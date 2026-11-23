# Contributing to Relay

Thanks for helping. Relay is a small open-source project, and every pull request makes a real difference. New contributors are very welcome: you don't need to know the whole codebase to fix something useful.

## Ways to help (no code needed for some)

- **A site broke?** AI websites change their pages often. Fixing a selector in [`src/browser/sites.ts`](src/browser/sites.ts) is the most valuable small PR.
- **Test on your machine.** Open an issue with your Windows version, RAM, CPU and what happened. Reports from AMD/Intel laptops and Oracle Arm servers are especially useful.
- **Docs and screenshots.** Clearer setup steps help everyone.
- **Features** from the [roadmap](README.md#roadmap) or issues labelled [good first issue](https://github.com/manjeetsingh-satveer/Relay/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) and [help wanted](https://github.com/manjeetsingh-satveer/Relay/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22).

Comment on an issue before you start so two people don't build the same thing. If you're unsure where to begin, ask in the issue, and we'll point you somewhere.

## Get a dev build running (about 5 minutes)

You need Node.js 22 or newer.

```bash
git clone https://github.com/manjeetsingh-satveer/Relay.git
cd Relay
npm ci
npm test
npm run dev
```

Open http://127.0.0.1:43123 for the UI. The API runs on 127.0.0.1:43124.

- `npm run dev` gives you the UI and API. To drive real AI sites you also need a desktop with Chromium on `127.0.0.1:9222`. That's either the packaged app's VM, or a Linux machine set up with [`scripts/cloud/setup.sh`](scripts/cloud/setup.sh).
- `npm run build && npm run desktop` runs the Electron app.
- `npm run dist:win` builds the Windows installer and portable exe into `release/`.
- `node dist/server.mjs --cloud --port 43123 --static dist/ui` runs cloud mode, which requires login.

## Where things live

| Area | Files |
| --- | --- |
| Web app driving (selectors, typing, reading replies) | `src/browser/sites.ts`, `src/browser/drive.ts`, `src/browser/cdp.ts` |
| Routing, team mode, hand-offs | `src/core/router.ts`, `src/core/coordinator.ts`, `src/core/prompt.ts` |
| CLIs inside the desktop (Claude Code, Cursor) | `src/browser/guest-cli.ts`, `guest/relay-helper.py` |
| Local VM (QEMU, cloud-init) | `src/vm/` |
| Cloud mode and login (password + TOTP) | `src/server/auth.ts`, `scripts/cloud/setup.sh` |
| UI | `src/renderer/` |

The design is described in [docs/architecture.md](docs/architecture.md).

## Fixing a site's selectors

1. Open the site in the Relay desktop's Chromium and sign in.
2. Use DevTools to find the message box, the send button, and the element that holds the AI's reply.
3. Put the stable selectors **first** in that site's lists in `src/browser/sites.ts`. Prefer `aria-label`, `data-testid` or roles over generated class names.
4. Send a short test message from Relay's chat and confirm the reply comes back.
5. In the PR, say which site and the date you checked it.

## Pull requests

- Keep them small and focused, and explain the user-visible change.
- Run `npm run typecheck` and `npm test` before you push. Add a test when you change routing, auth or parsing.
- Use a type prefix in the commit subject: `feat:`, `fix:`, `docs:`, `ui:`, `chore:`, `test:`.
- Link official docs when you touch a provider integration.

## Ground rules

These keep Relay trustworthy:

- **Never fake a reply.** If a tool fails, show the failure. Test doubles belong in `test/`, not in the app.
- **Never type or store passwords.** Users sign in themselves, including MFA and human checks. Relay must not solve CAPTCHAs.
- **Keep secrets out of Git**: no API keys, cookies, browser profiles, chats, VM disks or `.env` files.
- **Be honest in docs.** Don't mark something "working" until a real request returned.
- Be kind. See the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security issues

Please don't open a public issue. Use a [private security advisory](https://github.com/manjeetsingh-satveer/Relay/security/advisories/new). See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
