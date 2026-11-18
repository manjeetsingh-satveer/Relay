import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { executeCursor, executeGrokBot, executeOpenAI } from "../src/adapters/execute.ts";
import { ADAPTERS } from "../src/adapters/catalog.ts";

describe("adapter catalog", () => {
  it("marks Grok Bot unsupported and keeps Drex off the chat path", () => {
    const grok = ADAPTERS.find((item) => item.id === "grok-bot");
    const drex = ADAPTERS.find((item) => item.id === "drex");
    expect(grok?.support).toBe("unsupported");
    expect(grok?.capabilities.phone).toBe(false);
    expect(drex?.capabilities.chat).toBe(false);
    expect(drex?.summary).toMatch(/not a chat model/);
  });
});

describe("openai adapter", () => {
  it("continues a response id and does not resend history as a new transcript", async () => {
    let body: unknown;
    const result = await executeOpenAI(
      {
        prompt: "And the population?",
        role: "single",
        continued: true,
        providerSessionId: "resp_old",
        idempotencyKey: "11111111-1111-1111-1111-111111111111",
        workspace: "/tmp",
        model: "gpt-4.1-mini",
        apiKey: "sk-test",
        signal: AbortSignal.timeout(5000),
      },
      {
        fetchImpl: async (url, init) => {
          body = JSON.parse(String(init?.body));
          expect(String(url)).toBe("https://api.openai.com/v1/responses");
          expect(init?.headers).toMatchObject({ authorization: "Bearer sk-test" });
          return new Response(JSON.stringify({ id: "resp_new", output_text: "About 2 million." }), { status: 200 });
        },
      },
    );
    expect(body).toMatchObject({ previous_response_id: "resp_old", input: "And the population?" });
    expect(result.sessionMode).toBe("continued");
    expect(result.text).toBe("About 2 million.");
  });
});

describe("cursor adapter", () => {
  it("reuses an agent id on 409 instead of creating a second agent", async () => {
    const calls: string[] = [];
    const result = await executeCursor(
      {
        prompt: "Add a README",
        role: "single",
        continued: false,
        idempotencyKey: "22222222-2222-2222-2222-222222222222",
        repoUrl: "https://github.com/example/repo",
        workspace: "/tmp",
        model: "",
        apiKey: "cursor-test",
        signal: AbortSignal.timeout(5000),
      },
      {
        fetchImpl: async (url, init) => {
          const href = String(url);
          calls.push(`${init?.method ?? "POST"} ${href}`);
          if (href.endsWith("/v1/agents") && (init?.method ?? "POST") === "POST") {
            return new Response(JSON.stringify({ error: { code: "agent_id_conflict" } }), { status: 409 });
          }
          if (href.endsWith("/v1/agents/bc-22222222-2222-2222-2222-222222222222")) {
            return new Response(JSON.stringify({ id: "bc-22222222-2222-2222-2222-222222222222", latestRunId: "run-1" }), { status: 200 });
          }
          if (href.endsWith("/runs/run-1")) {
            return new Response(JSON.stringify({ id: "run-1", status: "FINISHED", result: "Added README.md" }), { status: 200 });
          }
          if (href.endsWith("/artifacts")) {
            return new Response(JSON.stringify({ items: [{ path: "artifacts/README.md" }] }), { status: 200 });
          }
          if (href.includes("/artifacts/download")) {
            return new Response(JSON.stringify({ url: "https://files.example/README.md" }), { status: 200 });
          }
          if (href === "https://files.example/README.md") {
            return new Response("# Relay\n", { status: 200 });
          }
          return new Response("unexpected", { status: 500 });
        },
      },
    );
    expect(calls.filter((call) => call.startsWith("POST https://api.cursor.com/v1/agents")).length).toBe(1);
    expect(result.text).toContain("Added README.md");
    expect(result.files[0]?.bytes.toString()).toBe("# Relay\n");
    expect(result.files[0]?.source).toMatch(/Cursor artifact/);
  });
});

describe("grok bot", () => {
  it("does not perform a network call", async () => {
    await expect(executeGrokBot()).rejects.toThrow(/Nothing was sent/);
  });
});

describe("workspace", () => {
  it("is created under the data directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay-ws-"));
    expect(dir).toBeTruthy();
  });
});
