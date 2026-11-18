#!/bin/sh
# Starts the VM's own Chromium with a profile that stays on this disk.
# Relay on the host attaches with Playwright over the forwarded debug port.
# This script never receives or types a password.
set -eu
PROFILE="${HOME}/.config/relay-chrome"
mkdir -p "$PROFILE"
for bin in chromium chromium-browser google-chrome google-chrome-stable; do
  if command -v "$bin" >/dev/null 2>&1; then
    exec "$bin" \
      --remote-debugging-address=0.0.0.0 \
      --remote-debugging-port=9222 \
      --user-data-dir="$PROFILE" \
      --no-first-run \
      --disable-session-crashed-bubble \
      about:blank
  fi
done
echo "No Chromium binary in the VM. Install the chromium package." >&2
exit 1
