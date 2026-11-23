# Relay in GitHub Codespaces: a private Linux desktop with Chromium and Relay's engine.
# Debian has a regular chromium package (Ubuntu's is a snap, which can't run in containers).
FROM mcr.microsoft.com/devcontainers/base:bookworm

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      xfce4 xfce4-terminal dbus-x11 tigervnc-standalone-server tigervnc-common tigervnc-tools \
      chromium socat python3 fonts-dejavu-core fonts-noto-color-emoji libnotify-bin x11-xserver-utils \
      ca-certificates curl git \
 && apt-get purge -y light-locker xfce4-screensaver || true \
 && rm -rf /var/lib/apt/lists/*
