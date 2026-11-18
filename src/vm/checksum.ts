import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { stat, rename, unlink } from "node:fs/promises";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

export async function sha256File(file: string): Promise<string> {
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

export function checksumFor(sums: string, fileName: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(\S+)\s*$/);
    if (match && match[2] === fileName) return match[1]!.toLowerCase();
  }
  return null;
}

export async function downloadVerified(input: {
  imageUrl: string;
  checksumUrl: string;
  fileName: string;
  dest: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<{ sha256: string; bytes: number; note: string; reused: boolean }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const noteProgress = input.onProgress ?? (() => undefined);
  const checksumResponse = await fetchImpl(input.checksumUrl, { signal: input.signal });
  if (!checksumResponse.ok) {
    throw new Error(`Could not download checksum file (${checksumResponse.status}). The image was not saved.`);
  }
  const expected = checksumFor(await checksumResponse.text(), input.fileName);
  if (!expected) throw new Error(`Checksum file has no line for ${input.fileName}. The image was not saved.`);
  try {
    const existing = await sha256File(input.dest);
    const info = await stat(input.dest);
    if (existing === expected) {
      noteProgress(`Reusing ${input.fileName} (${info.size} bytes). SHA256 already matches the checksum file.`);
      return {
        sha256: existing,
        bytes: info.size,
        reused: true,
        note: `Reused the image already on disk. SHA256 matches the checksum file from ${input.checksumUrl}. The GPG signature of that checksum file was not checked.`,
      };
    }
    noteProgress(`The existing ${input.fileName} does not match the checksum file. Downloading it again.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  noteProgress(`Downloading ${input.fileName}.`);
  const imageResponse = await fetchImpl(input.imageUrl, { signal: input.signal });
  if (!imageResponse.ok || !imageResponse.body) {
    throw new Error(`Could not download the image (${imageResponse.status}). Nothing was kept.`);
  }
  const partial = input.dest + ".partial";
  const hash = createHash("sha256");
  let bytes = 0;
  let reported = 0;
  const hasher = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      if (bytes - reported >= 8 * 1024 * 1024) {
        reported = bytes;
        noteProgress(`Downloaded ${bytes} bytes of ${input.fileName}.`);
      }
      callback(null, chunk);
    },
  });
  const body = Readable.fromWeb(imageResponse.body as import("node:stream/web").ReadableStream);
  await pipeline(body, hasher, createWriteStream(partial, { mode: 0o644 }));
  const actual = hash.digest("hex");
  if (actual !== expected) {
    await unlink(partial).catch(() => undefined);
    throw new Error(`SHA256 mismatch for ${input.fileName}. Expected ${expected}, got ${actual}. The partial file was deleted.`);
  }
  await unlink(input.dest).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await rename(partial, input.dest);
  const info = await stat(input.dest);
  noteProgress(`Saved ${input.fileName} (${info.size} bytes). SHA256 matches.`);
  return {
    sha256: actual,
    bytes: info.size || bytes,
    reused: false,
    note: `SHA256 matches the checksum file downloaded from ${input.checksumUrl}. The GPG signature of that checksum file was not checked.`,
  };
}

export function ubuntuImageSpec(): { fileName: string; imageUrl: string; checksumUrl: string } {
  const fileName = "noble-server-cloudimg-amd64.img";
  const base = "https://cloud-images.ubuntu.com/noble/current";
  return {
    fileName,
    imageUrl: `${base}/${fileName}`,
    checksumUrl: `${base}/SHA256SUMS`,
  };
}

export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
