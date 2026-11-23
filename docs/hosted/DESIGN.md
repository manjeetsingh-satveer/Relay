# Relay Cloud: hosted desktops per user (design)

Status: **draft, nothing built yet.** Owner: Manjeet Singh. This document describes the hosted version of Relay ("option B"). The self-hosted app and cloud mode stay as they are.

## Goal

Anyone can sign in with **Google, Apple or email** on the web, Windows, iPhone or Android, and land in **their own private Linux desktop and chats**. They can start a task on the PC and continue it on the phone. Each user's desktop is isolated from every other user and protected at every layer.

## Chosen model: free for every user and free to run

The owner wants Relay to cost nothing for users or for the owner. A desktop with Chromium and several AI apps needs about 4 GB of RAM, and no provider gives that away to every user of an app. So **Relay does not host the desktops.** Each user's desktop runs on compute that user already has, and Relay's own service only handles sign-in and connecting devices:

```
 PC app · phone app ──Continue with Google/Apple──▶ Relay accounts (free tier: Supabase / Cloudflare)
        │                                              │ knows which desktop belongs to which user
        └──────── encrypted tunnel (Cloudflare Tunnel / Tailscale, free) ────────┐
                                                                                  ▼
                       the user's own desktop:  ① their Windows PC (Relay app + VM)
                                                ② their free Oracle Cloud server
                                                ③ their GitHub Codespace (free hours)
```

