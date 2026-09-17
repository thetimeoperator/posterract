import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import Fastify from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { registerTikTokRoutes } from "../src/tiktok.js";
import { registerTikTokMediaRoute, tiktokMediaUrl, cleanupTikTokMedia, validMediaSignature } from "../src/tiktokMedia.js";
import { parseCreatePost } from "../src/domain.js";
import { loadExplicitPostAccounts } from "../src/postTargets.js";
import { emptyTikTokOptions } from "../../../packages/contract/src/tiktok.ts";
import { createTikTokDirectActivities } from "../../orchestrator/src/tiktokDirect.js";
import { TikTokApiError } from "../../web/convex/connectors/tiktokDirect.ts";

const ws = "00000000-0000-4000-8000-000000000001";
const account = "00000000-0000-4000-8000-000000000002";
const tx = "00000000-0000-4000-8000-000000000003";
const projection = "00000000-0000-4000-8000-000000000004";
const sessionId = "00000000-0000-4000-8000-000000000005";
const env = { TOKEN_ENCRYPTION_KEY: "test-signing-key", SITE_URL: "https://www.posterract.app", R2_BUCKET: "test" };
const options = { ...emptyTikTokOptions(), privacyLevel: "SELF_ONLY", consentAccepted: true,
  authorization: { accountId: account, authorizedAt: new Date().toISOString(), userId: "test" } };
const info = { creator_nickname: "Test creator", creator_username: "test.creator", creator_avatar_url: "", privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"],
  comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 60 };

async function fixture(t, overrides = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  for (const file of ["001-posterract.sql", "002-postgres-cutover.sql", "005-tiktok-draft-status.sql", "016-tiktok-direct-post.sql"]) {
    await db.exec(await readFile(new URL(`../../../deploy/posterract/postgres/init/${file}`, import.meta.url), "utf8"));
  }
  await db.query("insert into workspaces (id, name) values ($1, 'Test')", [ws]);
  await db.query("insert into social_accounts (id, workspace_id, provider, handle) values ($1, $2, 'tiktok', 'test.creator')", [account, ws]);
  await db.query("insert into social_account_tokens (social_account_id, access_token_ciphertext) values ($1, $2)", [account, Buffer.from("not-returned")]);
  await db.query("insert into transmissions (id, workspace_id, title, status, schedule_mode, source) values ($1, $2, 'Test', 'transmitting', 'now', 'ui')", [tx, ws]);
  await db.query("insert into projections (id, transmission_id, workspace_id, social_account_id, provider, platform_options, status) values ($1, $2, $3, $4, 'tiktok', $5, 'scheduled')", [projection, tx, ws, account, JSON.stringify(options)]);
  await db.query("insert into tiktok_publish_sessions (id, projection_id, state, prepared_key, size_bytes, duration_ms) values ($1, $2, 'prepared', 'test/prepared.mp4', 10, 18000)", [sessionId, projection]);
  const postgres = { query: (sql, params) => db.query(sql, params), connect: async () => ({ query: (sql, params) => db.query(sql, params), release() {} }) };
  let inits = 0;
  const deps = { postgres, environment: env, r2: { send: async () => {} },
    loadProjectionContext: async (id) => ({ ...(await db.query("select * from projections where id = $1", [id])).rows[0], account_status: "connected", access_token_ciphertext: "test", transmission_status: "transmitting" }),
    accessTokenFor: async () => "token", creatorInfo: async () => info,
    initDirect: async () => { inits++; return "publish-once"; }, fetchStatus: async () => ({ status: "PUBLISH_COMPLETE" }), ...overrides };
  return { db, postgres, deps, activities: createTikTokDirectActivities(deps), inits: () => inits };
}

