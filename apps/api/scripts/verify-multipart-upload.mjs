import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import Redis from "ioredis";
import { Pool } from "pg";

const required = [
  "DATABASE_URL",
  "INTERNAL_API_KEY",
  "REDIS_URL",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const endpoint =
  process.env.R2_ENDPOINT ||
  `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const r2 = new S3Client({
  region: process.env.R2_REGION ?? "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const postgres = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 1,
});
const apiBaseUrl = process.env.VERIFY_API_BASE_URL ?? "http://127.0.0.1:3001";

const userId = randomUUID();
const workspaceId = randomUUID();
const tokenPrefix = randomBytes(4).toString("hex");
const apiToken = `pr_test_${tokenPrefix}_${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(apiToken).digest("hex");
const firstPart = Buffer.alloc(5 * 1024 * 1024, 0x50);
const secondPart = Buffer.alloc(1_024, 0x52);
const totalBytes = firstPart.length + secondPart.length;

let uploadId;
let objectKey;
let completed = false;

async function cleanPreviousVerificationUploads() {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      "posterract:upload:*",
      "COUNT",
      100,
    );
    cursor = nextCursor;
    for (const key of keys) {
      const serialized = await redis.get(key);
      if (!serialized) continue;
      const session = JSON.parse(serialized);
      if (session.fileName !== "verification.mp4") continue;
      await fetch(
        `${apiBaseUrl}/v1/uploads/multipart/${encodeURIComponent(session.uploadId)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
        },
      );
    }
  } while (cursor !== "0");
}

async function api(path, init = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`API ${response.status}: ${payload.slice(0, 200)}`);
  }
  if (response.status === 204) return undefined;
  return response.json();
}

try {
  await cleanPreviousVerificationUploads();
  await postgres.query(
    `insert into app_users (id, email, display_name)
     values ($1, $2, 'R2 verification')`,
    [userId, `r2-verification-${userId}@invalid.posterract.local`],
  );
  await postgres.query(
    `insert into workspaces (id, owner_id, name)
     values ($1, $2, 'R2 verification')`,
    [workspaceId, userId],
  );
  await postgres.query(
    `insert into api_keys
      (workspace_id, name, key_prefix, secret_hash, scopes)
     values ($1, 'R2 verification', $2, $3, array['media:write'])`,
    [workspaceId, tokenPrefix, tokenHash],
  );

  const session = await api("/v1/uploads/multipart", {
    method: "POST",
    body: JSON.stringify({
      fileName: "verification.mp4",
      contentType: "video/mp4",
      sizeBytes: totalBytes,
    }),
  });
  uploadId = session.uploadId;
  objectKey = session.key;

  const uploadedParts = [];
  for (const [index, body] of [firstPart, secondPart].entries()) {
    const partNumber = index + 1;
    const signature = await api(
      `/v1/uploads/multipart/${encodeURIComponent(uploadId)}/parts/${partNumber}`,
      { method: "POST" },
    );
    const uploadResponse = await fetch(signature.url, {
      method: "PUT",
      body,
    });
    if (!uploadResponse.ok) {
      throw new Error(`R2 part ${partNumber} failed (${uploadResponse.status})`);
    }
    const etag = uploadResponse.headers.get("etag");
    if (!etag) throw new Error(`R2 part ${partNumber} omitted ETag`);
    uploadedParts.push({ PartNumber: partNumber, ETag: etag });
  }

  const listed = await api(
    `/v1/uploads/multipart/${encodeURIComponent(uploadId)}/parts`,
  );
  if (listed.parts.length !== uploadedParts.length) {
    throw new Error("ListParts did not return every uploaded part");
  }

  const result = await api(
    `/v1/uploads/multipart/${encodeURIComponent(uploadId)}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ parts: uploadedParts }),
    },
  );
  completed = true;

  const object = await r2.send(
    new HeadObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: objectKey,
    }),
  );
  const database = await postgres.query(
    `select status, purge_after, upload_completed_at
     from media_assets
     where id = $1`,
    [result.mediaId],
  );
  const media = database.rows[0];
  const purgeWindowHours =
    (new Date(media.purge_after).getTime() -
      new Date(media.upload_completed_at).getTime()) /
    3_600_000;

  if (Number(object.ContentLength) !== totalBytes) {
    throw new Error("R2 object size does not match the source");
  }
  if (media.status !== "ready") {
    throw new Error(`Unexpected media status: ${media.status}`);
  }
  if (purgeWindowHours < 23.9 || purgeWindowHours > 24.1) {
    throw new Error(`Unexpected purge window: ${purgeWindowHours}`);
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      authorization: "scoped-api-key",
      multipartParts: uploadedParts.length,
      bytesUploaded: totalBytes,
      objectKeyLayout:
        objectKey ===
        `uploads/${workspaceId}/${result.mediaId}/source.mp4`,
      databaseStatus: media.status,
      unattachedPurgeHours: Math.round(purgeWindowHours),
    })}\n`,
  );
} finally {
  if (uploadId && !completed) {
    await api(`/v1/uploads/multipart/${encodeURIComponent(uploadId)}`, {
      method: "DELETE",
    }).catch(() => undefined);
  }
  if (objectKey) {
    await r2
      .send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: objectKey,
        }),
      )
      .catch(() => undefined);
  }
  await postgres.query("delete from app_users where id = $1", [userId]);
  await postgres.end();
  redis.disconnect();
  r2.destroy();
}
