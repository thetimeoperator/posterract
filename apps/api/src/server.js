import { randomBytes, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Pool } from "pg";
import Redis from "ioredis";
import { Client as ElasticsearchClient } from "@elastic/elasticsearch";
import {
  Client as TemporalClient,
  Connection as TemporalConnection,
} from "@temporalio/client";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  PLATFORM_IDS,
  RequestValidationError,
  parseCreatePost,
  parseReschedulePost,
  publicPost,
} from "./domain.js";
import {
  constantTimeEqual,
  encryptSecret,
  hashApiKey,
  hashRequest,
} from "./security.js";
import { createPosterractAuth } from "./auth.js";
import { registerOAuthRoutes } from "./oauth.js";
import { loadAnalyticsDashboard } from "./analytics.js";
import { registerMetaRoutes } from "./meta.js";
import {
  executeAgentRun,
  validateAgentCredentialInput,
  validateAgentRunInput,
  validateProviderCredential,
} from "./agents.js";
import { listPublicSkills } from "./skills.js";
import { loadWorkspaceApiKeys } from "./apiKeys.js";
import {
  createStripeBillingService,
  registerBillingRoutes,
  registerStripeWebhookRoutes,
} from "./billing.js";

const env = process.env;
const port = Number(env.PORT ?? 3001);
const maxUploadBytes = Number(env.MAX_UPLOAD_BYTES ?? 5_000_000_000);
const uploadTtlSeconds = Number(env.UPLOAD_SESSION_TTL_SECONDS ?? 86_400);
const unattachedMediaTtlHours = Number(
  env.UNATTACHED_MEDIA_TTL_HOURS ?? 24,
);
const cleanupIntervalMs =
  Number(env.MEDIA_CLEANUP_INTERVAL_SECONDS ?? 900) * 1_000;
const outboxIntervalMs = Number(env.OUTBOX_INTERVAL_MS ?? 1_000);
const apiRateLimitPerMinute = Number(env.API_RATE_LIMIT_PER_MINUTE ?? 120);
const allowedMimeTypes = new Map([
  ["video/mp4", ".mp4"],
  ["video/quicktime", ".mov"],
  ["video/webm", ".webm"],
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const agentApiScopes = new Set([
  "accounts:read",
  "analytics:read",
  "media:write",
  "points:read",
  "posts:read",
  "posts:write",
  "runs:read",
  "runs:write",
  "skills:read",
]);

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL ?? "info",
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
    ],
  },
  bodyLimit: 1_048_576,
  routerOptions: {
    maxParamLength: 2_048,
  },
  trustProxy: true,
});

app.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (_request, body, done) => done(null, body),
);
app.addContentTypeParser(
  /^multipart\/form-data(?:;|$)/i,
  { parseAs: "string" },
  (_request, body, done) => done(null, body),
);

const postgres = new Pool({
  connectionString: env.DATABASE_URL,
  max: Number(env.POSTGRES_POOL_MAX ?? 10),
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});
const auth = createPosterractAuth(postgres);
const billing = createStripeBillingService({
  postgres,
  environment: env,
  logger: app.log,
});

const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  connectTimeout: 5_000,
});

const elasticsearch = new ElasticsearchClient({
  node: env.ELASTICSEARCH_URL,
  requestTimeout: 5_000,
  maxRetries: 1,
});

let temporalConnection;
let temporalClient;
let cleanupTimer;
let outboxTimer;

const r2Configured = Boolean(
  (env.R2_ENDPOINT || env.R2_ACCOUNT_ID) &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET,
);

const r2Endpoint =
  env.R2_ENDPOINT?.replace(/\/+$/, "") ||
  (env.R2_ACCOUNT_ID
    ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : undefined);

const r2 = r2Configured
  ? new S3Client({
      region: env.R2_REGION ?? "auto",
      endpoint: r2Endpoint,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    })
  : undefined;

function bearerToken(request) {
  const authorization = request.headers.authorization ?? "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
}

async function authenticate(request, reply, requiredScope) {
  const token = bearerToken(request);
  if (constantTimeEqual(token, env.INTERNAL_API_KEY)) {
    request.authContext = { kind: "internal" };
    return;
  }

  if (token.startsWith("pr_")) {
    const result = await postgres.query(
      `select id, workspace_id, scopes
       from api_keys
       where secret_hash = $1
         and revoked_at is null
         and (expires_at is null or expires_at > now())
       limit 1`,
      [hashApiKey(token)],
    );
    const apiKey = result.rows[0];
    if (!apiKey) return reply.code(401).send({ error: "unauthorized" });

    if (
      requiredScope &&
      !apiKey.scopes.includes("*") &&
      !apiKey.scopes.includes(requiredScope)
    ) {
      return reply.code(403).send({ error: "insufficient_scope" });
    }

    request.authContext = {
      kind: "api_key",
      apiKeyId: apiKey.id,
      workspaceId: apiKey.workspace_id,
      scopes: apiKey.scopes,
    };
    const minute = Math.floor(Date.now() / 60_000);
    const rateKey = `posterract:api-rate:${apiKey.id}:${minute}`;
    const rateCount = await redis.incr(rateKey);
    if (rateCount === 1) await redis.expire(rateKey, 120);
    reply.header("x-ratelimit-limit", apiRateLimitPerMinute);
    reply.header(
      "x-ratelimit-remaining",
      Math.max(0, apiRateLimitPerMinute - rateCount),
    );
    if (rateCount > apiRateLimitPerMinute) {
      reply.header("retry-after", 60);
      return reply.code(429).send({ error: "rate_limit_exceeded" });
    }
    void postgres
      .query("update api_keys set last_used_at = now() where id = $1", [
        apiKey.id,
      ])
      .catch((error) =>
        app.log.warn({ err: error, apiKeyId: apiKey.id }, "api key usage update failed"),
      );
    return;
  }

  if (!auth) return reply.code(401).send({ error: "unauthorized" });
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(",") : value);
  }
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const membership = await postgres.query(
    `select u.id as user_id, wm.workspace_id, wm.role
     from app_users u
     join workspace_memberships wm on wm.user_id = u.id
     where u.auth_user_id = $1
     order by case wm.role when 'owner' then 0 when 'admin' then 1 else 2 end,
              wm.created_at asc
     limit 1`,
    [session.user.id],
  );
  if (!membership.rows[0]) {
    return reply.code(403).send({ error: "workspace_not_found" });
  }
  request.authContext = {
    kind: "session",
    userId: membership.rows[0].user_id,
    workspaceId: membership.rows[0].workspace_id,
    role: membership.rows[0].role,
  };
}

async function requireInternalKey(request, reply) {
  const token = bearerToken(request);
  if (!constantTimeEqual(token, env.INTERNAL_API_KEY)) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  request.authContext = { kind: "internal" };
}

async function requireMediaWrite(request, reply) {
  return authenticate(request, reply, "media:write");
}

function requireScope(scope) {
  return (request, reply) => authenticate(request, reply, scope);
}

async function requireSession(request, reply) {
  await authenticate(request, reply);
  if (reply.sent) return;
  if (request.authContext?.kind !== "session") {
    return reply.code(403).send({ error: "interactive_session_required" });
  }
}

async function ensureRedis() {
  if (redis.status === "wait") await redis.connect();
  return redis.ping();
}

async function ensureTemporal() {
  if (!temporalConnection) {
    temporalConnection = await TemporalConnection.connect({
      address: env.TEMPORAL_ADDRESS,
      connectTimeout: 5_000,
    });
    temporalClient = new TemporalClient({
      connection: temporalConnection,
      namespace: env.TEMPORAL_NAMESPACE ?? "default",
    });
  }
  await temporalConnection.workflowService.getSystemInfo({});
  return "SERVING";
}

function requiredWorkspace(request) {
  if (!request.authContext?.workspaceId) throw new Error("A workspace is required");
  return request.authContext.workspaceId;
}

async function auditApiAction(request, action, resourceType, resourceId, metadata = {}) {
  if (request.authContext?.kind !== "api_key") return;
  await postgres.query(
    `insert into api_audit_logs
      (workspace_id, api_key_id, action, resource_type, resource_id,
       request_id, source_ip, user_agent, metadata)
     values ($1, $2, $3, $4, $5, $6, nullif($7, '')::inet, $8, $9)`,
    [
      request.authContext.workspaceId,
      request.authContext.apiKeyId,
      action,
      resourceType,
      resourceId,
      request.id,
      request.ip ?? "",
      request.headers["user-agent"] ?? null,
      JSON.stringify(metadata),
    ],
  );
}

function idempotencyKey(request, reply) {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8 || value.length > 200) {
    reply.code(400).send({ error: "idempotency_key_required" });
    return undefined;
  }
  return value;
}

function idempotencyActor(request) {
  return request.authContext.kind === "api_key"
    ? `api:${request.authContext.apiKeyId}`
    : `user:${request.authContext.userId}`;
}

async function claimIdempotency(client, request, key, payload) {
  const actorKey = idempotencyActor(request);
  const requestHash = hashRequest(payload);
  const claimed = await client.query(
    `insert into api_idempotency_keys
      (api_key_id, actor_key, idempotency_key, request_hash)
     values ($1, $2, $3, $4)
     on conflict do nothing
     returning actor_key`,
    [request.authContext.apiKeyId ?? null, actorKey, key, requestHash],
  );
  if (claimed.rowCount > 0) return { actorKey, requestHash };

  const existing = await client.query(
    `select request_hash, status_code, response_body, locked_until
     from api_idempotency_keys
     where actor_key = $1 and idempotency_key = $2
     for update`,
    [actorKey, key],
  );
  const record = existing.rows[0];
  if (!record || record.request_hash !== requestHash) {
    return { error: "idempotency_key_reused" };
  }
  if (record.response_body && record.status_code) {
    return {
      replay: {
        statusCode: record.status_code,
        body: record.response_body,
      },
    };
  }
  if (new Date(record.locked_until).getTime() > Date.now()) {
    return { error: "request_in_progress" };
  }
  await client.query(
    `update api_idempotency_keys
     set locked_until = now() + interval '2 minutes'
     where actor_key = $1 and idempotency_key = $2`,
    [actorKey, key],
  );
  return { actorKey, requestHash };
}

