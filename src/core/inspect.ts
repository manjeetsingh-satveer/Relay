import type { IntegrationId, IntegrationView } from "../shared/types.ts";
import type { AttemptRecord, Store } from "./store.ts";
import type { SecretStore } from "./secrets.ts";
import { ADAPTERS } from "../adapters/catalog.ts";
import type { AdapterRuntime } from "../adapters/execute.ts";
import { probeCdp } from "../browser/cdp.ts";
import { probeGuest } from "../browser/guest-cli.ts";

export async function inspectIntegrations(input: {
  store: Store;
  secrets: SecretStore;
  runtime?: AdapterRuntime;
}): Promise<IntegrationView[]> {
  const fetchImpl = input.runtime?.fetchImpl;
  const browserUp = await probeCdp("http://127.0.0.1:9222", fetchImpl);
  const guestUp = await probeGuest("http://127.0.0.1:43125/health", fetchImpl);
  const useApi = input.store.data.settings.useApiKeys;
  const views: IntegrationView[] = [];
  for (const meta of ADAPTERS) {
    const attempts = input.store.data.attempts.filter((item) => item.adapterId === meta.id);
    const keyCheck = last(attempts, "key");
    const liveCheck = last(attempts, "live");
    const taskAttempts = attempts.filter((item) => item.kind === "task");
    const latest = attempts[attempts.length - 1];
    const lastSuccess = [...attempts].reverse().find((item) => item.ok && (item.kind === "live" || item.kind === "task"));
    const hasKey = meta.credential === "api-key" ? await input.secrets.has(meta.id) : false;
    let install: IntegrationView["install"] = "not-applicable";
    let installDetail: string | undefined;
    let auth: IntegrationView["auth"] = "unconfigured";
    let authDetail = "No credential is stored.";
    let availableForRouting = false;
    if (meta.support === "unsupported") {
      authDetail = "No credential applies. This integration is unsupported.";
    } else if (meta.credential === "browser") {
      install = browserUp ? "installed" : "not-installed";
      installDetail = browserUp
        ? "Chromium in the VM accepted a connection on 127.0.0.1:9222."
        : "The VM browser is not reachable. Start the VM from the Computer tab.";
      auth = browserUp ? "not-verified" : "unconfigured";
      authDetail = browserUp
        ? "The browser is open. Sign-in is checked when you send. Relay does not store a password."
        : "Sign in through the Computer tab after the VM desktop is up.";
      availableForRouting = browserUp;
    } else if (meta.credential === "vm-cli") {
      install = guestUp ? "installed" : "not-installed";
      installDetail = guestUp
        ? "The VM helper is listening on 127.0.0.1:43125. The CLI binary is checked when a task runs."
        : "The VM helper is not reachable. CLIs run inside the VM, not on the host.";
      auth = guestUp ? "not-verified" : "unconfigured";
      authDetail = "Login is whatever you completed inside the VM. Relay does not type it.";
      availableForRouting = guestUp;
    } else if (meta.credential === "api-key") {
      auth = hasKey ? "stored" : "unconfigured";
      authDetail = !useApi
        ? "API keys are off. The website path does not need one."
        : hasKey
          ? "A key is stored. That does not mean a request has succeeded."
          : "No API key is stored.";
      availableForRouting = useApi && hasKey && meta.id !== "drex";
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
      availableForRouting,
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

export function readyIds(views: IntegrationView[]): IntegrationId[] {
  return views.filter((view) => view.support === "supported").map((view) => view.id);
}
