import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ArtifactRecord,
  Contact,
  Conversation,
  IntegrationId,
  MessageRecord,
  Project,
  Settings,
  TaskRecord,
  VmRecord,
} from "../shared/types.ts";

export interface Submission {
  key: string;
  taskId: string;
  conversationId: string;
}

export interface AttemptRecord {
  adapterId: IntegrationId;
  kind: "key" | "live" | "task";
  at: string;
  ok: boolean;
  detail: string;
  requestId?: string;
}

export interface StoreData {
  version: 1;
  projects: Project[];
  conversations: Conversation[];
  messages: MessageRecord[];
  tasks: TaskRecord[];
  submissions: Submission[];
  artifacts: ArtifactRecord[];
  contacts: Contact[];
  settings: Settings;
  attempts: AttemptRecord[];
  vm: VmRecord | null;
}

export const DEFAULT_SETTINGS: Settings = {
  router: "local",
  drexMinConfidence: 0.6,
  limits: {
    maxProviderCalls: 6,
    maxWallClockMs: 10 * 60 * 1000,
    maxTurns: 3,
    maxUsd: null,
  },
  models: {
    openai: "gpt-4.1-mini",
    anthropic: "claude-sonnet-5-5",
    gemini: "gemini-3.5-flash-lite",
    perplexity: "",
    xai: "",
    cursor: "",
    "claude-code": "sonnet",
  },
  allowSameAgentReview: false,
};

export function emptyStore(): StoreData {
  return {
    version: 1,
    projects: [],
    conversations: [],
    messages: [],
    tasks: [],
    submissions: [],
    artifacts: [],
    contacts: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    attempts: [],
    vm: null,
  };
}

export class Store {
  private chain: Promise<void> = Promise.resolve();
  data: StoreData;

  private constructor(
    readonly dir: string,
    data: StoreData,
  ) {
    this.data = data;
  }

  static async open(dir: string): Promise<Store> {
    await mkdir(dir, { recursive: true });
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
    await mkdir(path.join(dir, "projects"), { recursive: true });
    const file = path.join(dir, "store.json");
    let data: StoreData;
    try {
      data = JSON.parse(await readFile(file, "utf8")) as StoreData;
      if (data.version !== 1) throw new Error("unsupported store version");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        data = emptyStore();
      } else {
        try {
          data = JSON.parse(await readFile(file + ".bak", "utf8")) as StoreData;
          if (data.version !== 1) throw new Error("bad backup");
        } catch {
          throw new Error(
            `Relay could not read ${file}. The backup could not be read either. Nothing was reset.`,
          );
        }
      }
    }
    data.settings = { ...structuredClone(DEFAULT_SETTINGS), ...data.settings, models: { ...DEFAULT_SETTINGS.models, ...data.settings?.models }, limits: { ...DEFAULT_SETTINGS.limits, ...data.settings?.limits } };
    let changed = false;
    for (const task of data.tasks) {
      if (task.status === "running") {
        task.status = "interrupted";
        task.updatedAt = new Date().toISOString();
        task.progress.push({
          at: task.updatedAt,
          message: task.providerStarted
            ? "Relay restarted while the provider call was already in progress. It was not sent again. Retry only if you want another attempt."
            : "Relay restarted before a provider call started. It was not sent automatically.",
        });
        task.error = task.progress[task.progress.length - 1]?.message;
        changed = true;
      }
    }
    const store = new Store(dir, data);
    if (changed || !(await fileExists(file))) await store.save();
    return store;
  }

  update(mutator: (data: StoreData) => void): Promise<void> {
    const run = this.chain.then(async () => {
      mutator(this.data);
      await this.save();
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async save(): Promise<void> {
    const file = path.join(this.dir, "store.json");
    const tmp = file + ".tmp";
    const json = JSON.stringify(this.data, null, 2);
    await writeFile(tmp, json, { mode: 0o600 });
    try {
      await copyFile(file, file + ".bak");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(tmp, file);
  }

  project(id: string): Project | undefined {
    return this.data.projects.find((item) => item.id === id);
  }

  conversation(id: string): Conversation | undefined {
    return this.data.conversations.find((item) => item.id === id);
  }

  task(id: string): TaskRecord | undefined {
    return this.data.tasks.find((item) => item.id === id);
  }

  submission(key: string): Submission | undefined {
    return this.data.submissions.find((item) => item.key === key);
  }
}

export function createId(): string {
  return randomUUID();
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}
