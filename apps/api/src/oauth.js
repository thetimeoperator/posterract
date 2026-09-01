import { createHash, randomBytes } from "node:crypto";
import {
  FACEBOOK_PAGE_SCOPES,
  facebookAuthenticatedUserId,
  facebookAuthUrl,
  facebookExchangeCode,
  facebookListPages,
  facebookRevokeGrant,
} from "../../web/convex/connectors/facebook.ts";
import {
  IG_SCOPES,
  instagramAuthUrl,
  instagramExchangeCode,
  instagramRefreshToken,
} from "../../web/convex/connectors/instagram.ts";
import {
  THREADS_SCOPES,
  threadsAuthUrl,
  threadsExchangeCode,
  threadsRefreshToken,
} from "../../web/convex/connectors/threads.ts";
import {
  TIKTOK_SCOPES,
  tiktokAuthUrl,
  tiktokExchangeCode,
  tiktokRefreshToken,
} from "../../web/convex/connectors/tiktok.ts";
import {
  YOUTUBE_SCOPES,
  youtubeAuthUrl,
  youtubeExchangeCode,
  youtubeGetMyChannel,
  youtubeRefreshToken,
  youtubeRevokeToken,
} from "../../web/convex/connectors/youtube.ts";
import { decryptSecret, encryptSecret } from "./security.js";

export const OAUTH_PROVIDERS = new Set([
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
  "threads",
]);

const PROFILE_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

const hashState = (state) =>
  createHash("sha256").update(state).digest("hex");

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function redirectUri(provider) {
  const siteUrl = (process.env.SITE_URL ?? "https://www.posterract.app").replace(
    /\/+$/,
    "",
  );
  return `${siteUrl}/oauth/callback/${provider}`;
}

function authorizationUrl(provider, state) {
  const uri = redirectUri(provider);
  if (provider === "instagram") {
    return instagramAuthUrl({
      clientId: requiredEnvironment("INSTAGRAM_APP_ID"),
      redirectUri: uri,
      state,
    });
  }
  if (provider === "tiktok") {
    return tiktokAuthUrl({
      clientKey: requiredEnvironment("TIKTOK_CLIENT_KEY"),
      redirectUri: uri,
      state,
    });
  }
  if (provider === "youtube") {
    return youtubeAuthUrl({
      clientId: requiredEnvironment("YOUTUBE_CLIENT_ID"),
      redirectUri: uri,
      state,
    });
  }
  if (provider === "facebook") {
    return facebookAuthUrl({
      clientId: requiredEnvironment("FACEBOOK_APP_ID"),
      redirectUri: uri,
      state,
      configId: process.env.FACEBOOK_LOGIN_CONFIG_ID,
    });
  }
  if (provider === "threads") {
    return threadsAuthUrl({
      clientId: requiredEnvironment("THREADS_APP_ID"),
      redirectUri: uri,
      state,
    });
  }
  throw new Error(`${provider} OAuth is not supported`);
}

