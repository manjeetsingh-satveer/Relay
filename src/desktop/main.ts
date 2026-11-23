import { app, BrowserWindow, Menu, Notification, safeStorage, session, shell } from "electron";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { FileEncryptedSecretStore } from "../core/secrets.ts";
import { startServer } from "../server/app.ts";
import { GITHUB_TOKEN_KEY } from "../server/github-cloud.ts";
import { GITHUB_CLIENT_ID } from "../cloud/config.ts";
import { GitHubCodespaces } from "../cloud/github.ts";
import { beginProvision } from "../vm/provision-lock.ts";

// Quiet run at Windows sign-in: keep the user's Codespace from being deleted, then exit. No window.
const KEEPALIVE = process.argv.includes("--keepalive");

// Windows shows notifications under this ID (matches electron-builder's appId).
app.setAppUserModelId("app.relay.desktop");

const locked = KEEPALIVE || app.requestSingleInstanceLock();
if (!locked) app.quit();

interface Prefs {
  keepAlive: boolean;
}
const prefsFile = () => path.join(app.getPath("userData"), "relay-prefs.json");
async function readPrefs(): Promise<Prefs> {
  try {
    return { keepAlive: true, ...(JSON.parse(await readFile(prefsFile(), "utf8")) as Partial<Prefs>) };
  } catch {
    return { keepAlive: true };
  }
}
async function writePrefs(prefs: Prefs): Promise<void> {
  await writeFile(prefsFile(), JSON.stringify(prefs, null, 2));
}
/** Registers (or removes) the quiet keep-alive launch at Windows sign-in. */
function applyLoginItem(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled, args: ["--keepalive"] });
}

let notified = false;
function notify(title: string, body: string): void {
  notified = true;
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

const DAY = 24 * 60 * 60 * 1000;
const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / DAY));

function openSecrets() {
  const userData = app.getPath("userData");
  return new FileEncryptedSecretStore(path.join(userData, "secrets.bin"), safeStorage, {
    readFile: (file) => readFile(file),
    writeFile: async (file, data) => {
      await writeFile(file, data, { mode: 0o600 });
    },
    mkdir: async (dir) => {
      await mkdir(dir, { recursive: true });
    },
  });
}

if (KEEPALIVE) {
  app.whenReady().then(async () => {
    try {
      const token = await openSecrets().get(GITHUB_TOKEN_KEY);
      if (token && (await readPrefs()).keepAlive) {
        const result = await new GitHubCodespaces(token).keepAlive();
        await writeFile(path.join(app.getPath("userData"), "keepalive.log"), `${new Date().toISOString()} ${JSON.stringify(result)}\n`, { flag: "a" });
        if (result.action === "renewed") {
          notify("Relay kept your cloud desktop", "GitHub was about to delete your unused Codespace. Relay woke it briefly, so your chats and sign-ins are safe for another 30 days.");
        }
      }
    } catch (error) {
      if (error instanceof Error && /sign-in expired|signed out/i.test(error.message)) {
        notify("Relay can't protect your cloud desktop", "Your GitHub sign-in expired. Open Relay and choose Continue with GitHub, or GitHub may delete your unused Codespace.");
      } else {
        notify("Relay couldn't check your cloud desktop", "Open Relay once in the next few days so GitHub doesn't delete your unused Codespace.");
      }
      await writeFile(path.join(app.getPath("userData"), "keepalive.log"), `${new Date().toISOString()} error ${error instanceof Error ? error.message : error}\n`, { flag: "a" }).catch(() => undefined);
    } finally {
      // Give Windows a moment to show any notification before this quiet run exits.
      setTimeout(() => app.quit(), notified ? 6000 : 0);
    }
  });
}

if (!KEEPALIVE) app.whenReady().then(async () => {
  const userData = app.getPath("userData");
  const secrets = openSecrets();
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

  const prefs = await readPrefs();
  // While signed in with GitHub, check at each Windows sign-in that the Codespace won't be deleted.
  applyLoginItem(prefs.keepAlive && Boolean(githubToken && GITHUB_CLIENT_ID));
  setInterval(() => applyLoginItem(prefs.keepAlive && Boolean(githubToken && GITHUB_CLIENT_ID)), 60_000);
  if (githubToken && !prefs.keepAlive) {
    void new GitHubCodespaces(githubToken)
      .expiry()
      .then((info) => {
        if (info?.expiresAt && Date.parse(info.expiresAt) - Date.now() < 7 * DAY) {
          const days = daysLeft(info.expiresAt);
          notify(
            `Your cloud desktop will be deleted in ${days} day${days === 1 ? "" : "s"}`,
            "GitHub deletes unused Codespaces. Open your cloud desktop (Relay → Cloud desktop) or turn on Relay → Keep cloud desktop from expiring.",
          );
        }
      })
      .catch(() => undefined);
  }
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
          {
            label: "Keep cloud desktop from expiring",
            type: "checkbox",
            checked: prefs.keepAlive,
            click: (item) => {
              prefs.keepAlive = item.checked;
              void writePrefs(prefs);
              applyLoginItem(prefs.keepAlive && Boolean(githubToken));
            },
          },
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
