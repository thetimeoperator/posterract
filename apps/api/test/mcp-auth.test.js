import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { registerConnectorAuthRoutes, verifyConnectorToken } from "../src/mcp/auth.js";
import { registerMcpRoutes } from "../src/mcp/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = resolve(here, "../../../deploy/posterract/postgres/init");
const API = "https://api.test";
const SITE = "https://www.test";
const CALLBACK = "https://muse.example/callback";

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  const files = (await readdir(migrationDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of files) await db.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
  const query = (sql, params) => db.query(sql, params);
  return { query, connect: async () => ({ query, release() {} }) };
}

/** The sign-in routes on a small app; a "session=ok" cookie stands in for a signed-in user with a plan. */
async function harness() {
  const postgres = await database();
  const user = (await postgres.query("insert into app_users (email, display_name, email_verified) values ('c@example.com', 'Creator', true) returning id")).rows[0];
  const workspaceId = (await postgres.query("insert into workspaces (owner_id, name) values ($1, 'Creator HQ') returning id", [user.id])).rows[0].id;

  const app = Fastify();
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => done(null, body));
  const requireSession = async (request, reply) => {
    if (request.headers.cookie !== "session=ok") return reply.code(401).send({ error: "unauthorized" });
    request.authContext = { kind: "session", userId: user.id, workspaceId };
  };
  const requiredWorkspace = (request) => request.authContext.workspaceId;
  registerConnectorAuthRoutes(app, { postgres, requireSession, requiredWorkspace, publicApiUrl: API, siteUrl: SITE });
  registerMcpRoutes(app, {
    postgres,
    authenticate: async (_request, reply) => reply.code(401).send({ error: "unauthorized" }),
    resourceMetadataUrl: `${API}/.well-known/oauth-protected-resource/v1/mcp`,
  });

  const json = (response) => (response.body ? JSON.parse(response.body) : undefined);
  const session = { cookie: "session=ok" };
  const form = (url, fields) =>
    app.inject({
      method: "POST",
      url,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams(fields).toString(),
    });

  const register = async (metadata = { client_name: "Muse", redirect_uris: [CALLBACK] }) =>
    app.inject({ method: "POST", url: "/v1/oauth/register", payload: metadata });

  /** Register, start sign-in and approve: what Muse and the user do together. Returns a fresh code. */
  async function signIn({ scope, approve = true } = {}) {
    const clientId = json(await register()).client_id;
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
      ...(scope ? { scope } : {}),
    });
    const started = await app.inject({ method: "GET", url: `/v1/oauth/authorize?${query}` });
    assert.equal(started.statusCode, 302);
    const connectUrl = new URL(started.headers.location);
    assert.equal(`${connectUrl.origin}${connectUrl.pathname}`, `${SITE}/connect`);
    const requestId = connectUrl.searchParams.get("request");
    const decided = await app.inject({
      method: "POST",
      url: `/v1/oauth/requests/${requestId}/decision`,
      headers: session,
      payload: { approve },
    });
    const back = new URL(json(decided).redirect);
    return { clientId, verifier, requestId, back, code: back.searchParams.get("code") };
  }

  const exchange = (clientId, code, verifier) =>
    form("/v1/oauth/token", { grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: CALLBACK });
  const refresh = (clientId, refreshToken) =>
    form("/v1/oauth/token", { grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken });

  return { app, postgres, workspaceId, json, session, form, register, signIn, exchange, refresh };
}

