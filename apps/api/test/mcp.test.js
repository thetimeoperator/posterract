import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { registerMcpRoutes } from "../src/mcp/index.js";
import { validateArgs } from "../src/mcp/context.js";
import { checkLink, isPublicAddress } from "../src/mcp/safe-download.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = resolve(here, "../../../deploy/posterract/postgres/init");

const IG = "11111111-1111-4111-8111-111111111111";
const TH = "22222222-2222-4222-8222-222222222222";
const TT = "33333333-3333-4333-8333-333333333333";
const BUSINESS = "44444444-4444-4444-8444-444444444444";
const IG2 = "88888888-8888-4888-8888-888888888888";
const POST = "55555555-5555-4555-8555-555555555555";
const FAILED = "66666666-6666-4666-8666-666666666666";

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  const files = (await readdir(migrationDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of files) await db.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
  const query = (sql, params) => db.query(sql, params);
  return { query, connect: async () => ({ query, release() {} }) };
}

const account = (id, provider, handle) => ({ id, provider, handle, status: "connected" });

/**
 * The MCP routes on a small app whose REST routes are stand-ins that record
 * what the connector asked for; the database is real, for the library and
 * the game.
 */
async function harness() {
  const postgres = await database();
  const user = (await postgres.query("insert into app_users (email, display_name, email_verified) values ('c@example.com', 'Creator', true) returning id")).rows[0];
  const workspaceId = (await postgres.query("insert into workspaces (owner_id, name) values ($1, 'Creator HQ') returning id", [user.id])).rows[0].id;
  const video = (await postgres.query(
    `insert into media_assets (workspace_id, original_filename, r2_key, mime_type, size_bytes, duration_ms, status)
     values ($1, 'launch.mp4', 'media/launch', 'video/mp4', 1000, 12000, 'ready') returning id`,
    [workspaceId],
  )).rows[0].id;

  const calls = [];
  const app = Fastify();
  const keys = {
    full: ["*"],
    read: ["accounts:read", "posts:read", "analytics:read"],
  };
  const authenticate = async (request, reply) => {
    const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!keys[token]) return reply.code(401).send({ error: "unauthorized" });
    request.authContext = { kind: "api_key", workspaceId, scopes: keys[token] };
  };
  const record = (name) => async (request, reply) => {
    calls.push({ name, params: request.params, body: request.body, key: request.headers["idempotency-key"] });
    return reply.code(202).send({ id: POST, mediaId: video, uploadId: "upload-1", url: "https://storage.example/part" });
  };
  app.get("/v1/accounts", async () => ({
    accounts: [account(IG, "instagram", "@me"), account(IG2, "instagram", "@me.too"), account(TH, "threads", "@me"), account(TT, "tiktok", "@me")],
  }));
  app.get("/v1/businesses", async () => ({
    businesses: [{
      id: BUSINESS,
      name: "Sofia",
      accounts: [account(IG, "instagram", "@me"), account(IG2, "instagram", "@me.too"), account(TT, "tiktok", "@me")],
    }],
  }));
  app.post("/v1/posts", record("create"));
  app.get("/v1/posts/:id", async (request) => ({
    id: request.params.id,
    title: "Launch",
    status: "partial",
    caption: "We're live",
    scheduledFor: "2026-10-02T18:00:00.000Z",
    projections: [
      { id: FAILED, provider: "instagram", status: "failed", errorSummary: "Token expired" },
      { id: "77777777-7777-4777-8777-777777777777", provider: "threads", status: "live", platformPostUrl: "https://threads.net/p/1" },
    ],
  }));
  app.post("/v1/projections/:id/retry", record("retry"));
  app.post("/v1/posts/:id/cancel", record("cancel"));
  registerMcpRoutes(app, { postgres, authenticate });

  const rpc = async (token, method, params, id = 1) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/mcp",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) },
    });
    return { status: response.statusCode, headers: response.headers, body: response.body ? JSON.parse(response.body) : undefined };
  };
  const call = async (token, name, args) => (await rpc(token, "tools/call", { name, arguments: args })).body.result;
  return { app, postgres, workspaceId, video, calls, rpc, call };
}