test("Direct submissions require explicit account IDs and fresh consent; legacy inbox remains accepted", () => {
  const input = { artifactId: tx, caption: "test", platforms: ["tiktok"], perPlatform: { tiktok: { options } }, accountIds: [account] };
  assert.equal(parseCreatePost(input).projections[0].options.privacyLevel, "SELF_ONLY");
  assert.throws(() => parseCreatePost({ ...input, accountIds: undefined }), /tiktok_explicit_account_required/);
  assert.throws(() => parseCreatePost({ ...input, perPlatform: { tiktok: { options: { ...options, consentAccepted: false } } } }), /tiktok_post_consent_required/);
  assert.throws(() => parseCreatePost({ ...input, perPlatform: { tiktok: { options: { ...options, privacyLevel: "" } } } }), /invalid_tiktok_options/);
  assert.equal(parseCreatePost({ ...input, perPlatform: {} }).projections[0].options.mode, undefined);
});

test("explicit post targets reject another workspace or provider without selecting a replacement", async (t) => {
  const { db } = await fixture(t);
  assert.equal((await loadExplicitPostAccounts(db, ws, [account], ["tiktok"])).rows[0].id, account);
  await assert.rejects(loadExplicitPostAccounts(db, "00000000-0000-4000-8000-000000000009", [account], ["tiktok"]), /account_target_unavailable/);
  await assert.rejects(loadExplicitPostAccounts(db, ws, [account], ["instagram"]), /account_target_platform_mismatch/);
});

test("creator endpoint enforces workspace and provider, refreshes credentials, returns display/settings only", async (t) => {
  const { postgres, db } = await fixture(t);
  const app = Fastify(); t.after(() => app.close());
  let owner = ws, refreshed = 0;
  registerTikTokRoutes(app, { postgres, requiredWorkspace: () => owner, requireScope: () => async () => {},
    freshToken: async () => { refreshed++; return "token"; }, creatorInfo: async () => info });
  const path = `/v1/accounts/${account}/tiktok/creator-info`;
  const response = await app.inject(path);
  assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), info); assert.equal(refreshed, 1);
  owner = "00000000-0000-4000-8000-000000000009";
  assert.equal((await app.inject(path)).statusCode, 404);
  owner = ws; await db.query("update social_accounts set provider = 'instagram' where id = $1", [account]);
  assert.equal((await app.inject(path)).statusCode, 404); assert.equal(refreshed, 1);
});

test("creator endpoint explains posting restrictions without marking them as retryable HTTP 429", async (t) => {
  const { postgres } = await fixture(t);
  const app = Fastify(); t.after(() => app.close());
  let code = "spam_risk_too_many_posts";
  registerTikTokRoutes(app, { postgres, requiredWorkspace: () => ws, requireScope: () => async () => {},
    freshToken: async () => "token", creatorInfo: async () => { throw new TikTokApiError(code, 200); } });
  for (code of ["spam_risk_too_many_posts", "reached_active_user_cap", "spam_risk_user_banned_from_posting"]) {
    const response = await app.inject(`/v1/accounts/${account}/tiktok/creator-info`);
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, code);
    assert.match(response.json().detail, /attempt has stopped.*try again later/i);
  }
});

test("posting restrictions stop preparation and final eligibility checks without upload or automatic retry", async (t) => {
  const f = await fixture(t);
  let checks = 0;
  for (const code of ["spam_risk_too_many_posts", "reached_active_user_cap", "spam_risk_user_banned_from_posting"]) {
    const activities = createTikTokDirectActivities({ ...f.deps, creatorInfo: async () => { checks++; throw new TikTokApiError(code, 200); } });
    await f.db.query("update tiktok_publish_sessions set state = 'preparing'");
    for (const stage of ["prepareTikTokDirect", "initializeTikTokDirect"]) {
      const before = checks;
      const result = await activities[stage](projection);
      assert.deepEqual(result, { status: "failed", category: "posting_restricted" });
      assert.equal(checks, before + 1);
      assert.equal(f.inits(), 0);
      const row = (await f.db.query("select status, next_attempt_at, error_summary from projections")).rows[0];
      assert.equal(row.status, "failed");
      assert.equal(row.next_attempt_at, null);
      assert.match(row.error_summary, /attempt has stopped.*try again later/i);
    }
  }
});

