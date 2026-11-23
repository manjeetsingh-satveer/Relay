import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { base32Encode, matchTotp, totp } from "../src/server/auth.ts";
import { MemorySecretStore } from "../src/core/secrets.ts";
import { startServer } from "../src/server/app.ts";

describe("TOTP", () => {
  it("matches the RFC 6238 SHA-1 test vectors (6-digit truncation)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totp(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totp(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totp(secret, Math.floor(1234567890 / 30))).toBe("005924");
  });

  it("accepts one step of clock drift and rejects older codes", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    const now = 1_000_000_000_000;
    const step = Math.floor(now / 30000);
    expect(matchTotp(secret, totp(secret, step - 1), now)).toBe(step - 1);
    expect(matchTotp(secret, totp(secret, step - 3), now)).toBeNull();
    expect(matchTotp(secret, "abc", now)).toBeNull();
  });
});

describe("login in cloud mode", () => {
  let dir = "";
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("requires setup code, password and authenticator code; blocks the API without a session", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "relay-auth-"));
    const server = await startServer({ port: 0, dataDir: dir, secretStore: new MemorySecretStore(), requireLogin: true });
    close = server.close;
    const base = `http://127.0.0.1:${server.port}`;
    const post = (p: string, body: unknown, cookie = "") =>
      fetch(base + p, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });

    expect((await fetch(base + "/api/bootstrap")).status).toBe(401);
    expect(await (await fetch(base + "/api/auth/state")).json()).toEqual({ required: true, configured: false, authenticated: false });

    const token = (await readFile(path.join(dir, "setup-token.txt"), "utf8")).trim();
    expect(token).toBe(server.setupToken);
    expect((await post("/api/auth/setup", { setupToken: "wrong", password: "correct horse battery" })).status).toBe(403);
    expect((await post("/api/auth/setup", { setupToken: token, password: "short" })).status).toBe(400);

    const begin = await (await post("/api/auth/setup", { setupToken: token, password: "correct horse battery" })).json();
    expect(begin.qrSvg).toContain("<svg");
    const step = Math.floor(Date.now() / 30000);
    expect((await post("/api/auth/setup/confirm", { code: "000000" === totp(begin.secret, step) ? "111111" : "000000" })).status).toBe(400);
    const confirmed = await post("/api/auth/setup/confirm", { code: totp(begin.secret, step) });
    expect(confirmed.status).toBe(200);
    const { recoveryCodes } = await confirmed.json();
    expect(recoveryCodes).toHaveLength(8);
    const setupCookie = confirmed.headers.get("set-cookie")!.split(";")[0]!;
    expect(confirmed.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Strict/);
    expect((await fetch(base + "/api/bootstrap", { headers: { cookie: setupCookie } })).status).toBe(200);

    // The setup code is gone once the account exists.
    await expect(readFile(path.join(dir, "setup-token.txt"), "utf8")).rejects.toThrow();
    const stored = await readFile(path.join(dir, "auth.json"), "utf8");
    expect(stored).not.toContain("correct horse battery");

    // A code used during setup can't be replayed; the right password + a recovery code works once.
    expect((await post("/api/auth/login", { password: "correct horse battery", code: totp(begin.secret, step) })).status).toBe(401);
    const recovered = await post("/api/auth/login", { password: "correct horse battery", code: recoveryCodes[0] });
    expect(recovered.status).toBe(200);
    expect((await post("/api/auth/login", { password: "correct horse battery", code: recoveryCodes[0] })).status).toBe(401);

    // Cross-site posts are refused even with a valid session.
    const crossSite = await fetch(base + "/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: setupCookie, origin: "https://evil.example" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(crossSite.status).toBe(403);

    // Sign out everywhere ends every session.
    expect((await post("/api/auth/logout", { everywhere: true }, setupCookie)).status).toBe(200);
    expect((await fetch(base + "/api/bootstrap", { headers: { cookie: setupCookie } })).status).toBe(401);
  });

  it("locks sign-in after repeated failures", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "relay-auth-"));
    const server = await startServer({ port: 0, dataDir: dir, secretStore: new MemorySecretStore(), requireLogin: true });
    close = server.close;
    const base = `http://127.0.0.1:${server.port}`;
    const post = (p: string, body: unknown) =>
      fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const begin = await (await post("/api/auth/setup", { setupToken: server.setupToken, password: "correct horse battery" })).json();
    await post("/api/auth/setup/confirm", { code: totp(begin.secret, Math.floor(Date.now() / 30000)) });
    for (let i = 0; i < 5; i += 1) expect((await post("/api/auth/login", { password: "wrong password!", code: "123456" })).status).toBe(401);
    expect((await post("/api/auth/login", { password: "wrong password!", code: "123456" })).status).toBe(429);
  });

  it("stays off for the local desktop app", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "relay-auth-"));
    const server = await startServer({ port: 0, dataDir: dir, secretStore: new MemorySecretStore() });
    close = server.close;
    const base = `http://127.0.0.1:${server.port}`;
    expect((await fetch(base + "/api/bootstrap")).status).toBe(200);
    expect(server.setupToken).toBe("");
  });
});
