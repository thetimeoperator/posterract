import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { loadAnalyticsDashboard } from "../src/analytics.js";
import { parseScopeQuery, registerBusinessRoutes, resolveScopeAccounts } from "../src/businesses/index.js";
import { resolvePostTargets } from "../src/postTargets.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = resolve(here, "../../../deploy/posterract/postgres/init");
const API = "https://api.test";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  const files = (await readdir(migrationDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of files) await db.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
  const query = (sql, params) => db.query(sql, params);
  return { query, connect: async () => ({ query, release() {} }), exec: (sql) => db.exec(sql) };
}

/** A workspace with two Instagram accounts, a disconnected one, Threads and two TikToks. */
async function seed() {
  const postgres = await database();
  const user = (await postgres.query("insert into app_users (email, display_name, email_verified) values ('c@example.com', 'Creator', true) returning id")).rows[0];
  const workspaceId = (await postgres.query("insert into workspaces (owner_id, name) values ($1, 'Creator HQ') returning id", [user.id])).rows[0].id;
  const other = (await postgres.query("insert into workspaces (owner_id, name) values ($1, 'Someone else') returning id", [user.id])).rows[0].id;
  const account = async (provider, handle, status = "connected", workspace = workspaceId) =>
    (await postgres.query(
      `insert into social_accounts (workspace_id, provider, provider_account_id, handle, status)
       values ($1, $2, $3, $4, $5) returning id`,
      [workspace, provider, `${provider}-${handle}`, handle, status],
    )).rows[0].id;
  const ids = {
    ig1: await account("instagram", "@sofia"),
    ig2: await account("instagram", "@sofia.clips"),
    igOld: await account("instagram", "@old", "disconnected"),
    threads: await account("threads", "@sofia"),
    tiktok1: await account("tiktok", "@sofia"),
    tiktok2: await account("tiktok", "@sofia.two"),
    foreign: await account("instagram", "@stranger", "connected", other),
  };
  return { postgres, workspaceId, ids };
}

function routes(postgres, workspaceId) {
  const app = Fastify();
  registerBusinessRoutes(app, {
    postgres,
    requireScope: () => async (request) => { request.authContext = { kind: "session", workspaceId }; },
    requiredWorkspace: (request) => request.authContext?.workspaceId ?? workspaceId,
    publicApiUrl: API,
  });
  const send = async (method, url, payload) => {
    const response = await app.inject({ method, url, payload });
    const json = String(response.headers["content-type"] ?? "").includes("json");
    return { status: response.statusCode, headers: response.headers, body: json && response.body ? JSON.parse(response.body) : undefined, raw: response.rawPayload };
  };
  return { app, send };
}

test("migration 024: businesses replace account sets, and a post can reach two accounts on one platform", async () => {
  const { postgres, workspaceId, ids } = await seed();
  const tables = new Set((await postgres.query("select table_name from information_schema.tables where table_schema = 'public'")).rows.map((row) => row.table_name));
  assert.ok(tables.has("businesses") && tables.has("business_accounts"));
  assert.ok(!tables.has("account_sets") && !tables.has("account_set_members"));
  await postgres.exec(await readFile(resolve(migrationDirectory, "024-businesses.sql"), "utf8"));

  const post = (await postgres.query(
    "insert into transmissions (workspace_id, title, status, schedule_mode, source) values ($1, 'Launch', 'scheduled', 'now', 'ui') returning id",
    [workspaceId],
  )).rows[0].id;
  const projection = (account) => postgres.query(
    "insert into projections (transmission_id, workspace_id, social_account_id, provider, status) values ($1, $2, $3, 'instagram', 'scheduled')",
    [post, workspaceId, account],
  );
  await projection(ids.ig1);
  await projection(ids.ig2);
  await assert.rejects(projection(ids.ig1), /duplicate key/);
});

