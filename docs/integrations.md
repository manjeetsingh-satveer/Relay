# Integrations

Checked against official docs on 18 November 2026. A row is "working" only after a live request. This repository's default test run does not have provider keys, so none of these rows were marked working from a live call here.

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
