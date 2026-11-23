import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import QRCode from "qrcode";
import { RelayError } from "../core/errors.ts";

/**
 * Login for Relay when it runs on a server (cloud mode): one owner account with a password
 * plus a TOTP code from an authenticator app (two-factor). Sessions are random tokens in an
 * HttpOnly cookie; only their SHA-256 hashes are stored. Nothing here is used by the local
 * desktop app, which only listens on 127.0.0.1 of the user's own PC.
 */

const COOKIE = "relay_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const PASSWORD_MIN = 10;

interface SessionRecord {
  hash: string;
  createdAt: string;
  lastSeen: string;
  expiresAt: string;
  device: string;
}

interface AuthFile {
  version: 1;
  passwordHash: string;
  salt: string;
  totpSecret: string;
  lastTotpStep: number;
  recoveryHashes: string[];
  sessions: SessionRecord[];
}

export interface AuthState {
  required: boolean;
  configured: boolean;
  authenticated: boolean;
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — what Google Authenticator, Authy, 1Password, etc. use. */
export function totp(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

const currentStep = (now = Date.now()) => Math.floor(now / 30000);

/** Returns the matching time step (±1 for clock drift), or null. */
export function matchTotp(secret: string, code: string, now = Date.now()): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const step = currentStep(now);
  for (const candidate of [step - 1, step, step + 1]) {
    const expected = totp(secret, candidate);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return candidate;
  }
  return null;
}

export class Auth {
  private data: AuthFile | null = null;
  private pending: { passwordHash: string; salt: string; totpSecret: string; expires: number } | null = null;
  private failures = new Map<string, { count: number; lockedUntil: number }>();
  private readonly file: string;
  private readonly setupTokenFile: string;
  private setupToken = "";

  private constructor(dir: string, readonly required: boolean) {
    this.file = path.join(dir, "auth.json");
    this.setupTokenFile = path.join(dir, "setup-token.txt");
  }

  static async open(dir: string, required: boolean): Promise<Auth> {
    const auth = new Auth(dir, required);
    await mkdir(dir, { recursive: true });
    try {
      auth.data = JSON.parse(await readFile(auth.file, "utf8")) as AuthFile;
    } catch {
      auth.data = null;
    }
    if (required && !auth.data) {
      // Only someone who can read the server's disk (or its setup output) can create the owner account.
      auth.setupToken = randomBytes(9).toString("base64url");
      await writeFile(auth.setupTokenFile, auth.setupToken + "\n", { mode: 0o600 });
    }
    return auth;
  }

  get setupTokenForLog(): string {
    return this.setupToken;
  }

  state(request: IncomingMessage): AuthState {
    return { required: this.required, configured: Boolean(this.data), authenticated: !this.required || this.check(request) };
  }

  check(request: IncomingMessage): boolean {
    if (!this.required) return true;
    if (!this.data) return false;
    const token = readCookie(request, COOKIE);
    if (!token) return false;
    const hash = sha256(token);
    const now = Date.now();
    const session = this.data.sessions.find((item) => item.hash === hash);
    if (!session || Date.parse(session.expiresAt) < now) return false;
    if (now - Date.parse(session.lastSeen) > 60_000) {
      session.lastSeen = new Date(now).toISOString();
      void this.save();
    }
    return true;
  }

