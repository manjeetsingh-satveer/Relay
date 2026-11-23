# Relay in GitHub Codespaces (free, no card)

Relay runs in your own GitHub Codespace: a private cloud computer in **your** GitHub account. You use it from your PC or phone, and your chats, desktop and AI sign-ins stay there between sessions.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/manjeetsingh-satveer/Relay?quickstart=1)

## Start

1. Click the button above, then **Create codespace**. The first build takes about 10 minutes.
2. When the terminal shows **"Relay is running"**, open the **Ports** tab and click the globe next to **Relay (43123)**.
3. Enter the **setup code** shown in the terminal, choose a password, and scan the QR code with an authenticator app (two-factor). Save your recovery codes.
4. Open **computer** and sign in to each AI app once (ChatGPT, Claude, Gemini, Grok, Perplexity).
5. Use **chat**. Team mode has the AI apps work on your task together.

## On your phone

Open the same Relay link on your phone (it's on the Ports tab, or bookmark it). Sign in to GitHub if asked, then sign in to Relay. You'll see the same chats and desktop. Use **Share → Add to Home Screen** to open it like an app.

The link is **private**: only your GitHub account can open it, and Relay's own password and two-factor login apply on top.

## Free hours and sleep

- GitHub gives personal accounts a monthly allowance of free Codespaces hours (check *Settings → Billing* on GitHub for current numbers). This machine uses 2 cores.
- A Codespace **stops after a period of inactivity**. Set it to up to 4 hours in *GitHub → Settings → Codespaces → Default idle timeout*. Opening it again wakes it in about a minute; your chats and sign-ins are kept.
- Stop it yourself from github.com/codespaces when you're done to save hours.
- A Codespace you don't use for a long time is deleted by GitHub (30 days by default), and your sign-ins are lost with it.

## Troubleshooting

Logs are in `~/relay-data/logs/` (`relay.log`, `vnc.log`, `helper.log`). To restart everything run:

```bash
bash scripts/codespace/start.sh
```
