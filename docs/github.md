# Publishing on GitHub

This tree is prepared for a public repository named `relay`. Creating that repository and turning on visibility still has to be done by the owner. This workspace is not logged into GitHub.

Suggested repository name: `relay`

Suggested description:

> Desktop chat that routes work to the AI tools you already use, and can open a real Linux machine.

Suggested topics:

`ai` `desktop` `electron` `openai` `anthropic` `gemini` `cursor` `qemu` `linux` `windows` `open-source`

Do not add a star count, a download count, or a CI badge until the repository exists and the workflow has run. A badge URL for a repository that is not there yet is a broken image.

Suggested first release name: `v0.1.0`

Release notes should say:

- The Windows artifacts are the app (NSIS installer and portable exe).
- They do not include Ubuntu, QEMU, or any provider.
- The Computer tab downloads the Ubuntu 24.04 cloud image on first provision and checks its SHA256.
- Grok Bot chat and Grok Bot phone calls are unsupported.
- Drex is an optional routing model, not the chat model.

Create the labels `bug`, `enhancement`, `integration`, `good first issue`, and `help wanted` after the repo exists. The issue templates request `bug`, `enhancement`, and `integration`.