test("initialize introduces Posterract and the game; notifications get 202; GET is not offered", async () => {
  const { app, rpc } = await harness();
  const init = await rpc("full", "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "muse", version: "1" } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.deepEqual(init.body.result.capabilities, { tools: { listChanged: false } });
  assert.match(init.body.result.instructions, /Bronze Recruit to Legendary General/);
  const unknownVersion = await rpc("full", "initialize", { protocolVersion: "1999-01-01" });
  assert.equal(unknownVersion.body.result.protocolVersion, "2025-06-18");

  const notified = await app.inject({
    method: "POST",
    url: "/v1/mcp",
    headers: { authorization: "Bearer full" },
    payload: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
  assert.equal(notified.statusCode, 202);
  assert.equal((await app.inject({ method: "GET", url: "/v1/mcp" })).statusCode, 405);
  assert.equal((await rpc("full", "resources/list")).body.error.code, -32601);
  assert.equal((await rpc("full", "tools/call", { name: "no_such_tool", arguments: {} })).body.error.code, -32602);
});

test("without a valid key the connector answers 401 with a Bearer challenge", async () => {
  const { rpc } = await harness();
  const denied = await rpc(undefined, "tools/list");
  assert.equal(denied.status, 401);
  assert.match(denied.headers["www-authenticate"], /^Bearer/);
  assert.equal((await rpc("stolen", "tools/list")).status, 401);
});

test("tools/list shows only what the key can do", async () => {
  const { rpc } = await harness();
  const all = (await rpc("full", "tools/list")).body.result.tools;
  assert.deepEqual(all.map((tool) => tool.name), [
    "create_post", "get_post",
    "list_accounts",
    "list_schedule", "reschedule_post", "cancel_post", "duplicate_post", "retry_post",
    "list_videos", "start_video_upload", "finish_video_upload", "import_video_from_url",
    "get_analytics",
    "get_my_rank", "get_leaderboard", "get_post_points",
  ]);
  for (const tool of all) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(typeof tool.annotations.readOnlyHint, "boolean");
  }
  const readOnly = (await rpc("read", "tools/list")).body.result.tools.map((tool) => tool.name);
  assert.ok(readOnly.includes("get_my_rank") && readOnly.includes("list_videos") && readOnly.includes("get_analytics"));
  assert.ok(!readOnly.includes("create_post") && !readOnly.includes("cancel_post") && !readOnly.includes("import_video_from_url"));
});

test("create_post previews first, posts only when confirmed, and never twice for a retry", async () => {
  const { call, calls, video } = await harness();
  const args = {
    video_id: video,
    caption: "We're live",
    captions: { threads: "Live now" },
    when: "2030-01-02T18:00:00-08:00",
    account_ids: [IG, TH],
  };
  const preview = await call("full", "create_post", args);
  assert.equal(preview.structuredContent.status, "preview — nothing has been posted");
  assert.deepEqual(preview.structuredContent.posting_to, [
    { platform: "instagram", account: "@me", caption: "We're live" },
    { platform: "threads", account: "@me", caption: "Live now" },
  ]);
  assert.equal(calls.length, 0);

  const posted = await call("full", "create_post", { ...args, confirm: true });
  assert.equal(posted.isError, undefined);
  assert.equal(posted.structuredContent.post_id, POST);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, {
    artifactId: video,
    title: "launch.mp4",
    caption: "We're live",
    platforms: ["instagram", "threads"],
    perPlatform: { instagram: { caption: "We're live" }, threads: { caption: "Live now" } },
    scheduledFor: "2030-01-03T02:00:00.000Z",
    accountIds: [IG, TH],
  });
  await call("full", "create_post", { ...args, confirm: true });
  assert.equal(calls[1].key, calls[0].key, "a retried call reuses its duplicate-post key");
  await call("full", "create_post", { ...args, caption: "Different", confirm: true });
  assert.notEqual(calls[2].key, calls[0].key);
});

test("create_post only reaches Instagram, Facebook and Threads, and asks for the right key", async () => {
  const { call, calls, video } = await harness();
  const tiktok = await call("full", "create_post", { video_id: video, caption: "x", when: "now", account_ids: [TT], confirm: true });
  assert.equal(tiktok.isError, true);
  assert.match(tiktok.content[0].text, /isn't a connected Instagram, Facebook or Threads account/);

  // A business posts to all its Instagram, Facebook and Threads accounts, both Instagram accounts included.
  const preview = await call("full", "create_post", { video_id: video, caption: "x", when: "now", business_id: BUSINESS });
  assert.equal(preview.structuredContent.business, "Sofia");
  assert.deepEqual(preview.structuredContent.posting_to.map((row) => row.account), ["@me", "@me.too"]);
  await call("full", "create_post", { video_id: video, caption: "x", when: "now", business_id: BUSINESS, confirm: true });
  assert.deepEqual(calls.at(-1).body.platforms, ["instagram"]);
  assert.deepEqual(calls.at(-1).body.accountIds, [IG, IG2]);
  assert.equal(calls.at(-1).body.businessId, BUSINESS);
  assert.equal(calls.at(-1).body.scheduledFor, "now");

  // Only some of a business's accounts.
  await call("full", "create_post", { video_id: video, caption: "x", when: "now", business_id: BUSINESS, account_ids: [IG2], confirm: true });
  assert.deepEqual(calls.at(-1).body.accountIds, [IG2]);
  const outside = await call("full", "create_post", { video_id: video, caption: "x", when: "now", business_id: BUSINESS, account_ids: [TH] });
  assert.match(outside.content[0].text, /isn't in Sofia/);

  const readKey = await call("read", "create_post", { video_id: video, caption: "x", when: "now", platforms: ["instagram"] });
  assert.equal(readKey.isError, true);
  assert.match(readKey.content[0].text, /API Keys/);

  const past = await call("full", "create_post", { video_id: video, caption: "x", when: "2020-01-01T00:00:00Z", platforms: ["instagram"] });
  assert.match(past.content[0].text, /already passed/);
  const missing = await call("full", "create_post", { caption: "x", when: "now" });
  assert.match(missing.content[0].text, /video_id is required/);
});

test("the calendar retries only failed platforms, and cancelling needs a confirmation", async () => {
  const { call, calls } = await harness();
  const retried = await call("full", "retry_post", { post_id: POST });
  assert.deepEqual(retried.structuredContent.retried, ["instagram"]);
  assert.deepEqual(calls.map((item) => [item.name, item.params.id]), [["retry", FAILED]]);

  const asked = await call("full", "cancel_post", { post_id: POST });
  assert.equal(asked.structuredContent.status, "not cancelled yet");
  assert.equal(calls.length, 1);
  await call("full", "cancel_post", { post_id: POST, confirm: true });
  assert.equal(calls.at(-1).name, "cancel");
});

test("the library lists ready videos and the game reports rank, points and the leaderboard", async () => {
  const { call, postgres, workspaceId } = await harness();
  const videos = await call("read", "list_videos", {});
  assert.equal(videos.structuredContent.count, 1);
  assert.deepEqual(
    { name: videos.structuredContent.videos[0].name, status: videos.structuredContent.videos[0].status, seconds: videos.structuredContent.videos[0].seconds },
    { name: "launch.mp4", status: "ready", seconds: 12 },
  );

  await postgres.query(
    "insert into points_ledger (workspace_id, source, amount, reference_id, awarded_at) values ($1, 'bonus', 200, 'test:rank', now())",
    [workspaceId],
  );
  await postgres.query(
    `insert into billing_subscriptions (stripe_subscription_id, workspace_id, stripe_customer_id, status, recognized_plan)
     values ('sub_mcp', $1, 'cus', 'active', true)`,
    [workspaceId],
  );
  const rank = (await call("read", "get_my_rank", {})).structuredContent;
  assert.equal(rank.rank, "Silver Recruit");
  assert.equal(rank.level, 11);
  assert.deepEqual(rank.points, { total: 200, this_week: 200, this_month: 200 });
  assert.deepEqual(rank.next_level, { level: 12, rank: "Silver Private", points_to_go: 25 });
  assert.equal(rank.next_tier.tier, "Gold");
  assert.ok(rank.how_to_rank_up.some((tip) => /Start a streak/.test(tip)));

  const board = (await call("read", "get_leaderboard", { period: "all" })).structuredContent;
  assert.equal(board.creators_ranked, 1);
  assert.equal(board.you.position, 1);
  assert.equal(board.you.rank, "Silver Recruit");
  assert.equal(board.top[0].name, "Creator");

  const missing = await call("read", "get_post_points", { post_id: POST });
  assert.equal(missing.isError, true);
});

test("arguments are checked against each tool's schema", () => {
  const schema = {
    type: "object",
    properties: { when: { type: "string" }, period: { type: "string", enum: ["week", "month"] }, top: { type: "integer", maximum: 50 } },
    required: ["when"],
    additionalProperties: false,
  };
  assert.equal(validateArgs(schema, { when: "now" }), undefined);
  assert.equal(validateArgs(schema, {}), "when is required.");
  assert.match(validateArgs(schema, { when: "now", period: "year" }), /one of: week, month/);
  assert.match(validateArgs(schema, { when: "now", top: 51 }), /at most 50/);
  assert.match(validateArgs(schema, { when: "now", extra: 1 }), /Unknown argument: extra/);
});

test("video imports only reach public https addresses", () => {
  for (const address of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.5", "192.168.1.1", "100.93.122.0", "0.0.0.0", "::1", "::ffff:127.0.0.1", "fd00::1", "fe80::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["8.8.8.8", "151.101.1.140", "2606:4700:4700::1111"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
  assert.throws(() => checkLink("http://example.com/video.mp4"), /Only https/);
  assert.throws(() => checkLink("https://localhost/video.mp4"), /private address/);
  assert.throws(() => checkLink("https://10.0.0.8/video.mp4"), /private address/);
  assert.throws(() => checkLink("https://[::1]/video.mp4"), /private address/);
  assert.throws(() => checkLink("https://example.com:8443/video.mp4"), /standard https/);
  assert.throws(() => checkLink("https://user:pass@example.com/video.mp4"), /username or password/);
  assert.equal(checkLink("https://cdn.example.com/clip.mp4").hostname, "cdn.example.com");
});
