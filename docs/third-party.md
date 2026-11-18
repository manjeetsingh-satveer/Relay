# Third-party software

Relay's own code is MIT. See [LICENSE](../LICENSE).

Relay does not vendor these products, and it does not claim to own them:

| Piece | How Relay uses it | License note |
| --- | --- | --- |
| noVNC | Bundled as the `@novnc/novnc` dependency and loaded in the Computer tab | MPL-2.0 |
| Electron | Desktop shell | Electron's license |
| QEMU | Invoked if the user installed it. Not downloaded by Relay | GPL. Installing it is the user's choice |
| Ubuntu 24.04 cloud image | Downloaded on first VM provision from cloud-images.ubuntu.com | Ubuntu's terms. Not stored in Git |
| OpenAI, Anthropic, Google, Perplexity, xAI, Cursor, Nace, Grok Bot | Called only with the user's credentials, or marked unsupported | Their terms |

Do not commit disk images, provider installers, browser profiles, or API keys.
