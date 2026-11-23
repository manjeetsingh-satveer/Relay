import { RelayError } from "../core/errors.ts";
import type { ExecuteResult } from "../adapters/execute.ts";

export async function probeGuest(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(400) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function runGuestCli(input: {
  url: string;
  bin: "claude" | "cursor-agent";
  prompt: string;
  resume?: string;
  model?: string;
  timeoutMs: number;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<ExecuteResult> {
  const args = input.bin === "claude"
    ? ["-p", "--output-format", "json", "--permission-mode", "acceptEdits", ...(input.model ? ["--model", input.model] : []), ...(input.resume ? ["--resume", input.resume] : [])]
    : ["-p", input.prompt];
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(input.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bin: input.bin,
        args: input.bin === "claude" ? args : ["-p"],
        input: input.prompt,
        timeoutSec: Math.ceil(input.timeoutMs / 1000),
      }),
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal.aborted) throw new RelayError("cancelled", "Cancelled.", 499);
    throw new RelayError("vm-cli", "The VM helper is not reachable. Start the VM from the Computer tab. The CLI runs there, with the login on that machine.");
  }
  const body = await response.json() as { code?: number; stdout?: string; stderr?: string; error?: string };
  if (!response.ok) throw new RelayError("vm-cli", body.error || `Guest helper returned ${response.status}`);
  if (body.code === 127) throw new RelayError("not_installed", body.stderr || `${input.bin} is not installed in the VM.`);
  if (body.code !== 0) {
    // Claude Code prints a JSON result even on failure; show its message instead of the raw JSON.
    let detail = (body.stderr || body.stdout || "").trim();
    try {
      const parsedError = JSON.parse(body.stdout || "{}") as { result?: string };
      if (parsedError.result) detail = parsedError.result;
    } catch {
      // not JSON
    }
    if (/login|authenticat|api key|not logged in|run \/login/i.test(detail)) {
      throw new RelayError("login", `${input.bin === "claude" ? "Claude Code" : "Cursor CLI"} isn't signed in inside the VM. Open the Computer tab, open a terminal and run \`${input.bin === "claude" ? "claude" : "cursor-agent login"}\` once.`);
    }
    throw new RelayError("provider", `${input.bin} exited ${body.code}: ${detail.slice(0, 300)}`);
  }
  if (input.bin === "cursor-agent") {
    const text = (body.stdout || "").trim();
    if (!text) throw new RelayError("empty", "Cursor CLI returned no text. Nothing was invented.");
    return {
      text,
      files: [],
      sessionMode: "new",
      sessionDetail: "via Cursor CLI inside the VM. The CLI's own login was used. Relay did not type a password.",
    };
  }
  let parsed: { result?: string; session_id?: string; is_error?: boolean; total_cost_usd?: number } = {};
  try {
    parsed = JSON.parse(body.stdout || "");
  } catch {
    throw new RelayError("provider", "claude in the VM did not return JSON.");
  }
  if (parsed.is_error) throw new RelayError("provider", parsed.result || "claude reported an error.");
  const text = (parsed.result || "").trim();
  if (!text) throw new RelayError("empty", "Claude Code returned no text. Nothing was invented.");
  return {
    text,
    files: [],
    providerSessionId: parsed.session_id,
    sessionMode: input.resume ? "continued" : "new",
    sessionDetail: input.resume
      ? `via Claude Code inside the VM. Resumed session ${input.resume}.`
      : `via Claude Code inside the VM. Started session ${parsed.session_id ?? "without an id"}.`,
    usage: typeof parsed.total_cost_usd === "number" ? { reportedCostUsd: parsed.total_cost_usd, costSource: "Claude Code total_cost_usd" } : undefined,
    requestId: parsed.session_id,
  };
}
