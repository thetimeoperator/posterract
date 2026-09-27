import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * The member's GitHub token, at rest.
 *
 * The site hands the Hub a token straight from GitHub's OAuth exchange and the
 * Hub keeps it, because the nightly/on-open sync has to read the member's
 * calendar long after the browser that connected has gone. A stored token is
 * a stored secret, so it is sealed with AES-256-GCM under a key that lives
 * only in the Hub's environment — a database dump alone does not expose it.
 *
 * Blob layout: iv (12) || auth tag (16) || ciphertext.
 */

const KEY_PATTERN = /^[0-9a-f]{64}$/i;

export function githubTokenConfigured() {
  return KEY_PATTERN.test(process.env.AFS_GITHUB_TOKEN_KEY ?? "");
}

function key() {
  const hex = process.env.AFS_GITHUB_TOKEN_KEY ?? "";
  if (!KEY_PATTERN.test(hex)) {
    throw new Error("AFS_GITHUB_TOKEN_KEY must be 32 bytes as 64 hex characters");
  }
  return Buffer.from(hex, "hex");
}

export function sealToken(token) {
  if (typeof token !== "string" || !token) throw new Error("token_required");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export function openToken(blob) {
  if (!blob || blob.length < 12 + 16 + 1) return null;
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
