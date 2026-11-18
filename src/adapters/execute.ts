import { extractFencedFiles, mediaTypeFor } from "../core/artifacts.ts";
import { RelayError } from "../core/errors.ts";
import type { ContributionRole, IntegrationId, SessionMode, Usage } from "../shared/types.ts";
import { readChatCompletionText, readCitations, readResponsesText, readUsage, requestJson } from "./http.ts";

export interface ExecuteRequest {
  prompt: string;
  role: ContributionRole;
  continued: boolean;
  providerSessionId?: string;
  idempotencyKey: string;
  repoUrl?: string;
  workspace: string;
  model: string;
  apiKey: string | null;
  signal: AbortSignal;
}

export interface ProducedFile {
  name: string;
  bytes: Buffer;
  mediaType: string;
  source: string;
}

export interface ExecuteResult {
  text: string;
  sessionMode: SessionMode;
  sessionDetail: string;
  providerSessionId?: string;
  usage?: Usage;
  citations?: { title: string; url: string }[];
  files: ProducedFile[];
  requestId?: string;
}

export interface AdapterRuntime {
  fetchImpl?: typeof fetch;
  spawn?: SpawnFn;
  which?: (command: string) => Promise<string | null>;
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; signal: AbortSignal; env: NodeJS.ProcessEnv; input: string },
) => Promise<{ code: number; stdout: string; stderr: string }>;

function filesFromText(text: string, source: string): ProducedFile[] {
  return extractFencedFiles(text).map((file) => ({
    name: file.name,
    bytes: Buffer.from(file.text, "utf8"),
    mediaType: mediaTypeFor(file.name),
    source,
  }));
}

function requireKey(apiKey: string | null, name: string): string {
  if (!apiKey) throw new RelayError("unconfigured", `No ${name} is stored. Nothing was sent.`);
  return apiKey;
}

export async function executeOpenAI(request: ExecuteRequest, runtime: AdapterRuntime = {}): Promise<ExecuteResult> {
  const key = requireKey(request.apiKey, "OpenAI API key");
  const model = request.model || "gpt-4.1-mini";
  const body: Record<string, unknown> = { model, input: request.prompt, store: true };
  if (request.continued && request.providerSessionId) body.previous_response_id = request.providerSessionId;
  const result = await requestJson({
    url: "https://api.openai.com/v1/responses",
    headers: { authorization: `Bearer ${key}` },
    body,
    signal: request.signal,
    fetchImpl: runtime.fetchImpl,
  });
  const id = typeof (result.json as { id?: unknown }).id === "string" ? (result.json as { id: string }).id : undefined;
  const continued = Boolean(request.continued && request.providerSessionId);
  return {
    text: readResponsesText(result.json),
    providerSessionId: id,
    sessionMode: continued ? "continued" : request.prompt.includes("Earlier turns") ? "copied" : "new",
    sessionDetail: continued
      ? `Continued OpenAI response ${request.providerSessionId}.`
      : request.prompt.includes("Earlier turns")
        ? "Copied earlier Relay turns into a new OpenAI Responses request. There was no response id to continue."
        : "Started a new OpenAI Responses request.",
    usage: readUsage(result.json),
    files: filesFromText(readResponsesText(result.json), "Extracted from fenced files in the OpenAI reply."),
    requestId: result.requestId ?? id,
  };
}