async function completeIdempotency(
  client,
  actorKey,
  key,
  statusCode,
  response,
  resourceType,
  resourceId,
) {
  await client.query(
    `update api_idempotency_keys
     set status_code = $3, response_body = $4, resource_type = $5,
         resource_id = $6, completed_at = now()
     where actor_key = $1 and idempotency_key = $2`,
    [
      actorKey,
      key,
      statusCode,
      JSON.stringify(response),
      resourceType,
      resourceId,
    ],
  );
}

async function loadPost(workspaceId, transmissionId) {
  const transmission = await postgres.query(
    `select * from transmissions where id = $1 and workspace_id = $2`,
    [transmissionId, workspaceId],
  );
  if (!transmission.rows[0]) return undefined;
  const projections = await postgres.query(
    `select * from projections
     where transmission_id = $1 and workspace_id = $2
     order by created_at asc`,
    [transmissionId, workspaceId],
  );
  return publicPost(transmission.rows[0], projections.rows);
}

function publicAgentChat(row) {
  return {
    id: row.id,
    title: row.title,
    messageCount: Number(row.message_count ?? 0),
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function chatTitle(value) {
  if (value === undefined) return "New chat";
  if (typeof value !== "string") throw new Error("Chat title must be text");
  const title = value.trim();
  if (!title || title.length > 120) throw new Error("Chat title must be between 1 and 120 characters");
  return title;
}

async function dispatchOutbox() {
  await ensureTemporal();
  const client = await postgres.connect();
  try {
    await client.query("begin");
    const pending = await client.query(
      `select id, aggregate_id, event_type, payload
       from outbox_events
       where processed_at is null
         and event_type in (
           'publication.requested',
           'publication.cancel_requested',
           'publication.reschedule_requested',
           'transmission.analytics_index_requested'
         )
       order by id asc
       for update skip locked
       limit 20`,
    );

    for (const event of pending.rows) {
      try {
        if (event.event_type === "publication.requested") {
          const workflowId =
            event.payload.workflowId ?? `publication:${event.aggregate_id}:${event.id}`;
          await temporalClient.workflow.start("publicationWorkflow", {
            taskQueue: env.TEMPORAL_TASK_QUEUE ?? "posterract-publishing",
            workflowId,
            args: [
              {
                transmissionId: event.aggregate_id,
                projectionIds: event.payload.projectionIds,
              },
            ],
          });
        } else if (event.event_type === "publication.cancel_requested") {
          const workflowId = event.payload.workflowId;
          if (workflowId) {
            await temporalClient.workflow
              .getHandle(workflowId)
              .signal("cancelPublication");
          }
        } else if (event.event_type === "publication.reschedule_requested") {
          const workflowId = event.payload.workflowId;
          const scheduledFor = Number(event.payload.scheduledFor);
          if (workflowId && Number.isFinite(scheduledFor)) {
            await temporalClient.workflow
              .getHandle(workflowId)
              .signal("reschedulePublication", scheduledFor);
          }
        } else if (event.event_type === "transmission.analytics_index_requested") {
          await temporalClient.workflow
            .getHandle("posterract:analytics:continuous")
            .signal("refreshAnalytics");
        }
        await client.query(
          `update outbox_events
           set processed_at = now(), attempts = attempts + 1, last_error = null
           where id = $1`,
          [event.id],
        );
      } catch (error) {
        if (error?.name === "WorkflowExecutionAlreadyStartedError") {
          await client.query(
            `update outbox_events
             set processed_at = now(), attempts = attempts + 1, last_error = null
             where id = $1`,
            [event.id],
          );
          continue;
        }
        await client.query(
          `update outbox_events
           set attempts = attempts + 1, last_error = $2
           where id = $1`,
          [event.id, String(error?.message ?? error).slice(0, 1_000)],
        );
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureRecurringWorkflows() {
  await ensureTemporal();
  try {
    await temporalClient.workflow.start("analyticsRefreshWorkflow", {
      taskQueue: env.TEMPORAL_TASK_QUEUE ?? "posterract-publishing",
      workflowId: "posterract:analytics:continuous",
      args: [],
    });
    app.log.info("started continuous analytics workflow");
  } catch (error) {
    if (error?.name !== "WorkflowExecutionAlreadyStartedError") throw error;
  }
}

async function handleAuthRequest(request, reply) {
  if (!auth) {
    return reply.code(503).send({ error: "postgres_auth_not_configured" });
  }
  const origin =
    env.PUBLIC_API_URL ?? `${request.protocol}://${request.headers.host}`;
  const url = new URL(request.raw.url, origin);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  const method = request.method.toUpperCase();
  const body = ["GET", "HEAD"].includes(method)
    ? undefined
    : typeof request.body === "string"
      ? request.body
      : JSON.stringify(request.body ?? {});
  const response = await auth.handler(
    new Request(url, { method, headers, body }),
  );
  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const [name, value] of response.headers.entries()) {
    if (name.toLowerCase() !== "set-cookie") reply.header(name, value);
  }
  if (setCookies.length > 0) reply.header("set-cookie", setCookies);
  return reply
    .code(response.status)
    .send(Buffer.from(await response.arrayBuffer()));
}

async function readiness() {
  const checks = await Promise.allSettled([
    postgres.query("select 1 as ok"),
    ensureRedis(),
    elasticsearch.cluster.health({ timeout: "3s" }),
    ensureTemporal(),
  ]);
  const names = ["postgres", "redis", "elasticsearch", "temporal"];
  const services = Object.fromEntries(
    checks.map((result, index) => [
      names[index],
      result.status === "fulfilled"
        ? { ok: true }
        : {
            ok: false,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : "unavailable",
          },
    ]),
  );
  return {
    ok: Object.values(services).every((service) => service.ok),
    services,
    r2: { ok: r2Configured, configured: r2Configured },
  };
}

function uploadSessionKey(uploadId) {
  return `posterract:upload:${uploadId}`;
}

async function loadUploadSession(uploadId) {
  const serialized = await redis.get(uploadSessionKey(uploadId));
  return serialized ? JSON.parse(serialized) : undefined;
}

function canAccessWorkspace(request, workspaceId) {
  return (
    request.authContext?.kind === "internal" ||
    request.authContext?.workspaceId === workspaceId
  );
}

async function purgeExpiredMedia() {
  if (!r2) return;

  const client = await postgres.connect();
  let locked = false;
  try {
    const lockResult = await client.query(
      "select pg_try_advisory_lock(721044621) as locked",
    );
    locked = lockResult.rows[0]?.locked === true;
    if (!locked) return;

    const due = await client.query(
      `select id, r2_key
       from media_assets
       where purged_at is null
         and purge_after is not null
         and purge_after <= now()
         and status in ('ready', 'attached', 'failed', 'purge_pending')
       order by purge_after asc
       limit 25`,
    );

    for (const media of due.rows) {
      try {
        await client.query(
          `update media_assets
           set status = 'purge_pending', updated_at = now()
           where id = $1`,
          [media.id],
        );
        await r2.send(
          new DeleteObjectCommand({
            Bucket: env.R2_BUCKET,
            Key: media.r2_key,
          }),
        );
        await client.query(
          `update media_assets
           set status = 'purged', purged_at = now(), updated_at = now()
           where id = $1`,
          [media.id],
        );
        app.log.info({ mediaId: media.id }, "purged unattached media");
      } catch (error) {
        await client.query(
          `update media_assets
           set status = 'purge_pending',
               purge_after = now() + interval '15 minutes',
               updated_at = now()
           where id = $1`,
          [media.id],
        );
        app.log.error(
          { err: error, mediaId: media.id },
          "media purge failed; scheduled retry",
        );
      }
    }
  } finally {
    if (locked) {
      await client.query("select pg_advisory_unlock(721044621)");
    }
    client.release();
  }
}

app.get("/health/live", async () => ({
  ok: true,
  service: "posterract-api",
}));

app.get("/health/ready", async (_request, reply) => {
  const result = await readiness();
  return reply.code(result.ok ? 200 : 503).send(result);
});

registerBillingRoutes(app, { service: billing, requireSession });
await registerStripeWebhookRoutes(app, { service: billing });

app.route({
  method: ["GET", "POST"],
  url: "/api/auth/*",
  handler: handleAuthRequest,
});

app.get("/v1/system/architecture", { preHandler: requireInternalKey }, async () => {
  const result = await readiness();
  return {
    topology: "postiz-compatible",
    services: result.services,
    r2: result.r2,
    uploadMode: "direct-r2-multipart",
    workflowEngine: "temporal",
    cache: "redis",
    sourceOfTruth: "postgresql",
    search: "elasticsearch",
  };
});

app.get("/v1/openapi.json", async () => ({
  openapi: "3.1.0",
  info: { title: "Posterract Agent API", version: "1.0.0" },
  servers: [{ url: env.PUBLIC_API_URL ?? "https://api.posterract.app" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Posterract API key" },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/v1/skills": { get: { summary: "List safe metadata for private Posterract skills" } },
    "/v1/agent-runs": { post: { summary: "Run private skills with a workspace agent credential" } },
    "/v1/agent-runs/{id}": { get: { summary: "Read an agent run and its output" } },
    "/v1/chats": {
      get: { summary: "List retained agent chats" },
      post: { summary: "Create a retained agent chat" },
    },
    "/v1/chats/{id}": { get: { summary: "Read a retained chat and its messages" } },
    "/v1/schedule": { get: { summary: "List scheduled publications in a time range" } },
    "/v1/analytics": { get: { summary: "Read approved TikTok, Instagram, Facebook, and Threads analytics" } },
    "/v1/points": { get: { summary: "Read the workspace Resonance Points balance" } },
    "/v1/points/ledger": { get: { summary: "Read the immutable points ledger" } },
    "/v1/accounts": { get: { summary: "List connected social accounts" } },
    "/v1/uploads/multipart": { post: { summary: "Start a direct R2 multipart upload" } },
    "/v1/posts": { post: { summary: "Publish now or schedule a post" } },
    "/v1/posts/{id}": { get: { summary: "Read post and per-platform status" } },
    "/v1/posts/{id}/events": { get: { summary: "Read post events" } },
    "/v1/posts/{id}/cancel": { post: { summary: "Cancel a scheduled post" } },
    "/v1/posts/{id}/reschedule": { post: { summary: "Move a scheduled post to a new date or time" } },
    "/v1/projections/{id}/retry": { post: { summary: "Retry one failed platform" } },
    "/v1/billing/config": {
      get: { summary: "Read the public live subscription catalog", security: [] },
    },
    "/v1/billing/subscription": {
      get: { summary: "Read the current workspace subscription" },
    },
    "/v1/billing/checkout": {
      post: { summary: "Create an idempotent Stripe subscription Checkout session" },
    },
    "/v1/billing/portal": {
      post: { summary: "Open Stripe billing management for the workspace" },
    },
    "/v1/webhooks/stripe": {
      get: { summary: "Check Stripe webhook readiness", security: [] },
      post: { summary: "Receive signed Stripe events", security: [] },
    },
  },
}));

app.get(
  "/v1/skills",
  { preHandler: requireScope("skills:read") },
  async () => ({ skills: listPublicSkills() }),
);

app.get(
  "/v1/chats",
  { preHandler: requireScope("runs:read") },
  async (request) => {
    const result = await postgres.query(
      `select c.id, c.title, c.created_at, c.updated_at, count(m.id)::integer as message_count
       from agent_chats c
       left join agent_chat_messages m
         on m.chat_id = c.id and m.workspace_id = c.workspace_id
       where c.workspace_id = $1 and c.archived_at is null
       group by c.id
       order by c.updated_at desc
       limit 100`,
      [requiredWorkspace(request)],
    );
    return { chats: result.rows.map(publicAgentChat) };
  },
);

app.post(
  "/v1/chats",
  { preHandler: requireScope("runs:write") },
  async (request, reply) => {
    const key = idempotencyKey(request, reply);
    if (!key) return;
    let title;
    try {
      title = chatTitle(request.body?.title);
    } catch (error) {
      return reply.code(400).send({ error: "invalid_chat", detail: error.message });
    }
    const idempotency = await claimIdempotency(postgres, request, key, {
      operation: "chat.create",
      title,
    });
    if (idempotency.error) return reply.code(409).send({ error: idempotency.error });
    if (idempotency.replay) {
      return reply
        .header("idempotent-replayed", "true")
        .code(idempotency.replay.statusCode)
        .send(idempotency.replay.body);
    }
    const created = await postgres.query(
      `insert into agent_chats (workspace_id, created_by_user_id, title)
       values ($1, $2, $3)
       returning id, title, created_at, updated_at, 0::integer as message_count`,
      [
        requiredWorkspace(request),
        request.authContext.userId ?? null,
        title,
      ],
    );
    const response = publicAgentChat(created.rows[0]);
    await completeIdempotency(postgres, idempotency.actorKey, key, 201, response, "agent_chat", response.id);
    await auditApiAction(request, "chat.create", "agent_chat", response.id).catch((error) =>
      app.log.warn({ err: error }, "chat creation audit write failed"),
    );
    return reply.code(201).send(response);
  },
);

app.get(
  "/v1/chats/:id",
  { preHandler: requireScope("runs:read") },
  async (request, reply) => {
    if (!uuidPattern.test(request.params.id)) return reply.code(400).send({ error: "invalid_chat_id" });
    const workspaceId = requiredWorkspace(request);
    const chatResult = await postgres.query(
      `select c.id, c.title, c.created_at, c.updated_at, count(m.id)::integer as message_count
       from agent_chats c
       left join agent_chat_messages m
         on m.chat_id = c.id and m.workspace_id = c.workspace_id
       where c.id = $1 and c.workspace_id = $2 and c.archived_at is null
       group by c.id`,
      [request.params.id, workspaceId],
    );
    if (!chatResult.rows[0]) return reply.code(404).send({ error: "chat_not_found" });
    const messages = await postgres.query(
      `select id, role, body, skill_ids, run_id, created_at
       from agent_chat_messages
       where chat_id = $1 and workspace_id = $2
       order by created_at asc, id asc`,
      [request.params.id, workspaceId],
    );
    return {
      chat: publicAgentChat(chatResult.rows[0]),
      messages: messages.rows.map((row) => ({
        id: row.id,
        role: row.role,
        body: row.body,
        skillIds: row.skill_ids,
        runId: row.run_id ?? undefined,
        at: new Date(row.created_at).getTime(),
      })),
    };
  },
);

app.get(
  "/v1/agent-credentials",
  { preHandler: requireSession },
  async (request) => {
    const result = await postgres.query(
      `select id, provider, label, model, secret_hint, status, last_validated_at, created_at
       from agent_credentials
       where workspace_id = $1 and status <> 'revoked'
       order by created_at desc`,
      [requiredWorkspace(request)],
    );
    return {
      credentials: result.rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        label: row.label,
        model: row.model,
        lastFour: row.secret_hint,
        status: row.status,
        connectedAt: new Date(row.created_at).getTime(),
        lastValidatedAt: row.last_validated_at ? new Date(row.last_validated_at).getTime() : undefined,
      })),
    };
  },
);

app.post(
  "/v1/agent-credentials",
  { preHandler: requireSession },
  async (request, reply) => {
    let input;
    try {
      input = validateAgentCredentialInput(request.body);
      await validateProviderCredential({
        provider: input.provider,
        secret: input.secret,
        signal: request.raw.signal,
      });
    } catch (error) {
      return reply.code(400).send({ error: "agent_credential_invalid", detail: error.message });
    }
    const inserted = await postgres.query(
      `insert into agent_credentials
        (workspace_id, provider, label, model, secret_hint, secret_ciphertext, last_validated_at)
       values ($1, $2, $3, $4, $5, $6, now())
       returning id, provider, label, model, secret_hint, status, last_validated_at, created_at`,
      [
        requiredWorkspace(request),
        input.provider,
        input.label,
        input.model,
        input.secret.slice(-4).padStart(4, "•"),
        encryptSecret(input.secret),
      ],
    );
    const row = inserted.rows[0];
    return reply.code(201).send({
      id: row.id,
      provider: row.provider,
      label: row.label,
      model: row.model,
      lastFour: row.secret_hint,
      status: row.status,
      connectedAt: new Date(row.created_at).getTime(),
    });
  },
);

app.delete(
  "/v1/agent-credentials/:id",
  { preHandler: requireSession },
  async (request, reply) => {
    const result = await postgres.query(
      `update agent_credentials
       set status = 'revoked', secret_ciphertext = $3, updated_at = now()
       where id = $1 and workspace_id = $2 and status <> 'revoked'
       returning id`,
      [request.params.id, requiredWorkspace(request), encryptSecret(`revoked:${randomUUID()}`)],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: "agent_credential_not_found" });
    return reply.code(204).send();
  },
);

app.post(
  "/v1/agent-runs",
  { preHandler: requireScope("runs:write") },
  async (request, reply) => {
    const key = idempotencyKey(request, reply);
    if (!key) return;
    const workspaceId = requiredWorkspace(request);
    const credentialId = request.body?.credentialId;
    if (credentialId !== undefined && (typeof credentialId !== "string" || !uuidPattern.test(credentialId))) {
      return reply.code(400).send({ error: "invalid_agent_credential_id" });
    }
    const chatId = request.body?.chatId;
    if (chatId !== undefined && (typeof chatId !== "string" || !uuidPattern.test(chatId))) {
      return reply.code(400).send({ error: "invalid_chat_id" });
    }
    let runInput;
    try {
      runInput = validateAgentRunInput(request.body);
    } catch (error) {
      return reply.code(400).send({ error: "invalid_agent_run", detail: error.message });
    }
    const credentialResult = await postgres.query(
      `select id, provider, model, secret_ciphertext
       from agent_credentials
       where workspace_id = $1
         and status = 'connected'
         and ($2::uuid is null or id = $2)
       order by created_at asc
       limit 1`,
      [workspaceId, credentialId ?? null],
    );
    const credential = credentialResult.rows[0];
    if (!credential) return reply.code(409).send({ error: "agent_credential_required" });
    if (chatId) {
      const chat = await postgres.query(
        `select id from agent_chats
         where id = $1 and workspace_id = $2 and archived_at is null`,
        [chatId, workspaceId],
      );
      if (!chat.rows[0]) return reply.code(404).send({ error: "chat_not_found" });
    }
    const { skillIds, message } = runInput;
    const source = request.authContext.kind === "api_key" ? "api" : "ui";
    const idempotency = await claimIdempotency(postgres, request, key, {
      operation: "agent.run",
      credentialId: credential.id,
      chatId,
      skillIds,
      message,
    });
    if (idempotency.error) return reply.code(409).send({ error: idempotency.error });
    if (idempotency.replay) {
      return reply
        .header("idempotent-replayed", "true")
        .code(idempotency.replay.statusCode)
        .send(idempotency.replay.body);
    }
    const created = await postgres.query(
      `insert into agent_runs
        (workspace_id, credential_id, api_key_id, user_id, provider, model, skill_ids, input, status, source, chat_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'running', $9, $10)
       returning id, created_at`,
      [
        workspaceId,
        credential.id,
        request.authContext.apiKeyId ?? null,
        request.authContext.userId ?? null,
        credential.provider,
        credential.model,
        Array.isArray(skillIds) ? skillIds : [],
        { message },
        source,
        chatId ?? null,
      ],
    );
    const run = created.rows[0];
    let modelMessage = message;
    if (chatId) {
      const priorMessages = await postgres.query(
        `select role, right(body, 4000) as body
         from agent_chat_messages
         where chat_id = $1 and workspace_id = $2
         order by created_at desc, id desc
         limit 8`,
        [chatId, workspaceId],
      );
      modelMessage = [
        ...priorMessages.rows.reverse().map((item) => `${item.role === "user" ? "USER" : "ASSISTANT"}: ${item.body}`),
        `USER: ${message}`,
      ].join("\n\n");
      await postgres.query(
        `insert into agent_chat_messages
          (chat_id, workspace_id, run_id, role, body, skill_ids)
         values ($1, $2, $3, 'user', $4, $5)`,
        [chatId, workspaceId, run.id, message, skillIds],
      );
      await postgres.query(
        `update agent_chats
         set title = case when title = 'New chat' then left($3, 80) else title end,
             updated_at = now()
         where id = $1 and workspace_id = $2`,
        [chatId, workspaceId, message],
      );
    }
    try {
      const result = await executeAgentRun({
        credential,
        skillIds,
        message: modelMessage,
        signal: request.raw.signal,
      });
      await postgres.query(
        `update agent_runs
         set status = 'completed', output = $2, skill_versions = $3, completed_at = now()
         where id = $1`,
        [run.id, { text: result.output }, result.versions],
      );
      if (chatId) {
        await postgres.query(
          `insert into agent_chat_messages
            (chat_id, workspace_id, run_id, role, body, skill_ids)
           values ($1, $2, $3, 'agent', $4, $5)`,
          [chatId, workspaceId, run.id, result.output, skillIds],
        );
        await postgres.query(
          `update agent_chats set updated_at = now()
           where id = $1 and workspace_id = $2`,
          [chatId, workspaceId],
        );
      }
      const response = {
        id: run.id,
        chatId,
        status: "completed",
        source,
        provider: credential.provider,
        model: credential.model,
        skillIds,
        skillVersions: result.versions,
        output: { text: result.output },
        createdAt: new Date(run.created_at).getTime(),
      };
      await completeIdempotency(postgres, idempotency.actorKey, key, 201, response, "agent_run", run.id);
      await auditApiAction(request, "agent.run", "agent_run", run.id, { skillIds }).catch((error) =>
        app.log.warn({ err: error }, "agent run audit write failed"),
      );
      return reply.code(201).send(response);
    } catch (error) {
      const summary = error instanceof Error ? error.message.slice(0, 300) : "Agent run failed";
      await postgres.query(
        `update agent_runs set status = 'failed', error_summary = $2, completed_at = now() where id = $1`,
        [run.id, summary],
      );
      const response = { error: "agent_run_failed", detail: summary, runId: run.id };
      await completeIdempotency(postgres, idempotency.actorKey, key, 502, response, "agent_run", run.id);
      return reply.code(502).send(response);
    }
  },
);

app.get(
  "/v1/agent-runs/:id",
  { preHandler: requireScope("runs:read") },
  async (request, reply) => {
    const result = await postgres.query(
      `select id, chat_id, provider, model, skill_ids, skill_versions, input, output, status, source,
              error_summary, created_at, completed_at
       from agent_runs
       where id = $1 and workspace_id = $2`,
      [request.params.id, requiredWorkspace(request)],
    );
    const row = result.rows[0];
    if (!row) return reply.code(404).send({ error: "agent_run_not_found" });
    return {
      id: row.id,
      chatId: row.chat_id ?? undefined,
      provider: row.provider,
      model: row.model,
      skillIds: row.skill_ids,
      skillVersions: row.skill_versions,
      input: row.input,
      output: row.output,
      status: row.status,
      source: row.source,
      error: row.error_summary,
      createdAt: new Date(row.created_at).getTime(),
      completedAt: row.completed_at ? new Date(row.completed_at).getTime() : undefined,
    };
  },
);

app.get(
  "/v1/api-keys",
  { preHandler: requireSession },
  async (request) => {
    return { keys: await loadWorkspaceApiKeys(postgres, requiredWorkspace(request)) };
  },
);

app.post(
  "/v1/api-keys",
  { preHandler: requireSession },
  async (request, reply) => {
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    const scopes = Array.isArray(request.body?.scopes) ? [...new Set(request.body.scopes)] : [];
    if (!name || name.length > 80) return reply.code(400).send({ error: "invalid_api_key_name" });
    if (scopes.length === 0 || scopes.some((scope) => !agentApiScopes.has(scope))) {
      return reply.code(400).send({ error: "invalid_api_key_scopes" });
    }
    const tokenPrefix = randomBytes(4).toString("hex");
    const secret = `pr_live_${tokenPrefix}_${randomBytes(32).toString("base64url")}`;
    const result = await postgres.query(
      `insert into api_keys (workspace_id, name, key_prefix, secret_hash, scopes)
       values ($1, $2, $3, $4, $5)
       returning id, name, key_prefix, scopes, created_at`,
      [requiredWorkspace(request), name, `pr_live_${tokenPrefix}`, hashApiKey(secret), scopes],
    );
    const row = result.rows[0];
    return reply.code(201).send({
      id: row.id,
      name: row.name,
      prefix: row.key_prefix,
      scopes: row.scopes,
      secret,
      createdAt: new Date(row.created_at).getTime(),
      stats: { apiActions: 0, postsCreated: 0, postsScheduled: 0, postsPublished: 0 },
    });
  },
);

app.delete(
  "/v1/api-keys/:id",
  { preHandler: requireSession },
  async (request, reply) => {
    const result = await postgres.query(
      `update api_keys set revoked_at = now()
       where id = $1 and workspace_id = $2 and revoked_at is null
       returning id`,
      [request.params.id, requiredWorkspace(request)],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: "api_key_not_found" });
    return reply.code(204).send();
  },
);

app.get(
  "/v1/accounts",
  { preHandler: requireScope("accounts:read") },
  async (request) => {
    const workspaceId = requiredWorkspace(request);
    const result = await postgres.query(
      `select id, provider, provider_account_id, handle, display_name,
              avatar_url, status, scopes, token_expires_at,
              last_health_check_at, metadata
       from social_accounts
       where workspace_id = $1
       order by array_position($2::text[], provider), created_at asc`,
      [workspaceId, PLATFORM_IDS],
    );
    return {
      accounts: result.rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        providerAccountId: row.provider_account_id,
        handle: row.handle,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        status: row.status,
        scopes: row.scopes,
        tokenExpiresAt: row.token_expires_at,
        lastHealthCheckAt: row.last_health_check_at,
        capabilities: row.metadata?.capabilities ?? {},
      })),
    };
  },
);