  async beginSetup(input: { setupToken: string; password: string }): Promise<{ secret: string; uri: string; qrSvg: string }> {
    if (!this.required) throw new RelayError("auth_off", "Login is only used when Relay runs on a server.");
    if (this.data) throw new RelayError("auth_configured", "An account already exists. Sign in instead.", 409);
    if (!this.setupToken || !safeEqual(input.setupToken.trim(), this.setupToken)) {
      throw new RelayError("bad_setup_token", "The setup code is wrong. It is printed at the end of the server setup and saved in setup-token.txt.", 403);
    }
    if (input.password.length < PASSWORD_MIN) {
      throw new RelayError("weak_password", `Use a password with at least ${PASSWORD_MIN} characters.`, 400);
    }
    const salt = randomBytes(16);
    const passwordHash = (await scrypt(input.password, salt)).toString("hex");
    const totpSecret = base32Encode(randomBytes(20));
    this.pending = { passwordHash, salt: salt.toString("hex"), totpSecret, expires: Date.now() + 15 * 60 * 1000 };
    const uri = `otpauth://totp/Relay:owner?secret=${totpSecret}&issuer=Relay&algorithm=SHA1&digits=6&period=30`;
    const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, color: { dark: "#000000", light: "#ffffff" } });
    return { secret: totpSecret, uri, qrSvg };
  }

  async confirmSetup(input: { code: string; device: string }): Promise<{ cookie: string; recoveryCodes: string[] }> {
    const pending = this.pending;
    if (!pending || pending.expires < Date.now()) throw new RelayError("setup_expired", "Setup timed out. Start again.", 400);
    const step = matchTotp(pending.totpSecret, input.code);
    if (step === null) throw new RelayError("bad_code", "That code didn't match. Check the time on your phone and try the newest code.", 400);
    const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(5).toString("hex").toUpperCase().replace(/(.{5})/, "$1-"));
    this.data = {
      version: 1,
      passwordHash: pending.passwordHash,
      salt: pending.salt,
      totpSecret: pending.totpSecret,
      lastTotpStep: step,
      recoveryHashes: recoveryCodes.map((code) => sha256(code.replace(/-/g, ""))),
      sessions: [],
    };
    this.pending = null;
    const cookie = this.newSession(input.device);
    await this.save();
    await rm(this.setupTokenFile, { force: true });
    this.setupToken = "";
    return { cookie, recoveryCodes };
  }

  async login(input: { password: string; code: string; ip: string; device: string }): Promise<string> {
    if (!this.data) throw new RelayError("auth_not_configured", "No account yet. Finish setup first.", 409);
    const key = input.ip || "unknown";
    const entry = this.failures.get(key);
    if (entry && entry.lockedUntil > Date.now()) {
      const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
      throw new RelayError("locked", `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, 429);
    }
    const hash = (await scrypt(input.password, Buffer.from(this.data.salt, "hex"))).toString("hex");
    const passwordOk = safeEqual(hash, this.data.passwordHash);
    let secondOk = false;
    const code = input.code.replace(/[\s-]/g, "").toUpperCase();
    if (passwordOk) {
      const step = matchTotp(this.data.totpSecret, code);
      if (step !== null && step > this.data.lastTotpStep) {
        this.data.lastTotpStep = step; // a code can't be reused
        secondOk = true;
      } else if (/^[0-9A-F]{10}$/.test(code)) {
        const index = this.data.recoveryHashes.indexOf(sha256(code));
        if (index >= 0) {
          this.data.recoveryHashes.splice(index, 1); // recovery codes are single use
          secondOk = true;
        }
      }
    }
    if (!passwordOk || !secondOk) {
      const next = { count: (entry?.count ?? 0) + 1, lockedUntil: 0 };
      if (next.count >= MAX_FAILURES) {
        next.count = 0;
        next.lockedUntil = Date.now() + LOCK_MS;
      }
      this.failures.set(key, next);
      throw new RelayError("bad_login", "Wrong password or code.", 401);
    }
    this.failures.delete(key);
    const cookie = this.newSession(input.device);
    await this.save();
    return cookie;
  }

  async logout(request: IncomingMessage, everywhere: boolean): Promise<string> {
    if (this.data) {
      if (everywhere) {
        this.data.sessions = [];
      } else {
        const token = readCookie(request, COOKIE);
        const hash = token ? sha256(token) : "";
        this.data.sessions = this.data.sessions.filter((item) => item.hash !== hash);
      }
      await this.save();
    }
    return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureFlag(request)}`;
  }

  sessions(): { createdAt: string; lastSeen: string; device: string }[] {
    return (this.data?.sessions ?? []).map(({ createdAt, lastSeen, device }) => ({ createdAt, lastSeen, device }));
  }

  recoveryCodesLeft(): number {
    return this.data?.recoveryHashes.length ?? 0;
  }

  cookieHeader(token: string, request: IncomingMessage): string {
    return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secureFlag(request)}`;
  }

  private newSession(device: string): string {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    this.data!.sessions = this.data!.sessions.filter((item) => Date.parse(item.expiresAt) > now.getTime());
    this.data!.sessions.push({
      hash: sha256(token),
      createdAt: now.toISOString(),
      lastSeen: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_MS).toISOString(),
      device: device.slice(0, 120),
    });
    return token;
  }

  private async save(): Promise<void> {
    await writeFile(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function secureFlag(request: IncomingMessage): string {
  return request.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
}

export function clientIp(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || request.socket.remoteAddress || "";
}

export function deviceLabel(request: IncomingMessage): string {
  const ua = String(request.headers["user-agent"] ?? "");
  if (/iPhone|iPad/.test(ua)) return "iPhone / iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Linux/.test(ua)) return "Linux";
  return "Browser";
}

/** Blocks cross-site form posts: a state-changing request must come from Relay's own page. */
export function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true; // same-origin fetch from older browsers / non-browser clients behind the login
  try {
    return new URL(origin).host === request.headers.host || new URL(origin).host === request.headers["x-forwarded-host"];
  } catch {
    return false;
  }
}
