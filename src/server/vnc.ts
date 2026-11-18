import { WebSocketServer, type WebSocket } from "ws";
import net from "node:net";
import type { Server } from "node:http";
import type { VmRecord } from "../shared/types.ts";

export function attachVncProxy(
  server: Server,
  current: () => Promise<{ record: VmRecord | null; running: boolean }>,
): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", async (request, socket, head) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/vm/vnc") {
        socket.destroy();
        return;
      }
      const { record, running } = await current();
      if (!record?.vncPort || !running) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => bridge(ws, record.vncPort!));
    } catch {
      socket.destroy();
    }
  });
}

function bridge(ws: WebSocket, port: number): void {
  const tcp = net.connect(port, "127.0.0.1");
  tcp.on("data", (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk);
  });
  ws.on("message", (data) => {
    tcp.write(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
  });
  const close = () => {
    tcp.destroy();
    if (ws.readyState === ws.OPEN) ws.close();
  };
  tcp.on("error", close);
  tcp.on("close", close);
  ws.on("close", () => tcp.destroy());
  ws.on("error", () => tcp.destroy());
}