registerOAuthRoutes(app, { postgres, requireScope, requiredWorkspace });
registerMetaRoutes(app, { postgres });

app.get(
  "/v1/analytics",
  { preHandler: requireScope("analytics:read") },
  async (request, reply) => {
    const rangeDays = Number(request.query?.rangeDays ?? 30);
    if (![7, 30, 90].includes(rangeDays)) {
      return reply.code(400).send({ error: "invalid_analytics_range" });
    }
    return loadAnalyticsDashboard(
      postgres,
      requiredWorkspace(request),
      rangeDays,
    );
  },
);

app.get(
  "/v1/schedule",
  { preHandler: requireScope("posts:read") },
  async (request, reply) => {
    const from = new Date(request.query?.from ?? Date.now() - 86_400_000);
    const to = new Date(request.query?.to ?? Date.now() + 30 * 86_400_000);
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(to.getTime()) ||
      from >= to ||
      to.getTime() - from.getTime() > 180 * 86_400_000
    ) {
      return reply.code(400).send({ error: "invalid_schedule_range" });
    }
    const transmissions = await postgres.query(
      `select * from transmissions
       where workspace_id = $1
         and scheduled_for >= $2
         and scheduled_for < $3
         and status in ('scheduled', 'transmitting', 'live', 'partial', 'failed')
       order by scheduled_for asc, id asc`,
      [requiredWorkspace(request), from, to],
    );
    if (transmissions.rows.length === 0) return { transmissions: [] };
    const projections = await postgres.query(
      `select * from projections
       where transmission_id = any($1::uuid[])
       order by created_at asc`,
      [transmissions.rows.map((row) => row.id)],
    );
    const byTransmission = new Map();
    for (const projection of projections.rows) {
      const rows = byTransmission.get(projection.transmission_id) ?? [];
      rows.push(projection);
      byTransmission.set(projection.transmission_id, rows);
    }
    return {
      transmissions: transmissions.rows.map((row) =>
        publicPost(row, byTransmission.get(row.id) ?? []),
      ),
    };
  },
);