test("businesses: create with any accounts and a logo, list, rename, change accounts, delete", async () => {
  const { postgres, workspaceId, ids } = await seed();
  const { send } = routes(postgres, workspaceId);

  const created = await send("POST", "/v1/businesses", { name: "Pissed Off Sofia", accountIds: [ids.ig1, ids.ig2, ids.threads], logo: PNG });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, "Pissed Off Sofia");
  assert.deepEqual(created.body.accountIds, [ids.ig1, ids.ig2, ids.threads]);
  assert.match(created.body.logoUrl, /^https:\/\/api\.test\/v1\/business-logos\/[0-9a-f]{64}$/);

  // The same account can sit in another business too.
  const second = await send("POST", "/v1/businesses", { name: "Clips", accountIds: [ids.ig2] });
  assert.equal(second.status, 201);
  assert.equal(second.body.logoUrl, undefined);
  const empty = await send("POST", "/v1/businesses", { name: "Coming soon", accountIds: [] });
  assert.equal(empty.status, 201);

  const listed = await send("GET", "/v1/businesses");
  assert.deepEqual(listed.body.businesses.map((business) => business.name), ["Clips", "Coming soon", "Pissed Off Sofia"]);

  const logo = await send("GET", new URL(created.body.logoUrl).pathname);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers["content-type"], "image/png");
  assert.match(logo.headers["cache-control"], /immutable/);
  assert.equal((await send("GET", "/v1/business-logos/" + "0".repeat(64))).status, 404);

  assert.equal((await send("POST", "/v1/businesses", { name: "pissed off sofia", accountIds: [] })).body.error, "business_name_in_use");
  assert.equal((await send("POST", "/v1/businesses", { name: "X", accountIds: [ids.foreign] })).body.error, "business_account_unavailable");
  assert.equal((await send("POST", "/v1/businesses", { name: "X", accountIds: [ids.igOld] })).body.error, "business_account_unavailable");
  assert.equal((await send("POST", "/v1/businesses", { name: "X", accountIds: [], logo: "data:image/png;base64,AAAA" })).body.error, "invalid_business_logo");
  assert.equal((await send("POST", "/v1/businesses", { name: "", accountIds: [] })).body.error, "invalid_business_name");

  const renamed = await send("PUT", `/v1/businesses/${created.body.id}`, { name: "Sofia", accountIds: [ids.ig1, ids.threads] });
  assert.equal(renamed.body.name, "Sofia");
  assert.deepEqual(renamed.body.accountIds, [ids.ig1, ids.threads]);
  assert.equal(renamed.body.logoUrl, created.body.logoUrl, "leaving logo out keeps it");
  const noLogo = await send("PUT", `/v1/businesses/${created.body.id}`, { name: "Sofia", accountIds: [ids.ig1], logo: null });
  assert.equal(noLogo.body.logoUrl, undefined);

  // An account that disconnected later can stay in its business when the business is saved again.
  await postgres.query("update social_accounts set status = 'disconnected' where id = $1", [ids.ig1]);
  assert.equal((await send("PUT", `/v1/businesses/${created.body.id}`, { name: "Sofia", accountIds: [ids.ig1] })).status, 200);

  const post = (await postgres.query(
    "insert into transmissions (workspace_id, title, status, schedule_mode, source, business_id) values ($1, 'Launch', 'scheduled', 'now', 'ui', $2) returning id",
    [workspaceId, created.body.id],
  )).rows[0].id;
  assert.equal((await send("DELETE", `/v1/businesses/${created.body.id}`)).status, 204);
  assert.equal((await send("DELETE", `/v1/businesses/${created.body.id}`)).status, 404);
  assert.equal((await send("PUT", "/v1/businesses/not-a-uuid", { name: "x", accountIds: [] })).status, 404);
  const kept = await postgres.query("select business_id from transmissions where id = $1", [post]);
  assert.equal(kept.rows[0].business_id, null, "posts stay, without the deleted business");
});

test("posting to a business reaches every connected account in it, even two Instagram accounts", async () => {
  const { postgres, workspaceId, ids } = await seed();
  const { send } = routes(postgres, workspaceId);
  const business = (await send("POST", "/v1/businesses", {
    name: "Sofia",
    accountIds: [ids.ig1, ids.ig2, ids.threads, ids.tiktok1],
  })).body;
  const targets = (input) => resolvePostTargets(postgres, workspaceId, input);

  assert.deepEqual(
    await targets({ businessId: business.id, providers: ["instagram", "threads"] }),
    [
      { id: ids.ig1, provider: "instagram" },
      { id: ids.ig2, provider: "instagram" },
      { id: ids.threads, provider: "threads" },
    ],
  );
  // Some of the business's accounts only.
  assert.deepEqual(
    await targets({ businessId: business.id, accountIds: [ids.ig2], providers: ["instagram"] }),
    [{ id: ids.ig2, provider: "instagram" }],
  );
  await assert.rejects(targets({ businessId: business.id, accountIds: [ids.foreign], providers: ["instagram"] }), /account_not_in_business/);
  await assert.rejects(targets({ businessId: "00000000-0000-4000-8000-000000000001", providers: ["instagram"] }), /business_not_found/);

  // A disconnected account in the business is skipped instead of blocking the post.
  await postgres.query("update social_accounts set status = 'disconnected' where id = $1", [ids.ig2]);
  assert.deepEqual(
    (await targets({ businessId: business.id, providers: ["instagram"] })).map((target) => target.id),
    [ids.ig1],
  );
  // ...but an account picked by hand has to be connected.
  await assert.rejects(targets({ accountIds: [ids.ig1, ids.ig2], providers: ["instagram"] }), (error) =>
    error.message === "account_not_connected" && error.details.platforms[0] === "instagram");

  // Explicit accounts: several on Instagram are fine; TikTok takes one.
  await postgres.query("update social_accounts set status = 'connected' where id = $1", [ids.ig2]);
  assert.equal((await targets({ accountIds: [ids.ig1, ids.ig2], providers: ["instagram"] })).length, 2);
  await assert.rejects(targets({ accountIds: [ids.tiktok1, ids.tiktok2], providers: ["tiktok"] }), /one_account_per_platform/);
  await assert.rejects(targets({ businessId: business.id, providers: ["facebook"] }), /account_not_connected/);

  // Nothing chosen: the newest connected account per platform, as before.
  assert.equal((await targets({ providers: ["threads"] }))[0].id, ids.threads);
});

