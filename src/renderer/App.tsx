import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CallResolution, IntegrationView, Settings, VmView } from "../shared/types.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/dialog";
import { api, type Bootstrap, type ConversationPayload } from "@/lib/api";
import { formatBytes, formatWhen } from "@/lib/utils";
import { AccountCard } from "./Auth";

type Tab = "chat" | "integrations" | "computer" | "calls" | "settings";

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialTab = (["chat", "integrations", "computer", "calls", "settings"] as Tab[]).includes(location.hash.slice(1) as Tab)
    ? (location.hash.slice(1) as Tab)
    : "chat";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [thread, setThread] = useState<ConversationPayload | null>(null);
  const [call, setCall] = useState<CallResolution | null>(null);

  async function reload() {
    const next = await api.bootstrap();
    setBoot(next);
    setProjectId((current) => current ?? next.projects.at(-1)?.id ?? null);
    setConversationId((current) => {
      if (current) return current;
      const projectId = next.projects.at(-1)?.id;
      return [...next.conversations].reverse().find((item) => item.projectId === projectId)?.id ?? null;
    });
    return next;
  }

  useEffect(() => {
    reload().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not reach Relay."));
    const source = new EventSource("/api/events");
    source.onmessage = () => {
      reload().catch(() => undefined);
      setConversationId((current) => {
        if (current) api.conversation(current).then(setThread).catch(() => undefined);
        return current;
      });
    };
    source.onerror = () => undefined;
    return () => source.close();
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setThread(null);
      return;
    }
    api.conversation(conversationId).then(setThread).catch((reason) => setError(reason.message));
  }, [conversationId]);

  if (error && !boot) {
    return <Screen><p className="p-8">{error}</p></Screen>;
  }
  if (!boot) return <Screen><p className="p-8">Loading Relay…</p></Screen>;

  return (
    <Screen>
      <div className="shell">
        <aside className="rail">
          <div className="brand">
            <strong>RELAY</strong>
            <span>One chat across the tools you already pay for.</span>
          </div>
          <div className="nav">
            {(["chat", "computer", "integrations", "settings"] as Tab[]).map((item) => (
              <Button key={item} size="sm" variant={tab === item ? "default" : "outline"} onClick={() => { location.hash = item; setTab(item); }}>
                {item}
              </Button>
            ))}
          </div>
          <div className="scroll" style={{ padding: 12 }}>
            <Projects
              boot={boot}
              projectId={projectId}
              conversationId={conversationId}
              onProject={setProjectId}
              onConversation={setConversationId}
              onError={setError}
              refresh={reload}
            />
          </div>
        </aside>
        <main className="main">
          {error ? <p style={{ padding: "8px 16px", color: "var(--destructive)" }}>{error}</p> : null}
          {tab === "chat" ? (
            <Chat
              boot={boot}
              thread={thread}
              conversationId={conversationId}
              onSent={async (nextCall) => {
                setCall(nextCall);
                if (conversationId) setThread(await api.conversation(conversationId));
                await reload();
              }}
              onError={setError}
            />
          ) : null}
          {tab === "integrations" ? <Integrations boot={boot} refresh={reload} onError={setError} /> : null}
          {tab === "computer" ? <Computer boot={boot} refresh={reload} onError={setError} /> : null}
          {tab === "calls" ? <Calls boot={boot} pending={call} refresh={reload} onError={setError} onClear={() => setCall(null)} /> : null}
          {tab === "settings" ? <SettingsPanel boot={boot} refresh={reload} onError={setError} /> : null}
        </main>
      </div>
    </Screen>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return <div style={{ height: "100%" }}>{children}</div>;
}

