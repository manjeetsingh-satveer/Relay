#!/bin/bash
# Runs every time the Codespace starts or wakes: desktop, Chromium bridge, CLI helper, Relay.
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LOGS="$HOME/relay-data/logs"
mkdir -p "$LOGS"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"

running() { pgrep -f "$1" >/dev/null 2>&1; }

# Private desktop on 127.0.0.1:5901 (display :1), shown only through Relay after sign-in.
if ! running "Xtigervnc :1"; then
  rm -f /tmp/.X1-lock /tmp/.X11-unix/X1
  vncserver :1 -localhost yes -SecurityTypes None -geometry 1920x1080 -depth 24 >"$LOGS/vnc.log" 2>&1
fi
# Chromium's debug port inside the desktop is 9223; Relay talks to 127.0.0.1:9222.
running "TCP-LISTEN:9222" || nohup socat TCP-LISTEN:9222,fork,reuseaddr,bind=127.0.0.1 TCP:127.0.0.1:9223 >"$LOGS/cdp.log" 2>&1 &
running "relay-helper.py" || nohup python3 /opt/relay/relay-helper.py >"$LOGS/helper.log" 2>&1 &
if ! running "dist/server.mjs --cloud"; then
  cd "$REPO" && nohup node dist/server.mjs --cloud --vnc-port 5901 --host 127.0.0.1 --port 43123 \
    --data "$HOME/relay-data" --static dist/ui >"$LOGS/relay.log" 2>&1 &
fi
exit 0
