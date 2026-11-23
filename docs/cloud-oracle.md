# Run Relay in the cloud (Oracle Cloud Always Free)

Relay can run on a free Oracle Cloud server instead of a VM on your PC. It keeps working when your laptop is off, and you use it from your phone or laptop over a private Tailscale link. Nothing is opened to the public internet.

What you need: an Oracle Cloud account (free, asks for a card to verify you), a free [Tailscale](https://tailscale.com) account, and the Tailscale app on your phone and laptop.

## 1. Create the server

1. Sign in to [cloud.oracle.com](https://cloud.oracle.com) → **Compute → Instances → Create instance**.
2. **Image:** Canonical **Ubuntu 24.04** (not "Minimal").
3. **Shape:** **Ampere → VM.Standard.A1.Flex**. Use 2 OCPUs and 12 GB memory (the Always Free limit; it shows "Always Free-eligible").
4. **SSH keys:** choose **Generate a key pair for me** and click **Save private key**. Keep that file.
5. **Boot volume:** 50 GB or more (up to 200 GB total is free).
6. Click **Create**. When it's running, copy the **Public IP address**.

If Oracle says it is "out of capacity", try another availability domain or try again later. Free Ampere capacity comes and goes.

You don't need to open any ports. Relay only talks over Tailscale.

## 2. Run the setup (about 15 minutes)

On Windows, open PowerShell and connect (replace the key path and IP):

```powershell
ssh -i C:\Users\YOU\Downloads\ssh-key.key ubuntu@YOUR.PUBLIC.IP
```

Then on the server:

```bash
curl -fsSL https://raw.githubusercontent.com/manjeetsingh-satveer/Relay/main/scripts/cloud/setup.sh | sudo bash
```

Near the end it prints a Tailscale login link. Open it and approve the server in your Tailscale account. The script then prints Relay's private address, which looks like `https://relay-server.tail1234.ts.net`.

## 3. Create your login (once)

Open the address in your browser (Tailscale must be on). Relay asks you to secure it:

1. Enter the **setup code** printed at the end of step 2. It is also in `/home/relay/relay-data/setup-token.txt` on the server, and stops working once your account exists.
2. Choose a password (at least 10 characters).
3. Scan the QR code with an authenticator app such as Google Authenticator, Microsoft Authenticator, Authy or 1Password, then enter the 6-digit code it shows.
4. Save the 8 **recovery codes** somewhere safe. Each one signs you in once if you lose your phone.

From then on every device needs your password plus a fresh 6-digit code. Sessions last 30 days. After 5 wrong attempts sign-in is locked for 15 minutes. **Settings → Account** shows signed-in devices and has **Sign out on all devices**.

## 4. Open Relay on your phone and laptop

- **Laptop:** open the address and sign in.
- **Phone:** install Tailscale and sign in with the same account. Open the address in Safari or Chrome, sign in, then **Share → Add to Home Screen**. Relay then opens like an app.

Both talk to the same server, so chats, projects and sign-ins to the AI sites are the same everywhere.

## 5. Sign in to your AI apps (once)

In Relay, open **computer**. This is the server's desktop. Double-click each icon (ChatGPT, Claude, Gemini, Grok, Perplexity, Copilot) and sign in. For the CLIs, open the terminal on that desktop and run `claude` and `cursor-agent` once each.

Then use **chat** from any of your devices.

## Updating

Run the setup command again. It pulls the latest Relay and restarts it. Your sign-ins and chats stay.

## Notes

- Relay never types or stores your AI passwords. The desktop is only reachable through your Tailscale network.
- Oracle reclaims Always Free instances that stay idle for a long time. Relay's desktop and Chromium keep it in use, but check Oracle's current Always Free rules.
- Oracle's Arm servers can't run the x64-only Grok Bot direct download. The **Install Grok Bot** icon opens x.ai/bot so you can pick the Linux Arm64 build if xAI offers one.
