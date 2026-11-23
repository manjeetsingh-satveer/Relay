import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import sealedbox from "tweetnacl-sealedbox-js";
import { GitHubCodespaces, pollDeviceFlow, relayUrl, startDeviceFlow } from "../src/cloud/github.ts";
import { githubCloudRoutes, GITHUB_TOKEN_KEY } from "../src/server/github-cloud.ts";
import { MemorySecretStore } from "../src/core/secrets.ts";

type Call = { method: string; url: string; body: unknown };

/** A tiny fake of the GitHub endpoints Relay uses. */
function fakeGitHub(options: { codespaces?: { name: string; state: string; display_name?: string; retention_expires_at?: string | null }[] } = {}) {
  const calls: Call[] = [];
  const keys = nacl.box.keyPair();
  let codespaces = [...(options.codespaces ?? [])];
  let secret: string | null = null;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (url === "https://github.com/login/device/code") return json(200, { device_code: "dev123", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", interval: 5, expires_in: 900 });
    if (url === "https://github.com/login/oauth/access_token") return json(200, calls.filter((c) => c.url === url).length < 2 ? { error: "authorization_pending" } : { access_token: "gho_test" });
    if (url.endsWith("/repos/manjeetsingh-satveer/Relay")) return json(200, { id: 42 });
    if (url.includes("/user/codespaces?repository_id=42")) return json(200, { codespaces: codespaces.map((c) => ({ ...c, repository: { id: 42 } })) });
    if (url.endsWith("/user/codespaces/secrets/public-key")) return json(200, { key_id: "k1", key: Buffer.from(keys.publicKey).toString("base64") });
    if (url.endsWith("/user/codespaces/secrets/RELAY_SETUP_TOKEN") && method === "PUT") {
      const opened = sealedbox.open(Buffer.from(body.encrypted_value, "base64"), keys.publicKey, keys.secretKey);
      secret = opened ? new TextDecoder().decode(opened) : null;
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/user/codespaces") && method === "POST") {
      const created = { name: "relay-abc", state: "Provisioning", display_name: body.display_name };
      codespaces.push(created);
      return json(201, created);
    }
    if (url.endsWith("/stop") && method === "POST") return json(200, {});
    if (url.endsWith("/start") && method === "POST") {
      codespaces = codespaces.map((c) => (url.includes(c.name) ? { ...c, state: "Starting" } : c));
      return json(200, {});
    }
    if (/\/user\/codespaces\/[^/?]+$/.test(url)) return json(200, { state: "Available" });
    if (url.endsWith(".app.github.dev/api/auth/state")) return json(200, { required: true, configured: false, authenticated: false });
    if (url.endsWith("/user")) return json(200, { login: "octo" });
    return json(404, { message: "not mocked: " + url });
  }) as typeof fetch;
  return { fetchImpl, calls, secret: () => secret };
}

describe("GitHub device flow", () => {
  it("returns the user code, then the token once approved", async () => {
    const gh = fakeGitHub();
    const code = await startDeviceFlow("client", gh.fetchImpl);
    expect(code.userCode).toBe("ABCD-1234");
    expect(await pollDeviceFlow("client", code.deviceCode, gh.fetchImpl)).toEqual({ status: "pending" });
    expect(await pollDeviceFlow("client", code.deviceCode, gh.fetchImpl)).toEqual({ status: "done", token: "gho_test" });
    expect(gh.calls[0]!.body).toMatchObject({ client_id: "client", scope: "codespace" });
  });
});

