import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cronLines, dueBots, initialRunKey, type Bot } from "../src/core/bots.ts";
import { Alarm, WEEKLY_CRON, workflowYaml } from "../src/cloud/alarm.ts";
import { MemorySecretStore } from "../src/core/secrets.ts";
import { startServer } from "../src/server/app.ts";

function bot(schedule: Bot["schedule"], lastRunKey?: string): Bot {
  return { id: "b1", name: "Relay-Claude", agentId: "claude-web", job: "", memory: "", conversationId: "c1", createdAt: "", schedule, lastRunKey };
}

describe("bot schedules", () => {
  const morning = { time: "08:00", days: [1, 2, 3, 4, 5], prompt: "news", timeZone: "America/Los_Angeles" };
  // Monday 23 Nov 2026, 16:30 UTC = 08:30 in Los Angeles (PST, UTC-8).
  const mondayAfter = new Date("2026-11-23T16:30:00Z");
  const mondayBefore = new Date("2026-11-23T15:30:00Z");

  it("runs once a day after the time, and catches up after a late wake-up", () => {
    expect(dueBots([bot(morning)], mondayBefore)).toEqual([]);
    expect(dueBots([bot(morning)], mondayAfter).map((item) => item.dateKey)).toEqual(["2026-11-23"]);
    expect(dueBots([bot(morning, "2026-11-23")], mondayAfter)).toEqual([]);
  });

  it("skips days that aren't selected", () => {
    const sunday = new Date("2026-11-22T16:30:00Z");
    expect(dueBots([bot(morning)], sunday)).toEqual([]);
  });

  it("doesn't run immediately when saved after today's time", () => {
    expect(initialRunKey(morning, mondayAfter)).toBe("2026-11-23");
    expect(initialRunKey(morning, mondayBefore)).toBeUndefined();
  });

  it("converts local times to UTC cron, shifting days across midnight", () => {
    expect(cronLines([bot(morning)], mondayAfter)).toEqual(["0 16 * * 1,2,3,4,5"]);
    const lateNight = { ...morning, time: "20:15", days: [5] }; // Friday 20:15 PST = Saturday 04:15 UTC
    expect(cronLines([bot(lateNight)], mondayAfter)).toEqual(["15 4 * * 6"]);
    expect(cronLines([bot(null)], mondayAfter)).toEqual([]);
  });
});

describe("wake-up alarm", () => {
  it("writes a workflow that starts the Codespace at each time plus weekly", () => {
    const yaml = workflowYaml("relay-abc", ["0 16 * * 1"]);
    expect(yaml).toContain('- cron: "0 16 * * 1"');
    expect(yaml).toContain(`- cron: "${WEEKLY_CRON}"`);
    expect(yaml).toContain("CODESPACE: relay-abc");
    expect(yaml).toContain("secrets.RELAY_TOKEN");
    expect(yaml).not.toContain("tok-123");
  });

  it("creates the private repo, stores the token as a secret and writes the workflow", async () => {
    const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
    let repoExists = false;
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (url.endsWith("/user")) return reply(200, { login: "octo" });
      if (url.endsWith("/repos/octo/relay-alarm")) return repoExists ? reply(200, { id: 1 }) : reply(404, { message: "Not Found" });
      if (url.endsWith("/user/repos")) { repoExists = true; return reply(201, {}); }
      if (url.endsWith("/actions/secrets/public-key")) return reply(200, { key_id: "k1", key: Buffer.alloc(32, 7).toString("base64") });
      if (url.endsWith("/actions/secrets/RELAY_TOKEN")) return new Response(null, { status: 201 });
      if (url.includes("/contents/") && method === "GET") return reply(404, {});
      if (url.includes("/contents/") && method === "PUT") return reply(201, {});
      return reply(500, { message: "unexpected " + url });
    }) as typeof fetch;
    const result = await new Alarm("tok-123", fetchImpl).sync("relay-abc", ["0 16 * * 1"]);
    expect(result).toEqual({ repoUrl: "https://github.com/octo/relay-alarm", changed: true });
    const create = calls.find((call) => call.url.endsWith("/user/repos"));
    expect(create?.body).toMatchObject({ name: "relay-alarm", private: true });
    const secret = calls.find((call) => call.url.endsWith("/RELAY_TOKEN"));
    expect(JSON.stringify(secret?.body)).not.toContain("tok-123");
    const write = calls.find((call) => call.method === "PUT" && call.url.includes("/contents/"));
    expect(Buffer.from(String(write?.body?.content), "base64").toString()).toContain('cron: "0 16 * * 1"');
  });
});

