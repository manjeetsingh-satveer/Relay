#!/bin/bash
# Relay cloud setup for a fresh Ubuntu 24.04 server (Oracle Cloud Ampere A1 / Arm64, or x86_64).
#
#   curl -fsSL https://raw.githubusercontent.com/manjeetsingh-satveer/Relay/main/scripts/cloud/setup.sh | sudo bash
#
# What it does:
#   - creates the "relay" user with a private XFCE desktop (TigerVNC on 127.0.0.1:5901)
#   - installs Chromium with Relay's profile and debug port (127.0.0.1:9222), the AI app icons,
#     and the Claude Code, Cursor, Gemini, Codex and Copilot CLIs
#   - builds Relay from GitHub and runs it in cloud mode on 127.0.0.1:43123
#   - installs Tailscale so only your own devices can reach Relay (nothing is opened to the internet)
#
# It never asks for or stores your AI account passwords. You sign in yourself on the desktop.
set -euo pipefail

REPO="${RELAY_REPO:-https://github.com/manjeetsingh-satveer/Relay.git}"
BRANCH="${RELAY_BRANCH:-main}"
RELAY_HOME=/home/relay
APP_DIR=/opt/relay/app
PORT=43123

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

log "Installing the desktop, VNC, and tools"
apt-get update -y
apt-get install -y xfce4 xfce4-terminal dbus-x11 tigervnc-standalone-server tigervnc-common \
  socat curl git python3 ca-certificates fonts-dejavu-core libnotify-bin

log "Creating the relay user"
if ! id relay >/dev/null 2>&1; then
  useradd -m -s /bin/bash relay
fi
echo "relay ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/relay
chmod 440 /etc/sudoers.d/relay

log "Installing Node.js 22"
if ! node --version 2>/dev/null | grep -q '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

log "Installing Chromium"
apt-get install -y chromium || apt-get install -y chromium-browser || snap install chromium

log "Fetching Relay"
mkdir -p /opt/relay
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH" && git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
chown -R relay:relay "$APP_DIR"
sudo -u relay -H bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund && npm run build:ui && npm run build:server"

log "Installing Relay's guest scripts"
install -m 755 "$APP_DIR/guest/relay-chrome.sh" /usr/local/bin/relay-chrome
install -m 755 "$APP_DIR/guest/relay-install-grok-bot.sh" /usr/local/bin/relay-install-grok-bot
install -m 755 "$APP_DIR/guest/relay-helper.py" /opt/relay/relay-helper.py
cat > /usr/local/bin/relay-open <<'EOF'
#!/bin/sh
# Opens a site as an app window in Relay's Chromium (same profile and sign-ins).
PATH="$PATH:/snap/bin"
for bin in chromium chromium-browser; do
  command -v "$bin" >/dev/null 2>&1 && exec "$bin" --user-data-dir="$HOME/relay-chrome-profile" --app="$1"
done
EOF
chmod 755 /usr/local/bin/relay-open

log "Setting up the desktop session"
install -d -o relay -g relay "$RELAY_HOME/.config/tigervnc" "$RELAY_HOME/.config/autostart" "$RELAY_HOME/Desktop" "$RELAY_HOME/relay-chrome-profile"
cat > "$RELAY_HOME/.config/tigervnc/config" <<'EOF'
session=xfce
geometry=1920x1080
localhost=yes
securitytypes=none
EOF
echo ":1=relay" > /etc/tigervnc/vncserver.users

desktop_entry() { # file name exec [icon]
  cat > "$1" <<EOF
[Desktop Entry]
Type=Application
Name=$2
Exec=$3
Icon=${4:-web-browser}
Terminal=false
Categories=Network;
EOF
}
desktop_entry "$RELAY_HOME/.config/autostart/relay-chrome.desktop" "Relay Chrome" /usr/local/bin/relay-chrome
desktop_entry "$RELAY_HOME/.config/autostart/relay-noblank.desktop" "Relay keep display on" 'sh -c "xset s off; xset s noblank; xset -dpms"'
for name in light-locker xfce4-screensaver; do
  printf '[Desktop Entry]\nType=Application\nName=%s\nHidden=true\n' "$name" > "$RELAY_HOME/.config/autostart/$name.desktop"
done
while IFS='|' read -r id name url; do
  desktop_entry "$RELAY_HOME/Desktop/relay-$id.desktop" "$name" "/usr/local/bin/relay-open $url"
