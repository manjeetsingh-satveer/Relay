import { createServer } from "node:http";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checksumFor, downloadVerified } from "../src/vm/checksum.ts";
import { buildQemuArgs, chooseAccel } from "../src/vm/qemu.ts";
import { preflight } from "../src/vm/qemu.ts";

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