- **Sign in once with Google or Apple** on any device. The Relay account remembers the user's desktop, so the phone connects to the same desktop the PC uses and work continues where it left off.
- **The owner's costs stay at about $0.** Accounts, device pairing and push notifications fit the free tiers of Supabase (auth + Postgres), Cloudflare (Workers + Tunnel) and Firebase Cloud Messaging. Unavoidable store fees: Apple Developer $99/year (for the iOS app) and Google Play $25 once.
- **The user's costs are $0.** Option ① is their own PC, which must be on to reach the desktop from the phone. ② Oracle Always Free is always on but needs a card check. ③ Codespaces gives free hours with no card.
- **Security:** each desktop is private to its owner (it's their machine). The tunnel only accepts connections carrying a valid session from Relay accounts. The account service stores no chats and no AI sign-ins. Those never leave the user's desktop.
- The hosted-desktop design below stays as an optional paid tier for later, for people who want Relay to run while their PC is off without setting up Oracle.

## User experience

1. **Sign up:** Continue with Google, Continue with Apple, or email. Relay creates the user's desktop automatically, which takes about a minute the first time.
2. **First run:** the app opens the **Desktop** tab. The user signs in to ChatGPT, Claude, Gemini and the others once. Those sign-ins are saved in *their* desktop only.
3. **Daily use:**
   - **Chat** shows Team / Single / Review modes, as today.
   - **Desktop** shows the live view with touch controls on mobile.
   - **Settings** covers devices, security and billing.
4. **Continue anywhere:** chats, tasks and the desktop live on the server, so every signed-in device sees the same thing live. Tasks keep running when every device is closed, and a push notification says when they finish.
5. **Leave anytime:** "Delete my account" removes the desktop, its disk, the browser profile and all chats.

## Architecture

```
 Web · Windows · iOS · Android  (one React UI; Capacitor for mobile, Electron for Windows)
        │  HTTPS + WebSocket
        ▼
 ┌───────────────────────── Relay Cloud (control plane) ─────────────────────────┐
 │  Gateway      TLS, auth check on every request, rate limits, WAF             │
 │  Accounts     Google/Apple OIDC, email magic links, passkeys, TOTP           │
 │  Sessions     per-device sessions, revoke, audit log                         │
 │  Orchestrator create / start / stop / delete one desktop per user            │
 │  Billing      Stripe (web), App Store / Play billing (mobile)                │
 │  Push         APNs + FCM ("your team finished")                              │
 │  Postgres     users, devices, desktops, subscriptions, audit                 │
 └────────────────────────────────────────────────────────────────────────────────┘
        │  private network only (never public)
        ▼
 ┌─ Desktop: user A (microVM) ─┐   ┌─ Desktop: user B (microVM) ─┐
 │ Relay engine (cloud mode)   │   │ ...                         │
 │ XFCE + VNC (localhost)      │   │                             │
 │ Chromium + AI sign-ins      │   │                             │
 │ CLIs (Claude Code, Cursor…) │   │                             │
 │ Encrypted volume /home      │   │                             │
 └─────────────────────────────┘   └─────────────────────────────┘
```

### Control plane
- **Gateway:** the only public entry point. Every request carries a session, the gateway verifies it, then proxies `/api/*`, `/api/events` (SSE) and `/vm/vnc` (WebSocket) to **that user's** desktop over the private network. A user can never address another user's desktop: the route comes from the session, never from the URL.
- **Accounts:** OpenID Connect with Google and Apple, plus email magic links. Optional passkeys and TOTP. Apple requires Sign in with Apple in the iOS app if Google sign-in is offered.
- **Orchestrator:** creates a desktop on sign-up from a prebuilt image (today's `scripts/cloud/setup.sh`, baked into an image). Starts it when any device connects, and stops it after 30 minutes idle with no running task.

### Desktop (one per user)
- **Isolation:** a separate **microVM** per user (Firecracker / Kata / provider VM), not a shared container. One user's compromised desktop can't see another's.
- **Inside:** the existing Relay server in cloud mode, but trusting a **short-lived token signed by the gateway** instead of its own password login. It runs XFCE, TigerVNC bound to localhost, Chromium on 127.0.0.1:9222 and the CLIs, as today.
- **Storage:** a persistent volume for `/home/relay` (browser profile, chats, files), **encrypted at rest**. Phase 5 adds a per-user data key from a KMS, released to the VM only while it runs.
- **Network:** outbound internet only, so the AI sites work. No inbound ports, and no access to other desktops or to the control-plane database.

## Security model

| Threat | Protection |
|---|---|
| Someone takes over a user's account | Google/Apple sign-in, optional TOTP and passkeys, new-device email alerts, per-device sessions with revoke, rate limits |
| User A reaches user B's desktop | Separate microVM per user; the gateway routes by session only; private network with per-desktop firewall |
| Stolen session cookie | HttpOnly, Secure, SameSite=Strict cookies on the web and Keychain/Keystore on mobile; short tokens to desktops; IP and device binding with anomaly checks |
| Server disk or backup leaked | Encrypted volumes; per-user keys (phase 5); no AI passwords stored anywhere (users sign in to the sites themselves) |
| Relay staff access | No standing access to desktops; break-glass access is logged and requires the user's consent |
| Abuse (spam, scraping) | Per-user quotas, rate limits, terms of use, and the ability to suspend a desktop |

Ground rules carry over: Relay never types or stores AI passwords, never solves CAPTCHAs, and never fakes a reply.

## Hosting options for the desktops

| Option | How | Pros | Cons |
|---|---|---|---|
| **Fly.io Machines** *(recommended for MVP)* | One Firecracker microVM + volume per user via the Machines API; stop when idle and start on request | Real VM isolation, per-second billing, fast start/stop, little ops work | Costlier per GB than raw servers; vendor lock-in |
| Hetzner + Kata/Firecracker | Rent big servers and run microVMs yourself | Cheapest at scale | You run the VM layer, patching and scheduling |
| AWS (EC2 / Fargate) | VM or task per user | Mature, credits for startups | More expensive; more setup |
| Each user's own Oracle Free account | User links their Oracle account; Relay deploys there | Free hosting for you | Complex onboarding; a card is needed per user |

**Rough costs** (check current pricing before committing): a 4 GB desktop running full time costs on the order of **$15–30/month** on managed providers. With sleep-when-idle, a typical user active about 2 hours a day costs roughly **$2–6/month**, plus about $0.15/GB-month for storage. A paid plan, or a free tier with limited hours, is needed.

## Phased plan

| Phase | Deliverable | Notes |
|---|---|---|
| **1. Control plane MVP** | Gateway, Google + Apple + email sign-in, devices/sessions, Postgres, one desktop per user created by hand | Proves the sign-in → own desktop flow on the web |
| **2. Auto desktops** | Orchestrator on Fly.io: create on sign-up, start on connect, stop when idle, delete on request; desktop image from `setup.sh` | Desktop trusts gateway tokens |
| **3. Mobile apps** | Capacitor iOS/Android: sign-in, Chat, Desktop with touch controls, Face ID/fingerprint, push | TestFlight / internal testing first |
| **4. Billing** | Free tier (limited hours) and paid plan; Stripe on the web, in-app purchase on mobile | Store rules require in-app purchase for digital subscriptions sold in-app |
| **5. Hardening** | Per-user KMS keys, audit log UI, new-device alerts, penetration test, privacy policy and terms, data export/delete | Before a public launch |

## Open decisions (owner)

1. **Hosting for desktops:** Fly.io (recommended), Hetzner, AWS, or users' own Oracle accounts.
2. **Pricing:** free trial plus a paid plan, a free tier with limited hours, or paid only.
3. **Domain and name:** for example `relay.app` / `app.relay…` (needed for OAuth and the stores).
4. **Legal entity:** store accounts and Sign in with Apple are tied to a person or a company. A company is better for a paid service.
5. **Terms of service risk:** a hosted service that drives consumer AI sites at scale is riskier than personal use. Get legal advice before charging money.
6. **Accounts:** Apple Developer ($99/yr) and Google Play ($25 once), Google Cloud OAuth client, Apple Services ID.
