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
const server = await startServer({
  port,
  dataDir,
  staticDir,
  secretStore: new MemorySecretStore(),
});
console.log(`Relay is listening on http://127.0.0.1:${server.port}`);
if (server.store.data.settings) {
  console.log("Credentials in this process stay in memory and are cleared when it exits.");
}
