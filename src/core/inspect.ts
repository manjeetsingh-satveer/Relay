import type { IntegrationId, IntegrationView } from "../shared/types.ts";
import type { AttemptRecord, Store } from "./store.ts";
import type { SecretStore } from "./secrets.ts";
import { ADAPTERS } from "../adapters/catalog.ts";
import type { AdapterRuntime } from "../adapters/execute.ts";

export async function inspectIntegrations(input: {
  store: Store;
  secrets: SecretStore;
  runtime?: AdapterRuntime;
}): Promise<IntegrationView[]> {
  const which = input.runtime?.which;
  const claude = which ? await which("claude") : await defaultWhich("claude");
  const views: IntegrationView[] = [];
  for (const meta of ADAPTERS) {
    const attempts = input.store.data.attempts.filter((item) => item.adapterId === meta.id);
    const keyCheck = last(attempts, "key");
    const liveCheck = last(attempts, "live");
    const taskAttempts = attempts.filter((item) => item.kind === "task");
    const latest = attempts[attempts.length - 1];
    const lastSuccess = [...attempts].reverse().find((item) => item.ok && (item.kind === "live" || item.kind === "task"));
    const hasKey = meta.credential === "none" ? false : await input.secrets.has(meta.id);
    let install: IntegrationView["install"] = "not-applicable";
    let installDetail: string | undefined;
    if (meta.id === "claude-code") {
      install = claude ? "installed" : "not-installed";
      installDetail = claude ? `Found ${claude}.` : "claude is not on PATH.";
    }
    let auth: IntegrationView["auth"] = "unconfigured";
    let authDetail = "No credential is stored.";
    if (meta.support === "unsupported") {
      authDetail = "No credential applies. This integration is unsupported.";
    } else if (meta.credential === "api-key") {
      auth = hasKey ? "stored" : "unconfigured";
      authDetail = hasKey ? "A key is stored. That does not mean a request has succeeded." : "No API key is stored.";
    } else if (meta.credential === "local-cli") {
      if (install !== "installed") {
        auth = "unconfigured";
        authDetail = "The CLI is not installed, so there is nothing to authenticate.";
      } else if (hasKey) {
        auth = "stored";
        authDetail = "An API key is stored and will be passed to the CLI as ANTHROPIC_API_KEY. A live check has not been implied.";
      } else {
        auth = "not-verified";
        authDetail = "The CLI is installed. Relay has not confirmed a login. A subscription is not a login check.";
      }
    }
    views.push({
      id: meta.id,
      displayName: meta.displayName,
      support: meta.support,
      unsupportedReason: meta.unsupportedReason,
      summary: meta.summary,
      docsUrl: meta.docsUrl,
      install,
      installDetail,
      auth,
      authDetail,
      keyCheck: toCheck(keyCheck),
      liveCheck: toCheck(liveCheck),
      lastSuccess: lastSuccess ? { at: lastSuccess.at, ok: true, detail: lastSuccess.detail, requestId: lastSuccess.requestId } : undefined,
      latestAttempt: latest ? { at: latest.at, ok: latest.ok, detail: latest.detail, requestId: latest.requestId } : taskAttempts.at(-1)
        ? undefined
        : undefined,
      capabilities: meta.capabilities,
      credential: meta.credential,
      model: input.store.data.settings.models[meta.id] ?? "",
      modelEditable: meta.modelEditable,
      modelHelp: meta.modelHelp,
    });
  }
  return views;
}

function last(attempts: AttemptRecord[], kind: AttemptRecord["kind"]): AttemptRecord | undefined {
  return [...attempts].reverse().find((item) => item.kind === kind);
}

function toCheck(attempt: AttemptRecord | undefined) {
  if (!attempt) return undefined;
  return { at: attempt.at, ok: attempt.ok, detail: attempt.detail, requestId: attempt.requestId };
}

async function defaultWhich(command: string): Promise<string | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const { stdout } = await promisify(execFile)(process.platform === "win32" ? "where" : "which", [command]);
    return stdout.split(/\r?\n/).find(Boolean)?.trim() ?? null;
  } catch {
    return null;
  }
}

export function readyIds(views: IntegrationView[]): IntegrationId[] {
  return views.filter((view) => view.support === "supported").map((view) => view.id);
}
