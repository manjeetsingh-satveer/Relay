import { randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import sealedbox from "tweetnacl-sealedbox-js";
import { RelayError } from "../core/errors.ts";

/**
 * "Continue with GitHub": the Relay app signs the user in with GitHub's device flow and runs
 * Relay in a Codespace in *the user's own* GitHub account (their free monthly hours, no card,
 * nothing hosted by the Relay project). Docs:
 * - Device flow: https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 * - Codespaces API: https://docs.github.com/rest/codespaces/codespaces
 * - Codespaces secrets: https://docs.github.com/rest/codespaces/secrets
 */

export const RELAY_REPO = { owner: "manjeetsingh-satveer", repo: "Relay" };
export const RELAY_PORT = 43123;
const SECRET_NAME = "RELAY_SETUP_TOKEN";
const DISPLAY_NAME = "relay";
const MACHINE = "basicLinux32gb"; // 2 cores, 8 GB RAM
const IDLE_MINUTES = 20;
/** GitHub deletes a stopped Codespace after this long unused; 30 days is the maximum. */
const RETENTION_MINUTES = 30 * 24 * 60;
/** Wake the Codespace when it would be deleted within this window. */
const KEEPALIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SCOPE = "codespace";

type Fetch = typeof fetch;

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

export type DevicePoll = { status: "pending" | "slow_down" } | { status: "done"; token: string } | { status: "expired" | "denied" };

export interface CodespaceInfo {
  name: string;
  state: string;
  url: string;
  created: boolean;
  /** Only set right after creation: the one-time code for Relay's sign-up screen. */
  setupToken?: string;
}

export async function startDeviceFlow(clientId: string, fetchImpl: Fetch = fetch): Promise<DeviceCode> {
  const response = await fetchImpl("https://github.com/login/device/code", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: SCOPE }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof body.device_code !== "string") {
    throw new RelayError("github", `GitHub sign-in could not start (${String(body.error_description ?? body.error ?? response.status)}). Check that device flow is enabled on the OAuth app.`);
  }
  return {
    deviceCode: body.device_code,
    userCode: String(body.user_code),
    verificationUri: String(body.verification_uri),
    interval: Number(body.interval ?? 5),
    expiresIn: Number(body.expires_in ?? 900),
  };
}

export async function pollDeviceFlow(clientId: string, deviceCode: string, fetchImpl: Fetch = fetch): Promise<DevicePoll> {
  const response = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.access_token === "string") return { status: "done", token: body.access_token };
  if (body.error === "authorization_pending") return { status: "pending" };
  if (body.error === "slow_down") return { status: "slow_down" };
  if (body.error === "expired_token") return { status: "expired" };
  if (body.error === "access_denied") return { status: "denied" };
  throw new RelayError("github", `GitHub sign-in failed (${String(body.error_description ?? body.error ?? response.status)}).`);
}