test("analytics add up every account on a platform, and filter by business or picked accounts", async () => {
  const { postgres, workspaceId, ids } = await seed();
  const { send } = routes(postgres, workspaceId);
  const snapshot = (account, audience) => postgres.query(
    `insert into account_metric_snapshots (social_account_id, workspace_id, provider, audience, fetched_at)
     values ($1, $2, 'instagram', $3, now())`,
    [account, workspaceId, audience],
  );
  const day = (account, views, date) => postgres.query(
    `insert into daily_metric_snapshots (social_account_id, workspace_id, provider, metric_date, views, likes, fetched_at)
     values ($1, $2, 'instagram', $3, $4, 1, now())`,
    [account, workspaceId, date, views],
  );
  const today = new Date().toISOString().slice(0, 10);
  await snapshot(ids.ig1, 1_000);
  await snapshot(ids.ig2, 500);
  await snapshot(ids.igOld, 9_999);
  await day(ids.ig1, 300, today);
  await day(ids.ig2, 200, today);

  const instagram = (dashboard) => dashboard.platforms.find((row) => row.provider === "instagram");
  const overall = instagram(await loadAnalyticsDashboard(postgres, workspaceId, 7));
  assert.equal(overall.audience, 1_500, "both connected accounts, not the disconnected one");
  assert.equal(overall.views, 500);
  assert.equal(overall.handle, "@sofia, @sofia.clips");
  assert.deepEqual(overall.daily.map((point) => [point.date, point.views, point.likes]), [[today, 500, 2]]);

  const one = instagram(await loadAnalyticsDashboard(postgres, workspaceId, 7, { accountIds: [ids.ig2] }));
  assert.equal(one.audience, 500);
  assert.equal(one.views, 200);

  const business = (await send("POST", "/v1/businesses", { name: "Sofia", accountIds: [ids.ig1, ids.threads] })).body;
  const scoped = await resolveScopeAccounts(postgres, workspaceId, parseScopeQuery({ business: business.id }));
  assert.deepEqual(scoped.sort(), [ids.ig1, ids.threads].sort());
  assert.equal(instagram(await loadAnalyticsDashboard(postgres, workspaceId, 7, { accountIds: scoped })).audience, 1_000);

  // Accounts picked inside a business must belong to it.
  await assert.rejects(resolveScopeAccounts(postgres, workspaceId, { businessId: business.id, accountIds: [ids.ig2] }), /invalid_scope/);
  await assert.rejects(resolveScopeAccounts(postgres, workspaceId, { accountIds: [ids.foreign] }), /invalid_scope/);
  assert.throws(() => parseScopeQuery({ accounts: "nope" }), /invalid_scope/);
  assert.equal(await resolveScopeAccounts(postgres, workspaceId, parseScopeQuery({})), null);
});

