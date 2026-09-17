import { createHmac, timingSafeEqual } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function signature(id, expires, secret) {
  if (!secret) throw new Error("TikTok media signing is not configured");
  return createHmac("sha256", secret).update(`posterract:tiktok-media:v1:${id}:${expires}`).digest("hex");
}
export function tiktokMediaUrl(id, expiresAt, environment = process.env) {
  const expires = Math.floor(new Date(expiresAt).getTime() / 1000);
  const origin = (environment.SITE_URL || "https://www.posterract.app").replace(/\/$/, "");
  return `${origin}/v1/tiktok/media/${id}?expires=${expires}&signature=${signature(id, expires, environment.TOKEN_ENCRYPTION_KEY)}`;
}
export function validMediaSignature(id, query, secret, now = Date.now()) {
  if (!uuid.test(id) || !/^\d{10}$/.test(String(query?.expires)) || Number(query.expires) * 1000 <= now || !/^[a-f0-9]{64}$/.test(query?.signature || "")) return false;
  return timingSafeEqual(Buffer.from(query.signature), Buffer.from(signature(id, query.expires, secret)));
}
export function mediaByteRange(value, size) {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new Error("invalid_range");
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new Error("invalid_range");
  return { start, end };
}

export function registerTikTokMediaRoute(app, { postgres, r2, environment = process.env }) {
  app.route({ method: ["GET", "HEAD"], url: "/v1/tiktok/media/:id", logLevel: "silent", handler: async (request, reply) => {
    // A signed URL only grants access to this prepared file, not an arbitrary R2 key.
    if (!validMediaSignature(request.params.id, request.query, environment.TOKEN_ENCRYPTION_KEY)) return reply.code(403).send({ error: "media_link_invalid_or_expired" });
    const { rows } = await postgres.query(
      `select prepared_key, size_bytes, media_expires_at from tiktok_publish_sessions
       where id = $1 and media_cleaned_at is null and size_bytes > 0 and media_expires_at > now()`, [request.params.id]);
    const media = rows[0];
    if (!media || Math.floor(new Date(media.media_expires_at).getTime() / 1000) !== Number(request.query.expires)) return reply.code(404).send({ error: "media_unavailable" });
    const size = Number(media.size_bytes);
    let range;
    try { range = mediaByteRange(request.headers.range, size); }
    catch { return reply.header("Content-Range", `bytes */${size}`).code(416).send(); }
    reply.header("Accept-Ranges", "bytes").header("Content-Type", "video/mp4")
      .header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff")
      .header("Content-Length", range ? range.end - range.start + 1 : size);
    if (range) reply.code(206).header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    if (request.method === "HEAD") return reply.send();
    try {
      const object = await r2.send(new GetObjectCommand({ Bucket: environment.R2_BUCKET, Key: media.prepared_key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }));
      return reply.send(object.Body);
    } catch {
      reply.removeHeader("Content-Length");
      reply.removeHeader("Content-Range");
      return reply.type("application/json").code(503).send({ error: "media_temporarily_unavailable" });
    }
  } });
}

export async function cleanupTikTokMedia(postgres, r2, bucket) {
  if (!r2) return;
  const { rows } = await postgres.query(`select id, prepared_key from tiktok_publish_sessions
    where media_cleaned_at is null and media_expires_at < now() order by media_expires_at limit 100`);
  for (const row of rows) {
    await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.prepared_key }));
    await postgres.query("update tiktok_publish_sessions set media_cleaned_at = now() where id = $1", [row.id]);
  }
}
