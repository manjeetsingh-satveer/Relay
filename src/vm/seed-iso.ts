const SECTOR = 2048;

export interface SeedFile {
  name: string;
  data: Buffer;
}

/** ISO 9660 image with a Joliet tree so cloud-init sees `user-data` and `meta-data` on a volume labeled cidata. */
export function buildCidataIso(files: SeedFile[]): Buffer {
  if (files.length === 0) throw new Error("The seed ISO needs at least one file.");
  const layout = {
    pvd: 16,
    svd: 17,
    term: 18,
    pathL: 19,
    pathM: 20,
    jolietPathL: 21,
    jolietPathM: 22,
    primaryRoot: 23,
    jolietRoot: 24,
    fileStart: 25,
  };
  let cursor = layout.fileStart;
  const extents: number[] = [];
  for (const file of files) {
    extents.push(cursor);
    cursor += Math.max(1, Math.ceil(file.data.length / SECTOR));
  }
  const volumeSectors = cursor;
  const image = Buffer.alloc(volumeSectors * SECTOR);

  const primaryRoot = directorySector(files, extents, layout.primaryRoot, false);
  const jolietRoot = directorySector(files, extents, layout.jolietRoot, true);
  writeSector(image, layout.primaryRoot, primaryRoot);
  writeSector(image, layout.jolietRoot, jolietRoot);
  writeSector(image, layout.pathL, pathTable(layout.primaryRoot, false));
  writeSector(image, layout.pathM, pathTable(layout.primaryRoot, true));
  writeSector(image, layout.jolietPathL, pathTable(layout.jolietRoot, false));
  writeSector(image, layout.jolietPathM, pathTable(layout.jolietRoot, true));
  files.forEach((file, index) => {
    file.data.copy(image, extents[index]! * SECTOR);
  });

  writeSector(image, layout.pvd, volumeDescriptor({
    type: 1,
    volumeId: ascii("cidata", 32),
    volumeSectors,
    blockSize: SECTOR,
    pathTableSize: pathTable(layout.primaryRoot, false).length,
    pathL: layout.pathL,
    pathM: layout.pathM,
    root: directoryRecord(Buffer.from([0x00]), layout.primaryRoot, primaryRoot.length, 2),
    escape: Buffer.alloc(32),
  }));
  const escape = Buffer.alloc(32);
  escape.write("%/E", 0, "ascii");
  writeSector(image, layout.svd, volumeDescriptor({
    type: 2,
    volumeId: utf16("cidata", 32),
    volumeSectors,
    blockSize: SECTOR,
    pathTableSize: pathTable(layout.jolietRoot, false).length,
    pathL: layout.jolietPathL,
    pathM: layout.jolietPathM,
    root: directoryRecord(Buffer.from([0x00]), layout.jolietRoot, jolietRoot.length, 2),
    escape,
    unicodeIds: true,
  }));
  const term = Buffer.alloc(SECTOR);
  term[0] = 255;
  term.write("CD001", 1, "ascii");
  term[6] = 1;
  writeSector(image, layout.term, term);
  return image;
}

export function readCidata(iso: Buffer): { label: string; files: Record<string, Buffer> } {
  const pvd = iso.subarray(16 * SECTOR, 17 * SECTOR);
  if (pvd.toString("ascii", 1, 6) !== "CD001") throw new Error("Not an ISO 9660 image.");
  const label = pvd.toString("ascii", 40, 72).replace(/ +$/, "");
  const svd = iso.subarray(17 * SECTOR, 18 * SECTOR);
  if (svd[0] !== 2 || svd.toString("ascii", 88, 91) !== "%/E") throw new Error("Joliet descriptor is missing.");
  const rootExtent = svd.readUInt32LE(156 + 2);
  const rootSize = svd.readUInt32LE(156 + 10);
  const directory = iso.subarray(rootExtent * SECTOR, rootExtent * SECTOR + rootSize);
  const files: Record<string, Buffer> = {};
  let offset = 0;
  while (offset + 33 < directory.length && directory[offset] !== 0) {
    const length = directory[offset]!;
    const extent = directory.readUInt32LE(offset + 2);
    const size = directory.readUInt32LE(offset + 10);
    const nameLength = directory[offset + 32]!;
    const rawName = directory.subarray(offset + 33, offset + 33 + nameLength);
    if (rawName.length > 1) {
      const name = utf16beToString(rawName);
      files[name] = Buffer.from(iso.subarray(extent * SECTOR, extent * SECTOR + size));
    }
    offset += length;
  }
  return { label, files };
}

