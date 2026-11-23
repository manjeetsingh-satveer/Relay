export const INTEGRATION_IDS = [
  "claude-web",
  "chatgpt-web",
  "gemini-web",
  "perplexity-web",
  "grok-web",
  "claude-code",
  "cursor-cli",
  "openai",
  "anthropic",
  "gemini",
  "perplexity",
  "xai",
  "cursor",
  "grok-bot",
  "drex",
] as const;

export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export type Support = "supported" | "unsupported";
export type InstallState = "not-applicable" | "installed" | "not-installed";
export type AuthState = "unconfigured" | "stored" | "not-verified";

export interface CheckRecord {
  at: string;
  ok: boolean;
  detail: string;
  requestId?: string;
}

export interface Capabilities {
  chat: boolean;
  files: boolean;
  review: boolean;
  codingAgent: boolean;
  sessionContinue: boolean;
  cancel: boolean;
  phone: boolean;
}

export interface IntegrationView {
  id: IntegrationId;
  displayName: string;
  support: Support;
  unsupportedReason?: string;
  summary: string;
  docsUrl: string;
  install: InstallState;
  installDetail?: string;
  auth: AuthState;
  authDetail: string;
  keyCheck?: CheckRecord;
  liveCheck?: CheckRecord;
  lastSuccess?: CheckRecord;
  latestAttempt?: CheckRecord;
  capabilities: Capabilities;
  credential: "api-key" | "none" | "vm-cli" | "browser";
  availableForRouting: boolean;
  model: string;
  modelEditable: boolean;
  modelHelp: string;
}

export type TaskStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";
export type SessionMode = "continued" | "copied" | "new";
export type ContributionRole = "single" | "draft" | "review" | "revision" | "discuss" | "final";
export type TaskMode = "single" | "collaborative" | "team";

export interface ProgressEvent {
  at: string;
  message: string;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reportedCostUsd?: number;
  costSource?: string;
}

export interface ArtifactRecord {
  id: string;
  projectId: string;
  conversationId: string;
  taskId: string;
  name: string;
  bytes: number;
  mediaType: string;
  source: string;
  createdAt: string;
}

export interface Contribution {
  id: string;
  adapterId: IntegrationId;
  role: ContributionRole;
  text: string;
  sessionMode: SessionMode;
  sessionDetail: string;
  providerSessionId?: string;
  usage?: Usage;
  citations?: { title: string; url: string }[];
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  error?: string;
}

export interface TaskRecord {
  id: string;
  conversationId: string;
  projectId: string;
  idempotencyKey: string;
  status: TaskStatus;
  mode: TaskMode;
  userText: string;
  createdAt: string;
  updatedAt: string;
  providerStarted: boolean;
  progress: ProgressEvent[];
  contributions: Contribution[];
  error?: string;
  routeExplanation?: string;
  reportedCostUsd: number;
  unpricedCalls: number;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "notice";
  text: string;
  createdAt: string;
  taskId?: string;
  adapterId?: IntegrationId;
}

export interface ProviderSession {
  providerSessionId: string;
  detail: string;
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sessions: Partial<Record<IntegrationId, ProviderSession>>;
}

export interface Project {
  id: string;
  name: string;
  repoUrl?: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  notes: string;
  createdAt: string;
}

export interface Limits {
  maxProviderCalls: number;
  maxWallClockMs: number;
  maxTurns: number;
  maxUsd: number | null;
}

export interface Settings {
  router: "local" | "drex";
  drexMinConfidence: number;
  limits: Limits;
  models: Partial<Record<IntegrationId, string>>;
  allowSameAgentReview: boolean;
  useApiKeys: boolean;
}

export interface CallResolution {
  kind: "not-a-call" | "no-match" | "ambiguous" | "match";
  query?: string;
  contact?: Contact;
  matches?: Contact[];
  reason?: string;
}

export interface VmLogLine {
  at: string;
  message: string;
}

export interface VmRecord {
  directory: string;
  baseImage: string;
  overlay: string;
  seedIso: string;
  sha256: string;
  checksumNote: string;
  guestUser: string;
  guestPassword: string;
  createdAt: string;
  memoryMb: number;
  cpus: number;
  accel: "kvm" | "whpx" | "tcg";
  pid?: number;
  vncPort?: number;
  qmpSocket: string;
  serialLog: string;
  stderrLog: string;
  pidFile: string;
  share?: { path: string; writable: boolean };
  log: VmLogLine[];
}

export interface PreflightReport {
  checkedAt: string;
  qemu: { found: boolean; path?: string; detail: string };
  virtualization: { available: boolean; detail: string };
  memory: { availableBytes: number; totalBytes: number; requiredBytes: number; ok: boolean };
  disk: { path: string; availableBytes: number; requiredBytes: number; ok: boolean };
  ok: boolean;
  notes: string[];
}

export interface VmView {
  record: VmRecord | null;
  process: "absent" | "running" | "paused";
  preflight?: PreflightReport;
  /** True when Relay runs on a cloud server and shows that server's own desktop (no local VM). */
  cloud?: boolean;
}

export interface HealthInfo {
  name: "relay";
  version: string;
  secretStorage: "memory" | "os";
  secretStorageDetail: string;
}
