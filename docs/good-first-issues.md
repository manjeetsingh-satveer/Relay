# Good first issues

These are real gaps in this tree. They are not assigned. File one at https://github.com/manjeetsingh-satveer/Relay/issues. The label `good first issue` still has to be created on that repository.

1. **Update one site's selectors.** `src/browser/sites.ts` holds every selector. The live DOM was not verified. Pick one site, sign in inside the VM, and replace the guesses with selectors you actually saw. Add a fixture assertion if the shape changed.
2. **Show Cursor `durationMs` in the task header.** The run payload already includes it, and the adapter appends it to the session detail. A small UI line would make it easier to see.
3. **Per-project default agent.** The composer can select an agent for one send. Remember that choice on the project.
4. **CSV contact import.** Accept a file the user picks. Do not read the Windows address book.
5. **GPG-check Ubuntu `SHA256SUMS`.** The downloader currently compares the SHA256 only. Verifying `SHA256SUMS.gpg` with Ubuntu's published image key would close the "checksum file also replaced" gap. Document the key you pin.
6. **Windows QEMU discovery.** `qemuCandidates()` lists the usual paths. A test on the Windows CI job, with QEMU absent, should still pass and report not installed. Do not download QEMU in CI.
7. **Grok Bot routine webhook, clearly limited.** The docs describe a per-routine URL. A 200 means the run was accepted, not that it finished, and there is no documented result API. An optional card can POST and show the HTTP status only. It must not be labeled as chat or as a phone call.
8. **Composer shortcut.** Focus the prompt with a key. Do not steal keys while the VM display is focused.

Leave phone-call work alone unless Grok Bot publishes an interface that returns call status.
