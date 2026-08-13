import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { unzipSync } from "fflate";
import { encryptSecret } from "../src/security.js";

const [, , archivePath, mode = "--dry-run"] = process.argv;
if (!archivePath || !["--dry-run", "--apply"].includes(mode)) {
  throw new Error(
    "Usage: node apps/api/scripts/import-convex-export.mjs <snapshot.zip> [--dry-run|--apply]",
  );
}

const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
const decoder = new TextDecoder();
function table(name) {
  const entry = archive[`${name}/documents.jsonl`];
  if (!entry) return [];
  const source = decoder.decode(entry).trim();
  return source ? source.split("\n").map((line) => JSON.parse(line)) : [];
}

const data = {
  users: table("_components/betterAuth/user"),
  accounts: table("_components/betterAuth/account"),
  sessions: table("_components/betterAuth/session"),
  workspaces: table("workspaces"),
  portals: table("portals"),
  tokens: table("portalTokens"),
  artifacts: table("artifacts"),
  transmissions: table("transmissions"),
  projections: table("projections"),
  events: table("events"),
  points: table("pointsLedger"),
  stats: table("userStats"),
  publicationMetrics: table("metricSnapshots"),
  accountMetrics: table("accountMetricSnapshots"),
  dailyMetrics: table("dailyMetricSnapshots"),
  deletionRequests: table("metaDeletionRequests"),
  flows: table("flows"),
};

