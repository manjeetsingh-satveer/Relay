import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isRelayError, RelayError } from "../core/errors.ts";
import { Coordinator } from "../core/coordinator.ts";
import { inspectIntegrations } from "../core/inspect.ts";
import { resolveCall } from "../core/phone.ts";
import type { SecretStore } from "../core/secrets.ts";
import { Store, createId } from "../core/store.ts";
import { probeKey, probeLiveBody } from "../adapters/probe.ts";
import { readResponsesText } from "../adapters/http.ts";
import { requestJson } from "../adapters/http.ts";
import type { AdapterRuntime } from "../adapters/execute.ts";
import { VmManager } from "../vm/manager.ts";
import { preflight } from "../vm/qemu.ts";
import { isInside } from "../vm/checksum.ts";
import { attachVncProxy } from "./vnc.ts";
import { Auth, clientIp, deviceLabel, sameOrigin } from "./auth.ts";
import { INTEGRATION_IDS, type IntegrationId, type Settings } from "../shared/types.ts";
import { openLoginPage } from "../browser/cdp.ts";
import { siteById } from "../browser/sites.ts";
import { beginProvision as defaultBeginProvision } from "../vm/provision-lock.ts";

export interface ServerHandle {
  /** Set only in login mode before the owner account exists. */
  setupToken: string;
  port: number;
  store: Store;
  coordinator: Coordinator;
  close: () => Promise<void>;
}

