import { app, BrowserWindow, safeStorage } from "electron";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { FileEncryptedSecretStore } from "../core/secrets.ts";
import { startServer } from "../server/app.ts";
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
  });
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 560,
    title: "Relay",
    backgroundColor: "#12110e",
  });
  // Open straight into the Linux desktop: boot the provisioned VM in the background
  // and land on the Computer tab. If no VM exists yet, or it is already running, this is a no-op.
  void fetch(`http://127.0.0.1:${server.port}/api/vm/start`, { method: "POST" }).catch(() => undefined);
  await window.loadURL(`http://127.0.0.1:${server.port}/#computer`);
  window.on("closed", () => undefined);
});

app.on("window-all-closed", () => {
  app.quit();
});