async function exchange(provider, code) {
  const uri = redirectUri(provider);
  if (provider === "instagram") {
    const token = await instagramExchangeCode({
      clientId: requiredEnvironment("INSTAGRAM_APP_ID"),
      clientSecret: requiredEnvironment("INSTAGRAM_APP_SECRET"),
      redirectUri: uri,
      code,
    });
    return {
      handle: `@${token.username}`,
      displayName: token.username,
      avatarUrl: token.avatarUrl,
      providerAccountId: token.userId,
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      providerUserId: token.userId,
      scopes: IG_SCOPES,
    };
  }
  if (provider === "tiktok") {
    const token = await tiktokExchangeCode({
      clientKey: requiredEnvironment("TIKTOK_CLIENT_KEY"),
      clientSecret: requiredEnvironment("TIKTOK_CLIENT_SECRET"),
      redirectUri: uri,
      code,
    });
    return {
      handle: token.displayName,
      displayName: token.displayName,
      avatarUrl: token.avatarUrl,
      providerAccountId: token.openId,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      refreshExpiresAt: token.refreshExpiresAt,
      providerUserId: token.openId,
      scopes: token.scopes.length ? token.scopes : [...TIKTOK_SCOPES],
    };
  }
  if (provider === "youtube") {
    const token = await youtubeExchangeCode({
      clientId: requiredEnvironment("YOUTUBE_CLIENT_ID"),
      clientSecret: requiredEnvironment("YOUTUBE_CLIENT_SECRET"),
      redirectUri: uri,
      code,
    });
    return {
      handle: token.handle || token.channelTitle,
      displayName: token.channelTitle,
      avatarUrl: token.avatarUrl,
      providerAccountId: token.channelId,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      providerUserId: token.channelId,
      scopes: token.scopes.length ? token.scopes : [...YOUTUBE_SCOPES],
    };
  }
  if (provider === "threads") {
    const token = await threadsExchangeCode({
      clientId: requiredEnvironment("THREADS_APP_ID"),
      clientSecret: requiredEnvironment("THREADS_APP_SECRET"),
      redirectUri: uri,
      code,
    });
    return {
      handle: `@${token.username}`,
      displayName: token.username,
      avatarUrl: token.avatarUrl,
      providerAccountId: token.userId,
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      providerUserId: token.userId,
      scopes: token.scopes.length ? token.scopes : [...THREADS_SCOPES],
    };
  }
  if (provider === "facebook") {
    const clientId = requiredEnvironment("FACEBOOK_APP_ID");
    const clientSecret = requiredEnvironment("FACEBOOK_APP_SECRET");
    const token = await facebookExchangeCode({
      clientId,
      clientSecret,
      redirectUri: uri,
      code,
      configuredAccessToken: Boolean(process.env.FACEBOOK_LOGIN_CONFIG_ID),
    });
    const authUserId = await facebookAuthenticatedUserId(token.accessToken);
    const pages = await facebookListPages({
      userAccessToken: token.accessToken,
      clientId,
      clientSecret,
    });
    if (pages.length === 0) {
      throw new Error(
        "No manageable Facebook Pages were returned. Approve every requested permission and use an account with full Page access.",
      );
    }
    return {
      facebookSelection: {
        userAccessToken: token.accessToken,
        authUserId,
        expiresAt: token.expiresAt,
        scopes: token.scopes,
        pages,
      },
    };
  }
  throw new Error(`${provider} OAuth is not supported`);
}

async function freshProfileAccessToken(database, row) {
  const accessToken = decryptSecret(row.access_token_ciphertext);
  const refreshToken = decryptSecret(row.refresh_token_ciphertext);
  if (!accessToken) throw new Error("This account has no access token");

  const expiresAt = row.access_token_expires_at
    ? new Date(row.access_token_expires_at).getTime()
    : undefined;
  if (
    row.provider === "facebook" ||
    !expiresAt ||
    expiresAt > Date.now() + 60_000
  ) {
    return accessToken;
  }

  let refreshed;
  if (row.provider === "instagram") {
    refreshed = await instagramRefreshToken(accessToken);
  } else if (row.provider === "threads") {
    refreshed = await threadsRefreshToken(accessToken);
  } else if (row.provider === "tiktok") {
    if (!refreshToken) throw new Error("TikTok refresh token is missing");
    refreshed = await tiktokRefreshToken({
      clientKey: requiredEnvironment("TIKTOK_CLIENT_KEY"),
      clientSecret: requiredEnvironment("TIKTOK_CLIENT_SECRET"),
      refreshToken,
    });
  } else if (row.provider === "youtube") {
    if (!refreshToken) throw new Error("YouTube refresh token is missing");
    refreshed = await youtubeRefreshToken({
      clientId: requiredEnvironment("YOUTUBE_CLIENT_ID"),
      clientSecret: requiredEnvironment("YOUTUBE_CLIENT_SECRET"),
      refreshToken,
    });
  } else {
    return accessToken;
  }

  const nextRefreshToken = refreshed.refreshToken ?? refreshToken;
  await database.query(
    `update social_account_tokens
     set access_token_ciphertext = $2,
         refresh_token_ciphertext = $3,
         access_token_expires_at = $4,
         refresh_expires_at = coalesce($5, refresh_expires_at),
         updated_at = now()
     where social_account_id = $1`,
    [
      row.id,
      encryptSecret(refreshed.accessToken),
      encryptSecret(nextRefreshToken),
      refreshed.expiresAt ? new Date(refreshed.expiresAt) : null,
      refreshed.refreshExpiresAt
        ? new Date(refreshed.refreshExpiresAt)
        : null,
    ],
  );
  return refreshed.accessToken;
}

