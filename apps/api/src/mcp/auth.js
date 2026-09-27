/**
 * Sign-in for connectors: OAuth 2.1 with PKCE and dynamic client
 * registration, as MCP clients such as Meta Muse expect. Instead of copying
 * an API key, the user gets a sign-in link, approves the app on Posterract's
 * /connect page, and the app receives short-lived access tokens (1 hour)
 * with rotating refresh tokens (60 days).
 *
 *   GET  /.well-known/oauth-protected-resource    what the MCP endpoint is and who signs in for it (RFC 9728)
 *   GET  /.well-known/oauth-authorization-server  the endpoints below (RFC 8414)
 *   POST /v1/oauth/register                        a client registers itself (RFC 7591)
 *   GET  /v1/oauth/authorize                       starts sign-in; sends the browser to /connect
 *   GET  /v1/oauth/requests/:id                    what /connect shows (signed-in user)
 *   POST /v1/oauth/requests/:id/decision           the user allows or denies
 *   POST /v1/oauth/token                           code or refresh token for tokens
 *   POST /v1/oauth/revoke                          a client ends its connection (RFC 7009)
 *   GET  /v1/oauth/connections, DELETE .../:id     the user's connected apps, in Settings
 *
 * A connection (oauth_grants) belongs to one workspace. Revoking it, reusing
 * a spent code, or reusing a refresh token more than a minute after it was
 * spent ends all of its tokens at once.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const CONNECTOR_SCOPES = [
  "accounts:read",
  "posts:read",
  "posts:write",
  "media:write",
  "analytics:read",
  "points:read",
];

/** What each scope lets a connected app do, as the /connect page words it. */
export const SCOPE_LABELS = {
  "accounts:read": "See your connected Instagram, Facebook and Threads accounts",
  "posts:read": "See your calendar and your posts",
  "posts:write": "Post, schedule, move and cancel posts (it asks you first)",
  "media:write": "Add videos to your library",
  "analytics:read": "See your analytics",
  "points:read": "See your points, rank and the leaderboard",
};

const ACCESS_TTL_SECONDS = 3600;
const REFRESH_TTL_DAYS = 60;
const REFRESH_GRACE_SECONDS = 60;
const REQUEST_TTL_MINUTES = 15;
const CODE_TTL_MINUTES = 5;
const REGISTRATIONS_PER_HOUR = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const hash = (value) => createHash("sha256").update(value).digest("hex");
const secret = (prefix, bytes = 32) => `${prefix}${randomBytes(bytes).toString("base64url")}`;
const pkce = (verifier) => createHash("sha256").update(verifier).digest("base64url");

