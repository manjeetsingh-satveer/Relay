# Good first issues

Small, well-scoped tasks for new contributors. Each one is also filed on GitHub with the `good first issue` label; comment there before you start.

1. **Verify Grok's reply selector.** `grok-web` in `src/browser/sites.ts` uses a guessed `assistant` selector, and Relay falls back to page-text diffing when it misses. Find the real reply element on grok.com and add it.
2. **Verify Perplexity's reply selector.** Same as above for `perplexity-web`, where `div.prose` is a guess.
3. **Remember the chat mode.** The chat's Mode dropdown (Team / Single / Draft-review-revise) resets on reload. Save the last choice per conversation.
4. **Show who is in the team before sending.** In Team mode, list the agents that are ready (from `boot.integrations`) under the composer.
5. **"Copy answer" button** on each assistant message in `src/renderer/App.tsx`.
6. **Keyboard shortcut to focus the composer** (for example `/`), without stealing keys while the VM display is focused.
7. **GPG-check Ubuntu `SHA256SUMS`.** The VM downloader compares SHA256 only. Verify `SHA256SUMS.gpg` against Ubuntu's published image key, and document the pinned key.
8. **Dark/light theme toggle** in Settings, stored in `localStorage`.
9. **Show session expiry** in Settings → Account (cloud mode), from `/api/auth/sessions`.
10. **Better "not signed in" message** that links straight to the Computer tab and opens that site's icon.