export class GitHubCodespaces {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`https://api.github.com${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (response.status === 204) return undefined as T;
    const body = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (response.status === 401) throw new RelayError("github_signed_out", "Your GitHub sign-in expired. Continue with GitHub again.", 401);
    if (!response.ok) throw new RelayError("github", `GitHub: ${body.message ?? response.status} (${path.split("?")[0]})`, response.status >= 500 ? 502 : 400);
    return body;
  }

  async user(): Promise<{ login: string }> {
    return this.api("/user");
  }

  async repoId(): Promise<number> {
    const repo = await this.api<{ id: number }>(`/repos/${RELAY_REPO.owner}/${RELAY_REPO.repo}`);
    return repo.id;
  }

  /** Finds the user's Relay Codespace, creating it on first use and waking it if it's asleep. */
  async ensure(): Promise<CodespaceInfo> {
    const repositoryId = await this.repoId();
    const list = await this.api<{ codespaces: { name: string; state: string; display_name?: string; repository: { id: number } }[] }>(
      `/user/codespaces?repository_id=${repositoryId}&per_page=100`,
    );
    const mine = list.codespaces.filter((item) => item.repository.id === repositoryId);
    const existing = mine.find((item) => item.display_name === DISPLAY_NAME) ?? mine[0];
    if (existing) {
      if (["Shutdown", "ShuttingDown", "Stopped"].includes(existing.state)) {
        await this.api(`/user/codespaces/${existing.name}/start`, { method: "POST" });
      }
      return { name: existing.name, state: existing.state, url: relayUrl(existing.name), created: false };
    }
    // New Codespace: store the one-time setup code as an encrypted Codespaces secret first,
    // so the new machine starts with it and Relay's sign-up screen can be pre-filled.
    const setupToken = randomBytes(12).toString("base64url");
    await this.setSecret(SECRET_NAME, setupToken, repositoryId);
    const created = await this.api<{ name: string; state: string }>("/user/codespaces", {
      method: "POST",
      body: JSON.stringify({
        repository_id: repositoryId,
        ref: "main",
        machine: MACHINE,
        idle_timeout_minutes: IDLE_MINUTES,
        retention_period_minutes: RETENTION_MINUTES,
        display_name: DISPLAY_NAME,
      }),
    });
    return { name: created.name, state: created.state, url: relayUrl(created.name), created: true, setupToken };
  }

  /**
   * Stops GitHub from deleting an unused Codespace: if it would be deleted within 7 days,
   * start it briefly (which resets the retention clock), then stop it again. Uses ~2 minutes
   * of the user's free hours. Never creates a Codespace.
   */
  async keepAlive(now = Date.now(), sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<{ action: "none" | "renewed"; name?: string; expiresAt?: string | null }> {
    const repositoryId = await this.repoId();
    const list = await this.api<{ codespaces: { name: string; state: string; display_name?: string; repository: { id: number }; retention_expires_at?: string | null }[] }>(
      `/user/codespaces?repository_id=${repositoryId}&per_page=100`,
    );
    const mine = list.codespaces.filter((item) => item.repository.id === repositoryId);
    const relay = mine.find((item) => item.display_name === DISPLAY_NAME) ?? mine[0];
    if (!relay) return { action: "none" };
    const expiresAt = relay.retention_expires_at ? Date.parse(relay.retention_expires_at) : null;
    if (relay.state !== "Shutdown" || expiresAt === null || expiresAt - now > KEEPALIVE_WINDOW_MS) {
      return { action: "none", name: relay.name, expiresAt: relay.retention_expires_at ?? null };
    }
    await this.api(`/user/codespaces/${relay.name}/start`, { method: "POST" });
    for (let i = 0; i < 60; i += 1) {
      await sleep(5000);
      if ((await this.state(relay.name)) === "Available") break;
    }
    await this.api(`/user/codespaces/${relay.name}/stop`, { method: "POST" });
    return { action: "renewed", name: relay.name };
  }

  /** The Relay Codespace's deletion date (only set while it is stopped), without changing anything. */
  async expiry(): Promise<{ name: string; state: string; expiresAt: string | null } | null> {
    const repositoryId = await this.repoId();
    const list = await this.api<{ codespaces: { name: string; state: string; display_name?: string; repository: { id: number }; retention_expires_at?: string | null }[] }>(
      `/user/codespaces?repository_id=${repositoryId}&per_page=100`,
    );
    const mine = list.codespaces.filter((item) => item.repository.id === repositoryId);
    const relay = mine.find((item) => item.display_name === DISPLAY_NAME) ?? mine[0];
    return relay ? { name: relay.name, state: relay.state, expiresAt: relay.retention_expires_at ?? null } : null;
  }

  async state(name: string): Promise<string> {
    const codespace = await this.api<{ state: string }>(`/user/codespaces/${name}`);
    return codespace.state;
  }

  /** Relay itself answers once the Codespace's start script has run (first build ~10 min). */
  async relayReady(name: string): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${relayUrl(name)}api/auth/state`, { headers: { "x-github-token": this.token } });
      return response.ok && (await response.text()).includes("required");
    } catch {
      return false;
    }
  }

  private async setSecret(name: string, value: string, repositoryId: number): Promise<void> {
    const key = await this.api<{ key_id: string; key: string }>("/user/codespaces/secrets/public-key");
    const sealed = sealedbox.seal(new TextEncoder().encode(value), Buffer.from(key.key, "base64"));
    await this.api(`/user/codespaces/secrets/${name}`, {
      method: "PUT",
      body: JSON.stringify({ encrypted_value: Buffer.from(sealed).toString("base64"), key_id: key.key_id, selected_repository_ids: [repositoryId] }),
    });
  }
}

export function relayUrl(name: string): string {
  return `https://${name}-${RELAY_PORT}.app.github.dev/`;
}

// Keep tweetnacl referenced so bundlers include it for the sealed box implementation.
void nacl;