function sameText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Redirect URIs: https anywhere, http only for a loopback address (local tools). */
function validRedirect(uri) {
  if (typeof uri !== "string" || uri.length > 2048) return false;
  let url;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

function withQuery(uri, params) {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * The client_id from the form, or from HTTP Basic auth for clients that send
 * it there. Clients are public, so any secret alongside it is ignored.
 */
function clientIdOf(request, body) {
  if (typeof body.client_id === "string" && body.client_id) return body.client_id;
  const header = request.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return undefined;
  const user = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8").split(":")[0];
  try {
    return decodeURIComponent(user.replaceAll("+", " ")) || undefined;
  } catch {
    return undefined;
  }
}

function formBody(body) {
  if (typeof body === "string") return Object.fromEntries(new URLSearchParams(body));
  return body && typeof body === "object" ? body : {};
}

const oauthError = (reply, status, error, description) =>
  reply.code(status).header("cache-control", "no-store").send({ error, ...(description ? { error_description: description } : {}) });

/**
 * The connection behind an access token, or undefined when the token is
 * unknown, expired or revoked. The API's authenticate() calls this for
 * tokens starting with pr_oat_.
 */
export async function verifyConnectorToken(postgres, token) {
  const result = await postgres.query(
    `select g.id, g.workspace_id, g.scopes
     from oauth_tokens t
     join oauth_grants g on g.id = t.grant_id
     where t.token_hash = $1 and t.kind = 'access' and t.expires_at > now() and g.revoked_at is null`,
    [hash(token)],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  void postgres
    .query("update oauth_grants set last_used_at = now() where id = $1", [row.id])
    .catch(() => undefined);
  return { id: row.id, workspaceId: row.workspace_id, scopes: row.scopes };
}

async function issueTokens(database, grantId, scopes) {
  const access = secret("pr_oat_");
  const refresh = secret("pr_ort_");
  await database.query(
    `insert into oauth_tokens (token_hash, grant_id, kind, expires_at)
     values ($1, $3, 'access', now() + ($4 || ' seconds')::interval),
            ($2, $3, 'refresh', now() + ($5 || ' days')::interval)`,
    [hash(access), hash(refresh), grantId, String(ACCESS_TTL_SECONDS), String(REFRESH_TTL_DAYS)],
  );
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refresh,
    scope: scopes.join(" "),
  };
}

async function revokeGrant(database, grantId) {
  await database.query("update oauth_grants set revoked_at = coalesce(revoked_at, now()) where id = $1", [grantId]);
  await database.query("delete from oauth_tokens where grant_id = $1", [grantId]);
}

/**
 * Registers the sign-in routes. `requireSession` is the API's signed-in user
 * check (with an active plan); `publicApiUrl` is where the API is reached,
 * `siteUrl` where the web app is.
 */
export function registerConnectorAuthRoutes(app, { postgres, requireSession, requiredWorkspace, publicApiUrl, siteUrl }) {
  const issuer = publicApiUrl;
  const resource = `${publicApiUrl}/v1/mcp`;

  const protectedResource = async () => ({
    resource,
    authorization_servers: [issuer],
    scopes_supported: CONNECTOR_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Posterract",
  });
  app.get("/.well-known/oauth-protected-resource", protectedResource);
  app.get("/.well-known/oauth-protected-resource/v1/mcp", protectedResource);

  const serverMetadata = async () => ({
    issuer,
    authorization_endpoint: `${issuer}/v1/oauth/authorize`,
    token_endpoint: `${issuer}/v1/oauth/token`,
    registration_endpoint: `${issuer}/v1/oauth/register`,
    revocation_endpoint: `${issuer}/v1/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: CONNECTOR_SCOPES,
  });
  app.get("/.well-known/oauth-authorization-server", serverMetadata);
  app.get("/.well-known/openid-configuration", serverMetadata);

  app.post("/v1/oauth/register", async (request, reply) => {
    const body = request.body ?? {};
    const redirectUris = Array.isArray(body.redirect_uris) ? [...new Set(body.redirect_uris)] : [];
    if (redirectUris.length === 0 || redirectUris.length > 10 || !redirectUris.every(validRedirect)) {
      return oauthError(reply, 400, "invalid_redirect_uri", "redirect_uris must be https URLs (http only for localhost)");
    }
    // Every client is registered as public (PKCE, no secret), whatever
    // token_endpoint_auth_method it asked for; RFC 7591 lets the server
    // substitute its own values. Some MCP SDKs ask for client_secret_post by default.
    const recent = await postgres.query("select count(*)::int as n from oauth_clients where created_at > now() - interval '1 hour'");
    if (recent.rows[0].n >= REGISTRATIONS_PER_HOUR) {
      return oauthError(reply, 429, "temporarily_unavailable", "Too many registrations; try again later");
    }
    const name = typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim().slice(0, 100)
      : "An AI assistant";
    const clientId = secret("pc_", 18);
    const created = await postgres.query(
      "insert into oauth_clients (id, name, redirect_uris) values ($1, $2, $3) returning created_at",
      [clientId, name, redirectUris],
    );
    return reply.code(201).header("cache-control", "no-store").send({
      client_id: clientId,
      client_id_issued_at: Math.floor(new Date(created.rows[0].created_at).getTime() / 1000),
      client_name: name,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  app.get("/v1/oauth/authorize", async (request, reply) => {
    const query = request.query ?? {};
    const client = (await postgres.query("select id, redirect_uris from oauth_clients where id = $1", [query.client_id])).rows[0];
    if (!client) return oauthError(reply, 400, "invalid_client", "Unknown client_id");
    const redirectUri = query.redirect_uri ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : undefined);
    if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
      return oauthError(reply, 400, "invalid_request", "redirect_uri is not registered for this client");
    }
    // From here, problems go back to the client's redirect URI, as OAuth expects.
    const fail = (error, description) =>
      reply.redirect(withQuery(redirectUri, { error, error_description: description, state: query.state }));
    if (query.response_type !== "code") return fail("unsupported_response_type", "response_type must be code");
    if (typeof query.code_challenge !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(query.code_challenge)) {
      return fail("invalid_request", "A PKCE code_challenge is required");
    }
    if ((query.code_challenge_method ?? "plain") !== "S256") return fail("invalid_request", "code_challenge_method must be S256");
    const requested = typeof query.scope === "string" && query.scope.trim() ? query.scope.trim().split(/\s+/) : CONNECTOR_SCOPES;
    const scopes = CONNECTOR_SCOPES.filter((scope) => requested.includes(scope));
    if (scopes.length === 0) return fail("invalid_scope", `Ask for any of: ${CONNECTOR_SCOPES.join(" ")}`);
    const requestId = secret("", 24);
    await postgres.query(
      `insert into oauth_requests (id, client_id, redirect_uri, code_challenge, scopes, state, expires_at)
       values ($1, $2, $3, $4, $5, $6, now() + ($7 || ' minutes')::interval)`,
      [requestId, client.id, redirectUri, query.code_challenge, scopes, typeof query.state === "string" ? query.state.slice(0, 1024) : null, String(REQUEST_TTL_MINUTES)],
    );
    return reply.redirect(`${siteUrl}/connect?request=${encodeURIComponent(requestId)}`);
  });

  async function loadRequest(id) {
    const result = await postgres.query(
      `select r.*, c.name as client_name
       from oauth_requests r join oauth_clients c on c.id = r.client_id
       where r.id = $1 and r.expires_at > now()`,
      [id],
    );
    return result.rows[0];
  }

  app.get("/v1/oauth/requests/:id", { preHandler: requireSession }, async (request, reply) => {
    const pending = await loadRequest(request.params.id);
    if (!pending) return reply.code(404).send({ error: "request_expired" });
    return {
      requestId: pending.id,
      appName: pending.client_name,
      returnsTo: new URL(pending.redirect_uri).host,
      permissions: pending.scopes.map((scope) => ({ scope, label: SCOPE_LABELS[scope] })),
      expiresAt: new Date(pending.expires_at).getTime(),
    };
  });

  app.post("/v1/oauth/requests/:id/decision", { preHandler: requireSession }, async (request, reply) => {
    const pending = await loadRequest(request.params.id);
    if (!pending) return reply.code(404).send({ error: "request_expired" });
    await postgres.query("delete from oauth_requests where id = $1", [pending.id]);
    if (request.body?.approve !== true) {
      return { redirect: withQuery(pending.redirect_uri, { error: "access_denied", state: pending.state }) };
    }
    const grant = await postgres.query(
      `insert into oauth_grants (client_id, workspace_id, user_id, scopes)
       values ($1, $2, $3, $4) returning id`,
      [pending.client_id, requiredWorkspace(request), request.authContext.userId ?? null, pending.scopes],
    );
    const code = secret("pr_oac_");
    await postgres.query(
      `insert into oauth_codes (code_hash, grant_id, redirect_uri, code_challenge, expires_at)
       values ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)`,
      [hash(code), grant.rows[0].id, pending.redirect_uri, pending.code_challenge, String(CODE_TTL_MINUTES)],
    );
    return { redirect: withQuery(pending.redirect_uri, { code, state: pending.state }) };
  });

  app.post("/v1/oauth/token", async (request, reply) => {
    const body = formBody(request.body);
    const clientId = clientIdOf(request, body);
    if (body.grant_type === "authorization_code") {
      if (!body.code || !body.code_verifier || !clientId) {
        return oauthError(reply, 400, "invalid_request", "code, code_verifier and client_id are required");
      }
      const found = await postgres.query(
        `select c.*, g.client_id, g.scopes, g.revoked_at
         from oauth_codes c join oauth_grants g on g.id = c.grant_id
         where c.code_hash = $1`,
        [hash(body.code)],
      );
      const code = found.rows[0];
      if (!code || code.revoked_at) return oauthError(reply, 400, "invalid_grant", "Unknown or expired code");
      if (code.used_at) {
        // A spent code used again: someone may have intercepted it.
        await revokeGrant(postgres, code.grant_id);
        return oauthError(reply, 400, "invalid_grant", "Code already used");
      }
      if (new Date(code.expires_at).getTime() < Date.now()) return oauthError(reply, 400, "invalid_grant", "Code expired");
      if (!sameText(code.client_id, clientId)) return oauthError(reply, 400, "invalid_grant", "Code was issued to another client");
      if (body.redirect_uri && body.redirect_uri !== code.redirect_uri) return oauthError(reply, 400, "invalid_grant", "redirect_uri does not match");
      if (!sameText(pkce(body.code_verifier), code.code_challenge)) return oauthError(reply, 400, "invalid_grant", "PKCE verification failed");
      await postgres.query("update oauth_codes set used_at = now() where code_hash = $1", [code.code_hash]);
      return reply.header("cache-control", "no-store").send(await issueTokens(postgres, code.grant_id, code.scopes));
    }
    if (body.grant_type === "refresh_token") {
      if (!body.refresh_token || !clientId) return oauthError(reply, 400, "invalid_request", "refresh_token and client_id are required");
      const found = await postgres.query(
        `select t.*, g.client_id, g.scopes, g.revoked_at,
                t.used_at < now() - ($2 || ' seconds')::interval as spent_long_ago
         from oauth_tokens t join oauth_grants g on g.id = t.grant_id
         where t.token_hash = $1 and t.kind = 'refresh'`,
        [hash(body.refresh_token), String(REFRESH_GRACE_SECONDS)],
      );
      const token = found.rows[0];
      if (!token || token.revoked_at || new Date(token.expires_at).getTime() < Date.now()) {
        return oauthError(reply, 400, "invalid_grant", "Unknown or expired refresh token");
      }
      if (!sameText(token.client_id, clientId)) return oauthError(reply, 400, "invalid_grant", "Token was issued to another client");
      if (token.spent_long_ago) {
        // Refresh tokens rotate; an old one coming back later means it leaked.
        await revokeGrant(postgres, token.grant_id);
        return oauthError(reply, 400, "invalid_grant", "Refresh token already used");
      }
      // An app doing several things at once can refresh with the same token
      // twice. Within the grace period (counted from the first use) each
      // request gets fresh tokens instead of ending the connection.
      await postgres.query("update oauth_tokens set used_at = coalesce(used_at, now()) where token_hash = $1", [token.token_hash]);
      await postgres.query("delete from oauth_tokens where grant_id = $1 and kind = 'access' and expires_at < now()", [token.grant_id]);
      return reply.header("cache-control", "no-store").send(await issueTokens(postgres, token.grant_id, token.scopes));
    }
    return oauthError(reply, 400, "unsupported_grant_type", "Use authorization_code or refresh_token");
  });

  app.post("/v1/oauth/revoke", async (request, reply) => {
    const body = formBody(request.body);
    if (typeof body.token === "string") {
      const found = await postgres.query("select grant_id from oauth_tokens where token_hash = $1", [hash(body.token)]);
      if (found.rows[0]) await revokeGrant(postgres, found.rows[0].grant_id);
    }
    return reply.code(200).send({});
  });

  app.get("/v1/oauth/connections", { preHandler: requireSession }, async (request) => {
    const result = await postgres.query(
      `select g.id, c.name, g.scopes, g.created_at, g.last_used_at
       from oauth_grants g join oauth_clients c on c.id = g.client_id
       where g.workspace_id = $1 and g.revoked_at is null
       order by g.created_at desc`,
      [requiredWorkspace(request)],
    );
    return {
      connections: result.rows.map((row) => ({
        id: row.id,
        appName: row.name,
        permissions: row.scopes,
        connectedAt: new Date(row.created_at).getTime(),
        lastUsedAt: row.last_used_at ? new Date(row.last_used_at).getTime() : undefined,
      })),
    };
  });

  app.delete("/v1/oauth/connections/:id", { preHandler: requireSession }, async (request, reply) => {
    if (!UUID.test(request.params.id)) return reply.code(404).send({ error: "connection_not_found" });
    const found = await postgres.query(
      "select id from oauth_grants where id = $1 and workspace_id = $2 and revoked_at is null",
      [request.params.id, requiredWorkspace(request)],
    );
    if (!found.rows[0]) return reply.code(404).send({ error: "connection_not_found" });
    await revokeGrant(postgres, found.rows[0].id);
    return reply.code(204).send();
  });
}
