#!/bin/bash
# Runs once when the Codespace is created: builds Relay, prepares the desktop, installs AI CLIs.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

log "Building Relay"
cd "$REPO" && npm ci --no-audit --no-fund && npm run build:ui && npm run build:server

log "Installing Relay's desktop scripts"
sudo install -m 755 "$REPO/guest/relay-chrome.sh" /usr/local/bin/relay-chrome
sudo install -m 755 "$REPO/guest/relay-install-grok-bot.sh" /usr/local/bin/relay-install-grok-bot
sudo install -d /opt/relay
sudo install -m 755 "$REPO/guest/relay-helper.py" /opt/relay/relay-helper.py
# Everything listens on localhost only; only Relay's port is forwarded (privately) by Codespaces.
sudo sed -i 's/("0.0.0.0", 43125)/("127.0.0.1", 43125)/' /opt/relay/relay-helper.py
sudo tee /usr/local/bin/relay-open >/dev/null <<'EOF'
#!/bin/sh
exec chromium $RELAY_CHROME_FLAGS --user-data-dir="$HOME/relay-chrome-profile" --app="$1"
EOF
sudo chmod 755 /usr/local/bin/relay-open

log "Adding the Bitwarden password manager to Chromium"
# Passwords and cards live in Bitwarden (the user unlocks and autofills it themselves), never in Relay.
sudo install -d /etc/chromium/policies/managed
echo "{\"ExtensionInstallForcelist\":[\"nngceckbapebfimnlniiiahkandclblb;https://clients2.google.com/service/update2/crx\"]}" | sudo tee /etc/chromium/policies/managed/relay-bitwarden.json >/dev/null

log "Setting up the desktop"
mkdir -p "$HOME/.config/autostart" "$HOME/Desktop" "$HOME/relay-chrome-profile" "$HOME/relay-data" "$HOME/.vnc"
entry() { # file name exec [icon]
  printf '[Desktop Entry]\nType=Application\nName=%s\nExec=%s\nIcon=%s\nTerminal=false\nCategories=Network;\n' "$2" "$3" "${4:-web-browser}" > "$1"
}
entry "$HOME/.config/autostart/relay-chrome.desktop" "Relay Chrome" /usr/local/bin/relay-chrome
entry "$HOME/.config/autostart/relay-noblank.desktop" "Keep display on" 'sh -c "xset s off; xset s noblank; xset -dpms"'
while IFS='|' read -r id name url; do
  entry "$HOME/Desktop/relay-$id.desktop" "$name" "/usr/local/bin/relay-open $url"
done <<'EOF'
chatgpt|ChatGPT|https://chatgpt.com/
claude|Claude|https://claude.ai/
gemini|Gemini|https://gemini.google.com/
grok|Grok|https://grok.com/
perplexity|Perplexity|https://www.perplexity.ai/
cursor-web|Cursor (web)|https://cursor.com/agents
copilot|GitHub Copilot|https://github.com/copilot
EOF
log "Installing the Grok Bot desktop app"
# Official x64 .deb from xAI (the "Download for Linux" link on x.ai/bot). The user signs in themselves.
if curl -fsSL --retry 2 -o /tmp/grok-bot.deb "https://api2.cursor.sh/updates/download/stable/linux-x64/grok-bot-fb0a830618be0c54"; then
  sudo apt-get update -qq && sudo apt-get install -y /tmp/grok-bot.deb && rm -f /tmp/grok-bot.deb
fi
# Grok Bot opens with a local-only DevTools port so Relay can type into it and read replies.
sudo tee /usr/local/bin/relay-grok-bot >/dev/null <<'EOF'
#!/bin/sh
if ! command -v grok-bot >/dev/null 2>&1; then exec /usr/local/bin/relay-install-grok-bot; fi
exec grok-bot --no-sandbox --remote-debugging-address=127.0.0.1 --remote-debugging-port=9224 "$@"
EOF
sudo chmod 755 /usr/local/bin/relay-grok-bot
entry "$HOME/Desktop/relay-grok-bot.desktop" "Grok Bot" /usr/local/bin/relay-grok-bot grok-bot
entry "$HOME/.config/autostart/relay-grok-bot.desktop" "Grok Bot" /usr/local/bin/relay-grok-bot
# Sign-in links open in Relay's Chromium, and grokbot:// return links go back to Grok Bot.
sudo tee /usr/local/bin/relay-browser >/dev/null <<'EOF'
#!/bin/sh
exec chromium $RELAY_CHROME_FLAGS --user-data-dir="$HOME/relay-chrome-profile" "$@"
EOF
sudo chmod 755 /usr/local/bin/relay-browser
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/relay-browser.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Relay Browser
Exec=/usr/local/bin/relay-browser %u
Icon=web-browser
Terminal=false
MimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;
Categories=Network;WebBrowser;
EOF
cat > "$HOME/.local/share/applications/relay-grok-bot-handler.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Grok Bot (Relay)
Exec=/usr/local/bin/relay-grok-bot %U
Icon=grok-bot
Terminal=false
NoDisplay=true
MimeType=x-scheme-handler/grokbot;x-scheme-handler/sand;
EOF
# XFCE opens links with its own "preferred browser" (exo-open), so set that too.
mkdir -p "$HOME/.local/share/xfce4/helpers" "$HOME/.config/xfce4"
cat > "$HOME/.local/share/xfce4/helpers/relay-browser.desktop" <<'EOF'
[Desktop Entry]
NoDisplay=true
Version=1.0
Type=X-XFCE-Helper
X-XFCE-Category=WebBrowser
X-XFCE-Commands=/usr/local/bin/relay-browser
X-XFCE-CommandsWithParameter=/usr/local/bin/relay-browser "%s"
Icon=web-browser
Name=Relay Browser
EOF
echo "WebBrowser=relay-browser" >> "$HOME/.config/xfce4/helpers.rc"
xdg-mime default relay-browser.desktop x-scheme-handler/http x-scheme-handler/https text/html
xdg-mime default relay-grok-bot-handler.desktop x-scheme-handler/grokbot x-scheme-handler/sand
chmod 755 "$HOME"/Desktop/*.desktop
cat > "$HOME/.vnc/xstartup" <<'EOF'
#!/bin/sh
unset SESSION_MANAGER DBUS_SESSION_BUS_ADDRESS
export RELAY_CHROME_FLAGS="--no-sandbox --disable-dev-shm-usage"
# Trust Relay's own launchers so XFCE doesn't ask on first click.
(sleep 8; for f in "$HOME"/Desktop/relay-*.desktop; do gio set "$f" metadata::xfce-exe-checksum "$(sha256sum "$f" | cut -d' ' -f1)" 2>/dev/null; done) &
exec dbus-launch --exit-with-session startxfce4
EOF
chmod 755 "$HOME/.vnc/xstartup"

if [ "${RELAY_SKIP_CLIS:-}" = "1" ]; then log "Relay is ready (AI CLIs skipped)"; exit 0; fi
log "Installing AI command-line tools (each one is optional)"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
npm config set prefix "$HOME/.npm-global"
curl -fsSL https://claude.ai/install.sh | bash || npm install -g @anthropic-ai/claude-code || echo "relay: Claude Code install failed"
curl -fsS https://cursor.com/install | bash || echo "relay: Cursor CLI install failed"
npm install -g @google/gemini-cli @openai/codex @github/copilot || echo "relay: some CLIs failed to install"
grep -q relay-path "$HOME/.bashrc" || echo 'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH" # relay-path' >> "$HOME/.bashrc"
log "Relay is ready"
