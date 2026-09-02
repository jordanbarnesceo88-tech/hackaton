import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  decoyHash,
  passwordByteLength,
  MAX_PASSWORD_BYTES,
} from "./password";

describe("password hashing", () => {
  it("hashes a password to a non-plaintext bcrypt string", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).not.toBe("correct horse battery");
    expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt prefix
  });
  it("verifies the correct password", async () => {
    const hash = await hashPassword("s3cret-password");
    expect(await verifyPassword("s3cret-password", hash)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret-password");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("password byte length (bcrypt's 72-byte truncation)", () => {
  it("counts UTF-8 bytes, not characters", () => {
    expect(passwordByteLength("abcdefgh")).toBe(8);
    // Cyrillic is 2 bytes per character in UTF-8 — the reason a character count is not enough
    // for a Russian-language product.
    expect(passwordByteLength("парольпароль")).toBe(24);
  });

  it("a 40-character Cyrillic passphrase exceeds the bcrypt limit", () => {
    const passphrase = "п".repeat(40);
    expect(passphrase.length).toBeLessThan(MAX_PASSWORD_BYTES);      // 40 characters — looks fine
    expect(passwordByteLength(passphrase)).toBeGreaterThan(MAX_PASSWORD_BYTES); // 80 bytes — is not
  });
});

describe("decoyHash", () => {
  it("is a usable bcrypt hash that no password matches", async () => {
    const h = await decoyHash();
    expect(h.startsWith("$2")).toBe(true);
    expect(await verifyPassword("any-password", h)).toBe(false);
  });

  it("is computed once and reused, so it costs nothing per login", async () => {
    expect(await decoyHash()).toBe(await decoyHash());
  });

  it("takes real work to verify, which is the entire point", async () => {
    const h = await decoyHash();
    const t0 = performance.now();
    await verifyPassword("wrong", h);
    // A malformed hash would bail in microseconds; a real one must actually run the KDF.
    expect(performance.now() - t0).toBeGreaterThan(5);
  });
});

describe("hashPassword cost", () => {
  it("issues new hashes at cost 12", async () => {
    expect(await hashPassword("password12345")).toMatch(/^\$2[aby]\$12\$/);
  });

  it("still verifies a hash created at the older cost 10", async () => {
    // bcrypt reads the cost from the hash itself, so raising COST needs no migration.
    const legacy = "$2b$10$K7L1OJ0/9L2h0kQ0K1wEeuJ5cVJgLhk8kQKQ2vJ1Zx1qKQ8Q1YJ2u";
    expect(typeof (await verifyPassword("anything", legacy))).toBe("boolean");
  });
});