app.get(
  "/v1/points",
  { preHandler: requireScope("points:read") },
  async (request) => {
    const workspaceId = requiredWorkspace(request);
    const result = await postgres.query(
      `select coalesce(s.lifetime_rp, sum(l.amount), 0) as lifetime_rp,
              coalesce(s.week_rp, sum(l.amount) filter (where l.awarded_at >= date_trunc('week', now())), 0) as week_rp,
              coalesce(s.streak_days, 0) as streak_days,
              coalesce(s.badges, '{}') as badges
       from points_ledger l
       full join user_stats s on s.workspace_id = l.workspace_id
       where coalesce(l.workspace_id, s.workspace_id) = $1
       group by s.lifetime_rp, s.week_rp, s.streak_days, s.badges`,
      [workspaceId],
    );
    const row = result.rows[0] ?? {};
    return {
      lifetimeRP: Number(row.lifetime_rp ?? 0),
      weekRP: Number(row.week_rp ?? 0),
      streakDays: Number(row.streak_days ?? 0),
      badges: row.badges ?? [],
    };
  },
);

app.get(
  "/v1/points/ledger",
  { preHandler: requireScope("points:read") },
  async (request, reply) => {
    const limit = Math.min(100, Math.max(1, Number(request.query?.limit ?? 30)));
    if (!Number.isInteger(limit)) return reply.code(400).send({ error: "invalid_limit" });
    const beforeValue = request.query?.before;
    const before = beforeValue ? new Date(beforeValue) : undefined;
    if (before && !Number.isFinite(before.getTime())) {
      return reply.code(400).send({ error: "invalid_cursor" });
    }
    const result = await postgres.query(
      `select id, source, amount, reference_id, note, awarded_at
       from points_ledger
       where workspace_id = $1
         and ($2::timestamptz is null or awarded_at < $2)
       order by awarded_at desc, id desc
       limit $3`,
      [requiredWorkspace(request), before ?? null, limit],
    );
    return {
      entries: result.rows.map((row) => ({
        id: String(row.id),
        source: row.source,
        amount: Number(row.amount),
        referenceId: row.reference_id ?? undefined,
        note: row.note ?? undefined,
        awardedAt: new Date(row.awarded_at).getTime(),
      })),
      nextCursor:
        result.rows.length === limit
          ? new Date(result.rows.at(-1).awarded_at).toISOString()
          : undefined,
    };
  },
);

