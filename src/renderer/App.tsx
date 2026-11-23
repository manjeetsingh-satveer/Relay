import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CallResolution, IntegrationView, Settings } from "../shared/types.ts";
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
  const [mode, setMode] = useState<"single" | "collaborative" | "team">("team");
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
            {task.progress.length > 0 ? (
              <p style={{ margin: "6px 0", fontSize: 13 }}>{task.progress[task.progress.length - 1]!.message}</p>
            ) : null}
            <details>
              <summary style={{ cursor: "pointer", color: "var(--muted-foreground)", fontSize: 13 }}>Details ({task.progress.length} steps)</summary>
              {task.routeExplanation ? <p style={{ fontSize: 13 }}>{task.routeExplanation}</p> : null}
              {task.progress.map((event, index) => (
                <p key={index} style={{ color: "var(--muted-foreground)", fontSize: 13 }}>{formatWhen(event.at)} — {event.message}</p>
              ))}
            </details>
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
          <select value={mode} onChange={(event) => setMode(event.target.value as "single" | "collaborative" | "team")}>
            <option value="single">Single agent</option>
            <option value="team">Team: agents discuss, lead answers</option>
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

const TAGLINES: Partial<Record<string, string>> = {
  "claude-web": "claude.ai in your desktop's browser",
  "chatgpt-web": "chatgpt.com in your desktop's browser",
  "gemini-web": "gemini.google.com in your desktop's browser",
  "perplexity-web": "perplexity.ai in your desktop's browser",
  "grok-web": "grok.com in your desktop's browser",
  "claude-code": "Claude Code CLI in your desktop",
  "cursor-cli": "Cursor CLI in your desktop",
};

function statusOf(item: IntegrationView): { label: string; tone: string } {
  if (item.support !== "supported") return { label: "Not available", tone: "" };
  if (item.latestAttempt && !item.latestAttempt.ok) return { label: "Last try failed", tone: "bad" };
  if (item.lastSuccess) return { label: `Worked ${formatWhen(item.lastSuccess.at)}`, tone: "good" };
  if (item.credential === "api-key") return item.auth === "stored" ? { label: "Key saved", tone: "info" } : { label: "No key", tone: "" };
  if (item.credential === "vm-cli") return { label: "Log in once in the terminal", tone: "info" };
  if (item.credential === "browser") return { label: "Sign in once", tone: "info" };
  return { label: "Optional", tone: "" };
}

function Integrations(props: { boot: Bootstrap; refresh: () => Promise<Bootstrap>; onError: (message: string) => void }) {
  const all = props.boot.integrations;
  const apps = all.filter((item) => item.credential === "browser");
  const clis = all.filter((item) => item.credential === "vm-cli");
  const extra = all.filter((item) => item.credential === "api-key" || item.credential === "none");
  const list = (items: IntegrationView[]) => (
    <div className="card" style={{ padding: 0, gap: 0 }}>
      {items.map((item, index) => <IntegrationRow key={item.id} item={item} first={index === 0} refresh={props.refresh} onError={props.onError} />)}
    </div>
  );
  const heading = (title: string, hint: string) => (
    <div>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h2>
      <p style={{ margin: "2px 0 0", color: "var(--muted-foreground)", fontSize: 13 }}>{hint}</p>
    </div>
  );
  return (
    <div className="scroll" style={{ padding: 20 }}>
      <div style={{ display: "grid", gap: 22, maxWidth: 860 }}>
        <div>
          <h1 className="serif" style={{ fontWeight: 500, margin: 0 }}>Integrations</h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted-foreground)" }}>The AI tools Relay can use. Sign in to each once in the computer tab. Relay never sees or types your passwords.</p>
        </div>
        {apps.length ? <section style={{ display: "grid", gap: 8 }}>{heading("AI apps", "The websites you already pay for, in your cloud desktop.")}{list(apps)}</section> : null}
        {clis.length ? <section style={{ display: "grid", gap: 8 }}>{heading("Coding agents", "Command-line tools inside your cloud desktop.")}{list(clis)}</section> : null}
        {extra.length ? (
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 16 }}>API keys and extras (optional)</summary>
            <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Only needed if you'd rather pay per use with an API key. Turn on API keys in settings to use them.</p>
            {list(extra)}
          </details>
        ) : null}
      </div>
    </div>
  );
}

