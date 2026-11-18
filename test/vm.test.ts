import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checksumFor, downloadVerified } from "../src/vm/checksum.ts";
import { buildQemuArgs, chooseAccel, qemuImgCandidates } from "../src/vm/qemu.ts";
import { preflight } from "../src/vm/qemu.ts";
import { VmManager } from "../src/vm/manager.ts";
import { buildCidataIso, readCidata } from "../src/vm/seed-iso.ts";

describe("checksums", () => {
  it("reads the matching SHA256 line and rejects a mismatch", async () => {
    expect(checksumFor("abc  other\n0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef *noble.img\n", "noble.img")).toBe(
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    const server = createServer((request, response) => {
      if (request.url?.endsWith("SHA256SUMS")) {
        response.end("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  disk.img\n");
        return;
      }
      response.end("not-the-image");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const dest = path.join(await mkdtemp(path.join(tmpdir(), "relay-sum-")), "disk.img");
    await expect(
      downloadVerified({
        imageUrl: `http://127.0.0.1:${port}/disk.img`,
        checksumUrl: `http://127.0.0.1:${port}/SHA256SUMS`,
        fileName: "disk.img",
        dest,
      }),
    ).rejects.toThrow(/mismatch/);
    await expect(stat(dest)).rejects.toThrow();
    server.close();
  });
});

describe("seed iso", () => {
  it("stores cloud-init files under the cidata label", () => {
    const iso = buildCidataIso([
      { name: "user-data", data: Buffer.from("#cloud-config\nhostname: relay\n") },
      { name: "meta-data", data: Buffer.from("instance-id: relay\n") },
    ]);
    const read = readCidata(iso);
    expect(read.label).toBe("cidata");
    expect(read.files["user-data"]?.toString()).toContain("hostname: relay");
    expect(read.files["meta-data"]?.toString()).toContain("instance-id: relay");
  });
});

describe("windows qemu tools", () => {
  it("looks for qemu-img.exe beside the installed qemu-system binary", () => {
    const candidates = qemuImgCandidates("C:\\Program Files\\qemu\\qemu-system-x86_64.exe", "win32");
    expect(candidates[0]).toBe("C:\\Program Files\\qemu\\qemu-img.exe");
    expect(candidates).toContain("C:\\Program Files\\QEMU\\qemu-img.exe");
  });

  it("uses TCP for the QEMU monitor on Windows", () => {
    const args = buildQemuArgs({
      binary: "C:\\Program Files\\qemu\\qemu-system-x86_64.exe",
      accel: "whpx",
      memoryMb: 1536,
      cpus: 2,
      overlay: "C:\\Users\\Satma\\AppData\\Roaming\\Relay\\data\\vm\\overlay.qcow2",
      seedIso: "C:\\Users\\Satma\\AppData\\Roaming\\Relay\\data\\vm\\seed.iso",
      vncPort: 5901,
      qmpSocket: "tcp:127.0.0.1:46440",
      serialLog: "C:\\Users\\Satma\\AppData\\Roaming\\Relay\\data\\vm\\serial.log",
      pidFile: "C:\\Users\\Satma\\AppData\\Roaming\\Relay\\data\\vm\\qemu.pid",
    });
    expect(args).toContain("tcp:127.0.0.1:46440,server=on,wait=off");
    expect(args).toContain("whpx");
  });

  it("provisions with qemu-img.exe, reuses a verified image, and refuses a second run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "relay-win-"));
    const image = Buffer.from("ubuntu-cloud-image");
    const hash = createHash("sha256").update(image).digest("hex");
    let imageFetches = 0;
    const server = createServer((request, response) => {
      if (request.url?.endsWith("SHA256SUMS")) {
        response.end(`${hash} *disk.img\n`);
        return;
      }
      imageFetches += 1;
      response.end(image);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const calls: { file: string; args: string[] }[] = [];
    const manager = new VmManager(root);
    const imageSpec = {
      fileName: "disk.img",
      imageUrl: `http://127.0.0.1:${port}/disk.img`,
      checksumUrl: `http://127.0.0.1:${port}/SHA256SUMS`,
    };
    try {
      const record = await manager.provision({
        record: null,
        allowSoftwareEmulation: true,
        acknowledgeLowMemory: true,
        platform: "win32",
        qemuSystemPath: "C:\\Program Files\\qemu\\qemu-system-x86_64.exe",
        qemuImgPath: "C:\\Program Files\\qemu\\qemu-img.exe",
        imageSpec,
        fetchImpl: fetch,
        execFileImpl: async (file, args) => {
          calls.push({ file, args });
          await writeFile(args[7]!, "overlay");
        },
      });
      expect(calls[0]?.file).toBe("C:\\Program Files\\qemu\\qemu-img.exe");
      expect(calls[0]?.args.slice(0, 6)).toEqual(["create", "-f", "qcow2", "-F", "qcow2", "-b"]);
      const seed = readCidata(await readFile(record.seedIso));
      expect(seed.files["user-data"]?.toString()).toContain("#cloud-config");
      expect(record.qmpSocket.startsWith("tcp:127.0.0.1:")).toBe(true);
      const log = await readFile(path.join(root, "vm", "provision.log"), "utf8");
      expect(log).toMatch(/qemu-img.exe/);
      expect(log).toMatch(/cloud-localds is not used/);
      await writeFile(record.overlay, "");
      const { rm } = await import("node:fs/promises");
      await rm(record.overlay);
      await rm(record.seedIso);
      imageFetches = 0;
      await manager.provision({
        record: null,
        allowSoftwareEmulation: true,
        acknowledgeLowMemory: true,
        platform: "win32",
        qemuSystemPath: "C:\\Program Files\\qemu\\qemu-system-x86_64.exe",
        qemuImgPath: "C:\\Program Files\\qemu\\qemu-img.exe",
        fetchImpl: fetch,
        imageSpec,
        execFileImpl: async (_file, args) => {
          await writeFile(args[7]!, "overlay");
        },
      });
      expect(imageFetches).toBe(0);
      const again = await readFile(path.join(root, "vm", "provision.log"), "utf8");
      expect(again).toMatch(/Reusing disk.img/);
      await rm(path.join(root, "vm", "overlay.qcow2"));
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const third = manager.provision({
        record: null,
        allowSoftwareEmulation: true,
        acknowledgeLowMemory: true,
        platform: "win32",
        qemuSystemPath: "C:\\Program Files\\qemu\\qemu-system-x86_64.exe",
        qemuImgPath: "C:\\Program Files\\qemu\\qemu-img.exe",
        imageSpec,
        fetchImpl: fetch,
        execFileImpl: async (_file, args) => {
          await gate;
          await writeFile(args[7]!, "overlay");
        },
      });
      await expect(manager.provision({
        record: null,
        allowSoftwareEmulation: true,
        acknowledgeLowMemory: true,
        platform: "win32",
        qemuSystemPath: "C:\\Program Files\\qemu\\qemu-system-x86_64.exe",
        qemuImgPath: "C:\\Program Files\\qemu\\qemu-img.exe",
        imageSpec,
        fetchImpl: fetch,
        execFileImpl: async () => undefined,
      })).rejects.toThrow(/already running/);
      release();
      await third;
    } finally {
      server.close();
    }
  });
});

describe("qemu plan", () => {
  it("binds VNC to localhost and does not mount a host folder unless one was approved", () => {
    const args = buildQemuArgs({
      binary: "qemu-system-x86_64",
      accel: "kvm",
      memoryMb: 1536,
      cpus: 2,
      overlay: "/tmp/relay/overlay.qcow2",
      seedIso: "/tmp/relay/seed.iso",
      vncPort: 5901,
      qmpSocket: "/tmp/relay/qmp.sock",
      serialLog: "/tmp/relay/serial.log",
      pidFile: "/tmp/relay/qemu.pid",
    });
    expect(args.join(" ")).toContain("hostfwd=tcp:127.0.0.1:9222-:9222");
    expect(args).toContain("127.0.0.1:1,to=0");
    expect(args.join(" ")).not.toContain("fsdev");
    expect(() => chooseAccel({ platform: "linux", kvm: false, allowSoftwareEmulation: false })).toThrow(/not approved/);
    expect(chooseAccel({ platform: "linux", kvm: true, allowSoftwareEmulation: false })).toBe("kvm");
  });
});

describe("this machine", () => {
  it("reports the real KVM device and qemu binary without changing the host", async () => {
    const report = await preflight(process.cwd());
    const kvm = await readFile("/dev/kvm").then(() => true).catch(() => false);
    expect(report.virtualization.available).toBe(kvm);
    expect(report.qemu.found).toBe(true);
    expect(report.memory.availableBytes).toBeGreaterThan(0);
    expect(report.disk.availableBytes).toBeGreaterThan(0);
  });
});