function Projects(props: {
  boot: Bootstrap;
  projectId: string | null;
  conversationId: string | null;
  onProject: (id: string) => void;
  onConversation: (id: string) => void;
  onError: (message: string) => void;
  refresh: () => Promise<Bootstrap>;
}) {
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [adding, setAdding] = useState(false);
  const conversations = props.boot.conversations.filter((item) => item.projectId === props.projectId);
  return (
    <div className="grid-cards">
      {props.projectId ? (
        <Button
          size="sm"
          onClick={async () => {
            const conversation = await api.createConversation(props.projectId!);
            props.onConversation(conversation.id);
            await props.refresh();
          }}
        >
          + New chat
        </Button>
      ) : null}
      <div style={{ display: "grid", gap: 2 }}>
        {[...conversations].reverse().map((conversation) => (
          <button key={conversation.id} onClick={() => props.onConversation(conversation.id)} style={{ background: props.conversationId === conversation.id ? "var(--card)" : "transparent", border: 0, borderRadius: 8, textAlign: "left", color: props.conversationId === conversation.id ? "var(--primary)" : "inherit", padding: "6px 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {conversation.title}
          </button>
        ))}
      </div>
      <Label style={{ marginTop: 12 }}>Projects</Label>
      {props.boot.projects.map((project) => (
        <button key={project.id} onClick={() => props.onProject(project.id)} style={{ background: "transparent", border: 0, textAlign: "left", padding: "4px 8px", color: props.projectId === project.id ? "var(--primary)" : "inherit" }}>
          {project.name}
        </button>
      ))}
      {!adding ? <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>+ New project</Button> : null}
      {adding ? <form
        className="grid-cards"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            const project = await api.createProject(name, repo || undefined);
            setName("");
            setRepo("");
            props.onProject(project.id);
            setAdding(false);
            await props.refresh();
          } catch (reason) {
            props.onError(reason instanceof Error ? reason.message : "Could not create the project.");
          }
        }}
      >
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name" required autoFocus />
        <Input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="GitHub repo URL (optional)" />
        <div className="row">
          <Button type="submit" size="sm">Create</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      </form> : null}
    </div>
  );
}

