import { RelayError } from "../core/errors.ts";
import type { Usage } from "../shared/types.ts";

export interface HttpResult {
  status: number;
  json: unknown;
  requestId?: string;
}

export async function requestJson(input: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<HttpResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(input.timeoutMs ?? 120_000);
  const signal = AbortSignal.any([input.signal, timeout]);
  let response: Response;
  try {
    response = await fetchImpl(input.url, {
      method: input.method ?? "POST",
      headers: {
        accept: "application/json",
        ...(input.body === undefined ? {} : { "content-type": "application/json" }),
        ...input.headers,
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal,
    });
  } catch (error) {
    if (input.signal.aborted) throw new RelayError("cancelled", "Cancelled.", 499);
    const message = error instanceof Error ? error.message : "request failed";
    throw new RelayError("network", message, 502);
  }
  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 500) };
    }
  }
  const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined;
  if (!response.ok) {
    throw new RelayError(
      "provider",
      `${response.status} from ${new URL(input.url).host}: ${snippet(json)}`,
      response.status,
    );
  }
  return { status: response.status, json, requestId };
}

export function snippet(json: unknown): string {
  const text = typeof json === "string" ? json : JSON.stringify(json);
  return (text ?? "").slice(0, 500);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function readResponsesText(json: unknown): string {
  const record = asRecord(json);
  if (!record) return "";
  if (typeof record.output_text === "string" && record.output_text.trim()) return record.output_text;
  const output = Array.isArray(record.output) ? record.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    const row = asRecord(item);
    if (!row || row.type !== "message") continue;
    const content = Array.isArray(row.content) ? row.content : [];
    for (const part of content) {
      const piece = asRecord(part);
      if (piece && typeof piece.text === "string") chunks.push(piece.text);
    }
  }
  return chunks.join("\n").trim();
}

export function readCitations(json: unknown): { title: string; url: string }[] {
  const record = asRecord(json);
  const output = Array.isArray(record?.output) ? record.output : [];
  const citations: { title: string; url: string }[] = [];
  for (const item of output) {
    const row = asRecord(item);
    if (!row || row.type !== "search_results" || !Array.isArray(row.results)) continue;
    for (const result of row.results) {
      const entry = asRecord(result);
      if (entry && typeof entry.url === "string") {
        citations.push({ title: typeof entry.title === "string" ? entry.title : entry.url, url: entry.url });
      }
    }
  }
  return citations;
}

export function readUsage(json: unknown): Usage | undefined {
  const record = asRecord(json);
  const usage = asRecord(record?.usage);
  if (!usage) return undefined;
  const cost = asRecord(usage.cost);
  const result: Usage = {};
  if (typeof usage.input_tokens === "number") result.inputTokens = usage.input_tokens;
  if (typeof usage.output_tokens === "number") result.outputTokens = usage.output_tokens;
  if (typeof usage.total_tokens === "number") result.totalTokens = usage.total_tokens;
  if (typeof usage.inputTokens === "number") result.inputTokens = usage.inputTokens;
  if (typeof usage.outputTokens === "number") result.outputTokens = usage.outputTokens;
  if (typeof cost?.total_cost === "number") {
    result.reportedCostUsd = cost.total_cost;
    result.costSource = "provider usage.cost.total_cost";
  }
  return result;
}

export function readChatCompletionText(json: unknown): string {
  const record = asRecord(json);
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const first = asRecord(choices[0]);
  const message = asRecord(first?.message);
  return typeof message?.content === "string" ? message.content : "";
}
