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

type Tab = "chat" | "bots" | "integrations" | "computer" | "vault" | "calls" | "settings";

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialTab = (["chat", "bots", "integrations", "computer", "vault", "calls", "settings"] as Tab[]).includes(location.hash.slice(1) as Tab)
    ? (location.hash.slice(1) as Tab)
    : "chat";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [thread, setThread] = useState<ConversationPayload | null>(null);
  const [call, setCall] = useState<CallResolution | null>(null);

  const onboarded = useRef(false);
  async function reload() {
    const next = await api.bootstrap();
    setBoot(next);
    if (!onboarded.current) {
      onboarded.current = true;
      if (next.bots.length === 0 && !location.hash) setTab("bots");
    }
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
            <a href="https://github.com/manjeetsingh-satveer/Relay" target="_blank" rel="noreferrer" style={{ display: "block", fontSize: 12, color: "var(--primary)", marginTop: 6 }}>
              ⭐ Free and open source. Star it on GitHub
            </a>
          </div>
          <div className="nav">
            {(["chat", "bots", "computer", "vault", "integrations", "settings"] as Tab[]).map((item) => (
              <Button key={item} size="sm" variant={tab === item ? "default" : "outline"} onClick={() => { location.hash = item; setTab(item); }}>
                {item}
              </Button>
            ))}
          </div>
          <div className="scroll" style={{ padding: 12 }}>
            {boot.bots.length ? (
              <div style={{ display: "grid", gap: 2, marginBottom: 12 }}>
                <Label>Bots</Label>
                {boot.bots.map((bot) => (
                  <button key={bot.id} onClick={() => { setConversationId(bot.conversationId); location.hash = "chat"; setTab("chat"); }} style={{ background: conversationId === bot.conversationId ? "var(--card)" : "transparent", border: 0, borderRadius: 8, textAlign: "left", color: conversationId === bot.conversationId ? "var(--primary)" : "inherit", padding: "6px 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {bot.name}
                  </button>
                ))}
              </div>
            ) : null}
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
          {error && /\((404|502|503)\)/.test(error) && location.hostname.endsWith(".app.github.dev") ? (
            <div className="row" style={{ padding: "8px 16px", gap: 12, borderBottom: "1px solid var(--border)" }}>
              <span>Your cloud desktop went to sleep after 20 minutes without use.</span>
              <Button size="sm" onClick={() => { location.href = "/__relay/wake"; }}>Wake it up</Button>
            </div>
          ) : error ? <p style={{ padding: "8px 16px", color: "var(--destructive)" }}>{error}</p> : null}
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
          {tab === "bots" ? <Bots boot={boot} refresh={reload} onError={setError} onOpen={(id) => { setConversationId(id); location.hash = "chat"; setTab("chat"); }} /> : null}
          {tab === "integrations" ? <Integrations boot={boot} refresh={reload} onError={setError} /> : null}
          {tab === "vault" ? <Vault boot={boot} refresh={reload} onError={setError} onOpenComputer={() => { location.hash = "computer"; setTab("computer"); }} /> : null}
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
        {[...conversations].reverse().filter((conversation) => !props.boot.bots.some((item) => item.conversationId === conversation.id)).map((conversation) => (
          <div key={conversation.id} className="row chat-item" style={{ gap: 0, minWidth: 0, width: "100%", overflow: "hidden", flexWrap: "nowrap", background: props.conversationId === conversation.id ? "var(--card)" : "transparent", borderRadius: 8 }}>
            <button onClick={() => props.onConversation(conversation.id)} style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, textAlign: "left", color: props.conversationId === conversation.id ? "var(--primary)" : "inherit", padding: "6px 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {conversation.title}
            </button>
            {props.conversationId === conversation.id ? (
              <>
                <button title="Rename" aria-label="Rename chat" style={{ background: "transparent", border: 0, color: "var(--muted-foreground)", padding: "0 4px" }} onClick={() => { const title = prompt("Rename chat", conversation.title); if (title?.trim()) api.updateConversation(conversation.id, { title }).then(props.refresh).catch((reason) => props.onError(reason.message)); }}>✎</button>
                <button title="Delete" aria-label="Delete chat" style={{ background: "transparent", border: 0, color: "var(--muted-foreground)", padding: "0 6px" }} onClick={() => { if (confirm(`Delete "${conversation.title}"? Its messages are removed. This can't be undone.`)) api.deleteConversation(conversation.id).then(props.refresh).catch((reason) => props.onError(reason.message)); }}>🗑</button>
              </>
            ) : null}
          </div>
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
  const bot = props.boot.bots.find((item) => item.conversationId === props.conversationId);
  const chat = props.boot.conversations.find((item) => item.id === props.conversationId);
  const chatBots = props.boot.bots.filter((item) => !chat?.botIds || chat.botIds.includes(item.id));
  const otherBots = props.boot.bots.filter((item) => !chatBots.includes(item));
  const setChatBots = (ids: string[]) => {
    if (props.conversationId) api.updateConversation(props.conversationId, { botIds: ids }).catch((reason) => props.onError(reason.message));
  };

  if (!props.conversationId || !props.thread) {
    return <div className="scroll" style={{ padding: 28 }}><h1 className="serif" style={{ fontWeight: 500 }}>Start with a project.</h1><p style={{ maxWidth: 560, color: "var(--muted-foreground)" }}>Relay does not answer by itself. Start the Linux VM, sign in to Claude or ChatGPT in that desktop, then send a task. If the browser is not signed in, the task stops and says so. API keys stay off unless you enable them.</p></div>;
  }

  const send = async () => {
    if (!props.conversationId || !text.trim() || busy || running) return;
    const key = pendingKey.current ?? crypto.randomUUID();
    pendingKey.current = key;
    setBusy(true);
    props.onError("");
    try {
      const result = await api.send(props.conversationId, { text, mode, idempotencyKey: key, agentId: agentId === "auto" ? undefined : agentId });
      pendingKey.current = null;
      setText("");
      await props.onSent(result.call);
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "Send failed.");
    } finally {
      setBusy(false);
    }
  };
  const insert = (token: string) => setText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${token} `);

  // Which mentioned bots are still working (their reply hasn't come back to this chat yet).
  const waiting: string[] = [];
  {
    const messages = props.thread.messages;
    const lastUser = messages.map((item) => item.role).lastIndexOf("user");
    const sent = messages.slice(lastUser + 1).find((item) => item.role === "notice" && item.text.startsWith("Sent to @"));
    if (sent) {
      const names = [...sent.text.matchAll(/@([\w.-]+)/g)].map((match) => match[1]!);
      const after = messages.slice(lastUser + 1);
      for (const name of names) {
        const done = after.some((item) => item.text.startsWith(`**@${name}**`) || item.text.startsWith(`@${name} couldn't`));
        if (!done) waiting.push(name);
      }
    }
  }
  const runningTask = props.thread.tasks.find((task) => task.status === "running");
  const failedTasks = props.thread.tasks.filter((task) => (task.status === "failed" || task.status === "interrupted") && task.error);
  const visible = props.thread.messages.filter((message) => {
    if (message.role !== "notice") return true;
    if (message.text.startsWith("Sent to @")) return false; // shown as "working" indicators instead
    if (message.adapterId) return false; // browser-thread details
    if (/^Saved \d+ file/.test(message.text)) return false;
    return true;
  });

  return (
    <div className="chat">
      {bot ? (
        <div className="chat-header">
          <Avatar name={bot.name} agentId={bot.agentId} />
          <div style={{ minWidth: 0 }}>
            <strong>{bot.name}</strong>
            <div className="chat-sub">{agentName(props.boot, bot.agentId)}{bot.job ? ` · ${bot.job}` : ""}</div>
          </div>
        </div>
      ) : null}
      <div className="scroll transcript">
        <div className="column">
          {visible.length === 0 ? (
            <div className="empty">
              <h2 className="serif">{bot ? `Message ${bot.name}` : "What should your bots work on?"}</h2>
              <p>{bot ? bot.job || "This bot answers with its own AI." : chatBots.length ? "Type a task, or @mention bots so they hand it to each other." : "Type a task. Team mode lets several AIs discuss it."}</p>
              {!bot && chatBots.length > 1 ? (
                <button type="button" className="suggestion" onClick={() => setText(`@${chatBots[0]!.name} give me 3 ideas for a weekend project, then @${chatBots[1]!.name} pick the best one`)}>
                  @{chatBots[0]!.name} give me 3 ideas for a weekend project, then @{chatBots[1]!.name} pick the best one
                </button>
              ) : null}
            </div>
          ) : null}
          {visible.map((message) => {
            if (message.role === "user") return <div key={message.id} className="msg-user">{message.text}</div>;
            if (message.role === "notice") return <div key={message.id} className={`msg-note ${/couldn't|failed|not available/i.test(message.text) ? "bad" : ""}`}>{message.text}</div>;
            const header = /^\*\*@([^*\n]+)\*\*\n+/.exec(message.text);
            const name = header ? header[1]! : bot?.name ?? agentName(props.boot, message.adapterId ?? "");
            const body = header ? message.text.slice(header[0].length) : message.text;
            return (
              <div key={message.id} className="msg-ai">
                <Avatar name={name} agentId={message.adapterId} />
                <div className="msg-ai-body">
                  <div className="msg-ai-name">{name} <span>{message.adapterId ? agentName(props.boot, message.adapterId) : ""}</span></div>
                  <Markdown text={body} />
                  <button type="button" className="msg-copy" onClick={() => void navigator.clipboard?.writeText(body)}>Copy</button>
                </div>
              </div>
            );
          })}
          {[...waiting.map((name) => ({ key: name, label: `@${name} is working…` })), ...(runningTask && waiting.length === 0 ? [{ key: runningTask.id, label: bot ? `${bot.name} is working…` : "Working…" }] : [])].map((item) => (
            <div key={item.key} className="msg-working">
              <span className="dots"><i /><i /><i /></span> {item.label}
              {runningTask ? <button type="button" onClick={() => api.cancel(runningTask.id).catch((reason) => props.onError(reason.message))}>Stop</button> : null}
            </div>
          ))}
          {failedTasks.slice(-1).map((task) => (
            <div key={task.id} className="msg-note bad">
              {task.error}{" "}
              {task.providerStarted ? <button type="button" className="link" onClick={() => api.retry(task.id, crypto.randomUUID(), false).then(() => props.onSent(null)).catch((reason) => props.onError(reason.message))}>Retry</button> : null}
            </div>
          ))}
          {props.thread.artifacts.length > 0 ? (
            <div className="msg-files">
              {props.thread.artifacts.map((artifact) => (
                <a key={artifact.id} href={`/api/artifacts/${artifact.id}`}>📄 {artifact.name} <span>{formatBytes(artifact.bytes)}</span></a>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <div className="column">
          <div className="composer-box">
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
              placeholder={bot ? `Message ${bot.name}` : chatBots.length ? "Message your bots… (@mention to hand off)" : "Message Relay…"}
              rows={1}
            />
            <div className="composer-bar">
              {!bot ? chatBots.map((item) => (
                <span key={item.id} className="chip">
                  <button type="button" title={`Mention ${item.name}`} onClick={() => insert(`@${item.name}`)}>@{item.name}</button>
                  <button type="button" className="chip-x" title={`Remove ${item.name} from this chat`} aria-label={`Remove ${item.name} from this chat`} onClick={() => setChatBots(chatBots.filter((other) => other.id !== item.id).map((other) => other.id))}>×</button>
                </span>
              )) : null}
              {!bot && chatBots.length > 1 ? <span className="chip"><button type="button" onClick={() => insert("@all")}>@all</button></span> : null}
              {!bot && otherBots.length ? (
                <select className="chip-select" value="" onChange={(event) => { if (event.target.value) setChatBots([...chatBots.map((item) => item.id), event.target.value]); }}>
                  <option value="">+ Add bot</option>
                  {otherBots.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              ) : null}
              <span style={{ flex: 1 }} />
              {props.boot.vault.length ? (
                <select className="chip-select" value="" title="Insert from vault" onChange={(event) => { const item = props.boot.vault.find((entry) => entry.id === event.target.value); if (item) setText((current) => (current ? current + "\n" : "") + item.value); }}>
                  <option value="">Vault</option>
                  {props.boot.vault.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              ) : null}
              {!bot ? (
                <select className="chip-select" value={agentId === "auto" ? mode : `agent:${agentId}`} title="How Relay answers when you don't @mention a bot" onChange={(event) => {
                  const value = event.target.value;
                  if (value.startsWith("agent:")) { setMode("single"); setAgentId(value.slice(6)); } else { setMode(value as "single" | "collaborative" | "team"); setAgentId("auto"); }
                }}>
                  <option value="team">Team</option>
                  <option value="single">Best single AI</option>
                  <option value="collaborative">Draft + review</option>
                  {ready.map((item) => <option key={item.id} value={`agent:${item.id}`}>{item.displayName} only</option>)}
                </select>
              ) : null}
              <button type="submit" className="send" disabled={busy || running || !text.trim()} aria-label="Send">↑</button>
            </div>
          </div>
          <div className="composer-hint">Relay copies replies from your own AI apps. Check important answers.</div>
        </div>
      </form>
    </div>
  );
}

const AGENT_COLORS: Record<string, string> = {
  "claude-web": "#d97757", "claude-code": "#d97757", "chatgpt-web": "#10a37f", "gemini-web": "#4285f4",
  "grok-web": "#9aa0a6", "grok-bot": "#e8e8e8", "perplexity-web": "#20b8cd", "cursor-cli": "#7c7cff",
};

function Avatar(props: { name: string; agentId?: string }) {
  const color = AGENT_COLORS[props.agentId ?? ""] ?? "#e08a3c";
  const letter = props.name.replace(/^Relay-/, "").charAt(0).toUpperCase() || "R";
  return <span className="avatar" style={{ background: color, color: color === "#e8e8e8" ? "#111" : "#fff" }}>{letter}</span>;
}

/** Small, safe Markdown: paragraphs, lists, **bold**, `code`, ``` blocks and links. No HTML is injected. */
function Markdown(props: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = props.text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  const inline = (value: string, key: string): ReactNode[] => {
    const parts: ReactNode[] = [];
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let n = 0;
    while ((match = pattern.exec(value))) {
      if (match.index > last) parts.push(value.slice(last, match.index));
      const token = match[0];
      if (token.startsWith("**")) parts.push(<strong key={`${key}-${n++}`}>{token.slice(2, -2)}</strong>);
      else if (token.startsWith("`")) parts.push(<code key={`${key}-${n++}`}>{token.slice(1, -1)}</code>);
      else {
        const link = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(token)!;
        parts.push(<a key={`${key}-${n++}`} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>);
      }
      last = match.index + token.length;
    }
    if (last < value.length) parts.push(value.slice(last));
    return parts;
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!);
      i++;
      blocks.push(<pre key={`b${i}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const children = items.map((item, index) => <li key={index}>{inline(item, `l${i}-${index}`)}</li>);
      blocks.push(ordered ? <ol key={`b${i}`}>{children}</ol> : <ul key={`b${i}`}>{children}</ul>);
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      blocks.push(<h4 key={`b${i}`}>{inline(line.replace(/^#{1,4}\s+/, ""), `h${i}`)}</h4>);
      i++;
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !lines[i]!.startsWith("```") && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!) && !/^#{1,4}\s+/.test(lines[i]!)) para.push(lines[i++]!);
    blocks.push(<p key={`b${i}`}>{para.map((item, index) => <span key={index}>{index ? <br /> : null}{inline(item, `p${i}-${index}`)}</span>)}</p>);
  }
  return <div className="md">{blocks}</div>;
}

const TAGLINES: Partial<Record<string, string>> = {
  "claude-web": "claude.ai in your desktop's browser",
  "chatgpt-web": "chatgpt.com in your desktop's browser",
  "gemini-web": "gemini.google.com in your desktop's browser",
  "perplexity-web": "perplexity.ai in your desktop's browser",
  "grok-web": "grok.com in your desktop's browser",
  "grok-bot": "The Grok Bot app on your cloud desktop",
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

const BOT_CHOICES: { agentId: string; name: string; job: string }[] = [
  { agentId: "claude-web", name: "Relay-Claude", job: "Careful writing, analysis and reviewing other bots' work." },
  { agentId: "chatgpt-web", name: "Relay-ChatGPT", job: "General help: drafts, ideas, explanations and planning." },
  { agentId: "gemini-web", name: "Relay-Gemini", job: "Research with Google knowledge, summaries and comparisons." },
  { agentId: "grok-bot", name: "Relay-GrokBot", job: "Long-running work and routines in the Grok Bot app." },
  { agentId: "grok-web", name: "Relay-Grok", job: "Current events, X/Twitter context and quick takes." },
  { agentId: "perplexity-web", name: "Relay-Perplexity", job: "Web research with sources." },
  { agentId: "claude-code", name: "Relay-ClaudeCode", job: "Writing and changing code in its project folder." },
  { agentId: "cursor-cli", name: "Relay-Cursor", job: "Coding tasks with the Cursor agent." },
];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function agentName(boot: Bootstrap, agentId: string): string {
  return boot.integrations.find((item) => item.id === agentId)?.displayName ?? agentId;
}

function Bots(props: { boot: Bootstrap; refresh: () => Promise<unknown>; onError: (message: string) => void; onOpen: (conversationId: string) => void }) {
  const bots = props.boot.bots;
  const taken = new Set(bots.map((bot) => bot.agentId + ":" + bot.name.toLowerCase()));
  const available = BOT_CHOICES.filter((choice) => !bots.some((bot) => bot.name.toLowerCase() === choice.name.toLowerCase()));
  const [picked, setPicked] = useState<string[]>(bots.length === 0 ? ["claude-web", "chatgpt-web", "grok-web"] : []);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("claude-web");
  const [job, setJob] = useState("");
  void taken;

  async function addPicked() {
    try {
      for (const choice of available.filter((item) => picked.includes(item.agentId))) {
        await api.createBot({ name: choice.name, agentId: choice.agentId, job: choice.job });
      }
      setPicked([]);
      await props.refresh();
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "Could not add the bots.");
    }
  }

  return (
    <div className="scroll" style={{ padding: 20 }}>
      <div style={{ display: "grid", gap: 22, maxWidth: 860 }}>
        <div>
          <h1 className="serif" style={{ fontWeight: 500, margin: 0 }}>Bots</h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted-foreground)" }}>
            Each bot is one AI with its own chat, job and memory. Give it a daily schedule and it works in your cloud desktop even when your PC is off.
          </p>
        </div>

        {available.length ? (
          <section className="card" style={{ display: "grid", gap: 10 }}>
            <strong>{bots.length === 0 ? "Choose your bots" : "Add more bots"}</strong>
            <div style={{ display: "grid", gap: 6 }}>
              {available.map((choice) => (
                <label key={choice.agentId} className="row" style={{ gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={picked.includes(choice.agentId)}
                    onChange={(event) => setPicked((current) => (event.target.checked ? [...current, choice.agentId] : current.filter((id) => id !== choice.agentId)))}
                    style={{ marginTop: 4 }}
                  />
                  <span>
                    <strong>{choice.name}</strong>
                    <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}> · {agentName(props.boot, choice.agentId)}</span>
                    <div style={{ color: "var(--muted-foreground)", fontSize: 13 }}>{choice.job}</div>
                  </span>
                </label>
              ))}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Button size="sm" disabled={picked.length === 0} onClick={() => void addPicked()}>Add {picked.length || ""} bot{picked.length === 1 ? "" : "s"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>+ Create your own</Button>
            </div>
          </section>
        ) : (
          <div><Button size="sm" variant="outline" onClick={() => setCreating(true)}>+ Create your own bot</Button></div>
        )}

        {creating ? (
          <form
            className="card"
            style={{ display: "grid", gap: 8 }}
            onSubmit={(event) => {
              event.preventDefault();
              api.createBot({ name, agentId, job })
                .then((bot) => { setName(""); setJob(""); setCreating(false); return props.refresh().then(() => props.onOpen(bot.conversationId)); })
                .catch((reason) => props.onError(reason.message));
            }}
          >
            <strong>New bot</strong>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name, e.g. Relay-Outreach" required />
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
              {BOT_CHOICES.map((choice) => <option key={choice.agentId} value={choice.agentId}>{agentName(props.boot, choice.agentId)}</option>)}
            </select>
            <Textarea value={job} onChange={(event) => setJob(event.target.value)} placeholder="Its job, e.g. Draft three replies to new posts in my X feed every morning." />
            <div className="row" style={{ gap: 8 }}>
              <Button type="submit" size="sm">Create bot</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          </form>
        ) : null}

        {bots.length ? (
          <section style={{ display: "grid", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Your bots</h2>
            <div className="card" style={{ padding: 0, gap: 0 }}>
              {bots.map((bot, index) => <BotRow key={bot.id} boot={props.boot} bot={bot} first={index === 0} refresh={props.refresh} onError={props.onError} onOpen={props.onOpen} />)}
            </div>
          </section>
        ) : null}

        <AlarmCard boot={props.boot} refresh={props.refresh} onError={props.onError} />
      </div>
    </div>
  );
}

function AlarmCard(props: { boot: Bootstrap; refresh: () => Promise<unknown>; onError: (message: string) => void }) {
  const alarm = props.boot.alarm;
  const scheduled = props.boot.bots.some((bot) => bot.schedule);
  if (!scheduled && !alarm) return null;
  return (
    <section className="card" style={{ display: "grid", gap: 6 }}>
      <strong>Wake-ups</strong>
      <span style={{ fontSize: 13, color: alarm && !alarm.ok ? "var(--destructive)" : "var(--muted-foreground)" }}>
        {alarm ? alarm.detail : props.boot.alarmAvailable ? "Setting up…" : "Wake-ups need Relay for Windows: open it, Continue with GitHub again to allow scheduled bots, and reopen your desktop."}
      </span>
      {alarm?.repoUrl ? <a href={alarm.repoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>See the alarm in your GitHub account</a> : null}
      {props.boot.alarmAvailable ? (
        <div><Button size="sm" variant="ghost" onClick={() => api.syncAlarm().then(props.refresh).catch((reason) => props.onError(reason.message))}>Check again</Button></div>
      ) : null}
    </section>
  );
}

function BotRow(props: { boot: Bootstrap; bot: Bootstrap["bots"][number]; first: boolean; refresh: () => Promise<unknown>; onError: (message: string) => void; onOpen: (conversationId: string) => void }) {
  const bot = props.bot;
  const [editing, setEditing] = useState(false);
  const [job, setJob] = useState(bot.job);
  const [memory, setMemory] = useState(bot.memory);
  const [scheduled, setScheduled] = useState(Boolean(bot.schedule));
  const [time, setTime] = useState(bot.schedule?.time ?? "08:00");
  const [days, setDays] = useState<number[]>(bot.schedule?.days ?? [1, 2, 3, 4, 5]);
  const [prompt, setPrompt] = useState(bot.schedule?.prompt ?? "");
  const summary = bot.schedule ? `Every ${bot.schedule.days.length === 7 ? "day" : bot.schedule.days.map((day) => DAY_NAMES[day]).join(", ")} at ${bot.schedule.time}` : "No schedule";
  return (
    <div style={{ padding: "12px 16px", borderTop: props.first ? "none" : "1px solid var(--border)", display: "grid", gap: 8 }}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <strong>{bot.name}</strong>
            <span className="badge">{agentName(props.boot, bot.agentId)}</span>
            <span className={`badge ${bot.schedule ? "info" : ""}`}>{summary}</span>
          </div>
          {bot.job ? <div style={{ color: "var(--muted-foreground)", fontSize: 13 }}>{bot.job}</div> : null}
        </div>
        <div className="row" style={{ gap: 4 }}>
          <Button size="sm" onClick={() => props.onOpen(bot.conversationId)}>Chat</Button>
          <Button size="sm" variant="outline" onClick={() => setEditing((value) => !value)}>{editing ? "Close" : "Edit"}</Button>
        </div>
      </div>
      {editing ? (
        <form
          style={{ display: "grid", gap: 8 }}
          onSubmit={(event) => {
            event.preventDefault();
            const schedule = scheduled ? { time, days, prompt, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : null;
            api.updateBot(bot.id, { job, memory, schedule })
              .then(() => { setEditing(false); return props.refresh(); })
              .catch((reason) => props.onError(reason.message));
          }}
        >
          <Label>Job</Label>
          <Textarea value={job} onChange={(event) => setJob(event.target.value)} placeholder="What this bot is for" />
          <Label>Memory</Label>
          <Textarea value={memory} onChange={(event) => setMemory(event.target.value)} placeholder="Things it should always know, e.g. my audience, my tone, my projects" />
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={scheduled} onChange={(event) => setScheduled(event.target.checked)} />
            Run on a schedule
          </label>
          {scheduled ? (
            <>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} style={{ width: 130 }} />
                {DAY_NAMES.map((day, index) => (
                  <Button key={day} type="button" size="sm" variant={days.includes(index) ? "default" : "outline"} onClick={() => setDays((current) => (current.includes(index) ? current.filter((item) => item !== index) : [...current, index]))}>
                    {day}
                  </Button>
                ))}
              </div>
              <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="What to do each time, e.g. Summarize today's AI news in 5 bullets." required />
              <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Times are in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). GitHub can start a few minutes late.</span>
            </>
          ) : null}
          <div className="row" style={{ gap: 8 }}>
            <Button type="submit" size="sm">Save</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => api.runBot(bot.id).then(() => props.onOpen(bot.conversationId)).catch((reason) => props.onError(reason.message))}>Run now</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { if (confirm(`Remove ${bot.name}? Its chat stays under Projects → Bots.`)) api.deleteBot(bot.id).then(props.refresh).catch((reason) => props.onError(reason.message)); }}>Remove</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Vault(props: { boot: Bootstrap; refresh: () => Promise<unknown>; onError: (message: string) => void; onOpenComputer: () => void }) {
  const [kind, setKind] = useState<"address" | "note">("address");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const items = props.boot.vault;
  const group = (title: string, list: typeof items) =>
    list.length ? (
      <section style={{ display: "grid", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h2>
        <div className="card" style={{ padding: 0, gap: 0 }}>
          {list.map((item, index) => (
            <div key={item.id} className="row" style={{ padding: "12px 16px", borderTop: index ? "1px solid var(--border)" : "none", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <strong>{item.label}</strong>
                <div style={{ whiteSpace: "pre-wrap", color: "var(--muted-foreground)", fontSize: 13 }}>{item.value}</div>
              </div>
              <div className="row" style={{ gap: 4 }}>
                <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(item.value)}>Copy</Button>
                <Button size="sm" variant="ghost" onClick={() => api.deleteVaultItem(item.id).then(props.refresh).catch((reason) => props.onError(reason.message))}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      </section>
    ) : null;
  return (
    <div className="scroll" style={{ padding: 20 }}>
      <div style={{ display: "grid", gap: 22, maxWidth: 860 }}>
        <div>
          <h1 className="serif" style={{ fontWeight: 500, margin: 0 }}>Vault</h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted-foreground)" }}>Addresses and notes you reuse. Pick one from <strong>Insert from vault</strong> in chat, and it's added to your message so the AI can use it.</p>
        </div>
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <strong>Passwords and cards</strong>
          <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}>
            These stay in <strong>Bitwarden</strong>, the free password manager in your cloud desktop's browser. Click its icon in the browser toolbar, unlock it, and autofill when a site asks. Relay never sees or types them.
          </span>
          <div><Button size="sm" variant="outline" onClick={props.onOpenComputer}>Open my desktop</Button></div>
        </div>
        <form
          className="card"
          style={{ display: "grid", gap: 8 }}
          onSubmit={(event) => {
            event.preventDefault();
            api.addVaultItem(kind, label, value)
              .then(() => { setLabel(""); setValue(""); return props.refresh(); })
              .catch((reason) => props.onError(reason.message));
          }}
        >
          <div className="row" style={{ gap: 8 }}>
            <strong style={{ flex: 1 }}>Add</strong>
            <select value={kind} onChange={(event) => setKind(event.target.value as "address" | "note")}>
              <option value="address">Address</option>
              <option value="note">Note</option>
            </select>
          </div>
          <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={kind === "address" ? "Name, e.g. Home" : "Title, e.g. My bio"} required />
          <Textarea value={value} onChange={(event) => setValue(event.target.value)} placeholder={kind === "address" ? "Full name, street, city, postcode, country, phone" : "Anything you reuse often (no passwords or card numbers)"} required />
          <div><Button type="submit" size="sm">Save</Button></div>
        </form>
        {group("Addresses", items.filter((item) => item.kind === "address"))}
        {group("Notes", items.filter((item) => item.kind === "note"))}
        {items.length === 0 ? <p style={{ color: "var(--muted-foreground)", margin: 0 }}>Nothing saved yet.</p> : null}
      </div>
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