function Chat(props: {
  boot: Bootstrap;
  thread: ConversationPayload | null;
  conversationId: string | null;
  onSent: (call: CallResolution | null) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"single" | "collaborative">("single");
  const [agentId, setAgentId] = useState("auto");
  const [busy, setBusy] = useState(false);
  const pendingKey = useRef<string | null>(null);
  const ready = props.boot.integrations.filter((item) => item.availableForRouting);
  const running = props.thread?.tasks.some((task) => task.status === "running") ?? false;

  if (!props.conversationId || !props.thread) {
    return <div className="scroll" style={{ padding: 28 }}><h1 className="serif" style={{ fontWeight: 500 }}>Start with a project.</h1><p style={{ maxWidth: 560, color: "var(--muted-foreground)" }}>Relay does not answer by itself. Start the Linux VM, sign in to Claude or ChatGPT in that desktop, then send a task. If the browser is not signed in, the task stops and says so. API keys stay off unless you enable them.</p></div>;
  }

  return (
    <>
      <div className="scroll transcript">
        {props.thread.messages.length === 0 ? <p style={{ color: "var(--muted-foreground)" }}>This conversation is empty.</p> : null}
        {props.thread.messages.map((message) => (
          <article key={message.id} className={`bubble ${message.role}`}>
            {message.role === "assistant" ? <div className="badge">{message.adapterId}</div> : null}
            <div style={{ whiteSpace: "pre-wrap" }}>{message.text}</div>
          </article>
        ))}
        {props.thread.tasks.map((task) => (
          <section key={task.id} className="card">
            <div className="row">
              <span className={`badge ${task.status === "completed" ? "good" : task.status === "running" ? "info" : "bad"}`}>{task.status}</span>
              <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{formatWhen(task.updatedAt)}</span>
            </div>
            {task.routeExplanation ? <p>{task.routeExplanation}</p> : null}
            {task.progress.map((event, index) => (
              <p key={index} style={{ color: "var(--muted-foreground)", fontSize: 13 }}>{formatWhen(event.at)} — {event.message}</p>
            ))}
            {task.contributions.map((contribution) => (
              <div key={contribution.id}>
                <strong>{contribution.adapterId}</strong> · {contribution.role} · {contribution.sessionMode}
                <p>{contribution.sessionDetail}</p>
                {contribution.usage?.reportedCostUsd !== undefined ? <p>Reported cost {contribution.usage.reportedCostUsd} USD ({contribution.usage.costSource}).</p> : null}
                {contribution.citations?.length ? (
                  <ul>{contribution.citations.map((citation) => <li key={citation.url}><a href={citation.url}>{citation.title}</a></li>)}</ul>
                ) : null}
              </div>
            ))}
            {task.error ? <p style={{ color: "var(--destructive)" }}>{task.error}</p> : null}
            {task.status === "running" ? <Button size="sm" variant="outline" onClick={() => api.cancel(task.id).catch((reason) => props.onError(reason.message))}>Cancel</Button> : null}
            {task.status !== "running" && task.providerStarted ? (
              <div className="row">
                <Button size="sm" variant="outline" onClick={() => api.retry(task.id, crypto.randomUUID(), false).then(() => props.onSent(null)).catch((reason) => props.onError(reason.message))}>Retry same session</Button>
                <Button size="sm" variant="ghost" onClick={() => api.retry(task.id, crypto.randomUUID(), true).then(() => props.onSent(null)).catch((reason) => props.onError(reason.message))}>Retry as a new session</Button>
              </div>
            ) : null}
          </section>
        ))}
        {props.thread.artifacts.length > 0 ? (
          <section className="card">
            <h2 className="serif" style={{ margin: "0 0 8px", fontWeight: 500 }}>Files</h2>
            {props.thread.artifacts.map((artifact) => (
              <p key={artifact.id}><a href={`/api/artifacts/${artifact.id}`}>{artifact.name}</a> · {formatBytes(artifact.bytes)} · {artifact.source}</p>
            ))}
          </section>
        ) : null}
      </div>
      <form
        className="composer"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!props.conversationId) return;
          const key = pendingKey.current ?? crypto.randomUUID();
          pendingKey.current = key;
          setBusy(true);
          props.onError("");
          try {
            const result = await api.send(props.conversationId, {
              text,
              mode,
              idempotencyKey: key,
              agentId: agentId === "auto" ? undefined : agentId,
            });
            pendingKey.current = null;
            setText("");
            await props.onSent(result.call);
          } catch (reason) {
            props.onError(reason instanceof Error ? `${reason.message} The same request id will be reused if you send again.` : "Send failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="row">
          <Label>Mode</Label>
          <select value={mode} onChange={(event) => setMode(event.target.value as "single" | "collaborative")}>
            <option value="single">Single agent</option>
            <option value="collaborative">Draft, review, revise</option>
          </select>
          <Label>Agent</Label>
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
            <option value="auto">Auto</option>
            {ready.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
          </select>
          <span className="badge">{props.boot.settings.router === "drex" ? "Drex routing" : "Local rules"}</span>
          {running ? <span className="badge info">Task running</span> : null}
        </div>
        <Textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Build a portfolio website." required />
        <div className="row">
          <Button type="submit" disabled={busy || running}>{busy ? "Sending…" : "Send"}</Button>
          {pendingKey.current ? <span style={{ color: "var(--info)", fontSize: 12 }}>A previous send did not finish. The next click reuses its request id.</span> : null}
        </div>
      </form>
    </>
  );
}

function Integrations(props: { boot: Bootstrap; refresh: () => Promise<Bootstrap>; onError: (message: string) => void }) {
  return (
    <div className="scroll" style={{ padding: 20 }}>
      <h1 className="serif" style={{ fontWeight: 500 }}>Integrations</h1>
      <p style={{ maxWidth: 720, color: "var(--muted-foreground)" }}>Supported, installed, credential stored, and last real result are separate. A stored key is not a successful call.</p>
      <div className="grid-cards">
        {props.boot.integrations.map((item) => <IntegrationCard key={item.id} item={item} refresh={props.refresh} onError={props.onError} />)}
      </div>
    </div>
  );
}

function IntegrationCard(props: { item: IntegrationView; refresh: () => Promise<unknown>; onError: (message: string) => void }) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState(props.item.model);
  const item = props.item;
  const latest = item.latestAttempt;
  return (
    <article className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>{item.displayName}</h2>
        <span className={`badge ${item.support === "supported" ? "info" : ""}`}>{item.support}</span>
        <span className="badge">{item.install}</span>
        <span className="badge">{item.auth}</span>
        {item.lastSuccess ? <span className="badge good">last success {formatWhen(item.lastSuccess.at)}</span> : <span className="badge">no successful task</span>}
      </div>
      <p>{item.summary}</p>
      {item.unsupportedReason ? <p>{item.unsupportedReason}</p> : null}
      <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>{item.authDetail} {item.installDetail}</p>
      <p><a href={item.docsUrl}>Official docs</a></p>
      {latest ? <p>Latest attempt {formatWhen(latest.at)}: {latest.ok ? "succeeded" : "failed"} — {latest.detail}</p> : null}
      {item.modelEditable ? (
        <label className="grid-cards">
          <Label>Model</Label>
          <Input value={model} onChange={(event) => setModel(event.target.value)} />
          <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{item.modelHelp}</span>
        </label>
      ) : <p style={{ fontSize: 13 }}>{item.modelHelp}</p>}
      {item.credential === "browser" ? (
        <Button size="sm" variant="outline" onClick={() => api.openLogin(item.id).then((result) => props.onError(result.detail)).catch((reason) => props.onError(reason.message))}>Open sign-in in the VM</Button>
      ) : null}
      {item.credential === "api-key" ? (
        <form
          className="row"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const settings = await api.bootstrap();
              settings.settings.models[item.id] = model;
              await api.settings(settings.settings);
              if (key) await api.saveKey(item.id, key);
              setKey("");
              await props.refresh();
            } catch (reason) {
              props.onError(reason instanceof Error ? reason.message : "Could not save.");
            }
          }}
        >
          <Input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={item.auth === "stored" ? "Replace stored key" : "API key"} autoComplete="off" />
          <Button type="submit" size="sm">Save</Button>
          {item.auth === "stored" ? <Button type="button" size="sm" variant="ghost" onClick={() => api.deleteKey(item.id).then(props.refresh).catch((reason) => props.onError(reason.message))}>Remove key</Button> : null}
        </form>
      ) : null}
      <div className="row">
        {item.credential === "api-key" && item.id !== "anthropic" && item.id !== "perplexity" ? (
          <Button size="sm" variant="outline" onClick={() => api.probe(item.id, "key").then(props.refresh).catch((reason) => props.onError(reason.message))}>Check key</Button>
        ) : null}
        {item.credential === "api-key" && item.id !== "cursor" && item.id !== "xai" ? (
          <Button size="sm" variant="outline" onClick={() => api.probe(item.id, "live").then(props.refresh).catch((reason) => props.onError(reason.message))}>Live check</Button>
        ) : null}
        {item.credential === "vm-cli" ? <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>This CLI runs inside the VM. Log in there. Relay does not type the password.</span> : null}
      </div>
    </article>
  );
}