async function providerProfile(provider, providerAccountId, accessToken) {
  if (provider === "youtube") {
    const channel = await youtubeGetMyChannel(accessToken);
    return {
      avatarUrl: channel.avatarUrl,
      displayName: channel.title,
      handle: channel.handle || channel.title,
    };
  }

  let url;
  if (provider === "instagram") {
    url = new URL("https://graph.instagram.com/me");
    url.searchParams.set("fields", "user_id,username,profile_picture_url");
    url.searchParams.set("access_token", accessToken);
  } else if (provider === "threads") {
    url = new URL("https://graph.threads.net/v1.0/me");
    url.searchParams.set("fields", "id,username,threads_profile_picture_url");
    url.searchParams.set("access_token", accessToken);
  } else if (provider === "tiktok") {
    url = new URL("https://open.tiktokapis.com/v2/user/info/");
    url.searchParams.set(
      "fields",
      "open_id,display_name,avatar_large_url,avatar_url_100,avatar_url",
    );
  } else if (provider === "facebook") {
    // The dedicated Page picture edge is publicly readable and does not
    // require impersonating the Page. That also keeps legacy Page records
    // working when their old token cannot read the full Page object.
    url = new URL(
      `https://graph.facebook.com/v23.0/${providerAccountId}/picture`,
    );
    url.searchParams.set("type", "large");
    url.searchParams.set("redirect", "false");
  } else {
    throw new Error(`${provider} profiles are not supported`);
  }

  const response = await fetch(url, {
    headers:
      provider === "tiktok"
        ? { Authorization: `Bearer ${accessToken}` }
        : undefined,
  });
  const body = await response.json();
  const providerError = body?.error?.message ?? body?.error?.code;
  if (
    !response.ok ||
    (provider === "tiktok" && body?.error?.code && body.error.code !== "ok")
  ) {
    throw new Error(`${provider} profile lookup failed: ${providerError ?? response.status}`);
  }

  if (provider === "instagram") {
    return {
      avatarUrl: body.profile_picture_url,
      displayName: body.username,
      handle: body.username ? `@${body.username}` : undefined,
    };
  }
  if (provider === "threads") {
    return {
      avatarUrl: body.threads_profile_picture_url,
      displayName: body.username,
      handle: body.username ? `@${body.username}` : undefined,
    };
  }
  if (provider === "tiktok") {
    const user = body.data?.user;
    return {
      avatarUrl:
        user?.avatar_large_url ?? user?.avatar_url_100 ?? user?.avatar_url,
      displayName: user?.display_name,
      handle: user?.display_name,
    };
  }
  return {
    avatarUrl: body.data?.url,
  };
}

export async function refreshAccountProfiles(database, workspaceId, options = {}) {
  const now = Date.now();
  const result = await database.query(
    `select a.id, a.provider, a.provider_account_id, a.avatar_url, a.metadata,
            t.access_token_ciphertext, t.refresh_token_ciphertext,
            t.access_token_expires_at, t.refresh_expires_at
     from social_accounts a
     join social_account_tokens t on t.social_account_id = a.id
     where a.workspace_id = $1 and a.status = 'connected'
       and a.provider_account_id is not null`,
    [workspaceId],
  );
  const candidates = result.rows.filter((row) => {
    if (options.force) return true;
    const refreshedAt = Number(row.metadata?.profileRefreshedAt ?? 0);
    const attemptedAt = Number(row.metadata?.profileRefreshAttemptedAt ?? 0);
    const lastAttempt = Math.max(refreshedAt, attemptedAt);
    return !lastAttempt || now - lastAttempt >= PROFILE_REFRESH_INTERVAL_MS;
  });

  const outcomes = await Promise.all(
    candidates.map(async (row) => {
      try {
        const accessToken = await freshProfileAccessToken(database, row);
        let profile;
        try {
          profile = await providerProfile(
            row.provider,
            row.provider_account_id,
            accessToken,
          );
        } catch (error) {
          // Legacy Facebook rows can contain a user grant in the primary
          // token slot. The separately encrypted user grant is authorized to
          // read the selected Page identity and is safe for this read-only
          // fallback.
          const facebookUserToken =
            row.provider === "facebook"
              ? decryptSecret(row.refresh_token_ciphertext)
              : undefined;
          if (!facebookUserToken || facebookUserToken === accessToken) throw error;
          profile = await providerProfile(
            row.provider,
            row.provider_account_id,
            facebookUserToken,
          );
        }
        if (!profile.avatarUrl) {
          throw new Error(`${row.provider} returned no profile image`);
        }
        await database.query(
          `update social_accounts
           set avatar_url = $2,
               display_name = coalesce($3, display_name),
               handle = coalesce($4, handle),
               metadata = coalesce(metadata, '{}'::jsonb) ||
                 jsonb_build_object('profileRefreshedAt', $5::bigint),
               updated_at = now()
           where id = $1 and workspace_id = $6`,
          [
            row.id,
            profile.avatarUrl,
            profile.displayName ?? null,
            profile.handle ?? null,
            now,
            workspaceId,
          ],
        );
        return { ok: true, provider: row.provider };
      } catch (error) {
        await database.query(
          `update social_accounts
           set metadata = coalesce(metadata, '{}'::jsonb) ||
             jsonb_build_object('profileRefreshAttemptedAt', $2::bigint)
           where id = $1 and workspace_id = $3`,
          [row.id, now, workspaceId],
        );
        return {
          ok: false,
          provider: row.provider,
          message: error instanceof Error ? error.message : "Profile refresh failed",
        };
      }
    }),
  );

  return {
    checked: outcomes.length,
    refreshed: outcomes.filter((outcome) => outcome.ok).length,
    failures: outcomes.filter((outcome) => !outcome.ok),
  };
}