export async function startServer(options: {
  host?: string;
  port: number;
  dataDir: string;
  secretStore: SecretStore;
  staticDir?: string;
  runtime?: AdapterRuntime;
  version?: string;
  beginProvision?: () => () => void;
  /**
   * Cloud mode: Relay runs on a Linux server whose own desktop, Chromium (CDP on 127.0.0.1:9222)
   * and CLI helper (127.0.0.1:43125) are local. No QEMU VM is started; the Computer tab shows the
   * server's desktop through the VNC server on this port.
   */
  cloudDesktop?: { vncPort: number };
  /** Require the owner's password + authenticator code. On by default in cloud mode. */
  requireLogin?: boolean;
}): Promise<ServerHandle> {
  const acquireProvision = options.beginProvision ?? defaultBeginProvision;
  const host = options.host ?? "127.0.0.1";
  const store = await Store.open(options.dataDir);
  // Older installs saved the original small limits; raise them so team mode (up to 5 steps) fits.
  {
    const limits = store.data.settings.limits;
    if (limits.maxTurns === 3 && limits.maxProviderCalls === 6 && limits.maxWallClockMs === 600000) {
      await store.update((data) => {
        data.settings.limits = { ...data.settings.limits, maxTurns: 8, maxProviderCalls: 12, maxWallClockMs: 20 * 60 * 1000 };
      });
    }
  }
  const auth = await Auth.open(options.dataDir, options.requireLogin ?? Boolean(options.cloudDesktop));
  // Give every install a ready-to-use "General" chat so people can type without creating a project.
  if (store.data.projects.length === 0) {
    const now = new Date().toISOString();
    const general = { id: createId(), name: "General", repoUrl: undefined, createdAt: now };
    await store.update((data) => {
      data.projects.push(general);
      data.conversations.push({ id: createId(), projectId: general.id, title: "General", createdAt: now, updatedAt: now, sessions: {} });
    });
  }
  const listeners = new Set<ServerResponse>();
  const notify = () => {
    for (const response of listeners) {
      response.write(`data: ${JSON.stringify({ type: "changed" })}\n\n`);
    }
  };
  const coordinator = new Coordinator(store, options.secretStore, options.runtime, notify);
  const vm = new VmManager(options.dataDir);
  const version = options.version ?? "0.1.0";

  const server = createServer(async (request, response) => {
    try {
      await route(request, response);
    } catch (error) {
      const status = isRelayError(error) ? error.status : 500;
      const message = error instanceof Error ? error.message : "Request failed";
      send(response, status, { error: { code: isRelayError(error) ? error.code : "internal", message } });
    }
  });

  attachVncProxy(
    server,
    async () => {
      if (options.cloudDesktop) return options.cloudDesktop.vncPort;
      const record = store.data.vm;
      return record?.vncPort && (await vm.isAlive(record)) ? record.vncPort : null;
    },
    (request) => auth.check(request) && sameOrigin(request),
  );

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const method = request.method ?? "GET";
    if (auth.required) {
      response.setHeader("x-frame-options", "DENY");
      response.setHeader("referrer-policy", "no-referrer");
      if (method !== "GET" && !sameOrigin(request)) throw new RelayError("bad_origin", "Blocked a request from another site.", 403);
    }
    if (url.pathname.startsWith("/api/auth/")) {
      if (method === "GET" && url.pathname === "/api/auth/state") return send(response, 200, auth.state(request));
      if (method === "POST" && url.pathname === "/api/auth/setup") {
        const body = await json(request);
        return send(response, 200, await auth.beginSetup({ setupToken: stringField(body, "setupToken") ?? "", password: typeof body.password === "string" ? body.password : "" }));
      }
      if (method === "POST" && url.pathname === "/api/auth/setup/confirm") {
        const body = await json(request);
        const result = await auth.confirmSetup({ code: stringField(body, "code") ?? "", device: deviceLabel(request) });
        response.setHeader("set-cookie", auth.cookieHeader(result.cookie, request));
        return send(response, 200, { recoveryCodes: result.recoveryCodes });
      }
      if (method === "POST" && url.pathname === "/api/auth/login") {
        const body = await json(request);
        const token = await auth.login({
          password: typeof body.password === "string" ? body.password : "",
          code: stringField(body, "code") ?? "",
          ip: clientIp(request),
          device: deviceLabel(request),
        });
        response.setHeader("set-cookie", auth.cookieHeader(token, request));
        return send(response, 200, { ok: true });
      }
      if (method === "POST" && url.pathname === "/api/auth/logout") {
        if (!auth.check(request)) return send(response, 200, { ok: true });
        const body = await json(request).catch(() => ({}) as Record<string, unknown>);
        response.setHeader("set-cookie", await auth.logout(request, body.everywhere === true));
        return send(response, 200, { ok: true });
      }
      if (method === "GET" && url.pathname === "/api/auth/sessions") {
        if (!auth.check(request)) throw new RelayError("unauthorized", "Sign in first.", 401);
        return send(response, 200, { sessions: auth.sessions(), recoveryCodesLeft: auth.recoveryCodesLeft() });
      }
      throw new RelayError("not_found", "Not found.", 404);
    }
    if (url.pathname.startsWith("/api/") && url.pathname !== "/api/health" && !auth.check(request)) {
      throw new RelayError("unauthorized", "Sign in first.", 401);
    }
    if (method === "GET" && url.pathname === "/api/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write("\n");
      listeners.add(response);
      request.on("close", () => listeners.delete(response));
      return;
    }
    if (method === "GET" && url.pathname === "/api/health") {
      return send(response, 200, {
        name: "relay",
        version,
        secretStorage: options.secretStore.kind,
        secretStorageDetail: options.secretStore.detail,
      });
    }
    if (method === "GET" && url.pathname === "/api/bootstrap") {
      const views = await inspectIntegrations({ store, secrets: options.secretStore, runtime: options.runtime });
      const vmView = await vmState();
      return send(response, 200, {
        health: {
          name: "relay",
          version,
          secretStorage: options.secretStore.kind,
          secretStorageDetail: options.secretStore.detail,
        },
        settings: store.data.settings,
        projects: store.data.projects,
        conversations: store.data.conversations,
        contacts: store.data.contacts,
        integrations: views,
        vm: vmView,
      });
    }
    if (method === "PUT" && url.pathname === "/api/settings") {
      const body = await json(request);
      const next = sanitizeSettings(body, store.data.settings);
      await store.update((data) => {
        data.settings = next;
      });
      notify();
      return send(response, 200, next);
    }
    if (method === "POST" && url.pathname === "/api/projects") {
      const body = await json(request);
      const name = stringField(body, "name");
      if (!name) throw new RelayError("invalid", "Project name is required.");
      const repoUrl = optionalString(body, "repoUrl");
      const project = { id: createId(), name, repoUrl, createdAt: new Date().toISOString() };
      await store.update((data) => data.projects.push(project));
      notify();
      return send(response, 201, project);
    }
    if (method === "POST" && url.pathname === "/api/conversations") {
      const body = await json(request);
      const projectId = stringField(body, "projectId");
      if (!projectId || !store.project(projectId)) throw new RelayError("not_found", "Project not found.", 404);
      const conversation = {
        id: createId(),
        projectId,
        title: optionalString(body, "title") || "New conversation",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sessions: {},
      };
      await store.update((data) => data.conversations.push(conversation));
      notify();
      return send(response, 201, conversation);
    }
    const conversationMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (method === "GET" && conversationMatch) {
      const id = conversationMatch[1]!;
      const conversation = store.conversation(id);
      if (!conversation) throw new RelayError("not_found", "Conversation not found.", 404);
      return send(response, 200, {
        conversation,
        messages: store.data.messages.filter((item) => item.conversationId === id),
        tasks: store.data.tasks.filter((item) => item.conversationId === id),
        artifacts: store.data.artifacts.filter((item) => item.conversationId === id),
      });
    }
    const messageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (method === "POST" && messageMatch) {
      const id = messageMatch[1]!;
      if (!store.conversation(id)) throw new RelayError("not_found", "Conversation not found.", 404);
      const body = await json(request);
      const text = stringField(body, "text");
      const idempotencyKey = stringField(body, "idempotencyKey");
      const mode = body.mode === "collaborative" || body.mode === "team" ? body.mode : "single";
      if (!text || !idempotencyKey) throw new RelayError("invalid", "text and idempotencyKey are required.");
      const requested = optionalIntegration(body, "agentId");
      const resolution = resolveCall(store.data.contacts, text);
      if (resolution.kind !== "not-a-call") {
        const existing = store.submission(idempotencyKey);
        if (existing) return send(response, 200, { call: resolution, task: store.task(existing.taskId) ?? null });
        const detail =
          resolution.kind === "match"
            ? `Matched ${resolution.contact?.name}. Confirm that contact on the Calls tab. Nothing was dialed.`
            : resolution.kind === "ambiguous"
              ? `More than one contact matches "${resolution.query}". Nothing was dialed.`
              : `No saved contact matches "${resolution.query}". Nothing was dialed.`;
        const now = new Date().toISOString();
        const taskId = createId();
        await store.update((data) => {
          data.tasks.push({
            id: taskId,
            conversationId: id,
            projectId: store.conversation(id)?.projectId ?? "",
            idempotencyKey,
            status: "completed",
            mode,
            userText: text,
            createdAt: now,
            updatedAt: now,
            providerStarted: false,
            progress: [{ at: now, message: detail }],
            contributions: [],
            routeExplanation: detail,
            reportedCostUsd: 0,
            unpricedCalls: 0,
          });
          data.submissions.push({ key: idempotencyKey, taskId, conversationId: id });
          data.messages.push({ id: createId(), conversationId: id, role: "user", text, createdAt: now, taskId });
          data.messages.push({ id: createId(), conversationId: id, role: "notice", text: detail, createdAt: now, taskId });
        });
        notify();
        return send(response, 200, { call: resolution, task: store.task(taskId) ?? null });
      }
      const task = await coordinator.submit({ conversationId: id, text, mode, idempotencyKey, requested });
      return send(response, 202, { task, call: null });
    }
    const cancelMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
    if (method === "POST" && cancelMatch) {
      coordinator.cancel(cancelMatch[1]!);
      return send(response, 202, { ok: true });
    }
    const retryMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/retry$/);
    if (method === "POST" && retryMatch) {
      const previous = store.task(retryMatch[1]!);
      if (!previous) throw new RelayError("not_found", "Task not found.", 404);
      if (previous.status === "running") throw new RelayError("busy", "The task is still running.");
      const body = await json(request);
      const idempotencyKey = stringField(body, "idempotencyKey");
      if (!idempotencyKey) throw new RelayError("invalid", "idempotencyKey is required.");
      const task = await coordinator.submit({
        conversationId: previous.conversationId,
        text: previous.userText,
        mode: previous.mode,
        idempotencyKey,
        forceNewSession: body.forceNewSession === true,
      });
      return send(response, 202, { task });
    }
    if (method === "GET" && url.pathname === "/api/integrations") {
      return send(response, 200, await inspectIntegrations({ store, secrets: options.secretStore, runtime: options.runtime }));
    }
    const credentialMatch = url.pathname.match(/^\/api\/integrations\/([^/]+)\/credentials$/);
    if (credentialMatch && INTEGRATION_IDS.includes(credentialMatch[1] as IntegrationId)) {
      const id = credentialMatch[1] as IntegrationId;
      if (method === "PUT") {
        const body = await json(request);
        const apiKey = stringField(body, "apiKey");
        if (!apiKey || apiKey.length < 8) throw new RelayError("invalid", "apiKey is required.");
        await options.secretStore.set(id, apiKey.trim());
        notify();
        return send(response, 204, null);
      }
      if (method === "DELETE") {
        await options.secretStore.delete(id);
        notify();
        return send(response, 204, null);
      }
    }
    const loginMatch = url.pathname.match(/^\/api\/integrations\/([^/]+)\/open-login$/);
    if (method === "POST" && loginMatch) {
      const id = loginMatch[1] as IntegrationId;
      const site = siteById(id);
      if (!site) throw new RelayError("unsupported", "That integration has no sign-in page.");
      const detail = await openLoginPage("http://127.0.0.1:9222", site);
      return send(response, 200, { detail });
    }
    const probeMatch = url.pathname.match(/^\/api\/integrations\/([^/]+)\/probe$/);
    if (method === "POST" && probeMatch) {
      const id = probeMatch[1] as IntegrationId;
      if (!INTEGRATION_IDS.includes(id)) throw new RelayError("not_found", "Unknown integration.", 404);
      const body = await json(request);
      const kind = body.kind === "live" ? "live" : "key";
      const apiKey = await options.secretStore.get(id);
      if (!apiKey && id !== "claude-code") throw new RelayError("unconfigured", "No key is stored.");
      const model = store.data.settings.models[id] ?? "";
      const signal = AbortSignal.timeout(60_000);
      try {
        if (kind === "key") {
          if (!apiKey) throw new RelayError("unconfigured", "No key is stored.");
          const result = await probeKey({ id, apiKey, model, signal, fetchImpl: options.runtime?.fetchImpl });
          await remember(id, "key", true, result.detail, result.requestId);
          return send(response, 200, result);
        }
        const live = await probeLiveBody(id, model);
        if (!live) throw new RelayError("no_live_probe", "This integration has no live generation check.");
        if (!apiKey) throw new RelayError("unconfigured", "No key is stored.");
        const result = await requestJson({
          url: live.url,
          headers: live.headers(apiKey),
          body: live.body,
          signal,
          fetchImpl: options.runtime?.fetchImpl,
        });
        const text = readResponsesText(result.json);
        const detail = text ? `Live check returned: ${text.slice(0, 200)}` : "Live check returned a success status. The body had no text Relay could read.";
        await remember(id, "live", true, detail, result.requestId);
        return send(response, 200, { ok: true, detail, requestId: result.requestId });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Probe failed";
        await remember(id, kind, false, message);
        throw error;
      }
    }
    const artifactMatch = url.pathname.match(/^\/api\/artifacts\/([^/]+)$/);
    if (method === "GET" && artifactMatch) {
      const artifact = store.data.artifacts.find((item) => item.id === artifactMatch[1]);
      if (!artifact) throw new RelayError("not_found", "Artifact not found.", 404);
      const file = path.join(options.dataDir, "artifacts", artifact.id, artifact.name);
      if (!isInside(path.join(options.dataDir, "artifacts"), file)) throw new RelayError("refused", "Bad artifact path.");
      const info = await stat(file);
      response.writeHead(200, {
        "content-type": artifact.mediaType,
        "content-length": info.size,
        "content-disposition": `attachment; filename="${artifact.name}"`,
      });
      createReadStream(file).pipe(response);
      return;
    }
    if (method === "GET" && url.pathname === "/api/contacts") return send(response, 200, store.data.contacts);
    if (method === "POST" && url.pathname === "/api/contacts") {
      const body = await json(request);
      const name = stringField(body, "name");
      const phone = stringField(body, "phone");
      if (!name || !phone) throw new RelayError("invalid", "name and phone are required.");
      const contact = { id: createId(), name, phone, notes: optionalString(body, "notes") ?? "", createdAt: new Date().toISOString() };
      await store.update((data) => data.contacts.push(contact));
      notify();
      return send(response, 201, contact);
    }
    const contactMatch = url.pathname.match(/^\/api\/contacts\/([^/]+)$/);
    if (method === "DELETE" && contactMatch) {
      await store.update((data) => {
        data.contacts = data.contacts.filter((item) => item.id !== contactMatch[1]);
      });
      notify();
      return send(response, 204, null);
    }
    if (method === "POST" && url.pathname === "/api/calls") {
      const body = await json(request);
      const contact = store.data.contacts.find((item) => item.id === stringField(body, "contactId"));
      if (!contact) throw new RelayError("not_found", "Contact not found.", 404);
      if (body.confirm !== true) {
        return send(response, 200, {
          placed: false,
          confirmationRequired: true,
          contact,
          detail: "Relay will not place a call until you confirm this exact contact.",
        });
      }
      return send(response, 200, {
        placed: false,
        confirmationRequired: false,
        contact,
        detail:
          "Grok Bot phone calls are only documented inside the Grok Bot apps. There is no API for Relay to place this call or to show live call status. No call was placed and no webhook was sent.",
      });
    }
    if (method === "GET" && url.pathname === "/api/vm") return send(response, 200, await vmState());
    if (method === "GET" && url.pathname === "/api/vm/log") {
      let text = "";
      try {
        text = await readFile(path.join(options.dataDir, "vm", "provision.log"), "utf8");
      } catch {
        text = "";
      }
      return send(response, 200, { text: text.slice(-20000), running: vm.isProvisioning() });
    }
    if (method === "POST" && url.pathname === "/api/vm/preflight") return send(response, 200, await preflight(options.dataDir));
    if (method === "POST" && url.pathname === "/api/vm/provision") {
      const release = acquireProvision();
      try {
      const body = await json(request);
      const record = await vm.provision({
        record: store.data.vm,
        allowSoftwareEmulation: body.allowSoftwareEmulation === true,
        acknowledgeLowMemory: body.acknowledgeLowMemory === true,
        holdsLock: true,
      });
      await store.update((data) => {
        data.vm = record;
      });
      notify();
      return send(response, 201, await vmState());
      } finally {
        release();
      }
    }
    if (method === "POST" && url.pathname === "/api/vm/start") {
      if (!store.data.vm) throw new RelayError("vm_missing", "Provision a VM first.");
      const record = await vm.start(store.data.vm);
      await store.update((data) => {
        data.vm = record;
      });
      notify();
      return send(response, 200, await vmState());
    }
    if (method === "POST" && url.pathname === "/api/vm/shutdown") {
      if (!store.data.vm) throw new RelayError("vm_missing", "No VM.");
      const detail = await vm.shutdown(store.data.vm);
      return send(response, 200, { detail, ...(await vmState()) });
    }
    if (method === "POST" && url.pathname === "/api/vm/pause") {
      if (!store.data.vm) throw new RelayError("vm_missing", "No VM.");
      const detail = await vm.pause(store.data.vm);
      return send(response, 200, { detail });
    }
    if (method === "POST" && url.pathname === "/api/vm/resume") {
      if (!store.data.vm) throw new RelayError("vm_missing", "No VM.");
      if (!(await vm.isAlive(store.data.vm))) {
        const record = await vm.start(store.data.vm);
        await store.update((data) => {
          data.vm = record;
        });
        notify();
        return send(response, 200, { detail: "The process was not running, so Relay started it again.", ...(await vmState()) });
      }
      const detail = await vm.resumeCpu(store.data.vm);
      return send(response, 200, { detail });
    }
    if (method === "POST" && url.pathname === "/api/vm/force-stop") {
      if (!store.data.vm) throw new RelayError("vm_missing", "No VM.");
      const detail = await vm.forceStop(store.data.vm);
      return send(response, 200, { detail });
    }
    if (method === "POST" && url.pathname === "/api/vm/share") {
      if (!store.data.vm) throw new RelayError("vm_missing", "No VM.");
      const body = await json(request);
      if (body.confirmShare !== true) throw new RelayError("confirm_required", "confirmShare must be true.");
      const sharePath = stringField(body, "path");
      if (!sharePath || !path.isAbsolute(sharePath)) throw new RelayError("invalid", "path must be an absolute directory.");
      const info = await stat(sharePath);
      if (!info.isDirectory()) throw new RelayError("invalid", "path is not a directory.");
      await store.update((data) => {
        if (data.vm) data.vm.share = { path: sharePath, writable: body.writable === true };
      });
      notify();
      return send(response, 200, {
        detail: "The folder will be attached the next time this VM starts. It is not mounted until then. Other host folders stay private.",
        ...(await vmState()),
      });
    }
    if (method === "POST" && url.pathname === "/api/vm/unshare") {
      await store.update((data) => {
        if (data.vm) delete data.vm.share;
      });
      notify();
      return send(response, 200, await vmState());
    }
    if (method === "GET" && url.pathname === "/api/vm/serial") {
      if (!store.data.vm) return send(response, 200, { text: "" });
      return send(response, 200, { text: await vm.serialTail(store.data.vm) });
    }
    if (method === "POST" && url.pathname === "/api/vm/delete") {
      if (!store.data.vm) throw new RelayError("vm_missing", "No VM.");
      const body = await json(request);
      await vm.remove(store.data.vm, stringField(body, "confirmation") ?? "");
      await store.update((data) => {
        data.vm = null;
      });
      notify();
      return send(response, 200, { deleted: true });
    }
    if (method === "GET" && options.staticDir) return serveStatic(options.staticDir, url.pathname, response);
    throw new RelayError("not_found", "Not found.", 404);
  }

  async function remember(id: IntegrationId, kind: "key" | "live", ok: boolean, detail: string, requestId?: string) {
    await store.update((data) => {
      data.attempts.push({ adapterId: id, kind, at: new Date().toISOString(), ok, detail, requestId });
    });
    notify();
  }

  async function vmState() {
    if (options.cloudDesktop) return { record: null, process: "running" as const, cloud: true };
    const record = store.data.vm;
    let processState: "absent" | "running" = "absent";
    if (record && (await vm.isAlive(record))) processState = "running";
    return { record, process: processState };
  }

  await new Promise<void>((resolve) => server.listen(options.port, host, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    port,
    store,
    setupToken: auth.setupTokenForLog,
    coordinator,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function serveStatic(root: string, pathname: string, response: ServerResponse): Promise<void> {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = path.join(root, path.normalize(requested));
  if (!isInside(root, file)) throw new RelayError("refused", "Bad path.");
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("dir");
    response.writeHead(200, { "content-type": contentType(file) });
    createReadStream(file).pipe(response);
  } catch {
    const index = path.join(root, "index.html");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    createReadStream(index).pipe(response);
  }
}

function contentType(file: string): string {
  if (file.endsWith(".js")) return "text/javascript";
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".webmanifest")) return "application/manifest+json";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (status === 204 || body === null) {
    response.writeHead(status);
    response.end();
    return;
  }
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  response.end(payload);
}