test("a daily-limit rejection during initialization stops and never automatically initializes again", async (t) => {
  let calls = 0;
  const f = await fixture(t, { initDirect: async () => { calls++; throw new TikTokApiError("spam_risk_too_many_posts", 403); } });
  assert.deepEqual(await f.activities.initializeTikTokDirect(projection), { status: "failed", category: "posting_restricted" });
  assert.equal((await f.activities.initializeTikTokDirect(projection)).status, "failed");
  assert.equal(calls, 1);
  assert.equal((await f.db.query("select state from tiktok_publish_sessions")).rows[0].state, "failed");
  assert.equal((await f.db.query("select * from points_ledger")).rows.length, 0);
});

test("signed media supports GET, HEAD and ranges without redirect; tampering, expiration and cleanup deny access", async (t) => {
  const { postgres, db } = await fixture(t);
  const app = Fastify(); t.after(() => app.close());
  let deleted = 0;
  const r2 = { send: async (command) => {
    if (command.constructor.name === "DeleteObjectCommand") { deleted++; return {}; }
    const range = command.input.Range;
    return { Body: Readable.from([range === "bytes=2-5" ? "2345" : "0123456789"]) };
  } };
  registerTikTokMediaRoute(app, { postgres, r2, environment: env });
  const session = (await db.query("select * from tiktok_publish_sessions")).rows[0];
  const url = new URL(tiktokMediaUrl(session.id, session.media_expires_at, env));
  const path = url.pathname + url.search;
  const full = await app.inject(path);
  assert.equal(full.statusCode, 200); assert.equal(full.body, "0123456789"); assert.equal(full.headers.location, undefined);
  assert.equal((await app.inject({ url: path, method: "HEAD" })).headers["content-length"], "10");
  const range = await app.inject({ url: path, headers: { range: "bytes=2-5" } });
  assert.equal(range.statusCode, 206); assert.equal(range.body, "2345"); assert.equal(range.headers["content-range"], "bytes 2-5/10");
  assert.equal((await app.inject({ url: path, headers: { range: "bytes=20-30" } })).statusCode, 416);
  assert.equal((await app.inject(path.replace("signature=", "signature=x"))).statusCode, 403);
  assert.equal(validMediaSignature(session.id, Object.fromEntries(url.searchParams), env.TOKEN_ENCRYPTION_KEY, Date.now() + 3 * 3_600_000), false);
  await db.query("update tiktok_publish_sessions set media_expires_at = now() - interval '1 second'");
  await cleanupTikTokMedia(postgres, r2, env.R2_BUCKET);
  assert.equal(deleted, 1); assert.equal((await app.inject(path)).statusCode, 404);
  await cleanupTikTokMedia(postgres, r2, env.R2_BUCKET); assert.equal(deleted, 1);
});

test("restart resumes known publish ID, private completion succeeds and awards posting points exactly once", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.activities.initializeTikTokDirect(projection)).status, "processing");
  const restarted = createTikTokDirectActivities(f.deps);
  assert.equal((await restarted.initializeTikTokDirect(projection)).status, "processing");
  assert.equal(f.inits(), 1);
  assert.equal((await restarted.pollTikTokDirect(projection)).status, "live");
  assert.equal((await restarted.pollTikTokDirect(projection)).status, "live");
  const row = (await f.db.query("select * from projections")).rows[0];
  assert.equal(row.status, "live"); assert.equal(row.platform_post_id, null);
  assert.equal((await f.db.query("select * from points_ledger")).rows.length, 1);
});