async function saveConnection(database, workspaceId, provider, connection) {
  const client = await database.connect();
  try {
    await client.query("begin");
    // Serialize account additions within the workspace so concurrent OAuth
    // callbacks cannot race past the ten-account provider cap.
    await client.query("select id from workspaces where id = $1 for update", [workspaceId]);
    const existing = await client.query(
      `select id from social_accounts
       where workspace_id = $1 and provider = $2 and provider_account_id = $3
       limit 1 for update`,
      [workspaceId, provider, connection.providerAccountId],
    );
    let accountId = existing.rows[0]?.id;
    if (!accountId) {
      const count = await client.query(
        `select count(*)::int as count from social_accounts
         where workspace_id = $1 and provider = $2 and status = 'connected'`,
        [workspaceId, provider],
      );
      if (Number(count.rows[0]?.count ?? 0) >= 10) {
        const error = new Error(`You can connect up to 10 ${provider} accounts.`);
        error.code = "account_limit_reached";
        throw error;
      }
      const placeholder = await client.query(
        `select id from social_accounts
         where workspace_id = $1 and provider = $2 and provider_account_id is null
         order by created_at asc limit 1 for update`,
        [workspaceId, provider],
      );
      accountId = placeholder.rows[0]?.id ?? null;
      if (!accountId) {
        const inserted = await client.query(
          `insert into social_accounts
            (workspace_id, provider, provider_account_id, handle, display_name,
             avatar_url, status, scopes, token_expires_at,
             provider_auth_user_id, metadata, updated_at)
           values ($1, $2, $3, $4, $5, $6, 'connected', $7, $8, $9, '{}', now())
           returning id`,
          [
            workspaceId,
            provider,
            connection.providerAccountId,
            connection.handle,
            connection.displayName ?? null,
            connection.avatarUrl ?? null,
            [...(connection.scopes ?? [])],
            connection.expiresAt ? new Date(connection.expiresAt) : null,
            connection.providerAuthUserId ?? null,
          ],
        );
        accountId = inserted.rows[0].id;
      }
    }
    await client.query(
      `update social_accounts
       set provider_account_id = $3, handle = $4, display_name = $5,
           avatar_url = $6, status = 'connected', scopes = $7,
           token_expires_at = $8, provider_auth_user_id = $9,
           updated_at = now()
       where id = $1 and workspace_id = $2`,
      [
        accountId,
        workspaceId,
        connection.providerAccountId,
        connection.handle,
        connection.displayName ?? null,
        connection.avatarUrl ?? null,
        [...(connection.scopes ?? [])],
        connection.expiresAt ? new Date(connection.expiresAt) : null,
        connection.providerAuthUserId ?? null,
      ],
    );
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
        accountId,
        encryptSecret(connection.accessToken),
        encryptSecret(connection.refreshToken),
        connection.expiresAt ? new Date(connection.expiresAt) : null,
        connection.refreshExpiresAt
          ? new Date(connection.refreshExpiresAt)
          : null,
        connection.providerUserId ?? null,
        connection.providerAuthUserId ?? null,
      ],
    );
    await client.query(
      `insert into events (workspace_id, type, message, payload)
       values ($1, 'portal.connected', $2, $3)`,
      [
        workspaceId,
        `${provider} connected — ${connection.handle}`,
        JSON.stringify({ provider, socialAccountId: accountId }),
      ],
    );
    await client.query("commit");
    return accountId;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function disconnectConnection(database, request, workspaceId, accountId) {
  const result = await database.query(
    `select a.id, a.provider, a.provider_auth_user_id,
            t.access_token_ciphertext, t.refresh_token_ciphertext
     from social_accounts a
     left join social_account_tokens t on t.social_account_id = a.id
     where a.id = $1 and a.workspace_id = $2`,
    [accountId, workspaceId],
  );
  const account = result.rows[0];
  if (!account) return false;

  try {
    const accessToken = decryptSecret(account.access_token_ciphertext);
    const refreshToken = decryptSecret(account.refresh_token_ciphertext);
    if (account.provider === "youtube" && (refreshToken || accessToken)) {
      await youtubeRevokeToken(refreshToken || accessToken);
    }
    if (account.provider === "facebook" && refreshToken) {
      const siblings = await database.query(
        `select count(*)::int as count
         from social_accounts
         where workspace_id = $1 and provider = 'facebook' and id <> $2
           and status = 'connected' and provider_auth_user_id = $3`,
        [workspaceId, account.id, account.provider_auth_user_id],
      );
      // Facebook Page connections may share one user grant. Revoking it while
      // another Page still uses it would disconnect the sibling Page too.
      if (Number(siblings.rows[0]?.count ?? 0) === 0) {
        await facebookRevokeGrant(refreshToken);
      }
    }
  } catch (error) {
    request.log.warn(
      { err: error, provider: account.provider, accountId },
      "provider revoke failed; clearing locally",
    );
  }

  const client = await database.connect();
  try {
    await client.query("begin");
    await client.query(
      "delete from social_account_tokens where social_account_id = $1",
      [account.id],
    );
    await client.query(
      `delete from publication_metric_snapshots
       where projection_id in (
         select id from projections where social_account_id = $1
       )`,
      [account.id],
    );
    await client.query(
      "delete from account_metric_snapshots where social_account_id = $1",
      [account.id],
    );
    await client.query(
      "delete from daily_metric_snapshots where social_account_id = $1",
      [account.id],
    );
    await client.query(
      `update social_accounts
       set status = 'disconnected', scopes = '{}', token_expires_at = null,
           metadata = '{}', updated_at = now()
       where id = $1`,
      [account.id],
    );
    await client.query(
      `insert into events (workspace_id, type, message, payload)
       values ($1, 'portal.disconnected', $2, $3)`,
      [
        workspaceId,
        `${account.provider} disconnected`,
        JSON.stringify({ provider: account.provider, socialAccountId: account.id }),
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return true;
}

export function registerOAuthRoutes(app, { postgres, requireScope, requiredWorkspace }) {
  app.post(
    "/v1/oauth/:provider/start",
    { preHandler: requireScope("accounts:write") },
    async (request, reply) => {
      const { provider } = request.params;
      if (!OAUTH_PROVIDERS.has(provider)) {
        return reply.code(400).send({ error: "provider_not_supported" });
      }
      const workspaceId = requiredWorkspace(request);
      const state = randomBytes(32).toString("base64url");
      let url;
      try {
        url = authorizationUrl(provider, state);
      } catch (error) {
        request.log.warn({ provider }, "OAuth provider is not configured");
        return reply.code(503).send({
          error: "provider_not_configured",
          message: error instanceof Error ? error.message : undefined,
        });
      }
      await postgres.query(
        `delete from oauth_states
         where expires_at <= now() or consumed_at is not null`,
      );
      await postgres.query(
        `insert into oauth_states
          (state_hash, workspace_id, provider, redirect_uri, expires_at)
         values ($1, $2, $3, $4, now() + interval '15 minutes')`,
        [hashState(state), workspaceId, provider, redirectUri(provider)],
      );
      return { url };
    },
  );

  app.post(
    "/v1/oauth/:provider/complete",
    { preHandler: requireScope("accounts:write") },
    async (request, reply) => {
      const { provider } = request.params;
      const { code, state } = request.body ?? {};
      if (
        !OAUTH_PROVIDERS.has(provider) ||
        typeof code !== "string" ||
        code.length < 2 ||
        typeof state !== "string" ||
        state.length < 16
      ) {
        return reply.code(400).send({ error: "invalid_oauth_callback" });
      }
      const workspaceId = requiredWorkspace(request);
      const claimed = await postgres.query(
        `update oauth_states
         set consumed_at = now()
         where state_hash = $1 and workspace_id = $2 and provider = $3
           and consumed_at is null and expires_at > now()
         returning state_hash`,
        [hashState(state), workspaceId, provider],
      );
      if (!claimed.rows[0]) {
        return {
          ok: false,
          error: "This connection link expired — try again.",
        };
      }

      try {
        const connection = await exchange(provider, code);
        if (connection.facebookSelection) {
          const pending = connection.facebookSelection;
          await postgres.query(
            `insert into pending_facebook_connections
              (state_hash, workspace_id, payload_ciphertext, expires_at)
             values ($1, $2, $3, now() + interval '15 minutes')
             on conflict (state_hash) do update
             set workspace_id = excluded.workspace_id,
                 payload_ciphertext = excluded.payload_ciphertext,
                 expires_at = excluded.expires_at,
                 created_at = now()`,
            [hashState(state), workspaceId, encryptSecret(pending)],
          );
          return {
            ok: true,
            selectionRequired: true,
            pages: pending.pages.map((page) => ({ id: page.id, name: page.name })),
          };
        }

        await saveConnection(postgres, workspaceId, provider, connection);
        await postgres.query("delete from oauth_states where state_hash = $1", [
          hashState(state),
        ]);
        return { ok: true, handle: connection.handle };
      } catch (error) {
        request.log.warn({ err: error, provider }, "OAuth completion failed");
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Connection failed",
        };
      }
    },
  );

  app.post(
    "/v1/oauth/facebook/select-page",
    { preHandler: requireScope("accounts:write") },
    async (request) => {
      const { state, pageId } = request.body ?? {};
      if (typeof state !== "string" || typeof pageId !== "string") {
        return { ok: false, error: "Invalid Facebook Page selection." };
      }
      const workspaceId = requiredWorkspace(request);
      const pendingResult = await postgres.query(
        `select payload_ciphertext
         from pending_facebook_connections
         where state_hash = $1 and workspace_id = $2 and expires_at > now()`,
        [hashState(state), workspaceId],
      );
      if (!pendingResult.rows[0]) {
        return {
          ok: false,
          error: "This Page selection expired — connect Facebook again.",
        };
      }
      const pending = JSON.parse(
        decryptSecret(pendingResult.rows[0].payload_ciphertext),
      );
      const page = pending.pages.find((candidate) => candidate.id === pageId);
      if (!page) {
        return { ok: false, error: "That Page is not available to this connection." };
      }
      await saveConnection(postgres, workspaceId, "facebook", {
        handle: page.name,
        displayName: page.name,
        providerAccountId: page.id,
        accessToken: page.accessToken,
        refreshToken: pending.userAccessToken,
        expiresAt: pending.expiresAt,
        providerUserId: page.id,
        providerAuthUserId: pending.authUserId,
        avatarUrl: page.avatarUrl,
        scopes: FACEBOOK_PAGE_SCOPES,
      });
      await postgres.query(
        `delete from pending_facebook_connections
         where state_hash = $1 and workspace_id = $2`,
        [hashState(state), workspaceId],
      );
      await postgres.query("delete from oauth_states where state_hash = $1", [
        hashState(state),
      ]);
      return { ok: true, handle: page.name };
    },
  );

  app.delete(
    "/v1/accounts/by-id/:accountId",
    { preHandler: requireScope("accounts:write") },
    async (request, reply) => {
      const workspaceId = requiredWorkspace(request);
      await disconnectConnection(
        postgres,
        request,
        workspaceId,
        request.params.accountId,
      );
      return reply.code(204).send();
    },
  );

  app.post(
    "/v1/accounts/refresh-profiles",
    { preHandler: requireScope("accounts:write") },
    async (request) => {
      const result = await refreshAccountProfiles(
        postgres,
        requiredWorkspace(request),
      );
      if (result.failures.length > 0) {
        request.log.warn(
          { failures: result.failures },
          "Some social account profiles could not be refreshed",
        );
      }
      return result;
    },
  );

  // Backwards-compatible provider route for older web/desktop builds. It
  // disconnects only the most recently used account instead of every account.
  app.delete(
    "/v1/accounts/:provider",
    { preHandler: requireScope("accounts:write") },
    async (request, reply) => {
      const { provider } = request.params;
      if (!OAUTH_PROVIDERS.has(provider)) {
        return reply.code(400).send({ error: "provider_not_supported" });
      }
      const workspaceId = requiredWorkspace(request);
      const result = await postgres.query(
        `select id from social_accounts
         where workspace_id = $1 and provider = $2 and status <> 'disconnected'
         order by updated_at desc limit 1`,
        [workspaceId, provider],
      );
      if (result.rows[0]) {
        await disconnectConnection(
          postgres,
          request,
          workspaceId,
          result.rows[0].id,
        );
      }
      return reply.code(204).send();
    },
  );
}
