export interface SecretStore {
  readonly kind: "memory" | "os";
  readonly detail: string;
  get(id: string): Promise<string | null>;
  set(id: string, value: string): Promise<void>;
  delete(id: string): Promise<void>;
  has(id: string): Promise<boolean>;
}

export class MemorySecretStore implements SecretStore {
  readonly kind = "memory" as const;
  readonly detail: string;
  private values = new Map<string, string>();

  constructor(detail = "Keys stay in this process only. Restarting clears them. The desktop app uses OS secure storage instead.") {
    this.detail = detail;
  }

  async get(id: string): Promise<string | null> {
    return this.values.get(id) ?? null;
  }

  async set(id: string, value: string): Promise<void> {
    this.values.set(id, value);
  }

  async delete(id: string): Promise<void> {
    this.values.delete(id);
  }

  async has(id: string): Promise<boolean> {
    return this.values.has(id);
  }
}

export interface Encryptor {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class FileEncryptedSecretStore implements SecretStore {
  readonly kind: "memory" | "os";
  readonly detail: string;
  private values = new Map<string, string>();
  private loaded = false;

  constructor(
    private readonly file: string,
    private readonly encryptor: Encryptor,
    private readonly io: {
      readFile: (path: string) => Promise<Buffer>;
      writeFile: (path: string, data: Buffer) => Promise<void>;
      mkdir: (path: string) => Promise<void>;
    },
  ) {
    if (encryptor.isEncryptionAvailable()) {
      this.kind = "os";
      this.detail = "Credentials are encrypted with the operating system's secure storage.";
    } else {
      this.kind = "memory";
      this.detail = "OS encryption is unavailable, so keys are kept in memory for this session and are not written to disk.";
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (this.kind !== "os") return;
    try {
      const raw = await this.io.readFile(this.file);
      const parsed = JSON.parse(raw.toString("utf8")) as Record<string, string>;
      for (const [id, encoded] of Object.entries(parsed)) {
        this.values.set(id, this.encryptor.decryptString(Buffer.from(encoded, "base64")));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async get(id: string): Promise<string | null> {
    await this.load();
    return this.values.get(id) ?? null;
  }

  async set(id: string, value: string): Promise<void> {
    await this.load();
    this.values.set(id, value);
    await this.persist();
  }

  async delete(id: string): Promise<void> {
    await this.load();
    this.values.delete(id);
    await this.persist();
  }

  async has(id: string): Promise<boolean> {
    await this.load();
    return this.values.has(id);
  }

  private async persist(): Promise<void> {
    if (this.kind !== "os") return;
    const encoded: Record<string, string> = {};
    for (const [id, value] of this.values) {
      encoded[id] = this.encryptor.encryptString(value).toString("base64");
    }
    const path = await import("node:path");
    await this.io.mkdir(path.dirname(this.file));
    await this.io.writeFile(this.file, Buffer.from(JSON.stringify(encoded)));
  }
}
