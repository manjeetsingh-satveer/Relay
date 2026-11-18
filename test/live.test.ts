import { describe, expect, it } from "vitest";
import { executeAnthropic } from "../src/adapters/execute.ts";
import { executeGemini } from "../src/adapters/execute.ts";
import { executePerplexity } from "../src/adapters/execute.ts";
import { executeXai } from "../src/adapters/execute.ts";
import { requestJson } from "../src/adapters/http.ts";

const live = process.env.RELAY_LIVE === "1";

describe.skipIf(!live || !process.env.OPENAI_API_KEY)("openai live", () => {
  it("returns text from the Responses API", async () => {
    const result = await requestJson({
      url: "https://api.openai.com/v1/responses",
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: { model: process.env.RELAY_OPENAI_MODEL || "gpt-4.1-mini", input: "Reply with the single word pong.", store: false },
      signal: AbortSignal.timeout(60_000),
    });
    expect(JSON.stringify(result.json).toLowerCase()).toContain("pong");
  });
});

describe.skipIf(!live || !process.env.ANTHROPIC_API_KEY)("anthropic live", () => {
  it("returns text from the Messages API", async () => {
    const result = await executeAnthropic({
      prompt: "Reply with the single word pong.",
      role: "single",
      continued: false,
      idempotencyKey: crypto.randomUUID(),
      workspace: process.cwd(),
      model: process.env.RELAY_ANTHROPIC_MODEL || "claude-sonnet-5-5",
      apiKey: process.env.ANTHROPIC_API_KEY ?? null,
      signal: AbortSignal.timeout(60_000),
    });
    expect(result.text.toLowerCase()).toContain("pong");
  });
});

describe.skipIf(!live || !process.env.GEMINI_API_KEY)("gemini live", () => {
  it("returns text from generateContent", async () => {
    const result = await executeGemini({
      prompt: "Reply with the single word pong.",
      role: "single",
      continued: false,
      idempotencyKey: crypto.randomUUID(),
      workspace: process.cwd(),
      model: process.env.RELAY_GEMINI_MODEL || "gemini-3.5-flash-lite",
      apiKey: process.env.GEMINI_API_KEY ?? null,
      signal: AbortSignal.timeout(60_000),
    });
    expect(result.text.toLowerCase()).toContain("pong");
  });
});

describe.skipIf(!live || !process.env.PERPLEXITY_API_KEY)("perplexity live", () => {
  it("returns text from the Agent API", async () => {
    const result = await executePerplexity({
      prompt: "Reply with the single word pong.",
      role: "single",
      continued: false,
      idempotencyKey: crypto.randomUUID(),
      workspace: process.cwd(),
      model: process.env.RELAY_PERPLEXITY_MODEL || "",
      apiKey: process.env.PERPLEXITY_API_KEY ?? null,
      signal: AbortSignal.timeout(90_000),
    });
    expect(result.text.toLowerCase()).toContain("pong");
  });
});

describe.skipIf(!live || !process.env.XAI_API_KEY || !process.env.RELAY_XAI_MODEL)("xai live", () => {
  it("returns text from the xAI API", async () => {
    const result = await executeXai({
      prompt: "Reply with the single word pong.",
      role: "single",
      continued: false,
      idempotencyKey: crypto.randomUUID(),
      workspace: process.cwd(),
      model: process.env.RELAY_XAI_MODEL || "",
      apiKey: process.env.XAI_API_KEY ?? null,
      signal: AbortSignal.timeout(60_000),
    });
    expect(result.text.toLowerCase()).toContain("pong");
  });
});

describe.skipIf(!live || !process.env.CURSOR_API_KEY)("cursor live", () => {
  it("accepts the key without starting an agent", async () => {
    const result = await requestJson({
      url: "https://api.cursor.com/v1/agents?limit=1",
      method: "GET",
      headers: { authorization: `Bearer ${process.env.CURSOR_API_KEY}` },
      signal: AbortSignal.timeout(30_000),
    });
    expect(result.status).toBe(200);
  });
});

describe.skipIf(!live || !process.env.NACE_API_KEY)("drex live", () => {
  it("answers a typed question", async () => {
    const result = await requestJson({
      url: "https://console.nace.ai/v1/systemone",
      headers: { authorization: `Bearer ${process.env.NACE_API_KEY}` },
      body: {
        model: "drex-latest",
        state: "The payout failed.",
        questions: { is_urgent: { type: "noul", instructions: "Does this convey urgency?" } },
      },
      signal: AbortSignal.timeout(60_000),
    });
    expect(result.json).toHaveProperty("answers");
  });
});
