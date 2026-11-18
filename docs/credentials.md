# Credentials

The default path needs no API key. Sign in to each website yourself in the VM desktop. Relay does not ask for, store, or type that password.

API keys are optional. Turn them on in Settings only if you want the API adapters. Do not put keys in Git.

Set `RELAY_LIVE=1` and only the variables you have, then run `npm test`. Each missing variable skips that live test. The tests send a short prompt. They spend a small amount of quota. They do not place phone calls.

| Variable | Used for | Where it comes from |
| --- | --- | --- |
| `OPENAI_API_KEY` | OpenAI Responses live test | OpenAI API keys. Not ChatGPT Plus |
| `RELAY_OPENAI_MODEL` | Optional override | A current model id |
| `ANTHROPIC_API_KEY` | Messages API live test | Anthropic console. Not claude.ai |
| `RELAY_ANTHROPIC_MODEL` | Optional override | Default `claude-sonnet-5-5` |
| `GEMINI_API_KEY` | generateContent live test | Google AI Studio |
| `RELAY_GEMINI_MODEL` | Optional override | Default `gemini-3.5-flash-lite` |
| `PERPLEXITY_API_KEY` | Agent API live test | Perplexity API settings. Not Comet |
| `RELAY_PERPLEXITY_MODEL` | Optional. Blank uses `effort: low` | Agent API model list |
| `XAI_API_KEY` | xAI chat live test | xAI console. Not Grok Bot |
| `RELAY_XAI_MODEL` | Required for the xAI live test | A model id from current xAI docs. Relay does not guess |
| `CURSOR_API_KEY` | `GET /v1/agents?limit=1` only | Cursor Dashboard → API Keys. This live test does not start an agent |
| `NACE_API_KEY` | Drex `POST /v1/systemone` | console.nace.ai. Prefix `nace_sk_` |
| `claude` on `PATH` | Claude Code adapter | Install Claude Code and log in. No live test is included yet because it edits a workspace |

A Cursor coding task also needs a repository URL on the Relay project, and the key's account must be allowed to use that repository. That end-to-end run is not in the default live file, because it would create a real cloud agent.

Nothing in this list enables Grok Bot chat or Grok Bot phone calls.