test("the Businesses tab gets every account's stats, this period and the one before", async () => {
  const { postgres, workspaceId, ids } = await seed();
  const { loadAccountAnalytics } = await import("../src/analytics.js");
  const now = Date.parse("2026-09-26T12:00:00Z");
  const day = (account, date, views) => postgres.query(
    `insert into daily_metric_snapshots (social_account_id, workspace_id, provider, metric_date, views, likes, comments, fetched_at)
     values ($1, $2, 'instagram', $3, $4, 10, 2, now())`,
    [account, workspaceId, date, views],
  );
  await day(ids.ig1, "2026-09-25", 900);
  await day(ids.ig1, "2026-09-15", 400);
  await day(ids.ig2, "2026-09-24", 50);
  await postgres.query(
    `insert into account_metric_snapshots (social_account_id, workspace_id, provider, audience, fetched_at)
     values ($1, $2, 'instagram', 1200, now())`,
    [ids.ig1, workspaceId],
  );
  const post = (await postgres.query(
    "insert into transmissions (workspace_id, title, status, schedule_mode, source) values ($1, 'Rant', 'live', 'now', 'ui') returning id",
    [workspaceId],
  )).rows[0].id;
  const projection = (await postgres.query(
    `insert into projections (transmission_id, workspace_id, social_account_id, provider, status, published_at)
     values ($1, $2, $3, 'instagram', 'live', '2026-09-25T10:00:00Z') returning id`,
    [post, workspaceId, ids.ig1],
  )).rows[0].id;
  await postgres.query(
    `insert into points_ledger (workspace_id, source, amount, reference_id, social_account_id, projection_id, provider, awarded_at)
     values ($1, 'views', 12.5, 'a', $2, $3, 'instagram', '2026-09-25T12:00:00Z'),
            ($1, 'views', 4, 'b', $2, $3, 'instagram', '2026-09-14T12:00:00Z'),
            ($1, 'streak', 10, 'c', null, null, null, '2026-09-25T12:00:00Z')`,
    [workspaceId, ids.ig1, projection],
  );

  const { accounts } = await loadAccountAnalytics(postgres, workspaceId, 7, now);
  const byId = new Map(accounts.map((account) => [account.accountId, account]));
  assert.ok(!byId.has(ids.igOld), "a disconnected account that's in no business is left out");
  assert.ok(!byId.has(ids.foreign), "another workspace's account is left out");
  const sofia = byId.get(ids.ig1);
  assert.equal(sofia.views, 900);
  assert.equal(sofia.previous.views, 400);
  assert.equal(sofia.audience, 1200);
  assert.equal(sofia.publishedPosts, 1);
  assert.equal(sofia.points, 12.5);
  assert.equal(sofia.previous.points, 4);
  assert.equal(sofia.lastPostAt, Date.parse("2026-09-25T10:00:00Z"));
  assert.deepEqual(sofia.daily, [{ date: "2026-09-25", views: 900 }]);
  assert.equal(Math.round(sofia.engagementRate * 1000) / 1000, Math.round((12 / 900) * 1000) / 1000);
  assert.equal(byId.get(ids.ig2).views, 50);
});

test("the calendar's period stats: views and points for the month on screen, the month before, and the streak", async () => {
  const { postgres, workspaceId, ids } = await seed();
  const { loadPeriodStats, periodProblem } = await import("../src/analytics.js");
  const day = (account, date, views) => postgres.query(
    `insert into daily_metric_snapshots (social_account_id, workspace_id, provider, metric_date, views, fetched_at)
     values ($1, $2, 'instagram', $3, $4, now())`,
    [account, workspaceId, date, views],
  );
  await day(ids.ig1, "2026-09-03", 100);
  await day(ids.ig2, "2026-09-20", 50);
  await day(ids.ig1, "2026-08-10", 30);
  await postgres.query(
    `insert into points_ledger (workspace_id, source, amount, reference_id, social_account_id, provider, awarded_at)
     values ($1, 'views', 5, 'a', $2, 'instagram', '2026-09-30T23:30:00-07:00'),
            ($1, 'views', 7, 'b', $2, 'instagram', '2026-10-01T00:30:00-07:00'),
            ($1, 'streak', 10, 'c', null, null, '2026-09-10T12:00:00Z'),
            ($1, 'views', 3, 'd', $2, 'instagram', '2026-08-15T12:00:00Z')`,
    [workspaceId, ids.ig1],
  );
  const september = { from: "2026-09-01", to: "2026-09-30", timeZone: "America/Los_Angeles" };
  const all = await loadPeriodStats(postgres, workspaceId, september);
  assert.equal(all.views, 150);
  assert.equal(all.previousViews, 30);
  assert.equal(all.points, 15, "the Oct 1 00:30 Los Angeles point belongs to October; the streak bonus counts overall");
  assert.equal(all.previousPoints, 3);
  assert.equal(all.streak.days, 0);
  const one = await loadPeriodStats(postgres, workspaceId, { ...september, accountIds: [ids.ig2] });
  assert.equal(one.views, 50);
  assert.equal(one.points, 0, "streak bonuses belong to no account");
  assert.equal(periodProblem("2026-09-30", "2026-09-01"), "invalid_period");
  assert.equal(periodProblem("2026-9-1", "2026-09-30"), "invalid_period");
  assert.equal(periodProblem("2026-09-01", "2026-09-30"), undefined);
});
