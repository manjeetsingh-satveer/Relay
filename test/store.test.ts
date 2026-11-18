import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileEncryptedSecretStore } from "../src/core/secrets.ts";
import { Store } from "../src/core/store.ts";

describe("store", () => {
  it("marks an in-flight task interrupted after restart and does not rerun it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay-store-"));
    const store = await Store.open(dir);
    await store.update((data) => {
      data.tasks.push({
        id: "task-1",
        conversationId: "c",
        projectId: "p",
        idempotencyKey: "k",
        status: "running",
        mode: "single",
        userText: "hi",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        providerStarted: true,
        progress: [],
        contributions: [],
        reportedCostUsd: 0,
        unpricedCalls: 0,
      });
    });
    const reopened = await Store.open(dir);
    expect(reopened.task("task-1")?.status).toBe("interrupted");
    expect(reopened.task("task-1")?.progress.at(-1)?.message).toMatch(/not sent again/);
  });
});

describe("secrets", () => {
  it("writes ciphertext rather than the API key", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay-secret-"));
    const file = path.join(dir, "secrets.bin");
    const store = new FileEncryptedSecretStore(file, {
      isEncryptionAvailable: () => true,
      encryptString: (plain) => Buffer.from(`enc:${plain.length}:${"x".repeat(plain.length)}`),
      decryptString: (encrypted) => {
        const text = encrypted.toString("utf8");
        const length = Number(text.split(":")[1]);
        return "k".repeat(length);
      },
    }, {
      readFile: (target) => readFile(target),
      writeFile: async (target, data) => {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(target, data);
      },
      mkdir: async (target) => {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(target, { recursive: true });
      },
    });
    await store.set("openai", "super-secret-key-value");
    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain("super-secret-key-value");
    const reopened = new FileEncryptedSecretStore(file, {
      isEncryptionAvailable: () => true,
      encryptString: (plain) => Buffer.from(`enc:${plain.length}:${"x".repeat(plain.length)}`),
      decryptString: (encrypted) => "k".repeat(Number(encrypted.toString("utf8").split(":")[1])),
    }, {
      readFile: (target) => readFile(target),
      writeFile: async () => undefined,
      mkdir: async () => undefined,
    });
    expect(await reopened.get("openai")).toBe("k".repeat("super-secret-key-value".length));
  });
});
