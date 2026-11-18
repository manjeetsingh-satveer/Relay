# Integrations

The default path is a browser inside the Relay VM. You sign in on the Computer tab. Relay then uses Playwright, attached to that browser, to type a prompt and copy the finished answer. The browser profile stays on the VM disk at `~/.config/relay-chrome` and is not committed.

Live website DOM was not verified. Selectors are in `src/browser/sites.ts`. The first selector in each list is what the fixture tests use. Later selectors are guesses. A miss is reported as selector breakage, and no reply is invented.

Automating a consumer website can violate that service's terms. Read them before you rely on this.

| Surface | Path | Terms | Verified here |
| --- | --- | --- | --- |
| claude.ai | VM browser | https://www.anthropic.com/legal/consumer-terms | Fixture page only |
| chatgpt.com | VM browser | https://openai.com/policies/terms-of-use | Fixture page only |
| gemini.google.com | VM browser | https://policies.google.com/terms | Fixture page only |
| perplexity.ai | VM browser | https://www.perplexity.ai/hub/legal/terms-of-service | Fixture page only |
| grok.com | VM browser. Not Grok Bot | https://x.ai/legal/terms-of-service | Fixture page only |
| Claude Code | `claude` inside the VM | https://www.anthropic.com/legal/consumer-terms | Helper allowlist only. No live CLI |
| Cursor CLI | `cursor-agent` inside the VM | https://cursor.com/terms-of-service | Helper allowlist only. Binary not run |
| API adapters | Off until Settings enables them | Each provider's API terms | Request shapes only. No live key |
| Drex | Optional router | https://console.nace.ai/docs/drex | Parser tests only |
| Grok Bot | Unsupported, including calls | https://docs.x.ai/grok-bot/chat-and-collaboration | No API exists for this |
| Comet | Unsupported | Perplexity's terms | No task API found |

Checked against official product docs on 18 November 2026 for what each API does and does not offer. The website rows are a choice to drive the page, not a claim that the vendor supports that.

## What a website login does not give you

A ChatGPT, Claude, Gemini, or Perplexity login is not an API key. Leave API keys off if you only want the websites.

## Phone calls

"Call Arpanjeet" still resolves a contact you saved and then reports that no call was placed. Grok Bot's calling feature stays inside the Grok Bot apps.

| Product | Relay status | Interface Relay uses | What a subscription does not give you |
| --- | --- | --- | --- |
| ChatGPT | Supported as the OpenAI API, not the ChatGPT website | `POST https://api.openai.com/v1/responses` with `previous_response_id` when continuing | ChatGPT Plus is not an API key |
| Claude | Supported as the Anthropic API, not claude.ai | `POST https://api.anthropic.com/v1/messages`. Stateless, so follow-ups copy context and say so | A Claude subscription is not an API key |
| Gemini | Supported as the Gemini API, not the Gemini app | `POST .../models/{model}:generateContent` | The consumer app login is not an API key |
| Claude Code | Supported when the `claude` binary is on `PATH` | `claude -p --output-format json`, optional `--resume` | Installing the CLI is not proof of a login. Use a real task |
| Cursor | Supported as cloud agents | `POST https://api.cursor.com/v1/agents` and follow-up runs. Public beta | A Cursor plan does not by itself prove an API key works. Repo work needs a repository URL |
| Grok Bot | Unsupported | Docs describe in-app chat, routines, and US phone calls. No API for another app to send a message, read a reply, place a call, or read call status | A routine webhook only starts a routine and does not return the result. Relay does not call it |
| xAI API | Supported, and labeled as not Grok Bot | `POST https://api.x.ai/v1/chat/completions`. You must set a model id from current xAI docs | This is not Grok Bot and cannot place Grok Bot calls |
| Perplexity | Supported as the Agent API | `POST https://api.perplexity.ai/v1/agent` | This does not drive the Comet browser |
| Comet | Unsupported | No public task API was found | A Perplexity subscription does not add a Comet automation API |
| Nace Drex | Supported as an optional router | `POST https://console.nace.ai/v1/systemone` | Drex is a decision model. It does not chat and it does not provide a VM |

Default model ids are settings, not a promise that your account still has them:

- OpenAI `gpt-4.1-mini` (documented, and marked deprecated on the model page)
- Anthropic `claude-sonnet-5-5` (listed on the Messages API)
- Gemini `gemini-3.5-flash-lite` (named for new projects in Google's deprecation notes)
- Perplexity blank, which sends `effort: "low"`
- xAI blank on purpose
- Claude Code `sonnet` (a documented CLI alias)

## Phone calls

"Call Arpanjeet" resolves against contacts you typed into Relay. It does not read a phone address book. A match asks you to confirm the exact contact. Confirming shows that no call was placed. Relay does not send a test call.

## What still needs a key to prove

See [credentials.md](credentials.md).