export async function executeAnthropic(request: ExecuteRequest, runtime: AdapterRuntime = {}): Promise<ExecuteResult> {
  const key = requireKey(request.apiKey, "Anthropic API key");
  const model = request.model || "claude-sonnet-5-5";
  const result = await requestJson({
    url: "https://api.anthropic.com/v1/messages",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: { model, max_tokens: 4096, messages: [{ role: "user", content: request.prompt }] },
    signal: request.signal,
    fetchImpl: runtime.fetchImpl,
  });
  const content = (result.json as { content?: { text?: string }[] }).content ?? [];
  const text = content.map((part) => part.text ?? "").join("\n").trim();
  const usageRaw = (result.json as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  const id = (result.json as { id?: string }).id;
  return {
    text,
    sessionMode: request.prompt.includes("Earlier turns") ? "copied" : "new",
    sessionDetail: "Anthropic Messages is stateless. Relay sent this turn as a new request" +
      (request.prompt.includes("Earlier turns") ? " and copied earlier turns into it." : "."),
    usage: usageRaw
      ? { inputTokens: usageRaw.input_tokens, outputTokens: usageRaw.output_tokens }
      : undefined,
    files: filesFromText(text, "Extracted from fenced files in the Anthropic reply."),
    requestId: result.requestId ?? id,
  };
}

export async function executeGemini(request: ExecuteRequest, runtime: AdapterRuntime = {}): Promise<ExecuteResult> {
  const key = requireKey(request.apiKey, "Gemini API key");
  const model = request.model || "gemini-3.5-flash-lite";
  const result = await requestJson({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: { "x-goog-api-key": key },
    body: { contents: [{ role: "user", parts: [{ text: request.prompt }] }] },
    signal: request.signal,
    fetchImpl: runtime.fetchImpl,
  });
  const candidates = (result.json as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates ?? [];
  const text = (candidates[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("\n").trim();
  const usageRaw = (result.json as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }).usageMetadata;
  return {
    text,
    sessionMode: request.prompt.includes("Earlier turns") ? "copied" : "new",
    sessionDetail: "Gemini generateContent has no server-side Relay session. This was a new request" +
      (request.prompt.includes("Earlier turns") ? " with earlier turns copied in." : "."),
    usage: usageRaw
      ? {
          inputTokens: usageRaw.promptTokenCount,
          outputTokens: usageRaw.candidatesTokenCount,
          totalTokens: usageRaw.totalTokenCount,
        }
      : undefined,
    files: filesFromText(text, "Extracted from fenced files in the Gemini reply."),
    requestId: result.requestId,
  };
}

export async function executePerplexity(request: ExecuteRequest, runtime: AdapterRuntime = {}): Promise<ExecuteResult> {
  const key = requireKey(request.apiKey, "Perplexity API key");
  const body: Record<string, unknown> = {
    input: request.prompt,
    tools: [{ type: "web_search" }],
  };
  if (request.model) body.model = request.model;
  else body.effort = "low";
  if (request.continued && request.providerSessionId) body.previous_response_id = request.providerSessionId;
  const result = await requestJson({
    url: "https://api.perplexity.ai/v1/agent",
    headers: { authorization: `Bearer ${key}` },
    body,
    signal: request.signal,
    fetchImpl: runtime.fetchImpl,
  });
  const text = readResponsesText(result.json);
  const id = typeof (result.json as { id?: unknown }).id === "string" ? (result.json as { id: string }).id : undefined;
  const continued = Boolean(request.continued && request.providerSessionId);
  return {
    text,
    providerSessionId: id,
    sessionMode: continued ? "continued" : request.prompt.includes("Earlier turns") ? "copied" : "new",
    sessionDetail: continued
      ? `Continued Perplexity response ${request.providerSessionId}.`
      : "Sent a new Perplexity Agent API request with web search enabled.",
    usage: readUsage(result.json),
    citations: readCitations(result.json),
    files: [],
    requestId: result.requestId ?? id,
  };
}

export async function executeXai(request: ExecuteRequest, runtime: AdapterRuntime = {}): Promise<ExecuteResult> {
  const key = requireKey(request.apiKey, "xAI API key");
  if (!request.model) {
    throw new RelayError("model_required", "Set an xAI model id from the current xAI docs before sending. Relay does not guess one.");
  }
  const result = await requestJson({
    url: "https://api.x.ai/v1/chat/completions",
    headers: { authorization: `Bearer ${key}` },
    body: { model: request.model, messages: [{ role: "user", content: request.prompt }] },
    signal: request.signal,
    fetchImpl: runtime.fetchImpl,
  });
  const text = readChatCompletionText(result.json);
  return {
    text,
    sessionMode: request.prompt.includes("Earlier turns") ? "copied" : "new",
    sessionDetail: "xAI chat completions do not continue a Relay session. This was a new request" +
      (request.prompt.includes("Earlier turns") ? " with earlier turns copied in." : ". This is not a Grok Bot conversation."),
    usage: readUsage(result.json),
    files: filesFromText(text, "Extracted from fenced files in the xAI reply."),
    requestId: result.requestId,
  };
}

export async function executeCursor(request: ExecuteRequest, runtime: AdapterRuntime = {}): Promise<ExecuteResult> {
  const key = requireKey(request.apiKey, "Cursor API key");
  const headers = { authorization: `Bearer ${key}` };
  const fetchImpl = runtime.fetchImpl;
  let agentId = request.continued ? request.providerSessionId : undefined;
  let runId: string | undefined;
  if (!agentId) {
    const createdId = `bc-${request.idempotencyKey}`;
    const body: Record<string, unknown> = {
      prompt: { text: request.prompt },
      agentId: createdId,
      name: "Relay",
    };
    if (request.model) body.model = { id: request.model };
    if (request.repoUrl) body.repos = [{ url: request.repoUrl }];
    try {
      const created = await requestJson({
        url: "https://api.cursor.com/v1/agents",
        headers,
        body,
        signal: request.signal,
        fetchImpl,
        timeoutMs: 60_000,
      });
      const payload = created.json as { agent?: { id?: string }; run?: { id?: string } };
      agentId = payload.agent?.id ?? createdId;
      runId = payload.run?.id;
    } catch (error) {
      if (error instanceof RelayError && error.status === 409) {
        agentId = createdId;
        const existing = await requestJson({
          url: `https://api.cursor.com/v1/agents/${agentId}`,
          method: "GET",
          headers,
          signal: request.signal,
          fetchImpl,
        });
        runId = (existing.json as { latestRunId?: string }).latestRunId;
      } else {
        throw error;
      }
    }
  } else {
    const follow = await requestJson({
      url: `https://api.cursor.com/v1/agents/${agentId}/runs`,
      headers,
      body: { prompt: { text: request.prompt } },
      signal: request.signal,
      fetchImpl,
    });
    runId = (follow.json as { run?: { id?: string } }).run?.id;
  }
  if (!agentId || !runId) throw new RelayError("provider", "Cursor did not return an agent id and a run id.");
  const terminal = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);
  let run: { status?: string; result?: string; durationMs?: number; git?: { branches?: { prUrl?: string; branch?: string; repoUrl?: string }[] } } = {};
  while (!request.signal.aborted) {
    const polled = await requestJson({
      url: `https://api.cursor.com/v1/agents/${agentId}/runs/${runId}`,
      method: "GET",
      headers,
      signal: request.signal,
      fetchImpl,
    });
    run = polled.json as typeof run;
    if (run.status && terminal.has(run.status)) break;
    await delay(2000, request.signal);
  }
  if (request.signal.aborted) {
    await requestJson({
      url: `https://api.cursor.com/v1/agents/${agentId}/runs/${runId}/cancel`,
      headers,
      signal: AbortSignal.timeout(10_000),
      fetchImpl,
    }).catch(() => undefined);
    throw new RelayError("cancelled", "Cursor run cancel was requested.", 499);
  }
  if (run.status !== "FINISHED") {
    throw new RelayError("provider", `Cursor run ${runId} ended ${run.status ?? "without a status"}.`);
  }
  const files: ProducedFile[] = [];
  const listed = await requestJson({
    url: `https://api.cursor.com/v1/agents/${agentId}/artifacts`,
    method: "GET",
    headers,
    signal: request.signal,
    fetchImpl,
  });
  const items = ((listed.json as { items?: { path?: string }[] }).items ?? []).filter((item) => item.path);
  for (const item of items) {
    const downloaded = await requestJson({
      url: `https://api.cursor.com/v1/agents/${agentId}/artifacts/download?path=${encodeURIComponent(item.path ?? "")}`,
      method: "GET",
      headers,
      signal: request.signal,
      fetchImpl,
    });
    const url = (downloaded.json as { url?: string }).url;
    if (!url) continue;
    const fetchFn = fetchImpl ?? fetch;
    const fileResponse = await fetchFn(url, { signal: request.signal });
    if (!fileResponse.ok) {
      throw new RelayError("provider", `Cursor artifact ${item.path} download returned ${fileResponse.status}.`);
    }
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    files.push({
      name: item.path?.split("/").pop() || "artifact",
      bytes,
      mediaType: "application/octet-stream",
      source: `Downloaded from Cursor artifact ${item.path}.`,
    });
  }
  const links = (run.git?.branches ?? [])
    .map((branch) => [branch.repoUrl, branch.branch, branch.prUrl].filter(Boolean).join(" "))
    .filter(Boolean);
  const text = [run.result ?? "", links.length ? `Git: ${links.join("\n")}` : ""].filter(Boolean).join("\n\n");
  const duration = typeof run.durationMs === "number" ? ` Cursor reported durationMs ${run.durationMs}.` : "";
  return {
    text,
    providerSessionId: agentId,
    sessionMode: request.continued ? "continued" : "new",
    sessionDetail: (request.continued
      ? `Sent a follow-up run on Cursor agent ${agentId}.`
      : request.repoUrl
        ? `Started Cursor agent ${agentId} on ${request.repoUrl}.`
        : `Started a no-repo Cursor agent ${agentId}.`) + duration,
    usage: typeof run.durationMs === "number" ? undefined : undefined,
    files,
    requestId: runId,
  };
}

export async function executeClaudeCode(request: ExecuteRequest, runtime: AdapterRuntime = {}): Promise<ExecuteResult> {
  const command = (await (runtime.which ?? defaultWhich)("claude")) ?? "";
  if (!command) throw new RelayError("not_installed", "The claude binary is not on PATH. Nothing was run.");
  const spawn = runtime.spawn ?? defaultSpawn;
  const args = ["-p", "--output-format", "json", "--max-turns", "4", "--permission-mode", "acceptEdits"];
  if (request.model) args.push("--model", request.model);
  if (request.continued && request.providerSessionId) args.push("--resume", request.providerSessionId);
  const env = { ...process.env };
  if (request.apiKey) env.ANTHROPIC_API_KEY = request.apiKey;
  const result = await spawn(command, args, {
    cwd: request.workspace,
    signal: request.signal,
    env,
    input: request.prompt,
  });
  if (result.code !== 0) {
    throw new RelayError("provider", `claude exited ${result.code}: ${result.stderr.slice(0, 400) || result.stdout.slice(0, 400)}`);
  }
  let parsed: { result?: string; session_id?: string; is_error?: boolean; total_cost_usd?: number; duration_ms?: number } = {};
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new RelayError("provider", "claude did not return JSON.");
  }
  if (parsed.is_error) throw new RelayError("provider", parsed.result || "claude reported is_error.");
  const text = parsed.result ?? "";
  return {
    text,
    providerSessionId: parsed.session_id,
    sessionMode: request.continued && request.providerSessionId ? "continued" : request.prompt.includes("Earlier turns") ? "copied" : "new",
    sessionDetail: request.continued && request.providerSessionId
      ? `Resumed Claude Code session ${request.providerSessionId}.`
      : parsed.session_id
        ? `Started Claude Code session ${parsed.session_id} in the project workspace.`
        : "Claude Code finished without a session id.",
    usage: typeof parsed.total_cost_usd === "number"
      ? { reportedCostUsd: parsed.total_cost_usd, costSource: "Claude Code total_cost_usd" }
      : undefined,
    files: filesFromText(text, "Extracted from fenced files in the Claude Code result."),
    requestId: parsed.session_id,
  };
}

export async function executeGrokBot(): Promise<ExecuteResult> {
  throw new RelayError(
    "unsupported",
    "Grok Bot has no documented API for sending a message or placing a call from Relay. Nothing was sent.",
    501,
  );
}

async function defaultWhich(command: string): Promise<string | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    const { stdout } = await run(process.platform === "win32" ? "where" : "which", [command]);
    return stdout.split(/\r?\n/).find(Boolean)?.trim() ?? null;
  } catch {
    return null;
  }
}

const defaultSpawn: SpawnFn = async (command, args, options) => {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const onAbort = () => child.kill("SIGTERM");
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(options.input);
  });
};

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new RelayError("cancelled", "Cancelled.", 499));
      },
      { once: true },
    );
  });
}

export const EXECUTORS: Partial<Record<IntegrationId, (request: ExecuteRequest, runtime?: AdapterRuntime) => Promise<ExecuteResult>>> = {
  openai: executeOpenAI,
  anthropic: executeAnthropic,
  gemini: executeGemini,
  perplexity: executePerplexity,
  xai: executeXai,
  cursor: executeCursor,
  "claude-code": executeClaudeCode,
  "grok-bot": executeGrokBot,
};