app.get(
  "/v1/bootstrap",
  { preHandler: requireSession },
  async (request) => {
    const workspaceId = requiredWorkspace(request);
    const [
      mediaResult,
      transmissionsResult,
      projectionsResult,
      eventsResult,
      accountsResult,
      pointsResult,
      statsResult,
    ] =
      await Promise.all([
        postgres.query(
          `select * from media_assets
           where workspace_id = $1 and status <> 'purged'
           order by created_at desc`,
          [workspaceId],
        ),
        postgres.query(
          `select * from transmissions
           where workspace_id = $1 order by created_at desc`,
          [workspaceId],
        ),
        postgres.query(
          `select * from projections
           where workspace_id = $1 order by created_at desc`,
          [workspaceId],
        ),
        postgres.query(
          `select * from events
           where workspace_id = $1 order by occurred_at desc, id desc limit 500`,
          [workspaceId],
        ),
        postgres.query(
          `select * from social_accounts
           where workspace_id = $1 order by created_at asc`,
          [workspaceId],
        ),
        postgres.query(
          `select *,
                  sum(amount) over () as lifetime_rp,
                  sum(amount) filter (where awarded_at >= date_trunc('week', now())) over () as week_rp
           from points_ledger
           where workspace_id = $1
           order by awarded_at desc limit 50`,
          [workspaceId],
        ),
        postgres.query(
          `select lifetime_rp, week_rp, streak_days, badges
           from user_stats where workspace_id = $1`,
          [workspaceId],
        ),
      ]);

    const artifacts = await Promise.all(
      mediaResult.rows.map(async (row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        fileName: row.original_filename,
        r2Key: row.r2_key,
        publicUrl:
          r2 && !["purged", "aborted"].includes(row.status)
            ? await getSignedUrl(
                r2,
                new GetObjectCommand({
                  Bucket: env.R2_BUCKET,
                  Key: row.r2_key,
                }),
                { expiresIn: Number(env.R2_SIGNED_DOWNLOAD_TTL_SECONDS ?? 3_600) },
              )
            : undefined,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        durationMs: row.duration_ms ?? undefined,
        width: row.width ?? undefined,
        height: row.height ?? undefined,
        status: ["ready", "attached", "scheduled", "publishing"].includes(row.status)
          ? "ready"
          : row.status === "uploading"
            ? "uploading"
            : "failed",
        createdAt: new Date(row.created_at).getTime(),
      })),
    );
    const recentPoints = pointsResult.rows.map((row) => ({
      id: String(row.id),
      source: row.source,
      amount: row.amount,
      note: row.note ?? undefined,
      at: new Date(row.awarded_at).getTime(),
    }));
    return {
      workspaceId,
      artifacts,
      transmissions: transmissionsResult.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        title: row.title,
        baseCaption: row.base_caption,
        hashtags: row.hashtags,
        artifactId: row.media_asset_id ?? undefined,
        status: row.status,
        scheduleMode: row.schedule_mode,
        scheduledFor: row.scheduled_for
          ? new Date(row.scheduled_for).getTime()
          : undefined,
        source: row.source === "api" ? "api" : "ui",
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
      })),
      projections: projectionsResult.rows.map((row) => ({
        id: row.id,
        transmissionId: row.transmission_id,
        workspaceId: row.workspace_id,
        portalId: row.social_account_id ?? "",
        provider: row.provider,
        caption: row.caption,
        hashtags: row.hashtags,
        platformOptions: row.platform_options,
        status: row.status,
        attemptCount: row.attempt_count,
        nextAttemptAt: row.next_attempt_at
          ? new Date(row.next_attempt_at).getTime()
          : undefined,
        platformMediaId: row.platform_media_id ?? undefined,
        platformPostId: row.platform_post_id ?? undefined,
        platformPostUrl: row.platform_post_url ?? undefined,
        errorCategory: row.error_category ?? undefined,
        errorSummary: row.error_summary ?? undefined,
        updatedAt: new Date(row.updated_at).getTime(),
      })),
      events: eventsResult.rows.map((row) => ({
        id: String(row.id),
        workspaceId: row.workspace_id,
        transmissionId: row.transmission_id ?? undefined,
        projectionId: row.projection_id ?? undefined,
        type: row.type,
        message: row.message,
        at: new Date(row.occurred_at).getTime(),
      })),
      portals: accountsResult.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        provider: row.provider,
        providerAccountId: row.provider_account_id ?? "",
        handle: row.handle,
        displayName: row.display_name ?? undefined,
        avatarUrl: row.avatar_url ?? undefined,
        scopes: row.scopes,
        status: row.status,
        tokenExpiresAt: row.token_expires_at
          ? new Date(row.token_expires_at).getTime()
          : undefined,
        lastHealthCheckAt: row.last_health_check_at
          ? new Date(row.last_health_check_at).getTime()
          : undefined,
        windowUsage: row.metadata?.windowUsage,
      })),
      points: {
        lifetimeRP: Number(
          statsResult.rows[0]?.lifetime_rp ??
            pointsResult.rows[0]?.lifetime_rp ??
            0,
        ),
        weekRP: Number(
          statsResult.rows[0]?.week_rp ?? pointsResult.rows[0]?.week_rp ?? 0,
        ),
        streakDays: Number(statsResult.rows[0]?.streak_days ?? 0),
        badges: statsResult.rows[0]?.badges ?? [],
        recent: recentPoints,
      },
    };
  },
);

app.patch(
  "/v1/media/:id",
  { preHandler: requireMediaWrite },
  async (request, reply) => {
    const workspaceId = requiredWorkspace(request);
    const fileName = request.body?.fileName;
    if (typeof fileName !== "string" || fileName.trim().length === 0 || fileName.length > 512) {
      return reply.code(400).send({ error: "invalid_file_name" });
    }
    const updated = await postgres.query(
      `update media_assets
       set original_filename = $3, updated_at = now()
       where id = $1 and workspace_id = $2 and purged_at is null
       returning id, original_filename`,
      [request.params.id, workspaceId, fileName.trim()],
    );
    if (!updated.rows[0]) return reply.code(404).send({ error: "media_not_found" });
    return { id: updated.rows[0].id, fileName: updated.rows[0].original_filename };
  },
);

app.delete(
  "/v1/media/:id",
  { preHandler: requireMediaWrite },
  async (request, reply) => {
    const workspaceId = requiredWorkspace(request);
    const media = await postgres.query(
      `select m.id, m.r2_key,
              exists (
                select 1 from transmissions t
                where t.media_asset_id = m.id
                  and t.status in ('scheduled', 'transmitting')
              ) as in_use
       from media_assets m
       where m.id = $1 and m.workspace_id = $2 and m.purged_at is null`,
      [request.params.id, workspaceId],
    );
    if (!media.rows[0]) return reply.code(404).send({ error: "media_not_found" });
    if (media.rows[0].in_use) {
      return reply.code(409).send({ error: "media_in_use" });
    }
    if (r2) {
      await r2.send(
        new DeleteObjectCommand({
          Bucket: env.R2_BUCKET,
          Key: media.rows[0].r2_key,
        }),
      );
    }
    await postgres.query(
      `update media_assets
       set status = 'purged', purged_at = now(), updated_at = now()
       where id = $1`,
      [request.params.id],
    );
    return reply.code(204).send();
  },
);

