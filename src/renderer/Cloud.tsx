import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * "Continue with GitHub" (desktop app): sign in with GitHub, then open Relay running in the user's
 * own free Codespace. Shown at #cloud. The token stays in this app (OS-encrypted).
 */
type Phase =
  | { kind: "loading" }
  | { kind: "not-configured" }
  | { kind: "signed-out" }
  | { kind: "code"; userCode: string; verificationUri: string }
  | { kind: "opening"; message: string; created: boolean }
  | { kind: "error"; message: string };

async function call<T>(path: string, method = "GET"): Promise<T> {
  const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  return body as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function CloudLauncher() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [login, setLogin] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    void boot();
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function boot() {
    try {
      const state = await call<{ configured: boolean; signedIn: boolean; login?: string }>("/api/cloud/state");
      if (!state.configured) return setPhase({ kind: "not-configured" });
      if (!state.signedIn) return setPhase({ kind: "signed-out" });
      setLogin(state.login ?? null);
      await open();
    } catch (reason) {
      setPhase({ kind: "error", message: reason instanceof Error ? reason.message : "Something went wrong." });
    }
  }

  async function signIn() {
    try {
      const start = await call<{ userCode: string; verificationUri: string; interval: number }>("/api/cloud/github/start", "POST");
      setPhase({ kind: "code", userCode: start.userCode, verificationUri: start.verificationUri });
      window.open(start.verificationUri, "_blank");
      void navigator.clipboard?.writeText(start.userCode).catch(() => undefined);
      let interval = Math.max(5, start.interval) * 1000;
      for (;;) {
        await sleep(interval);
        if (cancelled.current) return;
        const poll = await call<{ status: string }>("/api/cloud/github/poll", "POST");
        if (poll.status === "done") return boot();
        if (poll.status === "slow_down") interval += 5000;
        if (poll.status === "expired" || poll.status === "denied") {
          return setPhase({ kind: "error", message: poll.status === "denied" ? "GitHub sign-in was cancelled." : "The code expired. Try again." });
        }
      }
    } catch (reason) {
      setPhase({ kind: "error", message: reason instanceof Error ? reason.message : "GitHub sign-in failed." });
    }
  }

  async function open() {
    const opened = await call<{ created: boolean; state: string }>("/api/cloud/open", "POST");
    const started = Date.now();
    for (;;) {
      if (cancelled.current) return;
      const progress = await call<{ state: string; ready: boolean; url: string | null; created: boolean }>("/api/cloud/progress");
      if (progress.ready && progress.url) {
        location.href = progress.url;
        return;
      }
      const minutes = Math.floor((Date.now() - started) / 60000);
      const message = opened.created
        ? `Creating your cloud desktop in your GitHub account. The first time takes about 10 minutes${minutes ? ` (${minutes} min so far)` : ""}.`
        : progress.state === "Available"
          ? "Starting Relay…"
          : "Waking up your cloud desktop (about a minute)…";
      setPhase({ kind: "opening", message, created: opened.created });
      await sleep(5000);
    }
  }

  async function signOut() {
    await call("/api/cloud/signout", "POST").catch(() => undefined);
    setLogin(null);
    setPhase({ kind: "signed-out" });
  }

  return (
    <div style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 20, overflow: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 460, display: "grid", gap: 14, padding: 24 }}>
        <div className="brand" style={{ padding: 0 }}>
          <strong>RELAY</strong>
        </div>
        {phase.kind === "loading" ? <p>Loading…</p> : null}
        {phase.kind === "not-configured" ? <p>Continue with GitHub isn't set up in this build yet.</p> : null}
        {phase.kind === "signed-out" ? (
          <>
            <h1 className="serif" style={{ fontWeight: 500, margin: 0 }}>Your free cloud desktop</h1>
            <p style={{ margin: 0, color: "var(--muted-foreground)" }}>
              Relay runs in a private Codespace in <strong>your own</strong> GitHub account, using GitHub's free monthly hours. No card. Open it from your PC or phone and carry on where you left off.
            </p>
            <Button onClick={() => void signIn()}>Continue with GitHub</Button>
          </>
        ) : null}
        {phase.kind === "code" ? (
          <>
            <h1 className="serif" style={{ fontWeight: 500, margin: 0 }}>Approve in your browser</h1>
            <p style={{ margin: 0 }}>Enter this code on the GitHub page that opened (it's copied to your clipboard):</p>
            <code style={{ fontSize: 30, letterSpacing: 4, textAlign: "center", padding: 12 }} className="card">{phase.userCode}</code>
            <Button variant="outline" onClick={() => window.open(phase.verificationUri, "_blank")}>Open GitHub again</Button>
            <p style={{ margin: 0, color: "var(--muted-foreground)", fontSize: 13 }}>Waiting for you to authorize Relay…</p>
          </>
        ) : null}
        {phase.kind === "opening" ? (
          <>
            <h1 className="serif" style={{ fontWeight: 500, margin: 0 }}>{phase.created ? "Setting up" : "Opening"} your desktop</h1>
            <p style={{ margin: 0 }}>{phase.message}</p>
            {login ? <p style={{ margin: 0, color: "var(--muted-foreground)", fontSize: 13 }}>Signed in to GitHub as {login}.</p> : null}
          </>
        ) : null}
        {phase.kind === "error" ? (
          <>
            <p style={{ color: "var(--destructive)", margin: 0 }}>{phase.message}</p>
            <Button onClick={() => void boot()}>Try again</Button>
          </>
        ) : null}
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span />
          {login ? <Button variant="ghost" size="sm" onClick={() => void signOut()}>Sign out of GitHub</Button> : null}
        </div>
      </div>
    </div>
  );
}
