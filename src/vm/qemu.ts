import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants } from "node:fs/promises";
import os from "node:os";
import { statfs } from "node:fs/promises";
import type { PreflightReport } from "../shared/types.ts";

const run = promisify(execFile);

export const REQUIRED_RAM = 1536 * 1024 * 1024;
export const REQUIRED_DISK = 12 * 1024 * 1024 * 1024;

export function qemuCandidates(platform = process.platform): string[] {
  if (platform === "win32") {
    return [
      "qemu-system-x86_64.exe",
      "C:\\Program Files\\qemu\\qemu-system-x86_64.exe",
      "C:\\Program Files\\QEMU\\qemu-system-x86_64.exe",
    ];
  }
  return ["qemu-system-x86_64"];
}

export async function findQemu(platform = process.platform): Promise<string | null> {
  for (const candidate of qemuCandidates(platform)) {
    if (candidate.includes("\\") || candidate.startsWith("/")) {
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
    try {
      const locator = platform === "win32" ? "where" : "which";
      const { stdout } = await run(locator, [candidate]);
      const found = stdout.split(/\r?\n/).find(Boolean)?.trim();
      if (found) return found;
    } catch {
      continue;
    }
  }
  return null;
}

export async function preflight(dataDir: string, platform = process.platform): Promise<PreflightReport> {
  const qemuPath = await findQemu(platform);
  const virt = await virtualization(platform);
  let diskFree = 0;
  try {
    const stats = await statfs(dataDir);
    diskFree = Number(stats.bavail) * Number(stats.bsize);
  } catch {
    diskFree = 0;
  }
  const available = os.freemem();
  const notes = [
    "Memory and disk figures are what the operating system reported at check time.",
    "Relay does not change host hypervisor settings, close other apps, or delete virtual machines it did not create.",
  ];
  if (platform === "win32") {
    notes.push("On Windows, Relay asks QEMU for WHPX. It does not enable the Windows Hypervisor Platform feature for you.");
  }
  const memoryOk = available >= REQUIRED_RAM;
  const diskOk = diskFree >= REQUIRED_DISK;
  const qemuOk = Boolean(qemuPath);
  return {
    checkedAt: new Date().toISOString(),
    qemu: {
      found: qemuOk,
      path: qemuPath ?? undefined,
      detail: qemuOk ? `Found ${qemuPath}.` : "qemu-system-x86_64 is not installed. Relay does not download QEMU.",
    },
    virtualization: virt,
    memory: { availableBytes: available, totalBytes: os.totalmem(), requiredBytes: REQUIRED_RAM, ok: memoryOk },
    disk: { path: dataDir, availableBytes: diskFree, requiredBytes: REQUIRED_DISK, ok: diskOk },
    ok: qemuOk && memoryOk && diskOk && (virt.available || platform === "win32"),
    notes,
  };
}

async function virtualization(platform: string): Promise<{ available: boolean; detail: string }> {
  if (platform === "win32") {
    return { available: false, detail: "KVM is a Linux device. Windows builds request WHPX and report QEMU's own error if it is missing." };
  }
  try {
    await access("/dev/kvm", constants.R_OK | constants.W_OK);
    return { available: true, detail: "/dev/kvm is present and this user can open it." };
  } catch {
    try {
      await access("/dev/kvm", constants.F_OK);
      return {
        available: false,
        detail: "/dev/kvm exists, but this user cannot open it. Relay will not change groups or host permissions. Software emulation stays off unless you approve it.",
      };
    } catch {
      return { available: false, detail: "/dev/kvm is not present. Software emulation stays off unless you approve it." };
    }
  }
}

export interface QemuPlan {
  binary: string;
  accel: "kvm" | "whpx" | "tcg";
  memoryMb: number;
  cpus: number;
  overlay: string;
  seedIso: string;
  vncPort: number;
  qmpSocket: string;
  serialLog: string;
  pidFile: string;
  share?: { path: string; writable: boolean };
}

export function buildQemuArgs(plan: QemuPlan): string[] {
  const display = plan.vncPort - 5900;
  if (display < 0 || display > 99) throw new Error("VNC port must be between 5900 and 5999.");
  const cpu = plan.accel === "kvm" ? "host" : "qemu64";
  const args = [
    "-machine", "q35",
    "-accel", plan.accel,
    "-cpu", cpu,
    "-m", String(plan.memoryMb),
    "-smp", String(plan.cpus),
    "-name", "relay",
    "-nodefaults",
    "-vga", "std",
    "-drive", `if=virtio,format=qcow2,file=${plan.overlay}`,
    "-drive", `if=virtio,format=raw,file=${plan.seedIso},media=cdrom,read-only=on`,
    "-netdev", "user,id=n0,hostfwd=tcp:127.0.0.1:9222-:9222,hostfwd=tcp:127.0.0.1:43125-:43125",
    "-device", "virtio-net-pci,netdev=n0",
    "-vnc", `127.0.0.1:${display},to=0`,
    "-qmp", `unix:${plan.qmpSocket},server,nowait`,
    "-serial", `file:${plan.serialLog}`,
    "-pidfile", plan.pidFile,
  ];
  if (plan.share) {
    assertSharePath(plan.share.path);
    args.push(
      "-fsdev",
      `local,id=share,path=${plan.share.path},security_model=mapped,readonly=${plan.share.writable ? "off" : "on"}`,
      "-device",
      "virtio-9p-pci,fsdev=share,mount_tag=hostshare",
    );
  }
  return args;
}

export function assertSharePath(value: string): void {
  if (!value || value.includes(",") || value.includes("\n") || value.includes('"')) {
    throw new Error("The shared folder path cannot contain a comma, quote, or newline.");
  }
}

export function chooseAccel(input: {
  platform?: string;
  kvm: boolean;
  allowSoftwareEmulation: boolean;
}): "kvm" | "whpx" | "tcg" {
  const platform = input.platform ?? process.platform;
  if (platform === "win32") return "whpx";
  if (input.kvm) return "kvm";
  if (input.allowSoftwareEmulation) return "tcg";
  throw new Error("Hardware virtualization is not available, and software emulation was not approved.");
}
