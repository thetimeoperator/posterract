// Run from apps/api/scripts (or pipe into node there). No TikTok APIs are called.
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { tiktokMediaUrl } from "../src/tiktokMedia.js";

const env = process.env;
const postgres = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
const r2 = new S3Client({ region: env.R2_REGION || "auto", endpoint: env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
const id = randomUUID();
const key = `tiktok-prepared/transport-smoke-${id}.mp4`;
const body = Buffer.from("Posterract signed media transport smoke test");
try {
  const { rows } = await postgres.query(`insert into tiktok_publish_sessions (id, state, prepared_key, size_bytes, media_expires_at)
    values ($1, 'prepared', $2, $3, now() + interval '5 minutes') returning media_expires_at`, [id, key, body.length]);
  await r2.send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: "video/mp4" }));
  const url = tiktokMediaUrl(id, rows[0].media_expires_at, env);
  const get = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (get.status !== 200 || !Buffer.from(await get.arrayBuffer()).equals(body)) throw new Error("signed_get_failed");
  const head = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (head.status !== 200 || Number(head.headers.get("content-length")) !== body.length) throw new Error("signed_head_failed");
  const range = await fetch(url, { headers: { Range: "bytes=2-7" }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (range.status !== 206 || !Buffer.from(await range.arrayBuffer()).equals(body.subarray(2, 8))) throw new Error("signed_range_failed");
  console.log(JSON.stringify({ signedGet: 200, signedHead: 200, signedRange: 206, redirects: false, tiktokRequests: 0 }));
} catch (error) {
  // Never print the signed URL or storage credentials on failure.
  console.error("TikTok media transport smoke check failed:", /signed_.*_failed/.test(error.message) ? error.message : error.name);
  process.exitCode = 1;
} finally {
  await r2.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  await postgres.query("delete from tiktok_publish_sessions where id = $1 and projection_id is null", [id]);
  await postgres.end(); r2.destroy();
}
