#!/bin/sh
# Starts the VM's own Chromium with a profile that stays on this disk.
# Relay on the host attaches with Playwright over the forwarded debug port.
# Chromium only binds its debug port to 127.0.0.1 (it ignores
# --remote-debugging-address), so relay-cdp-proxy.service forwards
# 0.0.0.0:9222 -> 127.0.0.1:9223 for QEMU's port forward to reach.
# The profile lives in a non-hidden folder because snap Chromium cannot
# write to hidden folders such as ~/.config.
# This script never receives or types a password.
set -eu
PROFILE="${HOME}/relay-chrome-profile"
mkdir -p "$PROFILE"
PATH="$PATH:/snap/bin"
for bin in chromium chromium-browser google-chrome google-chrome-stable; do
  if command -v "$bin" >/dev/null 2>&1; then
    exec "$bin" \
      --remote-debugging-port=9223 \
      --user-data-dir="$PROFILE" \
      --no-first-run \
      --no-default-browser-check \
      --disable-session-crashed-bubble \
      about:blank
  fi
done
echo "No Chromium binary in the VM. Install the chromium package." >&2
exit 1