function directorySector(files: SeedFile[], extents: number[], selfExtent: number, joliet: boolean): Buffer {
  const records = [
    directoryRecord(Buffer.from([0x00]), selfExtent, 0, 2),
    directoryRecord(Buffer.from([0x01]), selfExtent, 0, 2),
  ];
  files.forEach((file, index) => {
    const name = joliet ? utf16(file.name, file.name.length * 2) : Buffer.from(`${file.name.toUpperCase().replaceAll("-", "_")}.;1`, "ascii");
    records.push(directoryRecord(name, extents[index]!, file.data.length, 0));
  });
  const exact = Buffer.concat(records);
  records[0] = directoryRecord(Buffer.from([0x00]), selfExtent, exact.length, 2);
  records[1] = directoryRecord(Buffer.from([0x01]), selfExtent, exact.length, 2);
  return Buffer.concat(records);
}

function directoryRecord(name: Buffer, extent: number, size: number, flags: number): Buffer {
  let length = 33 + name.length;
  if (length % 2 === 1) length += 1;
  const record = Buffer.alloc(length);
  record[0] = length;
  writeBoth32(record, 2, extent);
  writeBoth32(record, 10, size);
  const now = new Date();
  record[18] = now.getUTCFullYear() - 1900;
  record[19] = now.getUTCMonth() + 1;
  record[20] = now.getUTCDate();
  record[21] = now.getUTCHours();
  record[22] = now.getUTCMinutes();
  record[23] = now.getUTCSeconds();
  record[25] = flags;
  record.writeUInt16LE(1, 28);
  record.writeUInt16BE(1, 30);
  record[32] = name.length;
  name.copy(record, 33);
  return record;
}

function pathTable(rootExtent: number, bigEndian: boolean): Buffer {
  const table = Buffer.alloc(10);
  table[0] = 1;
  if (bigEndian) table.writeUInt32BE(rootExtent, 2);
  else table.writeUInt32LE(rootExtent, 2);
  table.writeUInt16LE(1, 6);
  return table;
}

function volumeDescriptor(input: {
  type: number;
  volumeId: Buffer;
  volumeSectors: number;
  blockSize: number;
  pathTableSize: number;
  pathL: number;
  pathM: number;
  root: Buffer;
  escape: Buffer;
  unicodeIds?: boolean;
}): Buffer {
  const sector = Buffer.alloc(SECTOR);
  sector[0] = input.type;
  sector.write("CD001", 1, "ascii");
  sector[6] = 1;
  const pad = input.unicodeIds ? 0 : 0x20;
  sector.fill(pad, 8, 40);
  input.volumeId.copy(sector, 40, 0, Math.min(32, input.volumeId.length));
  writeBoth32(sector, 80, input.volumeSectors);
  input.escape.copy(sector, 88, 0, 32);
  writeBoth16(sector, 120, 1);
  writeBoth16(sector, 124, 1);
  writeBoth16(sector, 128, input.blockSize);
  writeBoth32(sector, 132, input.pathTableSize);
  sector.writeUInt32LE(input.pathL, 140);
  sector.writeUInt32BE(input.pathM, 148);
  input.root.copy(sector, 156, 0, Math.min(34, input.root.length));
  return sector;
}

function writeSector(image: Buffer, index: number, data: Buffer): void {
  data.copy(image, index * SECTOR);
}

function writeBoth16(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt16LE(value, offset);
  buffer.writeUInt16BE(value, offset + 2);
}

function writeBoth32(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt32LE(value, offset);
  buffer.writeUInt32BE(value, offset + 4);
}

function ascii(value: string, size: number): Buffer {
  const buffer = Buffer.alloc(size, 0x20);
  buffer.write(value, 0, "ascii");
  return buffer;
}

function utf16beToString(raw: Buffer): string {
  const swapped = Buffer.alloc(raw.length - (raw.length % 2));
  for (let i = 0; i < swapped.length; i += 2) {
    swapped[i] = raw[i + 1]!;
    swapped[i + 1] = raw[i]!;
  }
  return swapped.toString("utf16le").replace(/\u0000+$/, "");
}

function utf16(value: string, size: number): Buffer {
  const encoded = Buffer.from(value, "utf16le");
  const swapped = Buffer.alloc(encoded.length);
  for (let i = 0; i < encoded.length; i += 2) {
    swapped[i] = encoded[i + 1]!;
    swapped[i + 1] = encoded[i]!;
  }
  const buffer = Buffer.alloc(size);
  swapped.copy(buffer, 0, 0, Math.min(size, swapped.length));
  return buffer;
}
