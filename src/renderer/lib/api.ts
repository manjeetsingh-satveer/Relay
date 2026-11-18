import type { CallResolution, HealthInfo, IntegrationId, IntegrationView, Settings, TaskRecord, VmView } from "../../shared/types.ts";

export interface Bootstrap {
  health: HealthInfo;
  settings: Settings;
  projects: { id: string; name: string; repoUrl?: string; createdAt: string }[];
  conversations: { id: string; projectId: string; title: string; createdAt: string; updatedAt: string }[];
  contacts: { id: string; name: string; phone: string; notes: string; createdAt: string }[];
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
    const message = body?.error?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  bootstrap: () => request<Bootstrap>("/api/bootstrap"),
  settings: (settings: Settings) => request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  createProject: (name: string, repoUrl?: string) =>
    request<Bootstrap["projects"][number]>("/api/projects", { method: "POST", body: JSON.stringify({ name, repoUrl }) }),
  createConversation: (projectId: string) =>
    request<Bootstrap["conversations"][number]>("/api/conversations", { method: "POST", body: JSON.stringify({ projectId }) }),
  conversation: (id: string) => request<ConversationPayload>(`/api/conversations/${id}`),
  send: (id: string, body: { text: string; mode: "single" | "collaborative"; idempotencyKey: string; agentId?: string }) =>
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
  probe: (id: IntegrationId, kind: "key" | "live") =>
    request<{ ok: boolean; detail: string }>(`/api/integrations/${id}/probe`, { method: "POST", body: JSON.stringify({ kind }) }),
  addContact: (name: string, phone: string, notes: string) =>
    request("/api/contacts", { method: "POST", body: JSON.stringify({ name, phone, notes }) }),
  deleteContact: (id: string) => request(`/api/contacts/${id}`, { method: "DELETE" }),
  confirmCall: (contactId: string) =>
    request<{ placed: boolean; detail: string; contact: { name: string; phone: string } }>("/api/calls", {
      method: "POST",
      body: JSON.stringify({ contactId, confirm: true }),
    }),
  preflight: () => request<NonNullable<VmView["preflight"]>>("/api/vm/preflight", { method: "POST", body: "{}" }),
  provision: (body: { allowSoftwareEmulation?: boolean; acknowledgeLowMemory?: boolean }) =>
    request<VmView>("/api/vm/provision", { method: "POST", body: JSON.stringify(body) }),
  vmAction: (action: "start" | "shutdown" | "pause" | "resume" | "force-stop") =>
    request<VmView & { detail?: string }>(`/api/vm/${action}`, { method: "POST", body: "{}" }),
  share: (sharePath: string, writable: boolean) =>
    request<{ detail: string }>("/api/vm/share", { method: "POST", body: JSON.stringify({ path: sharePath, confirmShare: true, writable }) }),
  unshare: () => request("/api/vm/unshare", { method: "POST", body: "{}" }),
  serial: () => request<{ text: string }>("/api/vm/serial"),
  deleteVm: (confirmation: string) => request("/api/vm/delete", { method: "POST", body: JSON.stringify({ confirmation }) }),
};