describe("bot routes", () => {
  it("creates bots with their own chat, forces their agent, and saves schedules", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "relay-bots-"));
    const server = await startServer({ port: 0, dataDir: dir, secretStore: new MemorySecretStore() });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const created = await fetch(`${base}/api/bots`, { method: "POST", body: JSON.stringify({ name: "Relay-Claude", agentId: "claude-web", job: "Review" }) });
      expect(created.status).toBe(201);
      const bot = (await created.json()) as Bot;
      expect(server.store.conversation(bot.conversationId)?.title).toBe("Relay-Claude");
      expect(server.store.data.projects.some((item) => item.name === "Bots")).toBe(true);

      const duplicate = await fetch(`${base}/api/bots`, { method: "POST", body: JSON.stringify({ name: "relay-claude", agentId: "chatgpt-web" }) });
      expect(duplicate.status).toBe(400);
      const badAgent = await fetch(`${base}/api/bots`, { method: "POST", body: JSON.stringify({ name: "X", agentId: "openai" }) });
      expect(badAgent.status).toBe(400);

      const schedule = { time: "08:00", days: [1, 3], prompt: "Summarize AI news", timeZone: "Europe/London" };
      const updated = await fetch(`${base}/api/bots/${bot.id}`, { method: "PUT", body: JSON.stringify({ memory: "I like short answers", schedule }) });
      expect(updated.status).toBe(200);
      expect(server.store.data.bots[0]?.schedule).toEqual(schedule);
      expect(server.store.data.bots[0]?.memory).toBe("I like short answers");

      const noDays = await fetch(`${base}/api/bots/${bot.id}`, { method: "PUT", body: JSON.stringify({ schedule: { ...schedule, days: [] } }) });
      expect(noDays.status).toBe(400);

      const removed = await fetch(`${base}/api/bots/${bot.id}`, { method: "DELETE" });
      expect(removed.status).toBe(204);
      expect(server.store.data.bots).toEqual([]);
    } finally {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("mentions", () => {
  const make = (name: string): Bot => ({ ...bot(null), id: name, name });
  const all = [make("Relay-Claude"), make("Relay-ClaudeCode"), make("Relay-GrokBot")];
  it("finds mentioned bots in order, without confusing similar names", async () => {
    const { findMentions } = await import("../src/core/bots.ts");
    expect(findMentions("@Relay-GrokBot draft it, then @relay-claude review", all).map((item) => item.name)).toEqual(["Relay-GrokBot", "Relay-Claude"]);
    expect(findMentions("@Relay-ClaudeCode fix it", all).map((item) => item.name)).toEqual(["Relay-ClaudeCode"]);
    expect(findMentions("email me at a@Relay-Claude.com", all)).toEqual([]);
    expect(findMentions("@all go", all)).toHaveLength(3);
  });
});

describe("bots per chat", () => {
  it("only the chat's bots answer @mentions, and chats can be renamed and deleted", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "relay-chatbots-"));
    const server = await startServer({ port: 0, dataDir: dir, secretStore: new MemorySecretStore() });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const post = (url: string, body: unknown, method = "POST") => fetch(base + url, { method, body: JSON.stringify(body) });
      const claude = (await (await post("/api/bots", { name: "Relay-Claude", agentId: "claude-web" })).json()) as Bot;
      const grok = (await (await post("/api/bots", { name: "Relay-GrokBot", agentId: "grok-bot" })).json()) as Bot;
      const general = server.store.data.conversations.find((item) => item.title === "General")!;
      expect((await post(`/api/conversations/${general.id}`, { botIds: [claude.id], title: "Hosting" }, "PATCH")).status).toBe(200);
      expect(server.store.conversation(general.id)?.botIds).toEqual([claude.id]);
      expect(server.store.conversation(general.id)?.title).toBe("Hosting");
      // Grok Bot was removed from this chat, so @Relay-GrokBot is not a mention here.
      const sent = await post(`/api/conversations/${general.id}/messages`, { text: "@Relay-GrokBot hi", idempotencyKey: "k1", mode: "single" });
      const notices = server.store.data.messages.filter((item) => item.conversationId === general.id && item.role === "notice");
      expect(notices.some((item) => item.text.includes("Sent to @Relay-GrokBot"))).toBe(false);
      void sent; void grok;
      const botChat = await post(`/api/conversations/${claude.conversationId}`, { title: "x" }, "PATCH");
      expect(botChat.status).toBe(400);
      const fresh = (await (await post("/api/conversations", { projectId: general.projectId })).json()) as { id: string };
      expect((await fetch(`${base}/api/conversations/${fresh.id}`, { method: "DELETE" })).status).toBe(204);
      expect(server.store.conversation(fresh.id)).toBeUndefined();
    } finally {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
