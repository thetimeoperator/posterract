import { randomUUID } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { basename, extname } from "node:path";

const [, , filePath, platformsValue, caption = "", scheduleValue = "now", title] =
  process.argv;
const apiUrl = process.env.POSTERRACT_API_URL?.replace(/\/+$/, "");
const apiKey = process.env.POSTERRACT_API_KEY;

if (!apiUrl || !apiKey || !filePath || !platformsValue) {
  throw new Error(
    "Usage: POSTERRACT_API_URL=... POSTERRACT_API_KEY=... node post-video.mjs <video> <platforms-csv> [caption] [now|ISO-time] [title]",
  );
}

const mimeTypes = new Map([
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
]);
const contentType = mimeTypes.get(extname(filePath).toLowerCase());
if (!contentType) throw new Error("Video must be MP4, MOV, or WebM");
const platforms = [...new Set(platformsValue.split(",").map((item) => item.trim()).filter(Boolean))];
if (platforms.length === 0) throw new Error("At least one platform is required");

async function api(path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Posterract ${response.status}: ${body.slice(0, 1_000)}`);
  }
  return response.status === 204 ? undefined : response.json();
}

const file = await stat(filePath);
if (!file.isFile() || file.size <= 0) throw new Error("Video file is empty or missing");
const upload = await api("/v1/uploads/multipart", {
  method: "POST",
  body: JSON.stringify({
    fileName: basename(filePath),
    contentType,
    sizeBytes: file.size,
  }),
});

const chunkSize = 16 * 1024 * 1024;
const handle = await open(filePath, "r");
const parts = [];
try {
  for (let offset = 0, partNumber = 1; offset < file.size; partNumber += 1) {
    const size = Math.min(chunkSize, file.size - offset);
    const buffer = Buffer.allocUnsafe(size);
    const { bytesRead } = await handle.read(buffer, 0, size, offset);
    if (bytesRead !== size) throw new Error("Could not read the complete video file");
    const signed = await api(
      `/v1/uploads/multipart/${encodeURIComponent(upload.uploadId)}/parts/${partNumber}`,
      { method: "POST" },
    );
    const put = await fetch(signed.url, { method: "PUT", body: buffer });
    if (!put.ok) throw new Error(`R2 upload failed for part ${partNumber} (${put.status})`);
    const etag = put.headers.get("etag");
    if (!etag) throw new Error(`R2 did not return an ETag for part ${partNumber}`);
    parts.push({ PartNumber: partNumber, ETag: etag });
    offset += size;
    process.stderr.write(`Uploaded ${Math.round((offset / file.size) * 100)}%\n`);
  }
} catch (error) {
  await api(`/v1/uploads/multipart/${encodeURIComponent(upload.uploadId)}`, {
    method: "DELETE",
  }).catch(() => undefined);
  throw error;
} finally {
  await handle.close();
}

const completed = await api(
  `/v1/uploads/multipart/${encodeURIComponent(upload.uploadId)}/complete`,
  { method: "POST", body: JSON.stringify({ parts }) },
);
const post = await api("/v1/posts", {
  method: "POST",
  headers: { "Idempotency-Key": randomUUID() },
  body: JSON.stringify({
    artifactId: completed.mediaId,
    title: title || basename(filePath, extname(filePath)),
    caption,
    platforms,
    scheduledFor: scheduleValue,
  }),
});
process.stdout.write(`${JSON.stringify(post, null, 2)}\n`);
