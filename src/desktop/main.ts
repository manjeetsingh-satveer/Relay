import { app, BrowserWindow, Menu, safeStorage, session, shell } from "electron";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { FileEncryptedSecretStore } from "../core/secrets.ts";
import { startServer } from "../server/app.ts";
import { GITHUB_TOKEN_KEY } from "../server/github-cloud.ts";
import { GITHUB_CLIENT_ID } from "../cloud/config.ts";
import { beginProvision } from "../vm/provision-lock.ts";

const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();

app.whenReady().then(async () => {
  const userData = app.getPath("userData");
  const secrets = new FileEncryptedSecretStore(path.join(userData, "secrets.bin"), safeStorage, {
    readFile: (file) => readFile(file),
    writeFile: async (file, data) => {
      await writeFile(file, data, { mode: 0o600 });
    },
    mkdir: async (dir) => {
      await mkdir(dir, { recursive: true });
    },
  });
  const staticDir = path.join(__dirname, "ui");
  const server = await startServer({
    port: 0,
    host: "127.0.0.1",
    dataDir: path.join(userData, "data"),
    secretStore: secrets,
    staticDir,
    version: app.getVersion(),
    beginProvision,
    githubClientId: GITHUB_CLIENT_ID,
  });
  const local = `http://127.0.0.1:${server.port}/`;

  // The user's Codespace link is private to their GitHub account. GitHub accepts the user's
  // token in X-Github-Token for private ports, so send it there, and only there.
  let githubToken: string | null = await secrets.get(GITHUB_TOKEN_KEY);
  setInterval(() => {
    void secrets.get(GITHUB_TOKEN_KEY).then((token) => {
      githubToken = token;
    });
  }, 3000);
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://*.app.github.dev/*", "wss://*.app.github.dev/*"] },
    (details, callback) => {
      const host = new URL(details.url).hostname;
      if (githubToken && host.endsWith(".app.github.dev")) details.requestHeaders["X-Github-Token"] = githubToken;
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 560,
    title: "Relay",
    backgroundColor: "#12110e",
  });
  // Links like GitHub's sign-in page open in the user's normal browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  const openCloud = () => window.loadURL(`${local}#cloud`);
  const openThisPc = () => {
    // Boot the local VM in the background and land on the Computer tab (no-op if none / running).
    void fetch(`${local}api/vm/start`, { method: "POST" }).catch(() => undefined);
    return window.loadURL(`${local}#computer`);
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Relay",
        submenu: [
          { label: "Cloud desktop (GitHub)", click: () => void openCloud() },
          { label: "This PC (local VM)", click: () => void openThisPc() },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );

  // Signed in with GitHub before: go straight to the cloud desktop and leave the local VM off (saves RAM).
  if (githubToken && GITHUB_CLIENT_ID) await openCloud();
  else await openThisPc();
  window.on("closed", () => undefined);
});

app.on("window-all-closed", () => {
  app.quit();
});