test("discovery points MCP clients at Posterract's sign-in", async () => {
  const { app, json } = await harness();
  for (const url of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/v1/mcp"]) {
    const resource = json(await app.inject({ method: "GET", url }));
    assert.equal(resource.resource, `${API}/v1/mcp`);
    assert.deepEqual(resource.authorization_servers, [API]);
  }
  for (const url of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
    const server = json(await app.inject({ method: "GET", url }));
    assert.equal(server.issuer, API);
    assert.equal(server.authorization_endpoint, `${API}/v1/oauth/authorize`);
    assert.equal(server.token_endpoint, `${API}/v1/oauth/token`);
    assert.equal(server.registration_endpoint, `${API}/v1/oauth/register`);
    assert.deepEqual(server.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(server.token_endpoint_auth_methods_supported, ["none"]);
  }

  const denied = await app.inject({ method: "POST", url: "/v1/mcp", payload: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  assert.equal(denied.statusCode, 401);
  assert.equal(
    denied.headers["www-authenticate"],
    `Bearer realm="posterract", resource_metadata="${API}/.well-known/oauth-protected-resource/v1/mcp"`,
  );
});

test("clients register themselves; only public clients with safe redirect addresses", async () => {
  const { json, register } = await harness();
  const created = await register();
  assert.equal(created.statusCode, 201);
  const client = json(created);
  assert.match(client.client_id, /^pc_/);
  assert.equal(client.client_name, "Muse");
  assert.equal(client.token_endpoint_auth_method, "none");

  assert.equal((await register({ redirect_uris: ["http://127.0.0.1:8123/cb"] })).statusCode, 201);
  assert.equal((await register({ redirect_uris: ["http://muse.example/cb"] })).statusCode, 400);
  assert.equal((await register({ redirect_uris: ["https://muse.example/cb#frag"] })).statusCode, 400);
  assert.equal((await register({ redirect_uris: [] })).statusCode, 400);

  // Clients that ask for a secret are registered as public clients instead.
  const askedForSecret = await register({ redirect_uris: [CALLBACK], token_endpoint_auth_method: "client_secret_post" });
  assert.equal(askedForSecret.statusCode, 201);
  assert.equal(json(askedForSecret).token_endpoint_auth_method, "none");
  assert.equal(json(askedForSecret).client_secret, undefined);
});

test("clients that send their id with HTTP Basic auth can get and refresh tokens", async () => {
  const { app, postgres, json, signIn } = await harness();
  const { clientId, verifier, code } = await signIn();
  const basic = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:ignored-secret`).toString("base64")}`;
  const post = (fields) =>
    app.inject({
      method: "POST",
      url: "/v1/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic },
      payload: new URLSearchParams(fields).toString(),
    });
  const issued = json(await post({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: CALLBACK }));
  assert.match(issued.access_token, /^pr_oat_/);
  assert.ok(await verifyConnectorToken(postgres, issued.access_token));
  const refreshed = json(await post({ grant_type: "refresh_token", refresh_token: issued.refresh_token }));
  assert.match(refreshed.access_token, /^pr_oat_/);
});

test("sign-in: the approval page, the code, PKCE and a working token", async () => {
  const { app, postgres, workspaceId, json, session, signIn, exchange } = await harness();
  const { clientId, verifier, requestId, back, code } = await signIn({ scope: "points:read posts:read not:a-scope" });
  assert.equal(`${back.origin}${back.pathname}`, CALLBACK);
  assert.equal(back.searchParams.get("state"), "xyz");
  assert.match(code, /^pr_oac_/);

  const wrongVerifier = await exchange(clientId, code, randomBytes(32).toString("base64url"));
  assert.equal(json(wrongVerifier).error, "invalid_grant");

  const issued = await exchange(clientId, code, verifier);
  assert.equal(issued.statusCode, 200);
  assert.equal(issued.headers["cache-control"], "no-store");
  const tokens = json(issued);
  assert.match(tokens.access_token, /^pr_oat_/);
  assert.match(tokens.refresh_token, /^pr_ort_/);
  assert.equal(tokens.expires_in, 3600);
  assert.equal(tokens.scope, "posts:read points:read");

  const grant = await verifyConnectorToken(postgres, tokens.access_token);
  assert.equal(grant.workspaceId, workspaceId);
  assert.deepEqual(grant.scopes, ["posts:read", "points:read"]);
  assert.equal(await verifyConnectorToken(postgres, "pr_oat_made-up"), undefined);

  // The page already used the request; it can't be shown or approved again.
  const pageAgain = await app.inject({ method: "GET", url: `/v1/oauth/requests/${requestId}`, headers: session });
  assert.equal(pageAgain.statusCode, 404);
});

test("the approval page shows the app and plain-language permissions, and needs a signed-in user", async () => {
  const { app, json, session, register } = await harness();
  const clientId = json(await register()).client_id;
  const challenge = createHash("sha256").update("v".repeat(43)).digest("base64url");
  const started = await app.inject({
    method: "GET",
    url: `/v1/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${challenge}&code_challenge_method=S256`,
  });
  const requestId = new URL(started.headers.location).searchParams.get("request");
  assert.equal((await app.inject({ method: "GET", url: `/v1/oauth/requests/${requestId}` })).statusCode, 401);
  const page = json(await app.inject({ method: "GET", url: `/v1/oauth/requests/${requestId}`, headers: session }));
  assert.equal(page.appName, "Muse");
  assert.equal(page.returnsTo, "muse.example");
  assert.equal(page.permissions.length, 6);
  assert.ok(page.permissions.every((permission) => typeof permission.label === "string" && permission.label.length > 0));
});

test("bad sign-in starts: unknown client, unregistered redirect, no PKCE", async () => {
  const { app, json, register } = await harness();
  const unknown = await app.inject({ method: "GET", url: "/v1/oauth/authorize?client_id=pc_nobody&response_type=code" });
  assert.equal(unknown.statusCode, 400);
  assert.equal(json(unknown).error, "invalid_client");

  const clientId = json(await register()).client_id;
  const elsewhere = await app.inject({
    method: "GET",
    url: `/v1/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent("https://evil.example/cb")}`,
  });
  assert.equal(elsewhere.statusCode, 400);

  const noPkce = await app.inject({ method: "GET", url: `/v1/oauth/authorize?client_id=${clientId}&response_type=code&state=s1` });
  assert.equal(noPkce.statusCode, 302);
  const back = new URL(noPkce.headers.location);
  assert.equal(`${back.origin}${back.pathname}`, CALLBACK);
  assert.equal(back.searchParams.get("error"), "invalid_request");
  assert.equal(back.searchParams.get("state"), "s1");
});

test("denying sends the user back with access_denied and creates nothing", async () => {
  const { postgres, signIn } = await harness();
  const { back, code } = await signIn({ approve: false });
  assert.equal(back.searchParams.get("error"), "access_denied");
  assert.equal(back.searchParams.get("state"), "xyz");
  assert.equal(code, null);
  assert.equal((await postgres.query("select count(*)::int as n from oauth_grants")).rows[0].n, 0);
});

test("a code works once; using it again ends the connection", async () => {
  const { postgres, json, signIn, exchange } = await harness();
  const { clientId, verifier, code } = await signIn();
  const tokens = json(await exchange(clientId, code, verifier));
  assert.ok(await verifyConnectorToken(postgres, tokens.access_token));
  const replay = await exchange(clientId, code, verifier);
  assert.equal(json(replay).error, "invalid_grant");
  assert.equal(await verifyConnectorToken(postgres, tokens.access_token), undefined);
});

test("refresh tokens rotate; an old one coming back after the grace period ends the connection", async () => {
  const { postgres, json, signIn, exchange, refresh } = await harness();
  const { clientId, verifier, code } = await signIn();
  const first = json(await exchange(clientId, code, verifier));

  const otherClient = await refresh("pc_someone-else", first.refresh_token);
  assert.equal(json(otherClient).error, "invalid_grant");

  const second = json(await refresh(clientId, first.refresh_token));
  assert.match(second.access_token, /^pr_oat_/);
  assert.notEqual(second.refresh_token, first.refresh_token);
  assert.ok(await verifyConnectorToken(postgres, second.access_token));

  // Two minutes later, the spent token comes back: someone else has it.
  await postgres.query("update oauth_tokens set used_at = now() - interval '2 minutes' where used_at is not null");
  const reused = await refresh(clientId, first.refresh_token);
  assert.equal(json(reused).error, "invalid_grant");
  assert.equal(await verifyConnectorToken(postgres, second.access_token), undefined);
  assert.equal(json(await refresh(clientId, second.refresh_token)).error, "invalid_grant");
});

test("refreshing twice at once keeps the connection: both get working tokens", async () => {
  const { postgres, json, signIn, exchange, refresh } = await harness();
  const { clientId, verifier, code } = await signIn();
  const first = json(await exchange(clientId, code, verifier));

  const [a, b] = await Promise.all([refresh(clientId, first.refresh_token), refresh(clientId, first.refresh_token)]);
  const again = await refresh(clientId, first.refresh_token);
  for (const response of [a, b, again]) {
    assert.equal(response.statusCode, 200);
    assert.ok(await verifyConnectorToken(postgres, json(response).access_token));
  }
  // The grace period runs from the first use; retrying doesn't extend it.
  const spent = await postgres.query("select used_at from oauth_tokens where kind = 'refresh' and used_at is not null");
  assert.equal(spent.rows.length, 1);
  assert.ok(json(await refresh(clientId, json(a).refresh_token)).access_token);
  assert.ok(await verifyConnectorToken(postgres, first.access_token));
});

test("Settings lists connected apps and disconnecting ends access; clients can revoke too", async () => {
  const { app, postgres, json, session, signIn, exchange, form } = await harness();
  const first = await signIn();
  const firstTokens = json(await exchange(first.clientId, first.code, first.verifier));
  const second = await signIn();
  const secondTokens = json(await exchange(second.clientId, second.code, second.verifier));

  assert.equal((await app.inject({ method: "GET", url: "/v1/oauth/connections" })).statusCode, 401);
  const listed = json(await app.inject({ method: "GET", url: "/v1/oauth/connections", headers: session })).connections;
  assert.equal(listed.length, 2);
  assert.equal(listed[0].appName, "Muse");
  assert.ok(listed.every((connection) => connection.lastUsedAt === undefined || typeof connection.lastUsedAt === "number"));

  const firstGrant = await verifyConnectorToken(postgres, firstTokens.access_token);
  const removed = await app.inject({ method: "DELETE", url: `/v1/oauth/connections/${firstGrant.id}`, headers: session });
  assert.equal(removed.statusCode, 204);
  assert.equal(await verifyConnectorToken(postgres, firstTokens.access_token), undefined);
  assert.equal((await app.inject({ method: "DELETE", url: `/v1/oauth/connections/${firstGrant.id}`, headers: session })).statusCode, 404);
  assert.equal((await app.inject({ method: "DELETE", url: "/v1/oauth/connections/not-a-uuid", headers: session })).statusCode, 404);

  const revoked = await form("/v1/oauth/revoke", { token: secondTokens.refresh_token });
  assert.equal(revoked.statusCode, 200);
  assert.equal(await verifyConnectorToken(postgres, secondTokens.access_token), undefined);
  assert.equal(json(await app.inject({ method: "GET", url: "/v1/oauth/connections", headers: session })).connections.length, 0);
});

test("the token endpoint rejects unknown grant types and missing fields", async () => {
  const { json, form } = await harness();
  assert.equal(json(await form("/v1/oauth/token", { grant_type: "password", username: "a", password: "b" })).error, "unsupported_grant_type");
  assert.equal(json(await form("/v1/oauth/token", { grant_type: "authorization_code" })).error, "invalid_request");
  assert.equal(json(await form("/v1/oauth/token", { grant_type: "refresh_token" })).error, "invalid_request");
});
