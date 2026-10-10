import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Encryption for the few things this app has to be able to read back — the
 * website logins kept in the admin credentials vault.
 *
 * Passwords people *sign in with* are never stored here: those live in the
 * Attendance app and are checked, not read. These are different — a shared
 * login for someone else's website is only useful if it can be handed back,
 * so it is encrypted rather than hashed.
 *
 * AES-256-GCM: the tag means a value that has been tampered with in the
 * database fails to decrypt rather than returning something plausible.
 */

const VERSION = "v1";

/**
 * The key, from CREDENTIALS_KEY — 32 bytes as hex or base64.
 * Read at call time, not at import, so a key added to .env.local takes effect
 * on restart without the module having cached its absence.
 */
function key(): Buffer | null {
  const raw = (process.env.CREDENTIALS_KEY ?? "").trim();
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

/** Can this server store and read credentials at all? */
export function secretsConfigured(): boolean {
  return key() !== null;
}

/** Why it is not configured, in words an admin can act on. */
export function secretsProblem(): string | null {
  const raw = (process.env.CREDENTIALS_KEY ?? "").trim();
  if (!raw) {
    return "CREDENTIALS_KEY is not set, so there is nowhere safe to keep these. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"";
  }
  if (!key()) {
    return "CREDENTIALS_KEY is not a 32-byte key — it must be 64 hex characters, or base64 of 32 bytes.";
  }
  return null;
}

export class SecretsUnavailable extends Error {
  constructor() {
    super("Credentials storage is not configured on this server");
    this.name = "SecretsUnavailable";
  }
}

/** Encrypt a value for storage. Returns "v1:<iv>:<tag>:<ciphertext>", base64. */
export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) throw new SecretsUnavailable();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const out = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    out.toString("base64"),
  ].join(":");
}

/**
 * Read a stored value back. Throws if the key is wrong or the row has been
 * altered — a silent wrong answer would be worse than an error.
 */
export function decryptSecret(stored: string): string {
  const k = key();
  if (!k) throw new SecretsUnavailable();
  const [version, iv, tag, body] = String(stored).split(":");
  if (version !== VERSION || !iv || !tag || !body) {
    throw new Error("Stored credential is not in a format this version understands");
  }
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Constant-time compare, for anything that gates on a secret. */
export function secretEquals(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