describe("keep-alive", () => {
  const now = Date.parse("2026-12-01T00:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const noWait = async () => undefined;
  it("wakes and re-stops a Codespace that would be deleted within 7 days", async () => {
    const gh = fakeGitHub({ codespaces: [{ name: "relay-old", state: "Shutdown", display_name: "relay", retention_expires_at: new Date(now + 3 * day).toISOString() }] });
    const result = await new GitHubCodespaces("gho_test", gh.fetchImpl).keepAlive(now, noWait);
    expect(result.action).toBe("renewed");
    const posts = gh.calls.filter((c) => c.method === "POST").map((c) => c.url.split("/").pop());
    expect(posts).toEqual(["start", "stop"]);
  });
  it("leaves it alone when deletion is far away, running, or there is no Codespace", async () => {
    for (const codespaces of [
      [{ name: "a", state: "Shutdown", display_name: "relay", retention_expires_at: new Date(now + 20 * day).toISOString() }],
      [{ name: "b", state: "Available", display_name: "relay", retention_expires_at: null }],
      [],
    ]) {
      const gh = fakeGitHub({ codespaces });
      expect((await new GitHubCodespaces("gho_test", gh.fetchImpl).keepAlive(now, noWait)).action).toBe("none");
      expect(gh.calls.some((c) => c.method === "POST")).toBe(false);
    }
  });
});

describe("Relay Codespace", () => {
  it("reuses and wakes the user's existing Relay Codespace", async () => {
    const gh = fakeGitHub({ codespaces: [{ name: "relay-old", state: "Shutdown", display_name: "relay" }] });
    const info = await new GitHubCodespaces("gho_test", gh.fetchImpl).ensure();
    expect(info).toMatchObject({ name: "relay-old", created: false, url: relayUrl("relay-old") });
    expect(gh.calls.some((c) => c.method === "POST" && c.url.endsWith("/user/codespaces/relay-old/start"))).toBe(true);
    expect(gh.calls.some((c) => c.method === "POST" && c.url.endsWith("/user/codespaces"))).toBe(false);
  });

  it("creates one with 2 cores / 8 GB, 20-minute sleep, and an encrypted setup code", async () => {
    const gh = fakeGitHub();
    const info = await new GitHubCodespaces("gho_test", gh.fetchImpl).ensure();
    expect(info.created).toBe(true);
    expect(info.setupToken).toBeTruthy();
    expect(gh.secret()).toBe(info.setupToken); // the sealed secret decrypts to the same code
    const create = gh.calls.find((c) => c.method === "POST" && c.url.endsWith("/user/codespaces"))!;
    expect(create.body).toEqual({ repository_id: 42, ref: "main", machine: "basicLinux32gb", idle_timeout_minutes: 20, retention_period_minutes: 43200, display_name: "relay" });
    const secretIndex = gh.calls.findIndex((c) => c.url.endsWith("RELAY_SETUP_TOKEN"));
    const createIndex = gh.calls.indexOf(create);
    expect(secretIndex).toBeLessThan(createIndex); // secret exists before the machine boots
  });

  it("never creates two Codespaces when opened twice at once, and passes the setup code to sign-up", async () => {
    const gh = fakeGitHub();
    const secrets = new MemorySecretStore();
    await secrets.set(GITHUB_TOKEN_KEY, "gho_test");
    const routes = githubCloudRoutes({ clientId: "client", secrets, fetchImpl: gh.fetchImpl });
    const req = {} as never;
    const noBody = async () => ({});
    await Promise.all([routes("POST", "/api/cloud/open", req, noBody), routes("POST", "/api/cloud/open", req, noBody)]);
    expect(gh.calls.filter((c) => c.method === "POST" && c.url.endsWith("/user/codespaces"))).toHaveLength(1);
    const progress = (await routes("GET", "/api/cloud/progress", req, noBody)) as { ready: boolean; url: string };
    expect(progress.ready).toBe(true);
    expect(progress.url).toBe(`${relayUrl("relay-abc")}#setup=${gh.secret()}`);
    const readyCheck = gh.calls.find((c) => c.url.endsWith(".app.github.dev/api/auth/state"));
    expect(readyCheck).toBeTruthy();
  });

  it("reports not configured without a client ID", async () => {
    const routes = githubCloudRoutes({ clientId: undefined, secrets: new MemorySecretStore() });
    expect(await routes("GET", "/api/cloud/state", {} as never, async () => ({}))).toEqual({ configured: false, signedIn: false });
  });
});
