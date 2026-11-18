import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VmRecord } from "../shared/types.ts";
import { RelayError } from "../core/errors.ts";
import { downloadVerified, isInside, ubuntuImageSpec } from "./checksum.ts";
import { buildQemuArgs, chooseAccel, findQemu, preflight, type QemuPlan } from "./qemu.ts";

const run = promisify(execFile);

export class VmManager {
  constructor(private readonly root: string) {}

  directory(): string {
    return path.join(this.root, "vm");
  }

  async provision(input: {
    record: VmRecord | null;
    allowSoftwareEmulation: boolean;
    acknowledgeLowMemory: boolean;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  }): Promise<VmRecord> {
    if (input.record) {
      throw new RelayError("vm_exists", "A Relay VM already exists in this data directory. It was not replaced.");
    }
    const report = await preflight(this.root);
    if (!report.qemu.found || !report.qemu.path) {
      throw new RelayError("qemu_missing", report.qemu.detail);
    }
    if (!report.memory.ok && !input.acknowledgeLowMemory) {
      throw new RelayError(
        "low_memory",
        `The OS reports ${report.memory.availableBytes} bytes available. Relay asks for ${report.memory.requiredBytes}. Approve low memory to continue. Host settings were not changed.`,
      );
    }
    if (!report.disk.ok) {
      throw new RelayError(
        "low_disk",
        `The OS reports ${report.disk.availableBytes} bytes free. Relay asks for ${report.disk.requiredBytes}. Nothing was downloaded.`,
      );
    }
    const accel = chooseAccel({ kvm: report.virtualization.available, allowSoftwareEmulation: input.allowSoftwareEmulation });
    const dir = this.directory();
    await mkdir(dir, { recursive: true });
    const spec = ubuntuImageSpec();
    const baseImage = path.join(dir, spec.fileName);
    const verified = await downloadVerified({
      imageUrl: spec.imageUrl,
      checksumUrl: spec.checksumUrl,
      fileName: spec.fileName,
      dest: baseImage,
      fetchImpl: input.fetchImpl,
      signal: input.signal,
    });
    const overlay = path.join(dir, "overlay.qcow2");
    try {
      await stat(overlay);
      throw new RelayError("vm_exists", "overlay.qcow2 already exists. It was not overwritten.");
    } catch (error) {
      if (error instanceof RelayError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await run("qemu-img", ["create", "-f", "qcow2", "-F", "qcow2", "-b", baseImage, overlay, "32G"]);
    const password = randomBytes(12).toString("base64url");
    const userData = cloudInit(password);
    const metaData = "instance-id: relay\nlocal-hostname: relay\n";
    await writeFile(path.join(dir, "user-data"), userData, { mode: 0o600 });
    await writeFile(path.join(dir, "meta-data"), metaData);
    const seedIso = path.join(dir, "seed.iso");
    await run("cloud-localds", [seedIso, path.join(dir, "user-data"), path.join(dir, "meta-data")]);
    const now = new Date().toISOString();
    return {
      directory: dir,
      baseImage,
      overlay,
      seedIso,
      sha256: verified.sha256,
      checksumNote: verified.note,
      guestUser: "relay",
      guestPassword: password,
      createdAt: now,
      memoryMb: 1536,
      cpus: 2,
      accel,
      qmpSocket: path.join(dir, "qmp.sock"),
      serialLog: path.join(dir, "serial.log"),
      stderrLog: path.join(dir, "qemu.log"),
      pidFile: path.join(dir, "qemu.pid"),
      log: [{ at: now, message: `Downloaded ${spec.fileName}. ${verified.note}` }],
    };
  }

  async start(record: VmRecord): Promise<VmRecord> {
    if (await this.isAlive(record)) {
      throw new RelayError("vm_running", "The Relay VM process is already running. A second one was not started.");
    }
    const binary = await findQemu();
    if (!binary) throw new RelayError("qemu_missing", "qemu-system-x86_64 is not installed.");
    const vncPort = await freeVncPort();
    const plan: QemuPlan = {
      binary,
      accel: record.accel,
      memoryMb: record.memoryMb,
      cpus: record.cpus,
      overlay: record.overlay,
      seedIso: record.seedIso,
      vncPort,
      qmpSocket: record.qmpSocket,
      serialLog: record.serialLog,
      pidFile: record.pidFile,
      share: record.share,
    };
    const args = buildQemuArgs(plan);
    const log = await open(record.stderrLog, "a");
    const child = spawn(binary, args, { detached: true, stdio: ["ignore", log.fd, log.fd] });
    child.unref();
    log.close();
    if (!child.pid) throw new RelayError("qemu_failed", "QEMU did not return a process id. See the QEMU log.");
    const started = new Date().toISOString();
    return {
      ...record,
      pid: child.pid,
      vncPort,
      log: [...record.log, { at: started, message: `Started QEMU pid ${child.pid} with -accel ${record.accel}. VNC is on 127.0.0.1:${vncPort}.` }],
    };
  }

  async shutdown(record: VmRecord): Promise<string> {
    await qmp(record.qmpSocket, "system_powerdown");
    return "QEMU accepted system_powerdown. Relay will not claim the guest is off until the process exits.";
  }

  async pause(record: VmRecord): Promise<string> {
    await qmp(record.qmpSocket, "stop");
    return "QEMU accepted stop. The guest is paused.";
  }

  async resumeCpu(record: VmRecord): Promise<string> {
    await qmp(record.qmpSocket, "cont");
    return "QEMU accepted cont.";
  }

  async forceStop(record: VmRecord): Promise<string> {
    if (!record.pid || !(await this.isAlive(record))) return "No Relay VM process was running.";
    process.kill(record.pid, "SIGTERM");
    return `Sent SIGTERM to pid ${record.pid}.`;
  }

  async remove(record: VmRecord, confirmation: string): Promise<void> {
    if (confirmation !== "delete this vm") {
      throw new RelayError("confirm_required", "Type delete this vm to remove the Relay VM directory.");
    }
    if (await this.isAlive(record)) {
      throw new RelayError("vm_running", "Stop the VM before deleting it.");
    }
    if (!isInside(this.root, record.directory)) {
      throw new RelayError("refused", "Refusing to delete a directory outside Relay's data folder.");
    }
    await rm(record.directory, { recursive: true, force: true });
  }

  async isAlive(record: VmRecord): Promise<boolean> {
    if (!record.pid) return false;
    try {
      process.kill(record.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async serialTail(record: VmRecord, max = 12000): Promise<string> {
    try {
      const text = await readFile(record.serialLog, "utf8");
      return text.slice(-max);
    } catch {
      return "";
    }
  }
}

export function cloudInit(password: string): string {
  return `#cloud-config
hostname: relay
users:
  - name: relay
    gecos: Relay
    groups: [sudo]
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
chpasswd:
  expire: false
  list: |
    relay:${password}
ssh_pwauth: false
package_update: true
packages:
  - xfce4
  - xfce4-terminal
  - xorg
  - xinit
  - dbus-x11
  - fonts-dejavu-core
write_files:
  - path: /home/relay/.xinitrc
    owner: relay:relay
    permissions: "0755"
    content: |
      exec startxfce4
  - path: /etc/systemd/system/relay-desktop.service
    content: |
      [Unit]
      Description=Relay guest desktop
      After=multi-user.target
      [Service]
      User=relay
      WorkingDirectory=/home/relay
      ExecStart=/usr/bin/startx -- :0 vt1
      Restart=on-failure
      RestartSec=5
      [Install]
      WantedBy=multi-user.target
runcmd:
  - systemctl daemon-reload
  - systemctl enable relay-desktop.service
  - systemctl start relay-desktop.service || true
`;
}

async function freeVncPort(): Promise<number> {
  for (let port = 5901; port < 5910; port += 1) {
    if (await portFree(port)) return port;
  }
  throw new RelayError("vnc_busy", "No free VNC port on 127.0.0.1 between 5901 and 5909.");
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

export function qmp(socketPath: string, execute: string, args?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    const pending: Record<string, unknown>[] = [{ execute: "qmp_capabilities" }, { execute, arguments: args }];
    socket.setTimeout(8000);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new RelayError("qmp_timeout", `QMP ${execute} timed out.`));
    });
    socket.on("error", (error) => reject(new RelayError("qmp", error.message)));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as { QMP?: unknown; return?: unknown; error?: { desc?: string } };
        if (message.QMP) {
          const next = pending.shift();
          if (next) socket.write(JSON.stringify(next) + "\n");
          continue;
        }
        if (message.error) {
          socket.end();
          reject(new RelayError("qmp", message.error.desc || "QMP error"));
          return;
        }
        if ("return" in message) {
          const next = pending.shift();
          if (next) socket.write(JSON.stringify(next) + "\n");
          else {
            socket.end();
            resolve(message.return);
          }
        }
      }
    });
  });
}
