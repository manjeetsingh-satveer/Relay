import type { IncomingMessage } from "node:http";
import { GitHubCodespaces, pollDeviceFlow, startDeviceFlow, type CodespaceInfo, type DeviceCode } from "../cloud/github.ts";
import { RelayError } from "../core/errors.ts";
import type { SecretStore } from "../core/secrets.ts";

/** Secret-store key for the user's GitHub token (encrypted with the OS on the desktop app). */
export const GITHUB_TOKEN_KEY = "github-cloud-token";

/**
 * Local endpoints behind the desktop app's "Continue with GitHub" screen. They run in the
 * app's own 127.0.0.1 server; the token never leaves this PC except to call GitHub.
 */
export function githubCloudRoutes(options: { clientId: string | undefined; secrets: SecretStore; fetchImpl?: typeof fetch }) {
  let pending: DeviceCode | null = null;
  let opened: CodespaceInfo | null = null;
  let opening: Promise<CodespaceInfo> | null = null;

  const client = () => {
    if (!options.clientId) {
      throw new RelayError("github_not_configured", "Continue with GitHub isn't configured in this build (missing GitHub OAuth client ID).", 503);
    }
    return options.clientId;
  };
  const codespaces = async () => {
    const token = await options.secrets.get(GITHUB_TOKEN_KEY);
    if (!token) throw new RelayError("github_signed_out", "Continue with GitHub first.", 401);
    return new GitHubCodespaces(token, options.fetchImpl);
  };

  return async function handle(method: string, pathname: string, _request: IncomingMessage, body: () => Promise<Record<string, unknown>>): Promise<unknown | undefined> {
    if (!pathname.startsWith("/api/cloud/")) return undefined;
    if (method === "GET" && pathname === "/api/cloud/state") {
      const token = await options.secrets.get(GITHUB_TOKEN_KEY);
      if (!token) return { configured: Boolean(options.clientId), signedIn: false };
      try {
        const user = await new GitHubCodespaces(token, options.fetchImpl).user();
        return { configured: true, signedIn: true, login: user.login };
      } catch (error) {
        if (error instanceof RelayError && error.code === "github_signed_out") {
          await options.secrets.delete(GITHUB_TOKEN_KEY);
          return { configured: true, signedIn: false };
        }
        throw error;
      }
    }
    if (method === "POST" && pathname === "/api/cloud/github/start") {
      pending = await startDeviceFlow(client(), options.fetchImpl);
      return { userCode: pending.userCode, verificationUri: pending.verificationUri, interval: pending.interval, expiresIn: pending.expiresIn };
    }
    if (method === "POST" && pathname === "/api/cloud/github/poll") {
      if (!pending) throw new RelayError("github", "Start Continue with GitHub first.", 400);
      const result = await pollDeviceFlow(client(), pending.deviceCode, options.fetchImpl);
      if (result.status === "done") {
        await options.secrets.set(GITHUB_TOKEN_KEY, result.token);
        pending = null;
        return { status: "done" };
      }
      if (result.status === "expired" || result.status === "denied") pending = null;
      return { status: result.status };
    }
    if (method === "POST" && pathname === "/api/cloud/open") {
      // One open at a time: a double click (or React dev mode) must never create two Codespaces.
      opening ??= codespaces()
        .then((api) => api.ensure())
        .finally(() => {
          opening = null;
        });
      const next = await opening;
      // A later open finds the Codespace the first one created; keep its one-time setup code.
      if (opened?.name === next.name && opened.setupToken && !next.setupToken) {
        next.setupToken = opened.setupToken;
        next.created = true;
      }
      opened = next;
      return { name: opened.name, created: opened.created, state: opened.state };
    }
    if (method === "GET" && pathname === "/api/cloud/progress") {
      if (!opened) throw new RelayError("github", "Open your cloud desktop first.", 400);
      const api = await codespaces();
      const state = await api.state(opened.name);
      const ready = state === "Available" && (await api.relayReady(opened.name));
      const url = ready ? opened.url + (opened.setupToken ? `#setup=${opened.setupToken}` : "") : null;
      return { state, ready, url, created: opened.created };
    }
    if (method === "POST" && pathname === "/api/cloud/signout") {
      await options.secrets.delete(GITHUB_TOKEN_KEY);
      opened = null;
      void body;
      return { ok: true };
    }
    throw new RelayError("not_found", "Not found.", 404);
  };
}
