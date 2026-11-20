import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdapterRuntime, ExecuteResult } from "../adapters/execute.ts";
import { EXECUTORS } from "../adapters/execute.ts";
import { adapterMeta } from "../adapters/catalog.ts";
import { runWebTask } from "../browser/cdp.ts";
import { runGuestCli } from "../browser/guest-cli.ts";
import { requestJson } from "../adapters/http.ts";
import { mediaTypeFor, safeArtifactName } from "./artifacts.ts";
import { RelayError, isRelayError } from "./errors.ts";
import { inspectIntegrations } from "./inspect.ts";
import { buildPrompt } from "./prompt.ts";
import { canExecute, drexRequest, interpretDrex, routeLocal } from "./router.ts";
import type { SecretStore } from "./secrets.ts";
import { createId, type Store } from "./store.ts";
import type { ArtifactRecord, IntegrationId, IntegrationView, TaskRecord } from "../shared/types.ts";

export interface SubmitInput {
  conversationId: string;
  text: string;
  mode: "single" | "collaborative";
  idempotencyKey: string;
  requested?: IntegrationId;
  forceNewSession?: boolean;
}

export class Coordinator {
  private aborts = new Map<string, AbortController>();

  constructor(
    private readonly store: Store,
    private readonly secrets: SecretStore,
    private readonly runtime: AdapterRuntime = {},
    private readonly onChange: () => void = () => undefined,
  ) {}

