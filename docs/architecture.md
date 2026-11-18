# Architecture

Relay is a local desktop app. The browser UI, the Electron shell, the coordinator, the adapters, and the VM worker are separate.

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
        +-- VM worker
              +-- QEMU
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

Each adapter records support, install state, whether a credential is stored, and the last real result separately. Grok Bot's adapter refuses to run. Drex is a router, not a chat adapter.

Session text is specific. "Continued" means the provider accepted a previous response id or a CLI session id. "Copied" means Relay put earlier turns into a new request because that API has no server-side session.

## VM

The worker will not download an image until you ask. It checks QEMU, `/dev/kvm` on Linux, reported free memory, and free disk. It verifies the Ubuntu cloud image against `SHA256SUMS` from `cloud-images.ubuntu.com`. It does not check the GPG signature of that file. The qcow2 overlay and seed ISO live in the data directory. Host folders stay unshared until a confirmed path is attached on the next boot.

## Credentials

Dev mode uses an in-memory secret store. Electron uses `safeStorage` when the OS reports encryption is available, and keeps keys in memory otherwise. Neither path writes the raw key into `store.json`.
