import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi, type AuthState } from "@/lib/api";
import { formatWhen } from "@/lib/utils";

/**
 * Shows sign-in (or first-time setup) when Relay runs on a server, and the app once signed in.
 * On the local desktop app login is not required and this renders the app straight away.
 */
export function AuthGate(props: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    authApi.state().then(setState).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not reach Relay."));

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => void refresh();
    window.addEventListener("relay-unauthorized", onUnauthorized);
    return () => window.removeEventListener("relay-unauthorized", onUnauthorized);
  }, []);

  if (error) return <Centered><p>{error}</p></Centered>;
  if (!state) return <Centered><p>Loading Relay…</p></Centered>;
  if (!state.required || state.authenticated) return <>{props.children}</>;
  return state.configured ? <SignIn onDone={refresh} /> : <Setup onDone={refresh} />;
}

function Centered(props: { children: ReactNode }) {
  return (
    <div style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 20, overflow: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 420, display: "grid", gap: 14, padding: 24 }}>
        <div className="brand" style={{ padding: 0 }}>
          <strong>RELAY</strong>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function SignIn(props: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.login(password, code);
      props.onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <h1 className="serif" style={{ fontWeight: 500, margin: 0 }}>Sign in</h1>
      <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        <Label htmlFor="code">{useRecovery ? "Recovery code" : "6-digit code from your authenticator app"}</Label>
        <Input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={useRecovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          placeholder={useRecovery ? "XXXXX-XXXXX" : "123456"}
          required
        />
        {error ? <p style={{ color: "var(--destructive)", margin: 0 }}>{error}</p> : null}
        <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { setUseRecovery(!useRecovery); setCode(""); }}>
          {useRecovery ? "Use my authenticator app instead" : "Lost your phone? Use a recovery code"}
        </Button>
      </form>
    </Centered>
  );
}

function Setup(props: { onDone: () => void }) {
  const [step, setStep] = useState<"password" | "scan" | "codes">("password");
  const [setupToken, setSetupToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [qr, setQr] = useState<{ secret: string; qrSvg: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "password") {
    return (
      <Centered>
        <h1 className="serif" style={{ fontWeight: 500, margin: 0 }}>Secure your Relay</h1>
        <p style={{ margin: 0, color: "var(--muted-foreground)" }}>Create the owner account. You'll sign in with this password and a code from an authenticator app.</p>
        <form
          style={{ display: "grid", gap: 10 }}
          onSubmit={(event) => {
            event.preventDefault();
            if (password !== confirm) {
              setError("The passwords don't match.");
              return;
            }
            void run(async () => {
              setQr(await authApi.beginSetup(setupToken, password));
              setStep("scan");
            });
          }}
        >
          <Label htmlFor="token">Setup code (shown at the end of the server setup)</Label>
          <Input id="token" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} autoComplete="off" required autoFocus />
          <Label htmlFor="new-password">Password (at least 10 characters)</Label>
          <Input id="new-password" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Label htmlFor="confirm-password">Repeat password</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          {error ? <p style={{ color: "var(--destructive)", margin: 0 }}>{error}</p> : null}
          <Button type="submit" disabled={busy}>Next</Button>
        </form>
      </Centered>
    );
  }

  if (step === "scan" && qr) {
    return (
      <Centered>
        <h1 className="serif" style={{ fontWeight: 500, margin: 0 }}>Turn on two-factor</h1>
        <p style={{ margin: 0, color: "var(--muted-foreground)" }}>
          Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…). On a phone, tap the link instead.
        </p>
        <div style={{ background: "#fff", borderRadius: 12, padding: 12, width: 220, justifySelf: "center" }} dangerouslySetInnerHTML={{ __html: qr.qrSvg }} />
        <a href={qr.uri} style={{ textAlign: "center", color: "var(--primary)" }}>Open in authenticator app</a>
        <details>
          <summary style={{ cursor: "pointer" }}>Can't scan? Enter this key</summary>
          <code style={{ wordBreak: "break-all" }}>{qr.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
        </details>
        <form
          style={{ display: "grid", gap: 10 }}
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const result = await authApi.confirmSetup(code);
              setRecovery(result.recoveryCodes);
              setStep("codes");
            });
          }}
        >
          <Label htmlFor="first-code">Enter the 6-digit code it shows</Label>
          <Input id="first-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
          {error ? <p style={{ color: "var(--destructive)", margin: 0 }}>{error}</p> : null}
          <Button type="submit" disabled={busy}>Turn on</Button>
        </form>
      </Centered>
    );
  }

  return (
    <Centered>
      <h1 className="serif" style={{ fontWeight: 500, margin: 0 }}>Save your recovery codes</h1>
      <p style={{ margin: 0, color: "var(--muted-foreground)" }}>
        If you lose your phone, each code signs you in once instead of the authenticator. They are shown only now.
      </p>
      <pre className="card" style={{ margin: 0, columns: 2, fontSize: 15 }}>{recovery.join("\n")}</pre>
      <Button type="button" variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(recovery.join("\n"))}>Copy codes</Button>
      <label className="row"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I saved these somewhere safe</label>
      <Button disabled={!saved} onClick={props.onDone}>Open Relay</Button>
    </Centered>
  );
}

/** Settings card: who is signed in and sign-out controls. Renders nothing on the local desktop app. */
export function AccountCard() {
  const [info, setInfo] = useState<{ sessions: { createdAt: string; lastSeen: string; device: string }[]; recoveryCodesLeft: number } | null>(null);
  const [required, setRequired] = useState(false);

  useEffect(() => {
    authApi.state().then((state) => {
      setRequired(state.required);
      if (state.required) authApi.sessions().then(setInfo).catch(() => undefined);
    }).catch(() => undefined);
  }, []);

  if (!required) return null;
  const signOut = (everywhere: boolean) => authApi.logout(everywhere).finally(() => window.dispatchEvent(new Event("relay-unauthorized")));
  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      <Label>Account</Label>
      <p style={{ margin: 0 }}>Signed in with password and two-factor code. {info ? `${info.recoveryCodesLeft} recovery codes left.` : ""}</p>
      {info?.sessions.length ? (
        <div style={{ display: "grid", gap: 4, fontSize: 13, color: "var(--muted-foreground)" }}>
          {info.sessions.map((session, index) => (
            <span key={index}>{session.device} · signed in {formatWhen(session.createdAt)} · last active {formatWhen(session.lastSeen)}</span>
          ))}
        </div>
      ) : null}
      <div className="row">
        <Button type="button" variant="outline" size="sm" onClick={() => void signOut(false)}>Sign out</Button>
        <Button type="button" variant="danger" size="sm" onClick={() => void signOut(true)}>Sign out on all devices</Button>
      </div>
    </div>
  );
}