function Computer(props: { boot: Bootstrap; refresh: () => Promise<unknown>; onError: (message: string) => void }) {
  const [report, setReport] = useState<VmView["preflight"]>();
  const [share, setShare] = useState("");
  const [writable, setWritable] = useState(false);
  const [allowTcg, setAllowTcg] = useState(false);
  const [lowMemory, setLowMemory] = useState(false);
  const [provisionLog, setProvisionLog] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const holdingProvision = useRef(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const viewer = useRef<{ focus: () => void } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const record = props.boot.vm.record;
  const running = props.boot.vm.process === "running";
  const cloud = Boolean(props.boot.vm.cloud);

  useEffect(() => {
    if (!running) return;
    let rfb: { disconnect: () => void; scaleViewport: boolean; focusOnClick: boolean; addEventListener: (type: string, fn: () => void) => void } | null = null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Reconnect whenever the VNC link drops (VM still booting, restart, proxy hiccup),
    // otherwise the canvas stays black until the app is reopened.
    const connect = async () => {
      const mod = await import("@novnc/novnc");
      if (cancelled || !screen.current) return;
      const RFB = mod.default;
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      screen.current.replaceChildren();
      const client = new RFB(screen.current, `${protocol}://${location.host}/vm/vnc`) as unknown as NonNullable<typeof rfb>;
      client.scaleViewport = true;
      client.focusOnClick = true;
      client.addEventListener("disconnect", () => {
        if (cancelled) return;
        retry = setTimeout(() => void connect().catch(() => undefined), 2000);
      });
      rfb = client;
      viewer.current = client as unknown as { focus: () => void };
      viewer.current.focus();
    };
    connect().catch((reason) => props.onError(reason instanceof Error ? reason.message : "noVNC failed to load."));
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      rfb?.disconnect();
    };
  }, [running]);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(document.fullscreenElement === frame.current);
      // Give the keyboard to the VM again after entering or leaving full screen.
      setTimeout(() => viewer.current?.focus(), 50);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = () => {
      api.vmLog().then((result) => {
        if (stop) return;
        setProvisionLog(result.text);
        setProvisioning(holdingProvision.current || result.running);
      }).catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, provisioning ? 400 : 1500);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [provisioning]);

  return (
    <div className="scroll" style={{ padding: 20 }}>
      <h1 className="serif" style={{ fontWeight: 500 }}>Computer</h1>
      <p style={{ maxWidth: 760 }}>{cloud ? "Your cloud desktop. It keeps running when your laptop is off." : "Your private Linux desktop."} Sign in to each AI app here; Relay never sees or types your passwords.</p>
      <div className="row">
        {!record && !cloud ? <Button variant="outline" onClick={() => api.preflight().then(setReport).catch((reason) => props.onError(reason.message))}>Check this machine</Button> : null}
        {!record && !cloud ? <Button disabled={provisioning} onClick={() => {
          if (holdingProvision.current) return;
          holdingProvision.current = true;
          setProvisioning(true);
          setProvisionError(null);
          api.provision({ allowSoftwareEmulation: allowTcg, acknowledgeLowMemory: lowMemory })
            .then(() => props.refresh())
            .catch((reason) => {
              const message = reason instanceof Error ? reason.message : "Provision failed.";
              setProvisionError(message);
              props.onError(message);
            })
            .finally(() => {
              holdingProvision.current = false;
              api.vmLog().then((result) => setProvisionLog(result.text)).catch(() => undefined);
              setProvisioning(false);
            });
        }}>{provisioning ? "Provisioning…" : "Download and provision"}</Button> : null}
        {record && !running ? <Button onClick={() => api.vmAction("start").then(props.refresh).catch((reason) => props.onError(reason.message))}>Start</Button> : null}
        {running && !cloud ? <Button variant="outline" onClick={() => api.vmAction("shutdown").then(props.refresh).catch((reason) => props.onError(reason.message))}>Shut down</Button> : null}
        {running ? <Button onClick={() => frame.current?.requestFullscreen().catch((reason) => props.onError(reason instanceof Error ? reason.message : "Full screen failed."))}>Full screen</Button> : null}
        {running && !cloud ? <Button variant="danger" onClick={() => api.vmAction("force-stop").then(props.refresh).catch((reason) => props.onError(reason.message))}>Force stop</Button> : null}
      </div>
      {!record && !cloud ? (
        <div className="card" style={{ marginTop: 12 }}>
          <label className="row"><input type="checkbox" checked={allowTcg} onChange={(event) => setAllowTcg(event.target.checked)} /> Allow software emulation if hardware virtualization is missing</label>
          <label className="row"><input type="checkbox" checked={lowMemory} onChange={(event) => setLowMemory(event.target.checked)} /> Continue even if the OS reports less than 1.5 GB available</label>
        </div>
      ) : null}
      {provisionError ? <p className="card" style={{ marginTop: 12, color: "var(--destructive)" }}>{provisionError}</p> : null}
      {provisioning ? <p style={{ marginTop: 12 }}>Setting up the VM. This takes about 10 minutes.</p> : null}
      {provisionLog && (provisioning || !record) ? (
        <details className="card" style={{ marginTop: 12 }} open={provisioning}>
          <summary>Setup log</summary>
          <pre style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto" }}>{provisionLog}</pre>
        </details>
      ) : null}
      {report ? (
        <div className="card" style={{ marginTop: 12 }}>
          <p>{report.qemu.detail}</p>
          <p>{report.virtualization.detail}</p>
          <p>Memory available {formatBytes(report.memory.availableBytes)} of {formatBytes(report.memory.totalBytes)}. Required {formatBytes(report.memory.requiredBytes)}. {report.memory.ok ? "Meets the check." : "Below the check."}</p>
          <p>Disk free {formatBytes(report.disk.availableBytes)} on {report.disk.path}. Required {formatBytes(report.disk.requiredBytes)}.</p>
          {report.notes.map((note) => <p key={note}>{note}</p>)}
        </div>
      ) : null}
      <div
        ref={frame}
        style={fullscreen ? { background: "#000", width: "100vw", height: "100vh" } : { marginTop: 12 }}
        onMouseEnter={() => viewer.current?.focus()}
      >
        <div id="screen" ref={screen} style={fullscreen ? { width: "100%", height: "100%", maxWidth: "none", aspectRatio: "auto" } : undefined} />
      </div>
      {running ? <p style={{ color: "var(--muted-foreground)", fontSize: 13, marginTop: 6 }}>Click the screen to use your mouse and keyboard. Esc leaves full screen.</p> : <p>The display stays blank until the VM is running.</p>}
      {record ? (
        <details className="card" style={{ marginTop: 12 }}>
        <summary>Share a folder from this PC</summary>
        <form style={{ display: "grid", gap: 8, marginTop: 8 }} onSubmit={(event) => { event.preventDefault(); api.share(share, writable).then(props.refresh).catch((reason) => props.onError(reason.message)); }}>
          <Input value={share} onChange={(event) => setShare(event.target.value)} placeholder="Absolute path" />
          <label className="row"><input type="checkbox" checked={writable} onChange={(event) => setWritable(event.target.checked)} /> Allow the guest to write</label>
          <Button type="submit" size="sm">Attach on next start</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => api.unshare().then(props.refresh)}>Stop sharing</Button>
          <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Only this folder is shared. Inside the VM, after the next start: <code>sudo mkdir -p /mnt/host && sudo mount -t 9p -o trans=virtio,version=9p2000.L hostshare /mnt/host</code></p>
        </form>
        </details>
      ) : null}
    </div>
  );
}

