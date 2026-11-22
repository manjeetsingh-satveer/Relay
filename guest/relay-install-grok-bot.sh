#!/bin/sh
# Installs the Grok Bot desktop app (x.ai) inside the Relay VM.
# xAI only offers the Linux .deb to signed-in users, from the Cursor dashboard.
# This script opens that page in Relay's Chromium, waits for you to download
# the .deb there, then installs it. It never types a password.
set -eu
PATH="$PATH:/snap/bin"
DOWNLOADS="$HOME/Downloads"
mkdir -p "$DOWNLOADS"
if command -v grok-bot >/dev/null 2>&1; then
  notify-send "Grok Bot" "Grok Bot is already installed." 2>/dev/null || true
  exec grok-bot
fi
find_deb() { ls -t "$DOWNLOADS"/*rok*bot*.deb "$DOWNLOADS"/*rok-bot*.deb 2>/dev/null | head -n 1; }
DEB="$(find_deb || true)"
if [ -z "$DEB" ]; then
  # xAI's "Download for Linux" link on x.ai/bot (official .deb on downloads.cursor.com).
  if curl -fL --retry 2 -o "$DOWNLOADS/grok-bot_amd64.deb" \
    "https://api2.cursor.sh/updates/download/stable/linux-x64/grok-bot-fb0a830618be0c54"; then
    DEB="$DOWNLOADS/grok-bot_amd64.deb"
  else
    rm -f "$DOWNLOADS/grok-bot_amd64.deb"
  fi
fi
if [ -z "$DEB" ]; then
  /usr/local/bin/relay-open "https://x.ai/bot" &
  notify-send "Grok Bot" "Click 'Download for Linux'. Relay installs it when the download finishes." 2>/dev/null || true
  for _ in $(seq 1 360); do
    DEB="$(find_deb || true)"
    if [ -n "$DEB" ] && [ ! -e "$DEB.crdownload" ]; then break; fi
    sleep 5
  done
fi
if [ -z "$DEB" ]; then
  notify-send "Grok Bot" "No Grok Bot .deb appeared in ~/Downloads within 30 minutes." 2>/dev/null || true
  exit 1
fi
sleep 3
sudo apt-get install -y "$DEB"
notify-send "Grok Bot" "Installed. Open it from Applications or the desktop icon." 2>/dev/null || true
