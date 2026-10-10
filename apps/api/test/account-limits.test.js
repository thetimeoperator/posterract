import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { AccountLimitError, accountLimitFor } from "../src/accountLimits.js";
import { saveConnection } from "../src/oauth.js";

/**
 * Pro connects 10 accounts in all, an AI FOR SAVAGES member's workspace 100;
 * a reconnect never counts against the limit, and nothing is ever taken away.
 */

process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = resolve(here, "../../../deploy/posterract/postgres/init");

async function database({ through } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  const files = (await readdir(migrationDirectory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort()
    .filter((name) => !through || name <= through);
  for (const name of files) await db.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
  const query = (sql, params) => db.query(sql, params);
  return { query, connect: async () => ({ query, release() {} }) };
}

/** A workspace exactly as sign-up makes one: an owner and six empty placeholders. */
async function workspaceFor(postgres, { email = "owner@example.test", verified = true } = {}) {
  const user = (await postgres.query(
    "insert into app_users (email, display_name, email_verified) values ($1, 'Owner', $2) returning id",
    [email, verified],
  )).rows[0];
  const workspace = (await postgres.query(
    "insert into workspaces (owner_id, name) values ($1, 'Workspace') returning id",
    [user.id],
  )).rows[0];
  for (const provider of ["instagram", "tiktok", "facebook", "threads", "x", "youtube"]) {
    await postgres.query(
      "insert into social_accounts (workspace_id, provider, handle, status) values ($1, $2, 'not connected', 'disconnected')",
      [workspace.id, provider],
    );
  }
  return { userId: user.id, workspaceId: workspace.id };
}

const connection = (id) => ({
  providerAccountId: id,
  handle: `@${id}`,
  accessToken: "access",
  refreshToken: "refresh",
  scopes: [],
  expiresAt: Date.now() + 86_400_000,
});

/** 4 Instagram + 3 TikTok + 3 Threads: Pro's ten. */
async function connectTen(postgres, workspaceId) {
  for (const [provider, count] of [["instagram", 4], ["tiktok", 3], ["threads", 3]]) {
    for (let index = 0; index < count; index += 1) {
      await saveConnection(postgres, workspaceId, provider, connection(`${provider}-${index}`));
    }
  }
}

async function makeMember(postgres, userId) {
  await postgres.query(
    `insert into core.memberships (account_id, product_id, plan, status, source, current_period_end)
     values ($1, 'aiforsavages', 'monthly', 'active', 'manual', now() + interval '30 days')`,
    [userId],
  );
}

test("the empty placeholders never take a slot", async () => {
  const postgres = await database();
  const { workspaceId } = await workspaceFor(postgres);
  assert.deepEqual(await accountLimitFor(postgres, workspaceId), { plan: "pro", max: 10, used: 0 });
});

test("Pro connects ten accounts in all, across every platform, and the eleventh is refused", async () => {
  const postgres = await database();
  const { workspaceId } = await workspaceFor(postgres);
  await connectTen(postgres, workspaceId);
  assert.deepEqual(await accountLimitFor(postgres, workspaceId), { plan: "pro", max: 10, used: 10 });

  await assert.rejects(saveConnection(postgres, workspaceId, "facebook", connection("page-1")), (error) => {
    assert.ok(error instanceof AccountLimitError);
    assert.equal(error.code, "account_limit_reached");
    assert.deepEqual(error.accountLimit, { plan: "pro", max: 10, used: 10 });
    assert.match(error.message, /join AI FOR SAVAGES to connect up to 100/);
    return true;
  });
  assert.equal((await accountLimitFor(postgres, workspaceId)).used, 10, "nothing was written");
});

test("reconnecting an account that already holds a slot works at the limit", async () => {
  const postgres = await database();
  const { workspaceId } = await workspaceFor(postgres);
  await connectTen(postgres, workspaceId);
  await saveConnection(postgres, workspaceId, "instagram", connection("instagram-0"));
  assert.equal((await accountLimitFor(postgres, workspaceId)).used, 10);
});

test("an account waiting for a reconnect keeps its slot, and can be reconnected", async () => {
  const postgres = await database();
  const { workspaceId } = await workspaceFor(postgres);
  await connectTen(postgres, workspaceId);
  await postgres.query("update social_accounts set status = 'needs_reauth' where provider_account_id = 'tiktok-1'");
  assert.equal((await accountLimitFor(postgres, workspaceId)).used, 10);
  await assert.rejects(saveConnection(postgres, workspaceId, "facebook", connection("page-1")), AccountLimitError);
  await saveConnection(postgres, workspaceId, "tiktok", connection("tiktok-1"));
  const row = await postgres.query("select status from social_accounts where provider_account_id = 'tiktok-1'");
  assert.equal(row.rows[0].status, "connected");
});

test("disconnecting frees a slot, and bringing a disconnected account back needs one", async () => {
  const postgres = await database();
  const { workspaceId } = await workspaceFor(postgres);
  await connectTen(postgres, workspaceId);
  await postgres.query("update social_accounts set status = 'disconnected' where provider_account_id = 'tiktok-0'");
  assert.equal((await accountLimitFor(postgres, workspaceId)).used, 9);
  await saveConnection(postgres, workspaceId, "threads", connection("threads-new"));
  await assert.rejects(saveConnection(postgres, workspaceId, "tiktok", connection("tiktok-0")), AccountLimitError);
});

test("an AI FOR SAVAGES member's workspace connects up to 100", async () => {
  const postgres = await database();
  const { userId, workspaceId } = await workspaceFor(postgres);
  await makeMember(postgres, userId);
  await connectTen(postgres, workspaceId);
  await saveConnection(postgres, workspaceId, "facebook", connection("page-1"));
  assert.deepEqual(await accountLimitFor(postgres, workspaceId), { plan: "aiforsavages", max: 100, used: 11 });

  await postgres.query(
    `insert into social_accounts (workspace_id, provider, provider_account_id, handle, status)
     select $1::uuid, 'instagram', 'bulk-' || n, '@bulk' || n, 'connected' from generate_series(1, 89) as n`,
    [workspaceId],
  );
  await assert.rejects(saveConnection(postgres, workspaceId, "threads", connection("one-too-many")), (error) => {
    assert.ok(error instanceof AccountLimitError);
    assert.deepEqual(error.accountLimit, { plan: "aiforsavages", max: 100, used: 100 });
    assert.match(error.message, /All 100 of your account slots are in use/);
    return true;
  });
});

test("a membership counts only for an owner with a verified email", async () => {
  const postgres = await database();
  const { userId, workspaceId } = await workspaceFor(postgres, { verified: false });
  await makeMember(postgres, userId);
  assert.equal((await accountLimitFor(postgres, workspaceId)).plan, "pro");
});

test("without the core schema the limit falls back to Pro", async () => {
  const postgres = await database({ through: "016-tiktok-direct-post.sql" });
  const { workspaceId } = await workspaceFor(postgres);
  assert.deepEqual(await accountLimitFor(postgres, workspaceId), { plan: "pro", max: 10, used: 0 });
});
