# Security

Relay stores API keys and runs commands and a virtual machine on the machine where you installed it. Treat the data directory as private.

## Reporting

Once this project is on GitHub, use a private security advisory. Do not open a public issue that includes a key, a session token, a guest password, or a private chat.

Until a public repository exists, send the report to the maintainer out of band. Do not mail a live API key as the example.

## What to expect

We will confirm whether the report is about Relay's code. Third-party services (OpenAI, Anthropic, Google, Perplexity, xAI, Cursor, Nace, Ubuntu, QEMU) have their own reporting processes.

## Built-in limits

- The local API binds to 127.0.0.1.
- Dev mode keeps keys in process memory. The Electron build uses OS encryption when the platform provides it, and refuses to write plaintext keys when it does not.
- Keys are not written to `store.json`.
- Model and page text is treated as untrusted data when it is handed to another agent.
- Host folders are not mounted in the VM unless you pass an absolute path and set `confirmShare`.
- Relay will not delete a directory outside its own data folder.
- Phone confirmation never places a call. Grok Bot does not expose a calling API that Relay can use.

## Out of scope

- A stolen OS user account. Anyone who can run code as you can read what the OS key store will decrypt for your user.
- Provider-side incidents.
