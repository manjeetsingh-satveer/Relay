# Third-party software

Relay's own code is MIT. See [LICENSE](../LICENSE).

Relay does not vendor these products, and it does not claim to own them:

| Piece | How Relay uses it | License note |
| --- | --- | --- |
| noVNC | Bundled as the `@novnc/novnc` dependency and loaded in the Computer tab | MPL-2.0 |
| Electron | Desktop shell | Electron's license |
| Debian + Chromium (Codespace image) | Installed in the user's own Codespace from Debian's repositories | Their own licenses |
| OpenAI, Anthropic, Google, Perplexity, xAI, Cursor, Nace, Grok Bot | Called only with the user's credentials, or marked unsupported | Their terms |

Do not commit disk images, provider installers, browser profiles, or API keys.
