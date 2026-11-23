import { MemorySecretStore } from "../core/secrets.ts";
import { startServer } from "./app.ts";

const args = process.argv.slice(2);

function flag(name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1]! : fallback;
}

const port = Number(flag("--port", "43124"));
const dataDir = flag("--data", "./data");
const staticDir = args.includes("--static") ? flag("--static", "dist/ui") : undefined;
const host = flag("--host", "127.0.0.1");
const cloud = args.includes("--cloud");
const server = await startServer({
  host,
  port,
  dataDir,
  staticDir,
  secretStore: new MemorySecretStore(),
  cloudDesktop: cloud ? { vncPort: Number(flag("--vnc-port", "5901")) } : undefined,
});
if (cloud) console.log("Cloud mode: showing this server's desktop. No local VM is started.");
if (server.setupToken) {
  console.log(`First-time setup code: ${server.setupToken} (also saved in ${dataDir}/setup-token.txt)`);
}
console.log(`Relay is listening on http://127.0.0.1:${server.port}`);
if (server.store.data.settings) {
  console.log("Credentials in this process stay in memory and are cleared when it exits.");
}