test("processing and network outages never initialize another upload", async (t) => {
  const f = await fixture(t, { fetchStatus: async () => ({ status: "PROCESSING_DOWNLOAD" }) });
  await f.activities.initializeTikTokDirect(projection);
  for (let i = 0; i < 5; i++) assert.equal((await f.activities.pollTikTokDirect(projection)).status, "processing");
  assert.equal(f.inits(), 1);
  const restarted = createTikTokDirectActivities({ ...f.deps, fetchStatus: async () => { throw new Error("connection lost"); } });
  assert.equal((await restarted.pollTikTokDirect(projection)).status, "processing");
  assert.equal(f.inits(), 1);
});

test("ambiguous initialization stops automatic re-upload even on explicit retry", async (t) => {
  let calls = 0;
  const f = await fixture(t, { initDirect: async () => { calls++; throw new TikTokApiError("initialization_outcome_unknown", 503, true); } });
  assert.equal((await f.activities.initializeTikTokDirect(projection)).category, "ambiguous");
  assert.equal((await f.activities.initializeTikTokDirect(projection)).category, "ambiguous");
  assert.equal(calls, 1);
  assert.equal((await f.db.query("select state from tiktok_publish_sessions")).rows[0].state, "ambiguous");
});

test("changed creator permissions fail without modifying audience or publishing", async (t) => {
  const f = await fixture(t, { creatorInfo: async () => ({ ...info, privacy_level_options: ["PUBLIC_TO_EVERYONE"] }) });
  assert.equal((await f.activities.initializeTikTokDirect(projection)).status, "failed");
  assert.equal(f.inits(), 0);
  assert.equal((await f.db.query("select platform_options from projections")).rows[0].platform_options.privacyLevel, "SELF_ONLY");
});

test("known rate-limit rejection can retry but media rejection cannot upload again", async (t) => {
  let calls = 0;
  const f = await fixture(t, { initDirect: async () => { if (++calls === 1) throw new TikTokApiError("rate_limit_exceeded", 429); return "known"; },
    fetchStatus: async () => ({ status: "FAILED", fail_reason: "file_format_check_failed" }) });
  assert.equal((await f.activities.initializeTikTokDirect(projection)).status, "retry");
  assert.equal((await f.activities.initializeTikTokDirect(projection)).status, "processing");
  assert.equal((await f.activities.pollTikTokDirect(projection)).status, "failed");
  await f.activities.initializeTikTokDirect(projection);
  assert.equal(calls, 2); assert.equal((await f.db.query("select * from points_ledger")).rows.length, 0);
});

test("a permanently rejected status request fails distinctly without initializing again", async (t) => {
  const f = await fixture(t, { fetchStatus: async () => { throw new TikTokApiError("invalid_publish_id", 400); } });
  await f.activities.initializeTikTokDirect(projection);
  assert.equal((await f.activities.pollTikTokDirect(projection)).category, "validation");
  assert.equal(f.inits(), 1);
  assert.equal((await f.db.query("select platform_post_id, error_summary from projections")).rows[0].platform_post_id, null);
});

test("a late media-preparation completion cannot reset an initialized session or invalidate its signed URL", async (t) => {
  const f = await fixture(t);
  await f.db.query("update tiktok_publish_sessions set state = 'preparing'");
  let expires;
  const activities = createTikTokDirectActivities({ ...f.deps, signedMediaUrl: async () => "unused",
    prepareMedia: async () => ({ path: fileURLToPath(import.meta.url), sizeBytes: 10, durationMs: 18000, cleanup: async () => {} }),
    r2: { send: async (command) => {
      for await (const _chunk of command.input.Body) { /* consume the test stream */ }
      const { rows } = await f.db.query("update tiktok_publish_sessions set state = 'processing', publish_id = 'another-preparation-finished-first' returning media_expires_at");
      expires = rows[0].media_expires_at;
    } },
  });
  await activities.prepareTikTokDirect(projection);
  const session = (await f.db.query("select * from tiktok_publish_sessions")).rows[0];
  assert.equal(session.state, "processing");
  assert.equal(new Date(session.media_expires_at).getTime(), new Date(expires).getTime());
  assert.equal(session.publish_id, "another-preparation-finished-first");
});