async function json(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new RelayError("too_large", "Body is too large.");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new RelayError("invalid", "Body must be a JSON object.");
  }
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value.trim() : undefined;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = stringField(body, key);
  return value || undefined;
}

function optionalIntegration(body: Record<string, unknown>, key: string): IntegrationId | undefined {
  const value = stringField(body, key);
  if (!value || value === "auto") return undefined;
  if (!INTEGRATION_IDS.includes(value as IntegrationId)) throw new RelayError("invalid", "Unknown agent.");
  return value as IntegrationId;
}

function sanitizeSettings(body: Record<string, unknown>, current: Settings): Settings {
  const limits = (body.limits ?? {}) as Record<string, unknown>;
  const models = (body.models ?? {}) as Record<string, unknown>;
  const nextModels = { ...current.models };
  for (const id of INTEGRATION_IDS) {
    if (typeof models[id] === "string") nextModels[id] = (models[id] as string).trim();
  }
  return {
    router: body.router === "drex" ? "drex" : "local",
    drexMinConfidence: clamp(numberOr(body.drexMinConfidence, current.drexMinConfidence), 0, 1),
    allowSameAgentReview: body.allowSameAgentReview === true,
    useApiKeys: body.useApiKeys === undefined ? current.useApiKeys : body.useApiKeys === true,
    models: nextModels,
    limits: {
      maxProviderCalls: clamp(numberOr(limits.maxProviderCalls, current.limits.maxProviderCalls), 1, 20),
      maxWallClockMs: clamp(numberOr(limits.maxWallClockMs, current.limits.maxWallClockMs), 10_000, 60 * 60 * 1000),
      maxTurns: clamp(numberOr(limits.maxTurns, current.limits.maxTurns), 1, 6),
      maxUsd: limits.maxUsd === null ? null : typeof limits.maxUsd === "number" ? limits.maxUsd : current.limits.maxUsd,
    },
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
