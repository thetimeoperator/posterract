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
} from "../../web/convex/connectors/instagram.ts";
import {
  THREADS_SCOPES,
  threadsAuthUrl,
  threadsExchangeCode,
} from "../../web/convex/connectors/threads.ts";
import {
  TIKTOK_SCOPES,
  tiktokAuthUrl,
  tiktokExchangeCode,
} from "../../web/convex/connectors/tiktok.ts";
import {
  YOUTUBE_SCOPES,
  youtubeAuthUrl,
  youtubeExchangeCode,
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

async function saveConnection(database, workspaceId, provider, connection) {
  const client = await database.connect();
  try {
    await client.query("begin");
    const account = await client.query(
      `insert into social_accounts
        (workspace_id, provider, provider_account_id, handle, display_name,
         status, scopes, token_expires_at, provider_auth_user_id, metadata,
         updated_at)
       values ($1, $2, $3, $4, $5, 'connected', $6, $7, $8, '{}', now())
       on conflict (workspace_id, provider) do update
       set provider_account_id = excluded.provider_account_id,
           handle = excluded.handle,
           display_name = excluded.display_name,
           status = 'connected',
           scopes = excluded.scopes,
           token_expires_at = excluded.token_expires_at,
           provider_auth_user_id = excluded.provider_auth_user_id,
           updated_at = now()
       returning id`,
      [
        workspaceId,
        provider,
        connection.providerAccountId,
        connection.handle,
        connection.displayName ?? null,
        [...(connection.scopes ?? [])],
        connection.expiresAt ? new Date(connection.expiresAt) : null,
        connection.providerAuthUserId ?? null,
      ],
    );
    const accountId = account.rows[0].id;
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
    "/v1/accounts/:provider",
    { preHandler: requireScope("accounts:write") },
    async (request, reply) => {
      const { provider } = request.params;
      if (!OAUTH_PROVIDERS.has(provider)) {
        return reply.code(400).send({ error: "provider_not_supported" });
      }
      const workspaceId = requiredWorkspace(request);
      const result = await postgres.query(
        `select a.id, t.access_token_ciphertext, t.refresh_token_ciphertext
         from social_accounts a
         left join social_account_tokens t on t.social_account_id = a.id
         where a.workspace_id = $1 and a.provider = $2`,
        [workspaceId, provider],
      );
      const account = result.rows[0];
      if (!account) return reply.code(204).send();

      try {
        const accessToken = decryptSecret(account.access_token_ciphertext);
        const refreshToken = decryptSecret(account.refresh_token_ciphertext);
        if (provider === "youtube" && (refreshToken || accessToken)) {
          await youtubeRevokeToken(refreshToken || accessToken);
        }
        if (provider === "facebook" && refreshToken) {
          await facebookRevokeGrant(refreshToken);
        }
      } catch (error) {
        request.log.warn({ err: error, provider }, "provider revoke failed; clearing locally");
      }

      const client = await postgres.connect();
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
           set provider_account_id = null, provider_auth_user_id = null,
               handle = 'not connected', display_name = null, avatar_url = null,
               status = 'disconnected', scopes = '{}', token_expires_at = null,
               metadata = '{}', updated_at = now()
           where id = $1`,
          [account.id],
        );
        await client.query(
          `insert into events (workspace_id, type, message, payload)
           values ($1, 'portal.disconnected', $2, $3)`,
          [
            workspaceId,
            `${provider} disconnected`,
            JSON.stringify({ provider, socialAccountId: account.id }),
          ],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      return reply.code(204).send();
    },
  );
}
