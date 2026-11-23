# Security

Relay stores API keys and runs commands and a virtual machine on the machine where you installed it. Treat the data directory as private.

## Reporting

Use a private advisory: https://github.com/manjeetsingh-satveer/Relay/security/advisories/new

Do not open a public issue that includes a key, a session token, a guest password, or a private chat. Do not mail a live API key as the example.

## What to expect

We will confirm whether the report is about Relay's code. Third-party services (OpenAI, Anthropic, Google, Perplexity, xAI, Cursor, Nace, GitHub Codespaces) have their own reporting processes.

## Built-in limits

- The local API binds to 127.0.0.1.
- Dev mode keeps keys in process memory. The Electron build uses OS encryption when the platform provides it, and refuses to write plaintext keys when it does not.
- Keys are not written to `store.json`.
- Model and page text is treated as untrusted data when it is handed to another agent.
- The cloud desktop's link is private to the owner's GitHub account, and Relay adds password + two-factor sign-in.
- Relay will not delete a directory outside its own data folder.
- Phone confirmation never places a call. Grok Bot does not expose a calling API that Relay can use.

## Out of scope

- A stolen OS user account. Anyone who can run code as you can read what the OS key store will decrypt for your user.
- Provider-side incidents.