  async submit(input: SubmitInput): Promise<TaskRecord> {
    const existing = this.store.submission(input.idempotencyKey);
    if (existing) {
      const task = this.store.task(existing.taskId);
      if (!task) throw new RelayError("missing", "The saved submission points at a missing task.", 500);
      return task;
    }
    const conversation = this.store.conversation(input.conversationId);
    if (!conversation) throw new RelayError("not_found", "Conversation not found.", 404);
    if (this.store.data.tasks.some((task) => task.conversationId === conversation.id && task.status === "running")) {
      throw new RelayError("busy", "A task is already running in this conversation. Cancel it before sending another.");
    }
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: createId(),
      conversationId: conversation.id,
      projectId: conversation.projectId,
      idempotencyKey: input.idempotencyKey,
      status: "running",
      mode: input.mode,
      userText: input.text,
      createdAt: now,
      updatedAt: now,
      providerStarted: false,
      progress: [{ at: now, message: "Accepted. No provider has been called yet." }],
      contributions: [],
      reportedCostUsd: 0,
      unpricedCalls: 0,
    };
    await this.store.update((data) => {
      data.tasks.push(task);
      data.submissions.push({ key: input.idempotencyKey, taskId: task.id, conversationId: conversation.id });
      data.messages.push({
        id: createId(),
        conversationId: conversation.id,
        role: "user",
        text: input.text,
        createdAt: now,
        taskId: task.id,
      });
      if (conversation.title === "New conversation") {
        conversation.title = input.text.slice(0, 72);
        conversation.updatedAt = now;
      }
    });
    this.onChange();
    void this.run(task.id, input).catch((error) => {
      console.error("relay task failed to record", error instanceof Error ? error.message : error);
    });
    return task;
  }

  cancel(taskId: string): void {
    const controller = this.aborts.get(taskId);
    if (!controller) throw new RelayError("not_running", "That task is not running in this process.");
    controller.abort();
  }

  private async run(taskId: string, input: SubmitInput): Promise<void> {
    const controller = new AbortController();
    this.aborts.set(taskId, controller);
    const started = Date.now();
    try {
      const conversation = this.store.conversation(input.conversationId);
      const project = conversation ? this.store.project(conversation.projectId) : undefined;
      if (!conversation || !project) throw new RelayError("not_found", "Project or conversation disappeared.", 404);
      const views = await inspectIntegrations({ store: this.store, secrets: this.secrets, runtime: this.runtime });
      const limits = this.store.data.settings.limits;
      let calls = 0;
      const budget = () => {
        const task = this.must(taskId);
        if (Date.now() - started > limits.maxWallClockMs) {
          throw new RelayError("limit", `Stopped: wall-clock limit of ${limits.maxWallClockMs} ms.`);
        }
        if (calls >= limits.maxProviderCalls) {
          throw new RelayError("limit", `Stopped: provider call limit of ${limits.maxProviderCalls}.`);
        }
        if (limits.maxUsd !== null && task.unpricedCalls > 0 && calls > 0) {
          throw new RelayError("limit", "Stopped before another call because a previous provider did not report a cost and a spending cap is set. Relay will not invent a dollar amount.");
        }
        if (limits.maxUsd !== null && task.reportedCostUsd > limits.maxUsd) {
          throw new RelayError("limit", `Stopped: reported cost ${task.reportedCostUsd} is above ${limits.maxUsd}.`);
        }
      };

      let decision = routeLocal({
        prompt: input.text,
        mode: input.mode,
        requested: input.requested,
        repoUrl: project.repoUrl,
        available: views.filter(canExecute),
        allowSameAgentReview: this.store.data.settings.allowSameAgentReview,
      });

      if (!input.requested && this.store.data.settings.router === "drex") {
        budget();
        calls += 1;
        await this.progress(taskId, "Asking Drex to choose an agent. Drex does not write the reply.");
        try {
          const key = await this.secrets.get("drex");
          if (!key) throw new RelayError("unconfigured", "Drex is selected, but no Nace API key is stored.");
          const ready = views.filter(canExecute).map((view) => ({ id: view.id, description: view.summary.slice(0, 180) }));
          const response = await requestJson({
            url: "https://console.nace.ai/v1/systemone",
            headers: { authorization: `Bearer ${key}` },
            body: drexRequest(input.text, ready),
            signal: controller.signal,
            fetchImpl: this.runtime.fetchImpl,
          });
          const interpreted = interpretDrex({
            json: response.json,
            allowed: ready.map((item) => item.id),
            minConfidence: this.store.data.settings.drexMinConfidence,
          });
          if (interpreted.accepted && interpreted.assignee) {
            const routed = routeLocal({
              prompt: input.text,
              mode: input.mode,
              requested: interpreted.assignee,
              repoUrl: project.repoUrl,
              available: views.filter(canExecute),
              allowSameAgentReview: this.store.data.settings.allowSameAgentReview,
            });
            decision = {
              ...routed,
              source: "drex",
              explanation: `${interpreted.explanation} ${routed.explanation}`,
            };
          } else {
            decision = {
              ...decision,
              source: "drex-fallback",
              explanation: `${interpreted.explanation} Fell back to local rules. ${decision.explanation}`,
            };
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Drex request failed";
          decision = {
            ...decision,
            source: "drex-fallback",
            explanation: `Drex was not used (${message}). ${decision.explanation}`,
          };
        }
      }

      await this.store.update((data) => {
        const task = data.tasks.find((item) => item.id === taskId);
        if (task) task.routeExplanation = decision.explanation;
      });
      await this.progress(taskId, decision.explanation);
      if (decision.steps.length > limits.maxTurns) {
        throw new RelayError("limit", `This plan has ${decision.steps.length} steps and the turn limit is ${limits.maxTurns}.`);
      }

      let draft = "";
      let review = "";
      for (const step of decision.steps) {
        budget();
        const taskNow = this.must(taskId);
        if (taskNow.contributions.length >= limits.maxTurns) {
          throw new RelayError("limit", "Stopped: turn limit reached.");
        }
        calls += 1;
        const view = views.find((item) => item.id === step.adapterId);
        if (!view) throw new RelayError("agent_unavailable", `${step.adapterId} disappeared before the call.`);
        let result: ExecuteResult;
        try {
          result = await this.one(taskId, view, input, step.role, draft, review, controller.signal);
        } catch (error) {
          // Escalate: if this agent fails (not signed in, usage cap, timeout...), hand the same step
          // to the next ready agent instead of giving up. Cancels and limits still stop the task.
          const escalatable = step.role === "single" || step.role === "draft";
          if (!escalatable || controller.signal.aborted || (isRelayError(error) && (error.code === "cancelled" || error.code === "limit"))) throw error;
          let lastError = error;
          let done: ExecuteResult | null = null;
          for (const nextId of decision.fallbacks ?? []) {
            const next = views.find((item) => item.id === nextId);
            if (!next || next.id === view.id) continue;
            const reason = lastError instanceof Error ? lastError.message : "failed";
            await this.progress(taskId, `Escalating: the previous agent could not finish (${reason}). Trying ${next.displayName}.`);
            budget();
            calls += 1;
            try {
              done = await this.one(taskId, next, input, step.role, draft, review, controller.signal);
              break;
            } catch (nextError) {
              if (controller.signal.aborted) throw nextError;
              lastError = nextError;
            }
          }
          if (!done) throw lastError;
          result = done;
        }
        if (step.role === "draft" || step.role === "single" || step.role === "revision") draft = result.text;
        if (step.role === "review") review = result.text;
      }
      await this.finish(taskId, "completed");
    } catch (error) {
      const cancelled = controller.signal.aborted || (isRelayError(error) && error.code === "cancelled");
      const message = error instanceof Error ? error.message : "Task failed";
      await this.finish(taskId, cancelled ? "cancelled" : "failed", message);
    } finally {
      this.aborts.delete(taskId);
      this.onChange();
    }
  }

  private async one(
    taskId: string,
    view: IntegrationView,
    input: SubmitInput,
    role: TaskRecord["contributions"][number]["role"],
    draft: string,
    review: string,
    signal: AbortSignal,
  ): Promise<ExecuteResult> {
    const conversation = this.store.conversation(input.conversationId);
    if (!conversation) throw new RelayError("not_found", "Conversation not found.", 404);
    const session = conversation.sessions[view.id];
    const continued = Boolean(session && view.capabilities.sessionContinue && !input.forceNewSession && role !== "review");
    const history = this.store.data.messages.filter((message) => message.conversationId === conversation.id);
    const artifacts = this.store.data.artifacts.filter((item) => item.projectId === conversation.projectId);
    const prompt = buildPrompt({
      userText: input.text,
      history,
      artifacts,
      role,
      draftText: draft,
      reviewText: review,
      continued,
    });
    const workspace = await this.workspace(conversation.projectId);
    const before = view.id === "claude-code" ? await snapshot(workspace) : null;
    await this.progress(taskId, `Calling ${view.displayName} for the ${role} step.`);
    await this.store.update((data) => {
      const task = data.tasks.find((item) => item.id === taskId);
      if (task) task.providerStarted = true;
    });
    const startedAt = new Date().toISOString();
    const project = this.store.project(conversation.projectId);
    const meta = adapterMeta(view.id);
    let result: ExecuteResult;
    try {
      if (meta.credential === "browser") {
        result = await runWebTask({
          cdpUrl: "http://127.0.0.1:9222",
          siteId: view.id,
          prompt,
          continuedUrl: continued ? session?.providerSessionId : undefined,
          timeoutMs: this.store.data.settings.limits.maxWallClockMs,
          signal,
        });
      } else if (meta.credential === "vm-cli") {
        result = await runGuestCli({
          url: "http://127.0.0.1:43125/cli",
          bin: view.id === "cursor-cli" ? "cursor-agent" : "claude",
          prompt,
          resume: continued ? session?.providerSessionId : undefined,
          model: view.model,
          timeoutMs: this.store.data.settings.limits.maxWallClockMs,
          signal,
          fetchImpl: this.runtime.fetchImpl,
        });
      } else {
        const execute = EXECUTORS[view.id];
        if (!execute) throw new RelayError("unsupported", `${view.displayName} cannot run a task.`);
        result = await execute(
        {
          prompt,
          role,
          continued,
          providerSessionId: session?.providerSessionId,
          idempotencyKey: `${input.idempotencyKey}:${role}:${view.id}`,
          repoUrl: project?.repoUrl,
          workspace,
          model: view.model,
          apiKey: await this.secrets.get(view.id),
          signal,
        },
        this.runtime,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider call failed";
      await this.recordAttempt(view.id, false, message);
      throw error;
    }
    if (before) {
      const changed = await changedFiles(workspace, before);
      for (const file of changed) {
        result.files.push({
          name: file.name,
          bytes: file.bytes,
          mediaType: mediaTypeFor(file.name),
          source: "Copied from the project workspace after Claude Code exited.",
        });
      }
    }
    const finishedAt = new Date().toISOString();
    const saved = await this.saveFiles(taskId, conversation.projectId, conversation.id, result);
    await this.store.update((data) => {
      const task = data.tasks.find((item) => item.id === taskId);
      const convo = data.conversations.find((item) => item.id === conversation.id);
      if (!task || !convo) return;
      task.contributions.push({
        id: createId(),
        adapterId: view.id,
        role,
        text: result.text,
        sessionMode: result.sessionMode,
        sessionDetail: result.sessionDetail,
        providerSessionId: result.providerSessionId,
        usage: result.usage,
        citations: result.citations,
        startedAt,
        finishedAt,
        ok: true,
      });
      if (typeof result.usage?.reportedCostUsd === "number") task.reportedCostUsd += result.usage.reportedCostUsd;
      else task.unpricedCalls += 1;
      if (result.providerSessionId) {
        convo.sessions[view.id] = { providerSessionId: result.providerSessionId, detail: result.sessionDetail };
      }
      data.messages.push({
        id: createId(),
        conversationId: convo.id,
        role: "assistant",
        text: result.text,
        createdAt: finishedAt,
        taskId,
        adapterId: view.id,
      });
      data.messages.push({
        id: createId(),
        conversationId: convo.id,
        role: "notice",
        text: result.sessionDetail,
        createdAt: finishedAt,
        taskId,
        adapterId: view.id,
      });
      if (saved.length > 0) {
        data.messages.push({
          id: createId(),
          conversationId: convo.id,
          role: "notice",
          text: `Saved ${saved.length} file${saved.length === 1 ? "" : "s"}: ${saved.map((item) => item.name).join(", ")}.`,
          createdAt: finishedAt,
          taskId,
        });
      }
      task.updatedAt = finishedAt;
    });
    await this.recordAttempt(view.id, true, `${role} step finished.`, result.requestId);
    await this.progress(taskId, `${view.displayName} finished the ${role} step.`);
    this.onChange();
    return result;
  }

  private async saveFiles(taskId: string, projectId: string, conversationId: string, result: ExecuteResult): Promise<ArtifactRecord[]> {
    const saved: ArtifactRecord[] = [];
    for (const file of result.files) {
      const record: ArtifactRecord = {
        id: createId(),
        projectId,
        conversationId,
        taskId,
        name: safeArtifactName(file.name),
        bytes: file.bytes.length,
        mediaType: file.mediaType,
        source: file.source,
        createdAt: new Date().toISOString(),
      };
      const dir = path.join(this.store.dir, "artifacts", record.id);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, record.name), file.bytes);
      saved.push(record);
    }
    if (saved.length > 0) {
      await this.store.update((data) => {
        data.artifacts.push(...saved);
      });
    }
    return saved;
  }

  private async recordAttempt(adapterId: IntegrationId, ok: boolean, detail: string, requestId?: string): Promise<void> {
    await this.store.update((data) => {
      data.attempts.push({ adapterId, kind: "task", at: new Date().toISOString(), ok, detail, requestId });
    });
  }

  private async progress(taskId: string, message: string): Promise<void> {
    await this.store.update((data) => {
      const task = data.tasks.find((item) => item.id === taskId);
      if (!task) return;
      task.progress.push({ at: new Date().toISOString(), message });
      task.updatedAt = new Date().toISOString();
    });
    this.onChange();
  }

  private async finish(taskId: string, status: "completed" | "failed" | "cancelled", error?: string): Promise<void> {
    await this.store.update((data) => {
      const task = data.tasks.find((item) => item.id === taskId);
      if (!task || task.status !== "running") return;
      task.status = status;
      task.error = error;
      task.updatedAt = new Date().toISOString();
    });
  }

  private must(taskId: string): TaskRecord {
    const task = this.store.task(taskId);
    if (!task) throw new RelayError("not_found", "Task not found.", 404);
    return task;
  }

  private async workspace(projectId: string): Promise<string> {
    const dir = path.join(this.store.dir, "projects", projectId, "workspace");
    await mkdir(dir, { recursive: true });
    return dir;
  }
}

async function snapshot(dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await walk(dir, map);
  return map;
}

async function walk(dir: string, map: Map<string, string>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, map);
    else if (entry.isFile()) {
      const info = await stat(full);
      map.set(full, `${info.size}:${info.mtimeMs}`);
    }
  }
}

async function changedFiles(dir: string, before: Map<string, string>): Promise<{ name: string; bytes: Buffer }[]> {
  const after = await snapshot(dir);
  const files: { name: string; bytes: Buffer }[] = [];
  for (const [full, mark] of after) {
    if (before.get(full) === mark) continue;
    const info = await stat(full);
    if (info.size > 200_000 || files.length >= 30) continue;
    files.push({ name: path.relative(dir, full), bytes: await readFile(full) });
  }
  return files;
}
