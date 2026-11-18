# Troubleshooting

## The send button says no agent is ready

Store an API key on Integrations, or install `claude` for Claude Code. A green badge is not implied by saving a key. Look at "last success". If there is no successful task, Relay has not completed a provider call.

## A live check failed

The error text is the provider's status and a short body. Common causes:

- the key is for a different product (ChatGPT Plus, Claude.ai, the Gemini app, Grok Bot)
- the model id is retired
- the account has no quota

Change the model field and try again. Relay does not swap in a different model silently.

## The same message was sent twice

Each send keeps an idempotency key until the server answers. If the request fails before a response, the next click reuses that key. Retry is a separate action and uses a new key, so it can call the provider again. That is intentional.

## After a restart the task says interrupted

Relay does not guess whether the provider finished. If the call had already started, retrying can duplicate the work. Read the progress line before you retry.

## Cursor returns 409

Relay sends a client agent id derived from the idempotency key. A 409 means that id already exists, so Relay loads that agent instead of creating another one.

## The Computer tab will not download

The Computer tab shows the provision log while the download runs, and again if it fails. The same text is in `data\vm\provision.log`. A second click does nothing until that run finishes. An image whose SHA256 already matches the Ubuntu checksum file is kept and not downloaded again.

On Windows, Relay uses `qemu-img.exe` from the same folder as `qemu-system-x86_64.exe`. It builds the cloud-init seed itself. It does not need `cloud-localds`. The VM monitor uses a local TCP port because Windows QEMU does not use a Unix socket. Relay still asks QEMU for WHPX and does not enable that Windows feature for you.

## The display stays black

The VM process can be running while cloud-init is still installing XFCE. Read the serial log. That text is the guest console, not a progress percentage.

## I asked Relay to call someone

If the name matches one saved contact, Relay asks you to confirm. After confirmation it tells you the call was not placed. There is no Grok Bot calling API to connect.
