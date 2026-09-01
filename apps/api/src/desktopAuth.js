import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constantTimeEqual, hashApiKey } from "./security.js";

const PKCE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const PLATFORM_PATTERN = /^(darwin|win32|linux)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const GRANT_TTL_SECONDS = 10 * 60;

function text(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function validateDesktopStartInput(body) {
  const deviceName = text(body?.deviceName, 120);
  const platform = text(body?.platform, 20);
  const appVersion = text(body?.appVersion, 40) || undefined;
  const codeChallenge = text(body?.codeChallenge, 128);
  if (!deviceName || !PLATFORM_PATTERN.test(platform) || !PKCE_PATTERN.test(codeChallenge)) {
    return undefined;
  }
  return { deviceName, platform, appVersion, codeChallenge };
}

function newToken(prefix, bytes = 32) {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`;
}

function publicDevice(row) {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    appVersion: row.app_version ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    lastSeenAt: new Date(row.last_seen_at).getTime(),
    revokedAt: row.revoked_at ? new Date(row.revoked_at).getTime() : undefined,
  };
}

async function issueTokenPair(client, deviceId, familyId = randomUUID()) {
  const accessToken = newToken("pd_access_");
  const refreshToken = newToken("pd_refresh_");
  const access = await client.query(
    `insert into desktop_access_tokens (device_id, secret_hash, expires_at)
     values ($1, $2, now() + ($3 * interval '1 second'))
     returning id, expires_at`,
    [deviceId, hashApiKey(accessToken), ACCESS_TTL_SECONDS],
  );
  const refresh = await client.query(
    `insert into desktop_refresh_tokens
       (device_id, family_id, secret_hash, expires_at)
     values ($1, $2, $3, now() + ($4 * interval '1 second'))
     returning id, expires_at`,
    [deviceId, familyId, hashApiKey(refreshToken), REFRESH_TTL_SECONDS],
  );
  return {
    accessToken,
    accessTokenId: access.rows[0].id,
    accessExpiresAt: new Date(access.rows[0].expires_at).getTime(),
    refreshToken,
    refreshTokenId: refresh.rows[0].id,
    refreshExpiresAt: new Date(refresh.rows[0].expires_at).getTime(),
  };
}

async function revokeFamily(client, deviceId, familyId) {
  await client.query(
    `update desktop_devices set revoked_at = coalesce(revoked_at, now()) where id = $1`,
    [deviceId],
  );
  await client.query(
    `update desktop_access_tokens set revoked_at = coalesce(revoked_at, now())
     where device_id = $1`,
    [deviceId],
  );
  await client.query(
    `update desktop_refresh_tokens set revoked_at = coalesce(revoked_at, now())
     where family_id = $1`,
    [familyId],
  );
}

function siteUrl(environment) {
  const value = environment.SITE_URL ?? environment.PUBLIC_WEB_URL ?? "https://www.posterract.app";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error();
    return url.origin;
  } catch {
    return "https://www.posterract.app";
  }
}

export function registerDesktopAuthRoutes(
  app,
  { postgres, requireBrowserSession, requireInteractiveSession, environment = process.env },
) {
  app.post("/v1/desktop/auth/start", async (request, reply) => {
    const input = validateDesktopStartInput(request.body);
    if (!input) return reply.code(400).send({ error: "invalid_desktop_authorization_request" });
    const requestId = randomUUID();
    const pollToken = newToken("pd_poll_");
    await postgres.query(
      `delete from desktop_authorization_grants
       where expires_at <= now() or consumed_at is not null`,
    );
    await postgres.query(
      `insert into desktop_authorization_grants
        (id, poll_token_hash, code_challenge, device_name, platform, app_version, expires_at)
       values ($1, $2, $3, $4, $5, $6, now() + ($7 * interval '1 second'))`,
      [
        requestId,
        hashApiKey(pollToken),
        input.codeChallenge,
        input.deviceName,
        input.platform,
        input.appVersion ?? null,
        GRANT_TTL_SECONDS,
      ],
    );
    return {
      requestId,
      pollToken,
      verificationUrl: `${siteUrl(environment)}/desktop/authorize?request=${encodeURIComponent(requestId)}`,
      expiresIn: GRANT_TTL_SECONDS,
      interval: 2,
    };
  });

  app.get("/v1/desktop/auth/request/:id", async (request, reply) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      return reply.code(404).send({ error: "desktop_authorization_not_found" });
    }
    const result = await postgres.query(
      `select id, device_name, platform, app_version, status, expires_at
       from desktop_authorization_grants where id = $1 limit 1`,
      [request.params.id],
    );
    const row = result.rows[0];
    if (!row) return reply.code(404).send({ error: "desktop_authorization_not_found" });
    const expired = new Date(row.expires_at).getTime() <= Date.now();
    return {
      requestId: row.id,
      deviceName: row.device_name,
      platform: row.platform,
      appVersion: row.app_version ?? undefined,
      status: expired && row.status === "pending" ? "expired" : row.status,
      expiresAt: new Date(row.expires_at).getTime(),
    };
  });

  app.post(
    "/v1/desktop/auth/approve",
    { preHandler: requireBrowserSession },
    async (request, reply) => {
      const requestId = text(request.body?.requestId, 64);
      if (!UUID_PATTERN.test(requestId)) return reply.code(400).send({ error: "desktop_authorization_request_required" });
      const result = await postgres.query(
        `update desktop_authorization_grants
         set status = 'approved', approved_user_id = $2,
             approved_workspace_id = $3, approved_at = now()
         where id = $1 and status = 'pending' and expires_at > now()
         returning id`,
        [requestId, request.authContext.userId, request.authContext.workspaceId],
      );
      if (!result.rows[0]) {
        return reply.code(409).send({ error: "desktop_authorization_unavailable" });
      }
      return { ok: true };
    },
  );

  app.post("/v1/desktop/auth/exchange", async (request, reply) => {
    const requestId = text(request.body?.requestId, 64);
    const pollToken = text(request.body?.pollToken, 160);
    const codeVerifier = text(request.body?.codeVerifier, 128);
    if (!UUID_PATTERN.test(requestId) || !pollToken || !PKCE_PATTERN.test(codeVerifier)) {
      return reply.code(400).send({ error: "invalid_desktop_exchange" });
    }
    const client = await postgres.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `select * from desktop_authorization_grants where id = $1 for update`,
        [requestId],
      );
      const grant = result.rows[0];
      if (
        !grant ||
        !constantTimeEqual(hashApiKey(pollToken), grant.poll_token_hash) ||
        !constantTimeEqual(pkceChallenge(codeVerifier), grant.code_challenge)
      ) {
        await client.query("rollback");
        return reply.code(401).send({ error: "invalid_desktop_exchange" });
      }
      if (new Date(grant.expires_at).getTime() <= Date.now()) {
        await client.query(
          `update desktop_authorization_grants set status = 'expired'
           where id = $1 and status = 'pending'`,
          [requestId],
        );
        await client.query("commit");
        return reply.code(410).send({ error: "desktop_authorization_expired" });
      }
      if (grant.status === "pending") {
        await client.query("rollback");
        return reply.code(428).send({ error: "authorization_pending" });
      }
      if (grant.status !== "approved" || !grant.approved_user_id || !grant.approved_workspace_id) {
        await client.query("rollback");
        return reply.code(409).send({ error: "desktop_authorization_unavailable" });
      }
      const device = await client.query(
        `insert into desktop_devices
          (user_id, workspace_id, name, platform, app_version)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [
          grant.approved_user_id,
          grant.approved_workspace_id,
          grant.device_name,
          grant.platform,
          grant.app_version,
        ],
      );
      const pair = await issueTokenPair(client, device.rows[0].id);
      await client.query(
        `update desktop_authorization_grants
         set status = 'consumed', consumed_at = now() where id = $1`,
        [requestId],
      );
      await client.query("commit");
      return {
        tokenType: "Bearer",
        accessToken: pair.accessToken,
        accessExpiresAt: pair.accessExpiresAt,
        refreshToken: pair.refreshToken,
        refreshExpiresAt: pair.refreshExpiresAt,
        device: publicDevice(device.rows[0]),
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/v1/desktop/auth/refresh", async (request, reply) => {
    const refreshToken = text(request.body?.refreshToken, 180);
    if (!refreshToken.startsWith("pd_refresh_")) {
      return reply.code(401).send({ error: "invalid_refresh_token" });
    }
    const client = await postgres.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `select rt.*, d.revoked_at as device_revoked_at
         from desktop_refresh_tokens rt
         join desktop_devices d on d.id = rt.device_id
         where rt.secret_hash = $1
         for update of rt`,
        [hashApiKey(refreshToken)],
      );
      const current = result.rows[0];
      if (!current) {
        await client.query("rollback");
        return reply.code(401).send({ error: "invalid_refresh_token" });
      }
      if (current.consumed_at || current.replaced_by_id) {
        await revokeFamily(client, current.device_id, current.family_id);
        await client.query("commit");
        return reply.code(401).send({ error: "refresh_token_reuse" });
      }
      if (current.revoked_at || current.device_revoked_at || new Date(current.expires_at).getTime() <= Date.now()) {
        await client.query("rollback");
        return reply.code(401).send({ error: "refresh_token_expired" });
      }
      await client.query(
        `update desktop_access_tokens set revoked_at = coalesce(revoked_at, now())
         where device_id = $1 and revoked_at is null`,
        [current.device_id],
      );
      const pair = await issueTokenPair(client, current.device_id, current.family_id);
      await client.query(
        `update desktop_refresh_tokens
         set consumed_at = now(), replaced_by_id = $2 where id = $1`,
        [current.id, pair.refreshTokenId],
      );
      await client.query(
        `update desktop_devices set last_seen_at = now() where id = $1`,
        [current.device_id],
      );
      await client.query("commit");
      return {
        tokenType: "Bearer",
        accessToken: pair.accessToken,
        accessExpiresAt: pair.accessExpiresAt,
        refreshToken: pair.refreshToken,
        refreshExpiresAt: pair.refreshExpiresAt,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  app.get(
    "/v1/desktop/session",
    { preHandler: requireInteractiveSession },
    async (request, reply) => {
      if (request.authContext.kind !== "desktop") {
        return reply.code(403).send({ error: "desktop_session_required" });
      }
      const result = await postgres.query(
        `select u.email, u.display_name, d.*
         from desktop_devices d
         join app_users u on u.id = d.user_id
         where d.id = $1 and d.revoked_at is null limit 1`,
        [request.authContext.deviceId],
      );
      const row = result.rows[0];
      if (!row) return reply.code(401).send({ error: "desktop_session_revoked" });
      return {
        user: { id: request.authContext.userId, email: row.email, name: row.display_name ?? undefined },
        workspaceId: request.authContext.workspaceId,
        role: request.authContext.role,
        device: publicDevice(row),
      };
    },
  );

  app.post(
    "/v1/desktop/auth/revoke",
    { preHandler: requireInteractiveSession },
    async (request, reply) => {
      if (request.authContext.kind !== "desktop") {
        return reply.code(403).send({ error: "desktop_session_required" });
      }
      await postgres.query(
        `update desktop_devices set revoked_at = coalesce(revoked_at, now()) where id = $1`,
        [request.authContext.deviceId],
      );
      return reply.code(204).send();
    },
  );

  app.get(
    "/v1/desktop/devices",
    { preHandler: requireInteractiveSession },
    async (request) => {
      const result = await postgres.query(
        `select * from desktop_devices
         where user_id = $1 order by created_at desc`,
        [request.authContext.userId],
      );
      return { devices: result.rows.map(publicDevice) };
    },
  );

  app.delete(
    "/v1/desktop/devices/:id",
    { preHandler: requireInteractiveSession },
    async (request, reply) => {
      if (!UUID_PATTERN.test(request.params.id)) {
        return reply.code(404).send({ error: "desktop_device_not_found" });
      }
      const result = await postgres.query(
        `update desktop_devices set revoked_at = coalesce(revoked_at, now())
         where id = $1 and user_id = $2 returning id`,
        [request.params.id, request.authContext.userId],
      );
      if (!result.rows[0]) return reply.code(404).send({ error: "desktop_device_not_found" });
      return reply.code(204).send();
    },
  );
}