function Calls(props: { boot: Bootstrap; pending: CallResolution | null; refresh: () => Promise<unknown>; onError: (message: string) => void; onClear: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const match = props.pending?.kind === "match" ? props.pending.contact : undefined;
  return (
    <div className="scroll" style={{ padding: 20 }}>
      <h1 className="serif" style={{ fontWeight: 500 }}>Calls</h1>
      <p style={{ maxWidth: 720 }}>Grok Bot can place US phone calls inside its own apps, after its own confirmation. Relay cannot start those calls or show their status. Confirming here records that the call was not placed.</p>
      <form className="card grid-cards" onSubmit={(event) => { event.preventDefault(); api.addContact(name, phone, notes).then(() => { setName(""); setPhone(""); setNotes(""); return props.refresh(); }).catch((reason) => props.onError(reason.message)); }}>
        <Label>Saved contact</Label>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" required />
        <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone" required />
        <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes" />
        <Button type="submit" size="sm">Add contact</Button>
      </form>
      {props.boot.contacts.length === 0 ? <p>No contacts saved.</p> : props.boot.contacts.map((contact) => (
        <article key={contact.id} className="card" style={{ marginTop: 8 }}>
          <strong>{contact.name}</strong>
          <p>{contact.phone}</p>
          <p>{contact.notes}</p>
          <Button size="sm" variant="ghost" onClick={() => api.deleteContact(contact.id).then(props.refresh)}>Remove</Button>
        </article>
      ))}
      <Modal open={Boolean(match)} onOpenChange={(open) => { if (!open) props.onClear(); }} title="Confirm the recipient">
        {match ? (
          <>
            <p>Relay matched “{props.pending?.query}” to {match.name}, {match.phone}. {props.pending?.reason}</p>
            <p>No call has been placed.</p>
            <div className="row">
              <Button onClick={() => api.confirmCall(match.id).then((response) => { setResult(response.detail); props.onClear(); }).catch((reason) => props.onError(reason.message))}>Confirm, then show status</Button>
              <Button variant="outline" onClick={props.onClear}>Cancel</Button>
            </div>
          </>
        ) : null}
      </Modal>
      {result ? <p className="card">{result}</p> : null}
    </div>
  );
}

function SettingsPanel(props: { boot: Bootstrap; refresh: () => Promise<unknown>; onError: (message: string) => void }) {
  const [settings, setSettings] = useState<Settings>(props.boot.settings);
  return (
    <form
      className="scroll grid-cards"
      style={{ padding: 20, maxWidth: 720 }}
      onSubmit={(event) => {
        event.preventDefault();
        api.settings(settings).then(props.refresh).catch((reason) => props.onError(reason.message));
      }}
    >
      <AccountCard />
      <h1 className="serif" style={{ fontWeight: 500 }}>Limits</h1>
      <p>Relay stops after these limits. It does not invent a dollar cost. A spending cap blocks the next call when a provider omitted a cost.</p>
      <Label>Router</Label>
      <select value={settings.router} onChange={(event) => setSettings({ ...settings, router: event.target.value as Settings["router"] })}>
        <option value="local">Local rules</option>
        <option value="drex">Drex, then local rules if Drex is unsure</option>
      </select>
      <p style={{ color: "var(--muted-foreground)" }}>Drex answers which agent should run. It does not write the chat reply and it is not a virtual machine.</p>
      <Label>Drex minimum confidence</Label>
      <Input type="number" step="0.05" min="0" max="1" value={settings.drexMinConfidence} onChange={(event) => setSettings({ ...settings, drexMinConfidence: Number(event.target.value) })} />
      <Label>Max provider calls</Label>
      <Input type="number" value={settings.limits.maxProviderCalls} onChange={(event) => setSettings({ ...settings, limits: { ...settings.limits, maxProviderCalls: Number(event.target.value) } })} />
      <Label>Max wall clock (ms)</Label>
      <Input type="number" value={settings.limits.maxWallClockMs} onChange={(event) => setSettings({ ...settings, limits: { ...settings.limits, maxWallClockMs: Number(event.target.value) } })} />
      <Label>Max turns</Label>
      <Input type="number" value={settings.limits.maxTurns} onChange={(event) => setSettings({ ...settings, limits: { ...settings.limits, maxTurns: Number(event.target.value) } })} />
      <label className="row"><input type="checkbox" checked={settings.useApiKeys} onChange={(event) => setSettings({ ...settings, useApiKeys: event.target.checked })} /> Also allow API-key adapters. Off by default. The website path does not need a key.</label>
      <label className="row"><input type="checkbox" checked={settings.allowSameAgentReview} onChange={(event) => setSettings({ ...settings, allowSameAgentReview: event.target.checked })} /> Allow the same agent to review its own draft</label>
      <Button type="submit">Save settings</Button>
    </form>
  );
}
