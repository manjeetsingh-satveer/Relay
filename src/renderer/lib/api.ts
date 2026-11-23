import type { CallResolution, HealthInfo, IntegrationId, IntegrationView, Settings, TaskRecord, VmView } from "../../shared/types.ts";

export interface BotSchedule { time: string; days: number[]; prompt: string; timeZone: string }
export interface BotView { id: string; name: string; agentId: string; job: string; memory: string; conversationId: string; createdAt: string; schedule: BotSchedule | null; lastRunKey?: string }

export interface Bootstrap {
  health: HealthInfo;
  settings: Settings;
  projects: { id: string; name: string; repoUrl?: string; createdAt: string }[];
  conversations: { id: string; projectId: string; title: string; createdAt: string; updatedAt: string }[];
  contacts: { id: string; name: string; phone: string; notes: string; createdAt: string }[];
  bots: BotView[];
  alarm: { ok: boolean; detail: string; at: string; repoUrl?: string } | null;
  alarmAvailable: boolean;
  vault: { id: string; kind: "address" | "note"; label: string; value: string; createdAt: string }[];
  integrations: IntegrationView[];
  vm: VmView;
}

export interface ConversationPayload {
  conversation: Bootstrap["conversations"][number];
  messages: { id: string; role: "user" | "assistant" | "notice"; text: string; createdAt: string; adapterId?: string; taskId?: string }[];
  tasks: TaskRecord[];
  artifacts: { id: string; name: string; bytes: number; source: string; mediaType: string }[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Session expired or signed out elsewhere: the login gate listens for this and shows sign-in.
    if (response.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("relay-unauthorized"));
    const message = body?.error?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export interface AuthState {
  required: boolean;
  configured: boolean;
  authenticated: boolean;
}

export const authApi = {
  state: () => request<AuthState>("/api/auth/state"),
  beginSetup: (setupToken: string, password: string) =>
    request<{ secret: string; uri: string; qrSvg: string }>("/api/auth/setup", { method: "POST", body: JSON.stringify({ setupToken, password }) }),
  confirmSetup: (code: string) =>
    request<{ recoveryCodes: string[] }>("/api/auth/setup/confirm", { method: "POST", body: JSON.stringify({ code }) }),
  login: (password: string, code: string) =>
    request<{ ok: true }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password, code }) }),
  logout: (everywhere = false) => request<{ ok: true }>("/api/auth/logout", { method: "POST", body: JSON.stringify({ everywhere }) }),
  sessions: () =>
    request<{ sessions: { createdAt: string; lastSeen: string; device: string }[]; recoveryCodesLeft: number }>("/api/auth/sessions"),
};

export const api = {
  bootstrap: () => request<Bootstrap>("/api/bootstrap"),
  settings: (settings: Settings) => request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  createProject: (name: string, repoUrl?: string) =>
    request<Bootstrap["projects"][number]>("/api/projects", { method: "POST", body: JSON.stringify({ name, repoUrl }) }),
  createConversation: (projectId: string) =>
    request<Bootstrap["conversations"][number]>("/api/conversations", { method: "POST", body: JSON.stringify({ projectId }) }),
  conversation: (id: string) => request<ConversationPayload>(`/api/conversations/${id}`),
  send: (id: string, body: { text: string; mode: "single" | "collaborative" | "team"; idempotencyKey: string; agentId?: string }) =>
    request<{ task: TaskRecord | null; call: CallResolution | null }>(`/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancel: (taskId: string) => request(`/api/tasks/${taskId}/cancel`, { method: "POST", body: "{}" }),
  retry: (taskId: string, idempotencyKey: string, forceNewSession: boolean) =>
    request<{ task: TaskRecord }>(`/api/tasks/${taskId}/retry`, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey, forceNewSession }),
    }),
  saveKey: (id: IntegrationId, apiKey: string) =>
    request(`/api/integrations/${id}/credentials`, { method: "PUT", body: JSON.stringify({ apiKey }) }),
  deleteKey: (id: IntegrationId) => request(`/api/integrations/${id}/credentials`, { method: "DELETE" }),
  openLogin: (id: IntegrationId) =>
    request<{ detail: string }>(`/api/integrations/${id}/open-login`, { method: "POST", body: "{}" }),
  probe: (id: IntegrationId, kind: "key" | "live") =>
    request<{ ok: boolean; detail: string }>(`/api/integrations/${id}/probe`, { method: "POST", body: JSON.stringify({ kind }) }),
  addContact: (name: string, phone: string, notes: string) =>
    request("/api/contacts", { method: "POST", body: JSON.stringify({ name, phone, notes }) }),
  createBot: (input: { name: string; agentId: string; job: string }) => request<BotView>("/api/bots", { method: "POST", body: JSON.stringify(input) }),
  updateBot: (id: string, input: { name?: string; job?: string; memory?: string; schedule?: BotSchedule | null }) =>
    request<BotView>(`/api/bots/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteBot: (id: string) => request(`/api/bots/${id}`, { method: "DELETE" }),
  runBot: (id: string) => request(`/api/bots/${id}/run`, { method: "POST", body: "{}" }),
  syncAlarm: () => request("/api/alarm/sync", { method: "POST", body: "{}" }),
  addVaultItem: (kind: "address" | "note", label: string, value: string) =>
    request("/api/vault", { method: "POST", body: JSON.stringify({ kind, label, value }) }),
  deleteVaultItem: (id: string) => request(`/api/vault/${id}`, { method: "DELETE" }),
  deleteContact: (id: string) => request(`/api/contacts/${id}`, { method: "DELETE" }),
  confirmCall: (contactId: string) =>
    request<{ placed: boolean; detail: string; contact: { name: string; phone: string } }>("/api/calls", {
      method: "POST",
      body: JSON.stringify({ contactId, confirm: true }),
    }),
};
