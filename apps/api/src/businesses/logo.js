/**
 * A business's small round logo. The app shrinks the picture before sending
 * it (as a data URL), so the database only ever holds a small image. Logos
 * are served by content hash at a public, cacheable address, which works in
 * the browser and in the desktop app alike without sign-in.
 */

import { createHash } from "node:crypto";

export const MAX_LOGO_BYTES = 256 * 1024;
const HASH = /^[0-9a-f]{64}$/;

const signatures = {
  "image/png": (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/webp": (bytes) => bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP",
};

/** `data:image/…;base64,…` → { bytes, type, hash }, or { error }. */
export function parseLogo(value) {
  if (typeof value !== "string") return { error: "invalid_business_logo" };
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return { error: "invalid_business_logo" };
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) return { error: "invalid_business_logo" };
  if (bytes.length > MAX_LOGO_BYTES) return { error: "business_logo_too_large" };
  if (!signatures[match[1]](bytes)) return { error: "invalid_business_logo" };
  return { bytes, type: match[1], hash: createHash("sha256").update(bytes).digest("hex") };
}

export function logoUrl(publicApiUrl, hash) {
  return hash ? `${publicApiUrl}/v1/business-logos/${hash}` : undefined;
}

export function registerLogoRoute(app, { postgres }) {
  app.get("/v1/business-logos/:hash", async (request, reply) => {
    if (!HASH.test(request.params.hash)) return reply.code(404).send({ error: "logo_not_found" });
    const found = await postgres.query(
      "select logo, logo_type from businesses where logo_hash = $1 limit 1",
      [request.params.hash],
    );
    const row = found.rows[0];
    if (!row) return reply.code(404).send({ error: "logo_not_found" });
    return reply
      .header("content-type", row.logo_type)
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff")
      .send(Buffer.from(row.logo));
  });
}
