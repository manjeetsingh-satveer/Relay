import { requestJson } from "./http.ts";
import { RelayError } from "../core/errors.ts";

export async function probeKey(input: {
  id: string;
  apiKey: string;
  model: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; detail: string; requestId?: string }> {
  const headersFor = (header: Record<string, string>) => header;
  if (input.id === "openai") {
    const result = await requestJson({
      url: "https://api.openai.com/v1/models",
      method: "GET",
      headers: headersFor({ authorization: `Bearer ${input.apiKey}` }),
      signal: input.signal,
      fetchImpl: input.fetchImpl,
    });
    return { ok: true, detail: "OpenAI accepted the key on GET /v1/models. This is not a generation.", requestId: result.requestId };
  }
  if (input.id === "gemini") {
    const result = await requestJson({
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      method: "GET",
      headers: { "x-goog-api-key": input.apiKey },
      signal: input.signal,
      fetchImpl: input.fetchImpl,
    });
    return { ok: true, detail: "Gemini accepted the key on GET /v1beta/models. This is not a generation.", requestId: result.requestId };
  }
  if (input.id === "cursor") {
    const result = await requestJson({
      url: "https://api.cursor.com/v1/agents?limit=1",
      method: "GET",
      headers: { authorization: `Bearer ${input.apiKey}` },
      signal: input.signal,
      fetchImpl: input.fetchImpl,
    });
    return { ok: true, detail: "Cursor accepted the key on GET /v1/agents. No cloud agent was started.", requestId: result.requestId };
  }
  if (input.id === "xai") {
    const result = await requestJson({
      url: "https://api.x.ai/v1/models",
      method: "GET",
      headers: { authorization: `Bearer ${input.apiKey}` },
      signal: input.signal,
      fetchImpl: input.fetchImpl,
    });
    return { ok: true, detail: "xAI accepted the key on GET /v1/models. This is not Grok Bot.", requestId: result.requestId };
  }
  if (input.id === "drex") {
    const result = await requestJson({
      url: "https://console.nace.ai/v1/models",
      method: "GET",
      headers: { authorization: `Bearer ${input.apiKey}` },
      signal: input.signal,
      fetchImpl: input.fetchImpl,
    });
    return { ok: true, detail: "Nace accepted the key on GET /v1/models. Drex was not asked to route.", requestId: result.requestId };
  }
  throw new RelayError("no_key_probe", `${input.id} has no separate key check. Use the live check, which sends a real short prompt.`);
}

export async function probeLiveBody(id: string, model: string): Promise<{ url: string; headers: (key: string) => Record<string, string>; body: unknown } | null> {
  if (id === "openai") {
    return {
      url: "https://api.openai.com/v1/responses",
      headers: (key) => ({ authorization: `Bearer ${key}` }),
      body: { model: model || "gpt-4.1-mini", input: "Reply with the single word pong.", store: false },
    };
  }
  if (id === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
      body: { model: model || "claude-sonnet-5-5", max_tokens: 16, messages: [{ role: "user", content: "Reply with the single word pong." }] },
    };
  }
  if (id === "gemini") {
    const name = model || "gemini-3.5-flash-lite";
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent`,
      headers: (key) => ({ "x-goog-api-key": key }),
      body: { contents: [{ role: "user", parts: [{ text: "Reply with the single word pong." }] }] },
    };
  }
  if (id === "perplexity") {
    const body: Record<string, unknown> = { input: "Reply with the single word pong." };
    if (model) body.model = model;
    else body.effort = "low";
    return {
      url: "https://api.perplexity.ai/v1/agent",
      headers: (key) => ({ authorization: `Bearer ${key}` }),
      body,
    };
  }
  if (id === "drex") {
    return {
      url: "https://console.nace.ai/v1/systemone",
      headers: (key) => ({ authorization: `Bearer ${key}` }),
      body: {
        model: "drex-latest",
        state: "Reply with the single word pong.",
        questions: { is_pong: { type: "noul", instructions: "Does the state contain the word pong?" } },
      },
    };
  }
  return null;
}
