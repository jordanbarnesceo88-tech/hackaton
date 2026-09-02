import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

// bcrypt work factor. Raised from 10 to 12: at cost 10 a hash takes ~76 ms on this hardware,
// at 12 ~279 ms, which is the current guidance for an interactive login. Existing hashes carry
// their own cost in the string ($2b$10$…), so users created before this change keep verifying
// against 10 — no migration, no forced reset.
const COST = 12;

/**
 * bcrypt silently truncates after 72 BYTES, which is not 72 characters: this UI is Russian, and
 * Cyrillic is two bytes per character in UTF-8, so a perfectly ordinary 40-character passphrase
 * would have its last 8 characters ignored. Rather than quietly weakening such a password we
 * reject it and say so.
 */
export const MAX_PASSWORD_BYTES = 72;

export function passwordByteLength(plain: string): number {
  return Buffer.byteLength(plain, "utf8");
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// A valid hash of a value nobody knows, computed once per process and reused. `authorize` needs
// something to compare against when the account does not exist, so that a miss costs the same
// as a wrong password — see the note there. Generated lazily rather than hardcoded so it can
// never drift out of step with COST.
let dummyHash: Promise<string> | null = null;

/** A throwaway hash to compare against on the account-not-found path. */
export function decoyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash(randomUUID(), COST);
  return dummyHash;
}
