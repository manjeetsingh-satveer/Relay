# GitHub

The public repository is https://github.com/manjeetsingh-satveer/Relay

Clone it with:

```bash
git clone https://github.com/manjeetsingh-satveer/Relay.git
```

Issues: https://github.com/manjeetsingh-satveer/Relay/issues

Security reports: https://github.com/manjeetsingh-satveer/Relay/security/advisories/new

Suggested description:

> Desktop chat that routes work to the AI tools you already use, and can open a real Linux machine.

Suggested topics:

`ai` `desktop` `electron` `openai` `anthropic` `gemini` `cursor` `qemu` `linux` `windows` `open-source`

Do not add a star count or a download count. Do not add a CI badge until the Actions workflow on this repository has completed once. A badge for a workflow that has never run is a broken image.

Suggested first release name: `v0.1.0`

Release notes should say:

- The Windows artifacts are the app (NSIS installer and portable exe).
- They do not include Ubuntu, QEMU, or any provider.
- The Computer tab downloads the Ubuntu 24.04 cloud image on first provision and checks its SHA256.
- Grok Bot chat and Grok Bot phone calls are unsupported.
- Drex is an optional routing model, not the chat model.

Create the labels `bug`, `enhancement`, `integration`, `good first issue`, and `help wanted` on the repository. The issue templates request `bug`, `enhancement`, and `integration`.
