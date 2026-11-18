import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemorySecretStore } from "../src/core/secrets.ts";
import { startServer } from "../src/server/app.ts";

async function serve() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "relay-api-"));
  const secrets = new MemorySecretStore();
  const server = await startServer({ port: 0, dataDir, secretStore: secrets, runtime: { fetchImpl } });
  return { server, secrets, dataDir };
}

const fetchImpl: typeof fetch = async (url, init) => {
  const href = String(url);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (href.includes("api.openai.com")) {
    return new Response(JSON.stringify({ id: "resp_1", output_text: "Done\n```index.html\n<h1>Portfolio</h1>\n```" }), { status: 200 });
  }
  if (href.includes("api.anthropic.com")) {
    expect(body.messages[0].content).toMatch(/untrusted-draft/);
    return new Response(JSON.stringify({ id: "msg_1", content: [{ text: "Needs a title.\nVerdict: revise" }], usage: { input_tokens: 10, output_tokens: 8 } }), { status: 200 });
  }
  return new Response("no", { status: 500 });
};

describe("http api", () => {
  it("fails a send with no credential and does not invent a reply", async () => {
    const { server, dataDir } = await serve();
    const base = `http://127.0.0.1:${server.port}`;
    const project = await post(base, "/api/projects", { name: "Site" });
    const conversation = await post(base, "/api/conversations", { projectId: project.id });
    const sent = await post(base, `/api/conversations/${conversation.id}/messages`, {
      text: "Build a portfolio website",
      mode: "single",
      idempotencyKey: "33333333-3333-3333-3333-333333333333",
    }, 202);
    await waitFor(async () => {
      const thread = await get(base, `/api/conversations/${conversation.id}`);
      return thread.tasks[0].status !== "running";
    });
    const thread = await get(base, `/api/conversations/${conversation.id}`);
    expect(thread.tasks[0].status).toBe("failed");
    expect(thread.tasks[0].providerStarted).toBe(false);
    expect(thread.messages.some((message: { role: string }) => message.role === "assistant")).toBe(false);
    const again = await post(base, `/api/conversations/${conversation.id}/messages`, {
      text: "Build a portfolio website",
      mode: "single",
      idempotencyKey: "33333333-3333-3333-3333-333333333333",
    }, 202);
    expect(again.task.id).toBe(sent.task.id);
    const after = await get(base, `/api/conversations/${conversation.id}`);
    expect(after.tasks).toHaveLength(1);
    const raw = await readFile(path.join(dataDir, "store.json"), "utf8");
    expect(raw).not.toContain("sk-live");
    await server.close();
  });

  it("runs a real adapter contract for draft and review, then saves the file", async () => {
    const { server, secrets } = await serve();
    await secrets.set("openai", "sk-test-openai");
    await secrets.set("anthropic", "sk-test-anthropic");
    const base = `http://127.0.0.1:${server.port}`;
    const project = await post(base, "/api/projects", { name: "Site" });
    const conversation = await post(base, "/api/conversations", { projectId: project.id });
    await post(base, `/api/conversations/${conversation.id}/messages`, {
      text: "Build a portfolio website",
      mode: "collaborative",
      agentId: "openai",
      idempotencyKey: "44444444-4444-4444-4444-444444444444",
    }, 202);
    await waitFor(async () => {
      const thread = await get(base, `/api/conversations/${conversation.id}`);
      return thread.tasks[0].status !== "running";
    });
    const thread = await get(base, `/api/conversations/${conversation.id}`);
    expect(thread.tasks[0].status).toBe("completed");
    expect(thread.tasks[0].contributions.map((item: { adapterId: string; role: string }) => `${item.adapterId}:${item.role}`)).toEqual([
      "openai:draft",
      "anthropic:review",
      "openai:revision",
    ]);
    expect(thread.tasks[0].contributions[0].sessionDetail).toMatch(/new OpenAI/);
    expect(thread.tasks[0].contributions[2].sessionDetail).toMatch(/Continued OpenAI/);
    expect(thread.artifacts[0].name).toBe("index.html");
    const file = await fetch(`${base}/api/artifacts/${thread.artifacts[0].id}`);
    expect(await file.text()).toContain("<h1>Portfolio</h1>");
    const integrations = await get(base, "/api/integrations");
    const dumped = JSON.stringify(integrations);
    expect(dumped).not.toContain("sk-test-openai");
    const grok = integrations.find((item: { id: string }) => item.id === "grok-bot");
    expect(grok.support).toBe("unsupported");
    await server.close();
  });

  it("does not place a call when the recipient is confirmed", async () => {
    const { server } = await serve();
    const base = `http://127.0.0.1:${server.port}`;
    const contact = await post(base, "/api/contacts", { name: "Arpanjeet", phone: "+1-202-555-0101" });
    const project = await post(base, "/api/projects", { name: "Calls" });
    const conversation = await post(base, "/api/conversations", { projectId: project.id });
    const resolved = await post(base, `/api/conversations/${conversation.id}/messages`, {
      text: "Call Arpanjeet",
      mode: "single",
      idempotencyKey: "55555555-5555-5555-5555-555555555555",
    });
    expect(resolved.call.kind).toBe("match");
    expect(resolved.call.contact.id).toBe(contact.id);
    const confirmed = await post(base, "/api/calls", { contactId: contact.id, confirm: true });
    expect(confirmed.placed).toBe(false);
    expect(confirmed.detail).toMatch(/No call was placed/);
    const preview = await post(base, "/api/calls", { contactId: contact.id, confirm: false });
    expect(preview.confirmationRequired).toBe(true);
    await server.close();
  });
});

async function post(base: string, pathname: string, body: unknown, status = 200) {
  const response = await fetch(base + pathname, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json();
  if (response.status !== status && response.status !== 201 && response.status !== 202) {
    throw new Error(`${pathname} ${response.status} ${JSON.stringify(json)}`);
  }
  if (status !== 200 && response.status !== status) {
    throw new Error(`${pathname} expected ${status} got ${response.status}`);
  }
  return json;
}

async function get(base: string, pathname: string) {
  const response = await fetch(base + pathname);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function waitFor(check: () => Promise<boolean>) {
  for (let i = 0; i < 50; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out");
}