function IntegrationRow(props: { item: IntegrationView; first: boolean; refresh: () => Promise<unknown>; onError: (message: string) => void }) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState(props.item.model);
  const item = props.item;
  const latest = item.latestAttempt;
  const status = statusOf(item);
  return (
    <div style={{ padding: "12px 16px", borderTop: props.first ? "none" : "1px solid var(--border)", display: "grid", gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <strong>{item.displayName}</strong>
            <span className={`badge ${status.tone}`}>{status.label}</span>
          </div>
          <div style={{ color: "var(--muted-foreground)", fontSize: 13 }}>{TAGLINES[item.id] ?? item.summary.split(". ")[0] + "."}</div>
        </div>
        {item.credential === "browser" ? (
          <Button size="sm" variant="outline" onClick={() => api.openLogin(item.id).then((result) => props.onError(result.detail)).catch((reason) => props.onError(reason.message))}>Open sign-in</Button>
        ) : null}
      </div>
      {latest && !latest.ok ? <div style={{ color: "var(--destructive)", fontSize: 13 }}>{latest.detail}</div> : null}
      {item.credential === "api-key" ? (
        <form
          className="row"
          style={{ gap: 8, flexWrap: "wrap" }}
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
          <Input style={{ flex: "1 1 200px", width: "auto" }} type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={item.auth === "stored" ? "Replace saved key" : "Paste API key"} autoComplete="off" />
          <Button type="submit" size="sm">Save</Button>
          {item.auth === "stored" ? <Button type="button" size="sm" variant="ghost" onClick={() => api.deleteKey(item.id).then(props.refresh).catch((reason) => props.onError(reason.message))}>Remove</Button> : null}
          {item.id !== "anthropic" && item.id !== "perplexity" ? (
            <Button type="button" size="sm" variant="outline" onClick={() => api.probe(item.id, "key").then(props.refresh).catch((reason) => props.onError(reason.message))}>Check key</Button>
          ) : null}
          {item.id !== "cursor" && item.id !== "xai" ? (
            <Button type="button" size="sm" variant="outline" onClick={() => api.probe(item.id, "live").then(props.refresh).catch((reason) => props.onError(reason.message))}>Test</Button>
          ) : null}
        </form>
      ) : null}
      <details>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted-foreground)" }}>Details</summary>
        <div style={{ display: "grid", gap: 6, fontSize: 13, paddingTop: 6 }}>
          <span>{item.summary}</span>
          {item.unsupportedReason ? <span>{item.unsupportedReason}</span> : null}
          <span style={{ color: "var(--muted-foreground)" }}>{item.authDetail} {item.installDetail}</span>
          {item.modelEditable ? (
            <label style={{ display: "grid", gap: 4 }}>
              <Label>Model</Label>
              <Input value={model} onChange={(event) => setModel(event.target.value)} />
              <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{item.modelHelp}</span>
            </label>
          ) : <span style={{ color: "var(--muted-foreground)" }}>{item.modelHelp}</span>}
          <a href={item.docsUrl}>Official docs</a>
        </div>
      </details>
    </div>
  );
}

function Computer(props: { boot: Bootstrap; refresh: () => Promise<unknown>; onError: (message: string) => void }) {
  const screen = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const viewer = useRef<{ focus: () => void } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const running = props.boot.vm.process === "running";

  useEffect(() => {
    if (!running) return;
    let rfb: { disconnect: () => void; scaleViewport: boolean; focusOnClick: boolean; addEventListener: (type: string, fn: () => void) => void } | null = null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Reconnect whenever the link drops (desktop waking up, proxy hiccup); otherwise the canvas stays black.
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
    connect().then(
      () => sessionStorage.removeItem("relay-viewer-reload"),
      (reason) => {
        // A dropped link (desktop waking, tunnel hiccup) makes the lazy chunk fail, and the browser
        // caches that failure, so reload the page once instead of leaving a black screen.
        if (!sessionStorage.getItem("relay-viewer-reload")) {
          sessionStorage.setItem("relay-viewer-reload", "1");
          setTimeout(() => location.reload(), 1500);
          return;
        }
        props.onError(reason instanceof Error ? `The desktop viewer couldn't load. Check your connection and reopen Relay. (${reason.message})` : "noVNC failed to load.");
      },
    );
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      rfb?.disconnect();
    };
  }, [running]);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(document.fullscreenElement === frame.current);
      // Give the keyboard back to the desktop after entering or leaving full screen.
      setTimeout(() => viewer.current?.focus(), 50);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  if (!props.boot.vm.cloud) {
    return (
      <div className="scroll" style={{ padding: 20 }}>
        <h1 className="serif" style={{ fontWeight: 500 }}>Computer</h1>
        <p style={{ maxWidth: 640 }}>Relay's desktop runs in your own free GitHub Codespace, so it works on any PC or phone and doesn't use your computer's memory.</p>
        <Button onClick={() => { location.hash = "cloud"; location.reload(); }}>Open my cloud desktop</Button>
      </div>
    );
  }

  return (
    <div className="scroll" style={{ padding: 20 }}>
      <h1 className="serif" style={{ fontWeight: 500 }}>Computer</h1>
      <p style={{ maxWidth: 760 }}>Your cloud desktop. Sign in to each AI app here; Relay never sees or types your passwords.</p>
      <div className="row">
        {running ? <Button onClick={() => frame.current?.requestFullscreen().catch((reason) => props.onError(reason instanceof Error ? reason.message : "Full screen failed."))}>Full screen</Button> : null}
      </div>
      <div
        ref={frame}
        style={fullscreen ? { background: "#000", width: "100vw", height: "100vh" } : { marginTop: 12 }}
        onMouseEnter={() => viewer.current?.focus()}
      >
        <div id="screen" ref={screen} style={fullscreen ? { width: "100%", height: "100%", maxWidth: "none", aspectRatio: "auto" } : undefined} />
      </div>
      {running ? (
        <p style={{ color: "var(--muted-foreground)", fontSize: 13, marginTop: 6 }}>Click the screen to use your mouse and keyboard. Esc leaves full screen.</p>
      ) : (
        <p>Starting your desktop…</p>
      )}
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
