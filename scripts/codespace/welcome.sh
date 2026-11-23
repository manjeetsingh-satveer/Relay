#!/bin/bash
# Shown in the Codespace terminal: how to open Relay, and the one-time setup code.
for _ in $(seq 1 20); do [ -f "$HOME/relay-data/auth.json" ] || [ -f "$HOME/relay-data/setup-token.txt" ] && break; sleep 1; done
echo
echo "  Relay is running. Open the Ports tab and click the globe next to 'Relay' (port 43123)."
echo "  The link is private: only your GitHub account can open it, on any device."
if [ -f "$HOME/relay-data/setup-token.txt" ]; then
  echo
  echo "  First-time setup code: $(cat "$HOME/relay-data/setup-token.txt")"
  echo "  Enter it in Relay, choose a password, and scan the QR code with an authenticator app."
fi
echo