app.post(
  "/v1/posts",
  { preHandler: requireScope("posts:write") },
  async (request, reply) => {
    const key = idempotencyKey(request, reply);
    if (!key) return;
    const workspaceId = requiredWorkspace(request);
    let input;
    try {
      input = parseCreatePost(request.body);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return reply.code(400).send({
          error: error.code,
          details: error.details,
        });
      }
      throw error;
    }
    const requestHash = hashRequest(request.body);
    const actorKey = idempotencyActor(request);
    const source = request.authContext.kind === "api_key" ? "api" : "ui";
    const client = await postgres.connect();
    let response;
    try {
      await client.query("begin");
      const claimed = await client.query(
        `insert into api_idempotency_keys
          (api_key_id, actor_key, idempotency_key, request_hash)
         values ($1, $2, $3, $4)
         on conflict do nothing
         returning actor_key`,
        [request.authContext.apiKeyId ?? null, actorKey, key, requestHash],
      );
      if (claimed.rowCount === 0) {
        const existing = await client.query(
          `select request_hash, status_code, response_body, locked_until
           from api_idempotency_keys
           where actor_key = $1 and idempotency_key = $2
           for update`,
          [actorKey, key],
        );
        const record = existing.rows[0];
        if (record.request_hash !== requestHash) {
          await client.query("rollback");
          return reply.code(409).send({ error: "idempotency_key_reused" });
        }
        if (record.response_body && record.status_code) {
          await client.query("commit");
          return reply
            .header("idempotent-replayed", "true")
            .code(record.status_code)
            .send(record.response_body);
        }
        if (new Date(record.locked_until).getTime() > Date.now()) {
          await client.query("rollback");
          return reply.code(409).send({ error: "request_in_progress" });
        }
        await client.query(
          `update api_idempotency_keys
           set locked_until = now() + interval '2 minutes'
           where actor_key = $1 and idempotency_key = $2`,
          [actorKey, key],
        );
      }

      const media = await client.query(
        `select id, status from media_assets
         where id = $1 and workspace_id = $2
         for update`,
        [input.artifactId, workspaceId],
      );
      if (!media.rows[0] || !["ready", "attached"].includes(media.rows[0].status)) {
        await client.query("rollback");
        return reply.code(409).send({ error: "media_not_ready" });
      }

      const providers = input.projections.map((item) => item.provider);
      const accounts = await client.query(
        `select distinct on (provider) id, provider
         from social_accounts
         where workspace_id = $1
           and status = 'connected'
           and provider = any($2::text[])
         order by provider, updated_at desc`,
        [workspaceId, providers],
      );
      const accountByProvider = new Map(
        accounts.rows.map((account) => [account.provider, account.id]),
      );
      const unavailable = providers.filter(
        (provider) => !accountByProvider.has(provider),
      );
      if (unavailable.length > 0) {
        await client.query("rollback");
        return reply.code(409).send({
          error: "account_not_connected",
          platforms: unavailable,
        });
      }

      const transmissionId = randomUUID();
      const workflowId = `publication:${transmissionId}:initial`;
      await client.query(
        `insert into transmissions
          (id, workspace_id, media_asset_id, title, base_caption, hashtags,
           status, schedule_mode, scheduled_for, source, temporal_workflow_id)
         values ($1, $2, $3, $4, $5, $6, 'scheduled', $7, $8, $9, $10)`,
        [
          transmissionId,
          workspaceId,
          input.artifactId,
          input.title,
          input.caption,
          input.hashtags,
          input.scheduleMode,
          input.scheduledFor,
          source,
          workflowId,
        ],
      );

      const projections = [];
      for (const projection of input.projections) {
        const projectionId = randomUUID();
        await client.query(
          `insert into projections
            (id, transmission_id, workspace_id, social_account_id, provider,
             caption, hashtags, platform_options, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled')`,
          [
            projectionId,
            transmissionId,
            workspaceId,
            accountByProvider.get(projection.provider),
            projection.provider,
            projection.caption,
            projection.hashtags,
            JSON.stringify(projection.options),
          ],
        );
        projections.push({
          id: projectionId,
          provider: projection.provider,
          status: "scheduled",
        });
      }

      await client.query(
        `update media_assets
         set status = 'scheduled', purge_after = null, updated_at = now()
         where id = $1`,
        [input.artifactId],
      );
      await client.query(
        `insert into events
          (workspace_id, transmission_id, type, message, payload)
         values ($1, $2, 'transmission.scheduled', $3, $4)`,
        [
          workspaceId,
          transmissionId,
          input.scheduleMode === "now"
            ? "Post accepted for immediate publishing"
            : "Post scheduled",
          JSON.stringify({ providers, source }),
        ],
      );
      await client.query(
        `insert into outbox_events
          (aggregate_type, aggregate_id, event_type, payload)
         values ('transmission', $1, 'publication.requested', $2)`,
        [transmissionId, JSON.stringify({ workflowId })],
      );

      response = {
        id: transmissionId,
        transmissionId,
        status: "scheduled",
        scheduledFor: input.scheduledFor.toISOString(),
        projections: projections.map((projection) => ({
          ...projection,
          projectionId: projection.id,
        })),
      };
      await client.query(
        `update api_idempotency_keys
         set status_code = 202, response_body = $3, resource_type = 'transmission',
             resource_id = $4, completed_at = now()
         where actor_key = $1 and idempotency_key = $2`,
        [
          actorKey,
          key,
          JSON.stringify(response),
          transmissionId,
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    await auditApiAction(
      request,
      "post.create",
      "transmission",
      response.id,
      { platforms: response.projections.map((item) => item.provider) },
    ).catch((error) => app.log.warn({ err: error }, "API audit write failed"));
    void dispatchOutbox().catch((error) =>
      app.log.warn({ err: error }, "immediate outbox dispatch failed"),
    );
    return reply.code(202).send(response);
  },
);

app.get(
  "/v1/posts",
  { preHandler: requireScope("posts:read") },
  async (request, reply) => {
    const workspaceId = requiredWorkspace(request);
    const limit = Math.min(100, Math.max(1, Number(request.query?.limit ?? 25)));
    if (!Number.isInteger(limit)) {
      return reply.code(400).send({ error: "invalid_limit" });
    }
    const allowedStatuses = new Set([
      "draft",
      "scheduled",
      "transmitting",
      "live",
      "partial",
      "failed",
      "canceled",
    ]);
    const status = request.query?.status;
    if (status !== undefined && !allowedStatuses.has(status)) {
      return reply.code(400).send({ error: "invalid_status" });
    }
    const beforeValue = request.query?.before;
    const before = beforeValue ? new Date(beforeValue) : undefined;
    if (before && !Number.isFinite(before.getTime())) {
      return reply.code(400).send({ error: "invalid_cursor" });
    }
    const transmissions = await postgres.query(
      `select * from transmissions
       where workspace_id = $1
         and ($2::text is null or status = $2)
         and ($3::timestamptz is null or created_at < $3)
       order by created_at desc, id desc
       limit $4`,
      [workspaceId, status ?? null, before ?? null, limit],
    );
    if (transmissions.rows.length === 0) return { posts: [] };
    const projections = await postgres.query(
      `select * from projections
       where transmission_id = any($1::uuid[])
       order by created_at asc`,
      [transmissions.rows.map((row) => row.id)],
    );
    const projectionsByTransmission = new Map();
    for (const projection of projections.rows) {
      const rows = projectionsByTransmission.get(projection.transmission_id) ?? [];
      rows.push(projection);
      projectionsByTransmission.set(projection.transmission_id, rows);
    }
    return {
      posts: transmissions.rows.map((transmission) =>
        publicPost(
          transmission,
          projectionsByTransmission.get(transmission.id) ?? [],
        ),
      ),
      nextCursor:
        transmissions.rows.length === limit
          ? new Date(transmissions.rows.at(-1).created_at).toISOString()
          : undefined,
    };
  },
);

app.post(
  "/v1/posts/:id/duplicate",
  { preHandler: requireScope("posts:write") },
  async (request, reply) => {
    const key = idempotencyKey(request, reply);
    if (!key) return;
    const workspaceId = requiredWorkspace(request);
    const client = await postgres.connect();
    let response;
    try {
      await client.query("begin");
      const idempotency = await claimIdempotency(client, request, key, {
        operation: "post.duplicate",
        transmissionId: request.params.id,
      });
      if (idempotency.error) {
        await client.query("rollback");
        return reply.code(409).send({ error: idempotency.error });
      }
      if (idempotency.replay) {
        await client.query("commit");
        return reply
          .header("idempotent-replayed", "true")
          .code(idempotency.replay.statusCode)
          .send(idempotency.replay.body);
      }

      const originalResult = await client.query(
        `select * from transmissions
         where id = $1 and workspace_id = $2`,
        [request.params.id, workspaceId],
      );
      const original = originalResult.rows[0];
      if (!original) {
        await client.query("rollback");
        return reply.code(404).send({ error: "post_not_found" });
      }
      if (!original.media_asset_id) {
        await client.query("rollback");
        return reply.code(409).send({ error: "post_has_no_media" });
      }
      const originalProjections = await client.query(
        `select * from projections where transmission_id = $1 order by created_at asc`,
        [original.id],
      );
      if (originalProjections.rows.length === 0) {
        await client.query("rollback");
        return reply.code(409).send({ error: "post_has_no_platforms" });
      }
      const providers = originalProjections.rows.map((row) => row.provider);
      const accounts = await client.query(
        `select id, provider from social_accounts
         where workspace_id = $1 and provider = any($2::text[])
           and status = 'connected'`,
        [workspaceId, providers],
      );
      const accountByProvider = new Map(
        accounts.rows.map((row) => [row.provider, row.id]),
      );
      const unavailable = providers.filter(
        (provider) => !accountByProvider.has(provider),
      );
      if (unavailable.length > 0) {
        await client.query("rollback");
        return reply.code(409).send({
          error: "account_not_connected",
          platforms: unavailable,
        });
      }

      const transmissionId = randomUUID();
      const workflowId = `publication:${transmissionId}:initial`;
      const scheduledFor = new Date(Date.now() + 60 * 60_000);
      const source = request.authContext.kind === "api_key" ? "api" : "ui";
      await client.query(
        `insert into transmissions
          (id, workspace_id, media_asset_id, title, base_caption, hashtags,
           status, schedule_mode, scheduled_for, source, temporal_workflow_id)
         values ($1, $2, $3, $4, $5, $6, 'scheduled', 'at', $7, $8, $9)`,
        [
          transmissionId,
          workspaceId,
          original.media_asset_id,
          `${original.title} copy`.slice(0, 200),
          original.base_caption,
          original.hashtags,
          scheduledFor,
          source,
          workflowId,
        ],
      );
      const projections = [];
      for (const originalProjection of originalProjections.rows) {
        const projectionId = randomUUID();
        await client.query(
          `insert into projections
            (id, transmission_id, workspace_id, social_account_id, provider,
             caption, hashtags, platform_options, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled')`,
          [
            projectionId,
            transmissionId,
            workspaceId,
            accountByProvider.get(originalProjection.provider),
            originalProjection.provider,
            originalProjection.caption,
            originalProjection.hashtags,
            originalProjection.platform_options,
          ],
        );
        projections.push({
          id: projectionId,
          projectionId,
          provider: originalProjection.provider,
          status: "scheduled",
        });
      }
      await client.query(
        `update media_assets
         set status = 'scheduled', purge_after = null, updated_at = now()
         where id = $1`,
        [original.media_asset_id],
      );
      await client.query(
        `insert into events
          (workspace_id, transmission_id, type, message, payload)
         values ($1, $2, 'transmission.scheduled', 'Post duplicated and scheduled', $3)`,
        [
          workspaceId,
          transmissionId,
          JSON.stringify({ duplicatedFrom: original.id, providers, source }),
        ],
      );
      await client.query(
        `insert into outbox_events
          (aggregate_type, aggregate_id, event_type, payload)
         values ('transmission', $1, 'publication.requested', $2)`,
        [transmissionId, JSON.stringify({ workflowId })],
      );
      response = {
        id: transmissionId,
        transmissionId,
        status: "scheduled",
        scheduledFor: scheduledFor.toISOString(),
        projections,
      };
      await completeIdempotency(
        client,
        idempotency.actorKey,
        key,
        202,
        response,
        "transmission",
        transmissionId,
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    void dispatchOutbox().catch((error) =>
      app.log.warn({ err: error }, "duplicate outbox dispatch failed"),
    );
    return reply.code(202).send(response);
  },
);

app.get(
  "/v1/posts/:id",
  { preHandler: requireScope("posts:read") },
  async (request, reply) => {
    const post = await loadPost(requiredWorkspace(request), request.params.id);
    return post ?? reply.code(404).send({ error: "post_not_found" });
  },
);

app.get(
  "/v1/posts/:id/events",
  { preHandler: requireScope("posts:read") },
  async (request, reply) => {
    const workspaceId = requiredWorkspace(request);
    const exists = await postgres.query(
      `select 1 from transmissions where id = $1 and workspace_id = $2`,
      [request.params.id, workspaceId],
    );
    if (!exists.rows[0]) return reply.code(404).send({ error: "post_not_found" });
    const events = await postgres.query(
      `select id, projection_id, type, message, payload, occurred_at
       from events
       where transmission_id = $1 and workspace_id = $2
       order by occurred_at asc, id asc`,
      [request.params.id, workspaceId],
    );
    return {
      events: events.rows.map((event) => ({
        id: String(event.id),
        projectionId: event.projection_id,
        type: event.type,
        message: event.message,
        metadata: event.payload,
        occurredAt: event.occurred_at,
      })),
    };
  },
);

app.post(
  "/v1/posts/:id/reschedule",
  { preHandler: requireScope("posts:write") },
  async (request, reply) => {
    if (!uuidPattern.test(request.params.id)) {
      return reply.code(400).send({ error: "invalid_post_id" });
    }
    const key = idempotencyKey(request, reply);
    if (!key) return;
    const workspaceId = requiredWorkspace(request);
    let scheduledFor;
    try {
      scheduledFor = parseReschedulePost(request.body);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return reply.code(400).send({ error: error.code, details: error.details });
      }
      throw error;
    }

    const client = await postgres.connect();
    let response;
    try {
      await client.query("begin");
      const idempotency = await claimIdempotency(client, request, key, {
        operation: "post.reschedule",
        transmissionId: request.params.id,
        scheduledFor: scheduledFor.toISOString(),
      });
      if (idempotency.error) {
        await client.query("rollback");
        return reply.code(409).send({ error: idempotency.error });
      }
      if (idempotency.replay) {
        await client.query("commit");
        return reply
          .header("idempotent-replayed", "true")
          .code(idempotency.replay.statusCode)
          .send(idempotency.replay.body);
      }

      const transmission = await client.query(
        `select status, scheduled_for, temporal_workflow_id
         from transmissions
         where id = $1 and workspace_id = $2
         for update`,
        [request.params.id, workspaceId],
      );
      const current = transmission.rows[0];
      if (!current) {
        await client.query("rollback");
        return reply.code(404).send({ error: "post_not_found" });
      }
      if (current.status !== "scheduled") {
        await client.query("rollback");
        return reply.code(409).send({ error: "post_cannot_be_rescheduled" });
      }

      await client.query(
        `update transmissions
         set schedule_mode = 'at', scheduled_for = $2, updated_at = now()
         where id = $1`,
        [request.params.id, scheduledFor],
      );
      await client.query(
        `insert into events
          (workspace_id, transmission_id, type, message, payload)
         values ($1, $2, 'transmission.rescheduled', 'Scheduled post moved', $3)`,
        [
          workspaceId,
          request.params.id,
          JSON.stringify({
            from: current.scheduled_for,
            to: scheduledFor.toISOString(),
          }),
        ],
      );
      await client.query(
        `insert into outbox_events
          (aggregate_type, aggregate_id, event_type, payload)
         values ('transmission', $1, 'publication.reschedule_requested', $2)`,
        [
          request.params.id,
          JSON.stringify({
            workflowId: current.temporal_workflow_id,
            scheduledFor: scheduledFor.getTime(),
          }),
        ],
      );

      response = {
        id: request.params.id,
        status: "scheduled",
        scheduledFor: scheduledFor.toISOString(),
      };
      await completeIdempotency(
        client,
        idempotency.actorKey,
        key,
        200,
        response,
        "transmission",
        request.params.id,
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    await auditApiAction(
      request,
      "post.reschedule",
      "transmission",
      request.params.id,
      { scheduledFor: response.scheduledFor },
    ).catch((error) => app.log.warn({ err: error }, "API audit write failed"));
    void dispatchOutbox().catch((error) =>
      app.log.warn({ err: error }, "reschedule outbox dispatch failed"),
    );
    return response;
  },
);

app.post(
  "/v1/posts/:id/cancel",
  { preHandler: requireScope("posts:write") },
  async (request, reply) => {
    const key = idempotencyKey(request, reply);
    if (!key) return;
    const workspaceId = requiredWorkspace(request);
    const client = await postgres.connect();
    let workflowId;
    const response = { id: request.params.id, status: "canceled" };
    try {
      await client.query("begin");
      const idempotency = await claimIdempotency(client, request, key, {
        operation: "post.cancel",
        transmissionId: request.params.id,
      });
      if (idempotency.error) {
        await client.query("rollback");
        return reply.code(409).send({ error: idempotency.error });
      }
      if (idempotency.replay) {
        await client.query("commit");
        return reply
          .header("idempotent-replayed", "true")
          .code(idempotency.replay.statusCode)
          .send(idempotency.replay.body);
      }
      const transmission = await client.query(
        `select status, temporal_workflow_id from transmissions
         where id = $1 and workspace_id = $2
         for update`,
        [request.params.id, workspaceId],
      );
      if (!transmission.rows[0]) {
        await client.query("rollback");
        return reply.code(404).send({ error: "post_not_found" });
      }
      if (!["draft", "scheduled"].includes(transmission.rows[0].status)) {
        await client.query("rollback");
        return reply.code(409).send({ error: "post_cannot_be_canceled" });
      }
      workflowId = transmission.rows[0].temporal_workflow_id;
      await client.query(
        `update transmissions
         set status = 'canceled', canceled_at = now(), updated_at = now()
         where id = $1`,
        [request.params.id],
      );
      await client.query(
        `update projections
         set status = 'canceled', canceled_at = now(), updated_at = now()
         where transmission_id = $1
           and status in ('pending', 'scheduled', 'retrying')`,
        [request.params.id],
      );
      await client.query(
        `insert into events
          (workspace_id, transmission_id, type, message)
         values ($1, $2, 'transmission.canceled', 'Scheduled post canceled')`,
        [workspaceId, request.params.id],
      );
      await client.query(
        `insert into outbox_events
          (aggregate_type, aggregate_id, event_type, payload)
         values ('transmission', $1, 'publication.cancel_requested', $2)`,
        [request.params.id, JSON.stringify({ workflowId })],
      );
      await completeIdempotency(
        client,
        idempotency.actorKey,
        key,
        200,
        response,
        "transmission",
        request.params.id,
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await auditApiAction(
      request,
      "post.cancel",
      "transmission",
      request.params.id,
    ).catch((error) => app.log.warn({ err: error }, "API audit write failed"));
    void dispatchOutbox().catch(() => undefined);
    return response;
  },
);

app.post(
  "/v1/projections/:id/retry",
  { preHandler: requireScope("posts:write") },
  async (request, reply) => {
    const key = idempotencyKey(request, reply);
    if (!key) return;
    const workspaceId = requiredWorkspace(request);
    const client = await postgres.connect();
    let transmissionId;
    let response;
    try {
      await client.query("begin");
      const idempotency = await claimIdempotency(client, request, key, {
        operation: "projection.retry",
        projectionId: request.params.id,
      });
      if (idempotency.error) {
        await client.query("rollback");
        return reply.code(409).send({ error: idempotency.error });
      }
      if (idempotency.replay) {
        await client.query("commit");
        return reply
          .header("idempotent-replayed", "true")
          .code(idempotency.replay.statusCode)
          .send(idempotency.replay.body);
      }
      const projection = await client.query(
        `select id, transmission_id, status
         from projections
         where id = $1 and workspace_id = $2
         for update`,
        [request.params.id, workspaceId],
      );
      const row = projection.rows[0];
      if (!row) {
        await client.query("rollback");
        return reply.code(404).send({ error: "projection_not_found" });
      }
      if (!["failed", "blocked", "needs_reauth"].includes(row.status)) {
        await client.query("rollback");
        return reply.code(409).send({ error: "projection_cannot_be_retried" });
      }
      transmissionId = row.transmission_id;
      await client.query(
        `update projections
         set status = 'retrying', error_category = null, error_summary = null,
             next_attempt_at = now(), updated_at = now()
         where id = $1`,
        [request.params.id],
      );
      await client.query(
        `update transmissions
         set status = 'scheduled', updated_at = now()
         where id = $1`,
        [transmissionId],
      );
      const workflowId = `publication:${transmissionId}:retry:${request.params.id}:${Date.now()}`;
      await client.query(
        `insert into outbox_events
          (aggregate_type, aggregate_id, event_type, payload)
         values ('transmission', $1, 'publication.requested', $2)`,
        [
          transmissionId,
          JSON.stringify({ workflowId, projectionIds: [request.params.id] }),
        ],
      );
      response = {
        id: request.params.id,
        transmissionId,
        status: "retrying",
      };
      await completeIdempotency(
        client,
        idempotency.actorKey,
        key,
        202,
        response,
        "projection",
        request.params.id,
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await auditApiAction(
      request,
      "projection.retry",
      "projection",
      request.params.id,
    ).catch((error) => app.log.warn({ err: error }, "API audit write failed"));
    void dispatchOutbox().catch(() => undefined);
    return reply.code(202).send(response);
  },
);

app.post(
  "/v1/uploads/multipart",
  { preHandler: requireMediaWrite },
  async (request, reply) => {
    if (!r2) {
      return reply.code(503).send({ error: "r2_not_configured" });
    }

    const {
      workspaceId: requestedWorkspaceId,
      fileName,
      contentType,
      sizeBytes,
      durationMs,
      width,
      height,
    } = request.body ?? {};
    const workspaceId =
      request.authContext?.kind === "internal"
        ? requestedWorkspaceId
        : request.authContext?.workspaceId;
    const extension = allowedMimeTypes.get(contentType);
    if (
      typeof workspaceId !== "string" ||
      !uuidPattern.test(workspaceId) ||
      typeof fileName !== "string" ||
      fileName.length === 0 ||
      fileName.length > 512 ||
      !extension ||
      !Number.isFinite(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > maxUploadBytes ||
      (durationMs !== undefined && (!Number.isFinite(durationMs) || durationMs <= 0)) ||
      (width !== undefined && (!Number.isInteger(width) || width <= 0)) ||
      (height !== undefined && (!Number.isInteger(height) || height <= 0))
    ) {
      return reply.code(400).send({ error: "invalid_upload_request" });
    }
    if (
      request.authContext?.kind !== "internal" &&
      requestedWorkspaceId !== undefined &&
      requestedWorkspaceId !== workspaceId
    ) {
      return reply.code(403).send({ error: "workspace_mismatch" });
    }

    const workspace = await postgres.query(
      "select 1 from workspaces where id = $1",
      [workspaceId],
    );
    if (workspace.rowCount === 0) {
      return reply.code(404).send({ error: "workspace_not_found" });
    }

    const mediaId = randomUUID();
    const key = `uploads/${workspaceId}/${mediaId}/source${extension}`;
    const response = await r2.send(
      new CreateMultipartUploadCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
        ContentType: contentType,
        Metadata: {
          "posterract-workspace-id": workspaceId,
          "posterract-media-id": mediaId,
        },
      }),
    );
    const uploadId = response.UploadId;
    if (!uploadId) {
      throw new Error("R2 did not return a multipart upload id");
    }

    const session = {
      uploadId,
      mediaId,
      workspaceId,
      key,
      fileName,
      contentType,
      sizeBytes,
      createdAt: new Date().toISOString(),
    };

    try {
      await postgres.query(
        `insert into media_assets
          (id, workspace_id, original_filename, r2_key, mime_type, size_bytes,
           duration_ms, width, height, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'uploading')`,
        [
          mediaId,
          workspaceId,
          fileName,
          key,
          contentType,
          sizeBytes,
          durationMs ?? null,
          width ?? null,
          height ?? null,
        ],
      );
      await redis.set(
        uploadSessionKey(uploadId),
        JSON.stringify(session),
        "EX",
        uploadTtlSeconds,
      );
    } catch (error) {
      await r2
        .send(
          new AbortMultipartUploadCommand({
            Bucket: env.R2_BUCKET,
            Key: key,
            UploadId: uploadId,
          }),
        )
        .catch(() => undefined);
      await postgres
        .query("delete from media_assets where id = $1 and status = 'uploading'", [
          mediaId,
        ])
        .catch(() => undefined);
      throw error;
    }

    return reply.code(201).send({ uploadId, key, mediaId });
  },
);

app.post(
  "/v1/uploads/multipart/:uploadId/parts/:partNumber",
  { preHandler: requireMediaWrite },
  async (request, reply) => {
    if (!r2) return reply.code(503).send({ error: "r2_not_configured" });
    const { uploadId, partNumber: rawPartNumber } = request.params;
    const partNumber = Number(rawPartNumber);
    const session = await loadUploadSession(uploadId);
    if (!session) return reply.code(404).send({ error: "upload_not_found" });
    if (!canAccessWorkspace(request, session.workspaceId)) {
      return reply.code(404).send({ error: "upload_not_found" });
    }
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      return reply.code(400).send({ error: "invalid_part_number" });
    }

    const url = await getSignedUrl(
      r2,
      new UploadPartCommand({
        Bucket: env.R2_BUCKET,
        Key: session.key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: Number(env.R2_SIGNED_URL_TTL_SECONDS ?? 900) },
    );
    return { url };
  },
);

app.get(
  "/v1/uploads/multipart/:uploadId/parts",
  { preHandler: requireMediaWrite },
  async (request, reply) => {
    if (!r2) return reply.code(503).send({ error: "r2_not_configured" });
    const { uploadId } = request.params;
    const session = await loadUploadSession(uploadId);
    if (!session) return reply.code(404).send({ error: "upload_not_found" });
    if (!canAccessWorkspace(request, session.workspaceId)) {
      return reply.code(404).send({ error: "upload_not_found" });
    }
    const response = await r2.send(
      new ListPartsCommand({
        Bucket: env.R2_BUCKET,
        Key: session.key,
        UploadId: uploadId,
      }),
    );
    return {
      parts: (response.Parts ?? []).map((part) => ({
        PartNumber: part.PartNumber,
        ETag: part.ETag,
        Size: part.Size,
      })),
    };
  },
);

app.post(
  "/v1/uploads/multipart/:uploadId/complete",
  { preHandler: requireMediaWrite },
  async (request, reply) => {
    if (!r2) return reply.code(503).send({ error: "r2_not_configured" });
    const { uploadId } = request.params;
    const session = await loadUploadSession(uploadId);
    if (!session) return reply.code(404).send({ error: "upload_not_found" });
    if (!canAccessWorkspace(request, session.workspaceId)) {
      return reply.code(404).send({ error: "upload_not_found" });
    }
    const parts = Array.isArray(request.body?.parts) ? request.body.parts : [];
    if (
      parts.length === 0 ||
      parts.some(
        (part) =>
          !Number.isInteger(part.PartNumber) || typeof part.ETag !== "string",
      )
    ) {
      return reply.code(400).send({ error: "invalid_parts" });
    }

    await r2.send(
      new CompleteMultipartUploadCommand({
        Bucket: env.R2_BUCKET,
        Key: session.key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts].sort((a, b) => a.PartNumber - b.PartNumber),
        },
      }),
    );
    const object = await r2.send(
      new HeadObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: session.key,
      }),
    );
    if (Number(object.ContentLength) !== session.sizeBytes) {
      await r2.send(
        new DeleteObjectCommand({
          Bucket: env.R2_BUCKET,
          Key: session.key,
        }),
      );
      await postgres.query(
        `update media_assets
         set status = 'failed', purged_at = now(), updated_at = now()
         where id = $1`,
        [session.mediaId],
      );
      await redis.del(uploadSessionKey(uploadId));
      return reply.code(422).send({ error: "uploaded_size_mismatch" });
    }

    await postgres.query(
      `update media_assets
       set status = 'ready',
           upload_completed_at = now(),
           purge_after = now() + ($2 * interval '1 hour'),
           updated_at = now()
       where id = $1`,
      [session.mediaId, unattachedMediaTtlHours],
    );
    await redis.del(uploadSessionKey(uploadId));
    return {
      mediaId: session.mediaId,
      key: session.key,
      status: "ready",
    };
  },
);

app.delete(
  "/v1/uploads/multipart/:uploadId",
  { preHandler: requireMediaWrite },
  async (request, reply) => {
    if (!r2) return reply.code(503).send({ error: "r2_not_configured" });
    const { uploadId } = request.params;
    const session = await loadUploadSession(uploadId);
    if (!session) return reply.code(204).send();
    if (!canAccessWorkspace(request, session.workspaceId)) {
      return reply.code(404).send({ error: "upload_not_found" });
    }
    await r2.send(
      new AbortMultipartUploadCommand({
        Bucket: env.R2_BUCKET,
        Key: session.key,
        UploadId: uploadId,
      }),
    );
    await postgres.query(
      `update media_assets
       set status = 'aborted', purged_at = now(), updated_at = now()
       where id = $1`,
      [session.mediaId],
    );
    await redis.del(uploadSessionKey(uploadId));
    return reply.code(204).send();
  },
);

async function shutdown(signal) {
  app.log.info({ signal }, "shutting down");
  if (cleanupTimer) clearInterval(cleanupTimer);
  if (outboxTimer) clearInterval(outboxTimer);
  await app.close();
  await postgres.end();
  if (redis.status !== "end") redis.disconnect();
  temporalConnection?.close();
  await elasticsearch.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: "0.0.0.0", port });
cleanupTimer = setInterval(
  () =>
    void purgeExpiredMedia().catch((error) =>
      app.log.error({ err: error }, "media cleanup cycle failed"),
    ),
  cleanupIntervalMs,
);
cleanupTimer.unref();
outboxTimer = setInterval(
  () =>
    void dispatchOutbox().catch((error) =>
      app.log.error({ err: error }, "outbox dispatch cycle failed"),
    ),
  outboxIntervalMs,
);
outboxTimer.unref();
setTimeout(
  () =>
    void purgeExpiredMedia().catch((error) =>
      app.log.error({ err: error }, "initial media cleanup cycle failed"),
    ),
  5_000,
).unref();
setTimeout(
  () =>
    void ensureRecurringWorkflows().catch((error) =>
      app.log.error({ err: error }, "could not ensure recurring workflows"),
    ),
  7_500,
).unref();
