# Contributing

Relay is one desktop chat that routes work to AI tools the user already has. Contributions are welcome. The useful ones are small, tested, and honest about what a provider can do.

## Setup

Repository: https://github.com/manjeetsingh-satveer/Relay

Node.js 22 or newer.

```bash
git clone https://github.com/manjeetsingh-satveer/Relay.git
cd Relay
npm ci
npm test
npm run dev
```

Open http://127.0.0.1:43123. The API listens on 127.0.0.1:43124. In this dev process, API keys stay in memory and disappear when the process exits. The packaged Electron app stores them with the operating system (DPAPI on Windows).

## Tests

`npm test` runs unit and local HTTP tests. It does not call OpenAI, Anthropic, Google, Perplexity, xAI, Cursor, or Nace.

Live checks are skipped unless you opt in:

```bash
RELAY_LIVE=1 npm test
```

Export only the keys you have. The live file skips each provider whose variable is missing. Never print a key, and do not commit `.env`.

## Pull requests

- Explain the user-visible change.
- Link official documentation when you touch an adapter.
- Do not add a mock provider to the app. Test doubles belong in `test/`.
- Do not mark a row "working" because the code compiled. Working means a real request returned.
- Keep credentials, private conversations, browser profiles, VM disks, and third-party installers out of Git.

## Integrations

A new adapter needs a documented API, SDK, CLI, or supported local interface. Browser automation of a consumer chat site is not the default. A subscription to ChatGPT, Claude, Gemini, Perplexity, Cursor, or Grok Bot is not the same thing as API access.

Grok Bot phone calls are unsupported. Do not wire an unofficial private port or the xAI voice API and call it Grok Bot.

## Good first issues

See [docs/good-first-issues.md](docs/good-first-issues.md). File them at https://github.com/manjeetsingh-satveer/Relay/issues. The labels `good first issue` and `help wanted` still have to be created on that repository. This file does not pretend those labels already exist.
