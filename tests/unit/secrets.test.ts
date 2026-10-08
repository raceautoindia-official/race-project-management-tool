import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A throwaway key for these tests; production reads it from the environment.
const KEY = "0".repeat(63) + "1";

describe("credentials are encrypted, not hidden", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CREDENTIALS_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.CREDENTIALS_KEY;
  });

  it("gives back exactly what it was given", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/secrets");
    for (const value of [
      "hunter2",
      "a password with spaces and ünïcøde ✓",
      "x".repeat(500),
      '{"looks":"like json"}',
    ]) {
      expect(decryptSecret(encryptSecret(value))).toBe(value);
    }
  });

  it("stores the same password differently every time", async () => {
    const { encryptSecret } = await import("@/lib/secrets");
    // A repeated ciphertext would say "these two accounts share a password".
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
  });

  it("never contains the password it was given", async () => {
    const { encryptSecret } = await import("@/lib/secrets");
    const stored = encryptSecret("correct-horse-battery-staple");
    expect(stored).not.toContain("correct");
    expect(stored.startsWith("v1:")).toBe(true);
  });

  it("refuses a row that has been altered", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/secrets");
    const stored = encryptSecret("hunter2");
    const [v, iv, tag, body] = stored.split(":");
    // One flipped character in the ciphertext. Returning a plausible-looking
    // wrong password would be worse than failing.
    const altered = Buffer.from(body, "base64");
    altered[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, altered.toString("base64")].join(":"))).toThrow();
  });

  it("refuses a value saved under a different key", async () => {
    const { encryptSecret } = await import("@/lib/secrets");
    const stored = encryptSecret("hunter2");
    vi.resetModules();
    process.env.CREDENTIALS_KEY = "f".repeat(64);
    const { decryptSecret } = await import("@/lib/secrets");
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("will not store anything without a key, and says what to do", async () => {
    vi.resetModules();
    delete process.env.CREDENTIALS_KEY;
    const { encryptSecret, secretsConfigured, secretsProblem } = await import("@/lib/secrets");
    expect(secretsConfigured()).toBe(false);
    expect(secretsProblem()).toContain("CREDENTIALS_KEY");
    // Not a fallback to plaintext — nothing is stored at all.
    expect(() => encryptSecret("hunter2")).toThrow(/not configured/i);
  });

  it("rejects a key of the wrong length rather than padding it", async () => {
    vi.resetModules();
    process.env.CREDENTIALS_KEY = "abc123";
    const { secretsConfigured, secretsProblem } = await import("@/lib/secrets");
    expect(secretsConfigured()).toBe(false);
    expect(secretsProblem()).toContain("32-byte");
  });

  it("takes the key as hex or base64", async () => {
    vi.resetModules();
    process.env.CREDENTIALS_KEY = Buffer.alloc(32, 7).toString("base64");
    const { encryptSecret, decryptSecret, secretsConfigured } = await import("@/lib/secrets");
    expect(secretsConfigured()).toBe(true);
    expect(decryptSecret(encryptSecret("ok"))).toBe("ok");
  });
});