done <<'EOF'
chatgpt|ChatGPT|https://chatgpt.com/
claude|Claude|https://claude.ai/
gemini|Gemini|https://gemini.google.com/
grok|Grok|https://grok.com/
perplexity|Perplexity|https://www.perplexity.ai/
cursor-web|Cursor (web)|https://cursor.com/agents
copilot|GitHub Copilot|https://github.com/copilot
EOF
desktop_entry "$RELAY_HOME/Desktop/relay-grok-bot.desktop" "Install Grok Bot" /usr/local/bin/relay-install-grok-bot system-software-install
chmod 755 "$RELAY_HOME"/Desktop/*.desktop
# Trust Relay's own launchers so XFCE does not ask on first click.
cat > /usr/local/bin/relay-trust-icons <<'EOF'
#!/bin/sh
for f in "$HOME"/Desktop/relay-*.desktop; do
  [ -f "$f" ] || continue
  gio set "$f" metadata::xfce-exe-checksum "$(sha256sum "$f" | cut -d' ' -f1)" 2>/dev/null || true
done
EOF
chmod 755 /usr/local/bin/relay-trust-icons
desktop_entry "$RELAY_HOME/.config/autostart/relay-trust-icons.desktop" "Relay trust icons" /usr/local/bin/relay-trust-icons
chown -R relay:relay "$RELAY_HOME"

log "Installing AI command-line tools (each one is optional)"
sudo -u relay -H bash -s <<'EOF' || true
set -u
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/bin:/bin"
npm config set prefix "$HOME/.npm-global"
curl -fsSL https://claude.ai/install.sh | bash || npm install -g @anthropic-ai/claude-code || echo "relay: Claude Code install failed"
curl -fsS https://cursor.com/install | bash || echo "relay: Cursor CLI install failed"
npm install -g @google/gemini-cli || echo "relay: Gemini CLI install failed"
npm install -g @openai/codex || echo "relay: Codex CLI install failed"
npm install -g @github/copilot || echo "relay: GitHub Copilot CLI install failed"
grep -q relay-path "$HOME/.bashrc" || echo 'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH" # relay-path' >> "$HOME/.bashrc"
EOF

log "Creating services"
cat > /etc/systemd/system/relay-cdp-proxy.service <<'EOF'
[Unit]
Description=Relay Chromium debug port (127.0.0.1:9222 -> 9223)
After=network.target
[Service]
ExecStart=/usr/bin/socat TCP-LISTEN:9222,fork,reuseaddr,bind=127.0.0.1 TCP:127.0.0.1:9223
Restart=always
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/relay-helper.service <<'EOF'
[Unit]
Description=Relay CLI helper
After=network.target
[Service]
User=relay
WorkingDirectory=/home/relay
Environment=HOME=/home/relay
Environment=PATH=/home/relay/.local/bin:/home/relay/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:/snap/bin
ExecStart=/usr/bin/python3 /opt/relay/relay-helper.py
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF
# The helper must only listen locally on a server.
sed -i 's/("0.0.0.0", 43125)/("127.0.0.1", 43125)/' /opt/relay/relay-helper.py
cat > /etc/systemd/system/relay.service <<EOF
[Unit]
Description=Relay (cloud mode)
After=network.target tigervncserver@:1.service
[Service]
User=relay
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node dist/server.mjs --cloud --vnc-port 5901 --host 127.0.0.1 --port $PORT --data /home/relay/relay-data --static dist/ui
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now tigervncserver@:1.service relay-cdp-proxy.service relay-helper.service relay.service

log "Installing Tailscale (private access from your phone and laptop)"
command -v tailscale >/dev/null 2>&1 || curl -fsSL https://tailscale.com/install.sh | sh
if ! tailscale status >/dev/null 2>&1; then
  echo "Open the link below on your phone or laptop and approve this server:"
  tailscale up
fi
tailscale serve --bg "$PORT"

log "Done"
tailscale serve status || true
for _ in $(seq 1 30); do [ -f /home/relay/relay-data/setup-token.txt ] && break; sleep 1; done
echo
echo "Open the https://...ts.net address above on any device signed in to your Tailscale account."
echo "On your phone: open it in the browser, then Share -> Add to Home Screen."
if [ -f /home/relay/relay-data/setup-token.txt ]; then
  echo
  echo "First-time setup code (needed once to create your login): $(cat /home/relay/relay-data/setup-token.txt)"
  echo "You'll then pick a password and scan a QR code with an authenticator app (two-factor)."
fi
