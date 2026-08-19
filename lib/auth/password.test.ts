import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

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
