import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";
import { appendFile, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VmRecord } from "../shared/types.ts";
import { RelayError } from "../core/errors.ts";
import { downloadVerified, isInside, ubuntuImageSpec } from "./checksum.ts";
import { buildQemuArgs, chooseAccel, findQemu, findQemuImg, preflight, type QemuPlan } from "./qemu.ts";
import { buildCidataIso } from "./seed-iso.ts";
import { beginProvision, provisionInProgress } from "./provision-lock.ts";

const run = promisify(execFile);

export type ExecFileImpl = (file: string, args: string[]) => Promise<void>;

export class VmManager {
  constructor(private readonly root: string) {}

  isProvisioning(): boolean {
    return provisionInProgress();
  }

  directory(): string {
    return path.join(this.root, "vm");
  }

  async provision(input: {
    record: VmRecord | null;
    allowSoftwareEmulation: boolean;
    acknowledgeLowMemory: boolean;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    platform?: NodeJS.Platform;
    qemuSystemPath?: string;
    qemuImgPath?: string;
    execFileImpl?: ExecFileImpl;
    onProgress?: (message: string) => void;
    imageSpec?: { fileName: string; imageUrl: string; checksumUrl: string };
    holdsLock?: boolean;
  }): Promise<VmRecord> {
    const release = input.holdsLock ? null : beginProvision();
    const dir = this.directory();
    const log = (message: string) => this.note(dir, message, input.onProgress);
    try {
      if (input.record) {
        throw new RelayError("vm_exists", "A Relay VM already exists in this data directory. It was not replaced.");
      }
      await log("Checking QEMU, memory, and disk.");
      const platform = input.platform ?? process.platform;
      const report = await preflight(this.root, platform);
      if (!input.qemuSystemPath && (!report.qemu.found || !report.qemu.path)) {
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
      const qemuSystem = input.qemuSystemPath ?? report.qemu.path ?? "";
      const accel = chooseAccel({ platform, kvm: report.virtualization.available, allowSoftwareEmulation: input.allowSoftwareEmulation });
      await mkdir(dir, { recursive: true });
      const spec = input.imageSpec ?? ubuntuImageSpec();
      const baseImage = path.join(dir, spec.fileName);
      const verified = await downloadVerified({
        imageUrl: spec.imageUrl,
        checksumUrl: spec.checksumUrl,
        fileName: spec.fileName,
        dest: baseImage,
        fetchImpl: input.fetchImpl,
        signal: input.signal,
        onProgress: (message) => void log(message),
      });
      const overlay = path.join(dir, "overlay.qcow2");
      try {
        await stat(overlay);
        throw new RelayError("vm_exists", "overlay.qcow2 already exists. It was not overwritten.");
      } catch (error) {
        if (error instanceof RelayError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const qemuImg = input.qemuImgPath ?? (await findQemuImg(qemuSystem, platform));
      if (!qemuImg) {
        throw new RelayError(
          "qemu_img_missing",
          `qemu-img was not found next to ${qemuSystem}. QEMU for Windows includes qemu-img.exe in the same folder. The downloaded image was kept. No overlay was created.`,
        );
      }
      await log(`Creating the overlay disk with ${qemuImg}.`);
      const exec = input.execFileImpl ?? (async (file: string, args: string[]) => {
        await run(file, args);
      });
      await exec(qemuImg, ["create", "-f", "qcow2", "-F", "qcow2", "-b", baseImage, overlay, "32G"]);
      await log("Writing the cloud-init seed with Relay's ISO builder. cloud-localds is not used.");
      const password = randomBytes(12).toString("base64url");
      const assets = await loadGuestAssets();
      const userData = cloudInit(password, assets.helper, assets.chrome);
      const metaData = "instance-id: relay\nlocal-hostname: relay\n";
      await writeFile(path.join(dir, "user-data"), userData);
      await writeFile(path.join(dir, "meta-data"), metaData);
      const seedIso = path.join(dir, "seed.iso");
      await writeFile(seedIso, buildCidataIso([
        { name: "user-data", data: Buffer.from(userData, "utf8") },
        { name: "meta-data", data: Buffer.from(metaData, "utf8") },
      ]));
      const qmpSocket = platform === "win32" ? `tcp:127.0.0.1:${await freeTcpPort()}` : path.join(dir, "qmp.sock");
      const now = new Date().toISOString();
      await log(`Provision finished. Image SHA256 ${verified.sha256}.`);
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
        qmpSocket,
        serialLog: path.join(dir, "serial.log"),
        stderrLog: path.join(dir, "qemu.log"),
        pidFile: path.join(dir, "qemu.pid"),
        log: [{ at: now, message: `${verified.reused ? "Reused" : "Downloaded"} ${spec.fileName}. ${verified.note}` }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provision failed.";
      await log(`ERROR ${message}`);
      if (error instanceof RelayError) throw error;
      throw new RelayError("provision", message);
    } finally {
      release?.();
    }
  }

  private async note(dir: string, message: string, onProgress?: (message: string) => void): Promise<void> {
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "provision.log"), `${new Date().toISOString()} ${message}\n`);
    onProgress?.(message);
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
    const child = spawn(binary, args, { detached: true, windowsHide: true, stdio: ["ignore", log.fd, log.fd] });
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

export function guestAssetRoots(): string[] {
  const roots = [process.cwd()];
  if (process.argv[1]) roots.push(path.resolve(path.dirname(process.argv[1]), ".."));
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resources) {
    roots.push(path.join(resources, "app.asar"));
    roots.push(path.join(resources, "app"));
    roots.push(resources);
  }
  return roots;
}

export async function loadGuestAssets(roots = guestAssetRoots()): Promise<{ helper: string; chrome: string }> {
  for (const root of roots) {
    try {
      return {
        helper: await readFile(path.join(root, "guest/relay-helper.py"), "utf8"),
        chrome: await readFile(path.join(root, "guest/relay-chrome.sh"), "utf8"),
      };
    } catch {
      continue;
    }
  }
  throw new RelayError("guest-files", "Could not read guest/relay-helper.py. The VM was not provisioned.");
}

export function cloudInit(password: string, helper: string, chrome: string): string {
  const helperB64 = Buffer.from(helper, "utf8").toString("base64");
  const chromeB64 = Buffer.from(chrome, "utf8").toString("base64");
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
  - python3
write_files:
  - path: /home/relay/.xinitrc
    owner: relay:relay
    permissions: "0755"
    content: |
      exec startxfce4
  - path: /opt/relay/relay-helper.b64
    content: ${helperB64}
    permissions: "0644"
  - path: /opt/relay/relay-chrome.b64
    content: ${chromeB64}
    permissions: "0644"
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
  - path: /etc/systemd/system/relay-helper.service
    content: |
      [Unit]
      Description=Relay guest CLI helper
      After=network.target
      [Service]
      ExecStart=/usr/bin/python3 /opt/relay/relay-helper.py
      Restart=on-failure
      [Install]
      WantedBy=multi-user.target
  - path: /home/relay/.config/autostart/relay-chrome.desktop
    owner: relay:relay
    content: |
      [Desktop Entry]
      Type=Application
      Name=Relay Chrome
      Exec=/usr/local/bin/relay-chrome
runcmd:
  - mkdir -p /opt/relay /usr/local/bin /home/relay/.config/relay-chrome
  - base64 -d /opt/relay/relay-helper.b64 > /opt/relay/relay-helper.py
  - base64 -d /opt/relay/relay-chrome.b64 > /usr/local/bin/relay-chrome
  - chmod 755 /opt/relay/relay-helper.py /usr/local/bin/relay-chrome
  - chown -R relay:relay /home/relay/.config
  - apt-get install -y chromium || apt-get install -y chromium-browser || true
  - systemctl daemon-reload
  - systemctl enable relay-desktop.service relay-helper.service
  - systemctl start relay-desktop.service || true
  - systemctl start relay-helper.service || true
`;
}

async function freeTcpPort(): Promise<number> {
  for (let port = 46440; port < 46450; port += 1) {
    if (await portFree(port)) return port;
  }
  throw new RelayError("qmp_busy", "No free local port for the QEMU monitor.");
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
    const socket = socketPath.startsWith("tcp:")
      ? net.createConnection({ host: socketPath.slice(4).split(":")[0], port: Number(socketPath.slice(4).split(":")[1]) })
      : net.createConnection(socketPath);
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
