# Architecture

Relay's desktop and engine run in the cloud: the user's own GitHub Codespace (or their own server). The Windows app is a thin client that signs in with GitHub, wakes the Codespace, and shows it.

```text
Electron window  or  Vite dev server
        |
        v
HTTP + WebSocket on 127.0.0.1
        |
        +-- Coordinator
        |     +-- local rules, or Drex when a Nace key is stored
        |     +-- adapters
        |     +-- JSON store and artifact files
        |
              +-- noVNC over a localhost WebSocket
```

## Processes

`npm run dev` starts Vite on port 43123 and the API on port 43124. Vite proxies `/api` and `/vm`.

`npm run build` writes `dist/ui`, `dist/server.mjs`, and `dist/desktop.cjs`. Electron loads the UI from the API process so the packaged app does not depend on Vite.

## Coordinator

A send creates one task and one idempotency record before any provider is called. Repeating the same idempotency key returns that task. A failed task is not sent again until Retry, which uses a new key.

Collaborative mode is three steps at most by default: draft, review, revise. The reviewer gets the draft inside an `<untrusted-draft>` block. The turn, call, and wall-clock limits stop the loop. A spending cap is enforced only with costs the provider reported. Relay does not invent a price.

If Relay restarts while a task is `running`, the task becomes `interrupted` and is not submitted again.

## Adapters

The default adapters drive Chromium on the cloud desktop. Relay's engine attaches to Chromium's debugging port on 127.0.0.1 of the same machine. The browser profile stays on that machine's disk. Selectors are in `src/browser/sites.ts`. Page text is copied as untrusted data.

API adapters run only after Settings turns API keys on. Drex remains an optional router. Grok Bot refuses to run.

Session text is specific. "Continued" means the provider accepted a previous response id or a CLI session id. "Copied" means Relay put earlier turns into a new request because that API has no server-side session.

## Cloud desktop

The Codespace is built from `.devcontainer/` (Debian, XFCE, TigerVNC on localhost, Chromium, Node 22). `scripts/codespace/start.sh` starts the desktop and Relay in cloud mode on every start. Only Relay's port is forwarded, and it is private to the owner's GitHub account; Relay's own password + TOTP login sits on top. The Windows app finds or creates the Codespace through the GitHub API (`src/cloud/github.ts`) and opens it with the user's token in `X-Github-Token`.

## Bots and the wake-up alarm

`src/core/bots.ts` holds bots (agent, job, memory, schedule) and the schedule maths. The server checks every minute for due bots and runs each once per local day, catching up after a late wake-up. @mentions run bots one at a time (the desktop runs one AI app at a time), passing earlier replies as untrusted notes. `src/cloud/alarm.ts` keeps a private `relay-alarm` repository in the user's account with a scheduled workflow that starts the Codespace; the desktop app shares its GitHub token with the Codespace as the `RELAY_GITHUB_TOKEN` Codespaces secret only when the user granted repo + workflow scope.

## Credentials

Dev mode uses an in-memory secret store. Electron uses `safeStorage` when the OS reports encryption is available, and keeps keys in memory otherwise. Neither path writes the raw key into `store.json`.