function uuidFor(entity, legacyId) {
  const bytes = createHash("sha256")
    .update(`posterract-convex:${entity}:${legacyId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function instant(value, fallback = Date.now()) {
  return new Date(typeof value === "number" ? value : fallback);
}

function requireReference(map, legacyId, label) {
  const value = map.get(legacyId);
  if (!value) throw new Error(`Missing ${label} reference ${legacyId}`);
  return value;
}

const userIds = new Map(data.users.map((row) => [row._id, uuidFor("user", row._id)]));
const workspaceIds = new Map(
  data.workspaces.map((row) => [row._id, uuidFor("workspace", row._id)]),
);
const portalIds = new Map(data.portals.map((row) => [row._id, uuidFor("portal", row._id)]));
const transmissionIds = new Map(
  data.transmissions.map((row) => [row._id, uuidFor("transmission", row._id)]),
);
const projectionIds = new Map(
  data.projections.map((row) => [row._id, uuidFor("projection", row._id)]),
);

for (const workspace of data.workspaces) {
  requireReference(userIds, workspace.ownerId, "workspace owner");
}
for (const portal of data.portals) {
  requireReference(workspaceIds, portal.workspaceId, "portal workspace");
}
for (const token of data.tokens) {
  requireReference(portalIds, token.portalId, "token portal");
}
for (const transmission of data.transmissions) {
  requireReference(workspaceIds, transmission.workspaceId, "transmission workspace");
}
for (const projection of data.projections) {
  requireReference(transmissionIds, projection.transmissionId, "projection transmission");
  requireReference(workspaceIds, projection.workspaceId, "projection workspace");
  if (projection.portalId) requireReference(portalIds, projection.portalId, "projection portal");
}

const summary = Object.fromEntries(
  Object.entries(data).map(([name, rows]) => [name, rows.length]),
);
process.stdout.write(`${JSON.stringify({ mode, summary, sessionsWillBeInvalidated: data.sessions.length })}\n`);
if (data.artifacts.length > 0) {
  throw new Error(
    "The snapshot contains Convex Storage artifacts. Copy their bytes to R2 and extend the media mapping before applying this import.",
  );
}
if (mode === "--dry-run") process.exit(0);

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for --apply");
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  throw new Error("TOKEN_ENCRYPTION_KEY is required for --apply");
}
if (process.env.MIGRATION_CONFIRM !== "postgres-cutover") {
  throw new Error("Set MIGRATION_CONFIRM=postgres-cutover to apply the import");
}

const postgres = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await postgres.connect();
try {
  await client.query("begin");
  // Better Auth session tokens are intentionally not migrated. The source
  // session cookies were minted by Convex and must never remain valid after
  // the PostgreSQL cutover.
  await client.query(`delete from "session"`);

  for (const row of data.users) {
    const id = userIds.get(row._id);
    await client.query(
      `insert into "user"
        ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       values ($1, $2, $3, $4, $5, $6)
       on conflict ("id") do update
       set "name" = excluded."name", "email" = excluded."email",
           "emailVerified" = excluded."emailVerified",
           "updatedAt" = excluded."updatedAt"`,
      [id, row.name, row.email, row.emailVerified === true, instant(row.createdAt), instant(row.updatedAt)],
    );
    await client.query(
      `insert into app_users
       (id, auth_user_id, email, display_name, email_verified,
         legacy_convex_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update
       set email = excluded.email, display_name = excluded.display_name,
           email_verified = excluded.email_verified, updated_at = excluded.updated_at`,
      [
        id,
        id,
        row.email,
        row.name,
        row.emailVerified === true,
        row._id,
        instant(row.createdAt),
        instant(row.updatedAt),
      ],
    );
  }

  for (const row of data.accounts) {
    await client.query(
      `insert into "account"
        ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict ("id") do update
       set "accountId" = excluded."accountId",
           "providerId" = excluded."providerId",
           "password" = excluded."password",
           "updatedAt" = excluded."updatedAt"`,
      [
        uuidFor("auth-account", row._id),
        row.providerId === "credential"
          ? requireReference(userIds, row.userId, "auth account user")
          : row.accountId,
        row.providerId,
        requireReference(userIds, row.userId, "auth account user"),
        row.password ?? null,
        instant(row.createdAt),
        instant(row.updatedAt),
      ],
    );
  }

  for (const row of data.workspaces) {
    const id = workspaceIds.get(row._id);
    const ownerId = requireReference(userIds, row.ownerId, "workspace owner");
    await client.query(
      `insert into workspaces
        (id, owner_id, name, legacy_convex_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $5)
       on conflict (id) do update
       set owner_id = excluded.owner_id, name = excluded.name,
           updated_at = excluded.updated_at`,
      [id, ownerId, row.name, row._id, instant(row._creationTime)],
    );
    await client.query(
      `insert into workspace_memberships (workspace_id, user_id, role)
       values ($1, $2, 'owner')
       on conflict (workspace_id, user_id) do update set role = 'owner'`,
      [id, ownerId],
    );
  }

  for (const row of data.portals) {
    await client.query(
      `insert into social_accounts
        (id, workspace_id, provider, provider_account_id, handle, display_name,
         status, scopes, token_expires_at, metadata, legacy_convex_id,
         created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
       on conflict (id) do update
       set provider_account_id = excluded.provider_account_id,
           handle = excluded.handle, display_name = excluded.display_name,
           status = excluded.status, scopes = excluded.scopes,
           token_expires_at = excluded.token_expires_at,
           metadata = excluded.metadata, updated_at = excluded.updated_at`,
      [
        portalIds.get(row._id),
        requireReference(workspaceIds, row.workspaceId, "portal workspace"),
        row.provider,
        row.providerAccountId ?? null,
        row.handle,
        row.displayName ?? null,
        row.status,
        row.scopes ?? [],
        row.tokenExpiresAt ? instant(row.tokenExpiresAt) : null,
        JSON.stringify({
          windowUsage:
            row.windowCap === undefined
              ? undefined
              : {
                  used: row.windowUsed ?? 0,
                  cap: row.windowCap,
                  windowHours: row.windowHours ?? 24,
                },
        }),
        row._id,
        instant(row._creationTime),
      ],
    );
  }

  for (const row of data.tokens) {
    const portalId = requireReference(portalIds, row.portalId, "token portal");
    await client.query(
      `insert into social_account_tokens
        (social_account_id, access_token_ciphertext, refresh_token_ciphertext,
         access_token_expires_at, refresh_expires_at, provider_user_id,
         provider_auth_user_id, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (social_account_id) do update
       set access_token_ciphertext = excluded.access_token_ciphertext,
           refresh_token_ciphertext = excluded.refresh_token_ciphertext,
           access_token_expires_at = excluded.access_token_expires_at,
           refresh_expires_at = excluded.refresh_expires_at,
           provider_user_id = excluded.provider_user_id,
           provider_auth_user_id = excluded.provider_auth_user_id,
           updated_at = now()`,
      [
        portalId,
        encryptSecret(row.accessToken),
        row.refreshToken ? encryptSecret(row.refreshToken) : null,
        row.expiresAt ? instant(row.expiresAt) : null,
        row.refreshExpiresAt ? instant(row.refreshExpiresAt) : null,
        row.providerUserId ?? null,
        row.providerAuthUserId ?? null,
      ],
    );
  }

  for (const row of data.transmissions) {
    await client.query(
      `insert into transmissions
        (id, workspace_id, media_asset_id, title, base_caption, hashtags,
         status, schedule_mode, scheduled_for, source, legacy_convex_id,
         created_at, updated_at)
       values ($1, $2, null, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (id) do update
       set title = excluded.title, base_caption = excluded.base_caption,
           hashtags = excluded.hashtags, status = excluded.status,
           schedule_mode = excluded.schedule_mode,
           scheduled_for = excluded.scheduled_for,
           updated_at = excluded.updated_at`,
      [
        transmissionIds.get(row._id),
        requireReference(workspaceIds, row.workspaceId, "transmission workspace"),
        row.title,
        row.baseCaption ?? "",
        row.hashtags ?? [],
        row.status,
        row.scheduleMode,
        row.scheduledFor ? instant(row.scheduledFor) : null,
        row.source,
        row._id,
        instant(row._creationTime),
        instant(row.updatedAt, row._creationTime),
      ],
    );
  }

  for (const row of data.projections) {
    await client.query(
      `insert into projections
        (id, transmission_id, workspace_id, social_account_id, provider,
         caption, hashtags, platform_options, status, attempt_count,
         platform_post_id, platform_post_url, error_summary,
         legacy_convex_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       on conflict (id) do update
       set social_account_id = excluded.social_account_id,
           caption = excluded.caption, hashtags = excluded.hashtags,
           platform_options = excluded.platform_options,
           status = excluded.status, attempt_count = excluded.attempt_count,
           platform_post_id = excluded.platform_post_id,
           platform_post_url = excluded.platform_post_url,
           error_summary = excluded.error_summary,
           updated_at = excluded.updated_at`,
      [
        projectionIds.get(row._id),
        requireReference(transmissionIds, row.transmissionId, "projection transmission"),
        requireReference(workspaceIds, row.workspaceId, "projection workspace"),
        row.portalId ? requireReference(portalIds, row.portalId, "projection portal") : null,
        row.provider,
        row.caption ?? "",
        row.hashtags ?? [],
        JSON.stringify(row.platformOptions ?? {}),
        row.status,
        row.attemptCount ?? 0,
        row.platformPostId ?? null,
        row.platformPostUrl ?? null,
        row.errorSummary ?? null,
        row._id,
        instant(row._creationTime),
        instant(row.updatedAt, row._creationTime),
      ],
    );
  }

  for (const row of data.events) {
    await client.query(
      `insert into events
        (workspace_id, transmission_id, projection_id, type, message,
         occurred_at, legacy_convex_id)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (legacy_convex_id) do nothing`,
      [
        requireReference(workspaceIds, row.workspaceId, "event workspace"),
        row.transmissionId ? requireReference(transmissionIds, row.transmissionId, "event transmission") : null,
        row.projectionId ? requireReference(projectionIds, row.projectionId, "event projection") : null,
        row.type,
        row.message,
        instant(row.at, row._creationTime),
        row._id,
      ],
    );
  }

  for (const row of data.points) {
    await client.query(
      `insert into points_ledger
        (workspace_id, source, amount, reference_id, note, awarded_at, legacy_convex_id)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict do nothing`,
      [
        requireReference(workspaceIds, row.workspaceId, "points workspace"),
        row.source,
        row.amount,
        row.refId ?? `convex:${row._id}`,
        row.note ?? null,
        instant(row.at, row._creationTime),
        row._id,
      ],
    );
  }

  for (const row of data.stats) {
    await client.query(
      `insert into user_stats
        (workspace_id, lifetime_rp, week_rp, week_start_at, streak_days,
         last_post_day, badges, legacy_convex_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (workspace_id) do update
       set lifetime_rp = excluded.lifetime_rp, week_rp = excluded.week_rp,
           week_start_at = excluded.week_start_at, streak_days = excluded.streak_days,
           last_post_day = excluded.last_post_day, badges = excluded.badges,
           updated_at = now()`,
      [
        requireReference(workspaceIds, row.workspaceId, "stats workspace"),
        row.lifetimeRP ?? 0,
        row.weekRP ?? 0,
        row.weekStartAt ? instant(row.weekStartAt) : null,
        row.streakDays ?? 0,
        row.lastPostDay ?? null,
        row.badges ?? [],
        row._id,
      ],
    );
  }

  for (const row of data.publicationMetrics) {
    await client.query(
      `insert into publication_metric_snapshots
        (projection_id, workspace_id, provider, views, likes, comments, shares,
         fetched_at, legacy_convex_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (legacy_convex_id) do nothing`,
      [
        requireReference(projectionIds, row.projectionId, "metric projection"),
        requireReference(workspaceIds, row.workspaceId, "metric workspace"),
        row.provider,
        row.views ?? 0,
        row.likes ?? 0,
        row.comments ?? 0,
        row.shares ?? 0,
        instant(row.fetchedAt),
        row._id,
      ],
    );
  }

  for (const row of data.accountMetrics) {
    await client.query(
      `insert into account_metric_snapshots
        (social_account_id, workspace_id, provider, audience, total_views,
         total_likes, published_videos, fetched_at, legacy_convex_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (legacy_convex_id) do nothing`,
      [
        requireReference(portalIds, row.portalId, "account metric portal"),
        requireReference(workspaceIds, row.workspaceId, "account metric workspace"),
        row.provider,
        row.audience ?? null,
        row.totalViews ?? null,
        row.totalLikes ?? null,
        row.publishedVideos ?? null,
        instant(row.fetchedAt),
        row._id,
      ],
    );
  }

  for (const row of data.dailyMetrics) {
    await client.query(
      `insert into daily_metric_snapshots
        (social_account_id, workspace_id, provider, metric_date, views, likes,
         comments, shares, watch_minutes, audience_gained, audience_lost,
         fetched_at, legacy_convex_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (social_account_id, metric_date) do update
       set views = excluded.views, likes = excluded.likes,
           comments = excluded.comments, shares = excluded.shares,
           watch_minutes = excluded.watch_minutes,
           audience_gained = excluded.audience_gained,
           audience_lost = excluded.audience_lost,
           fetched_at = excluded.fetched_at,
           legacy_convex_id = excluded.legacy_convex_id`,
      [
        requireReference(portalIds, row.portalId, "daily metric portal"),
        requireReference(workspaceIds, row.workspaceId, "daily metric workspace"),
        row.provider,
        row.date,
        row.views ?? 0,
        row.likes ?? 0,
        row.comments ?? 0,
        row.shares ?? 0,
        row.watchMinutes ?? null,
        row.audienceGained ?? 0,
        row.audienceLost ?? 0,
        instant(row.fetchedAt),
        row._id,
      ],
    );
  }

  for (const row of data.deletionRequests) {
    await client.query(
      `insert into meta_deletion_requests
        (id, provider, confirmation_code, signed_request_hash, status,
         deleted_connections, requested_at, completed_at, legacy_convex_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update
       set status = excluded.status,
           deleted_connections = excluded.deleted_connections,
           completed_at = excluded.completed_at`,
      [
        uuidFor("meta-deletion", row._id),
        row.provider,
        row.confirmationCode,
        createHash("sha256").update(row.requestKey).digest("hex"),
        row.status,
        row.deletedConnections ?? 0,
        instant(row.requestedAt),
        row.completedAt ? instant(row.completedAt) : null,
        row._id,
      ],
    );
  }

  for (const row of data.flows) {
    await client.query(
      `insert into flows
        (id, workspace_id, name, enabled, platforms, base_caption,
         caption_templates, hashtags, default_time_of_day,
         legacy_convex_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (id) do update
       set name = excluded.name, enabled = excluded.enabled,
           platforms = excluded.platforms, base_caption = excluded.base_caption,
           caption_templates = excluded.caption_templates,
           hashtags = excluded.hashtags,
           default_time_of_day = excluded.default_time_of_day,
           updated_at = excluded.updated_at`,
      [
        uuidFor("flow", row._id),
        requireReference(workspaceIds, row.workspaceId, "flow workspace"),
        row.name,
        row.enabled !== false,
        row.platforms ?? [],
        row.baseCaption ?? "",
        JSON.stringify(row.captionTemplates ?? {}),
        row.hashtags ?? [],
        row.defaultTimeOfDay ?? null,
        row._id,
        instant(row._creationTime),
        instant(row.updatedAt, row._creationTime),
      ],
    );
  }

  await client.query("commit");
  process.stdout.write(
    `${JSON.stringify({ imported: summary, invalidatedSessions: data.sessions.length })}\n`,
  );
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await postgres.end();
}
