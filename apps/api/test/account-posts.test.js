import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { loadAccountPosts } from "../src/analytics.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = resolve(here, "../../../deploy/posterract/postgres/init");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  const files = (await readdir(migrationDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of files) await db.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
  return { query: (sql, params) => db.query(sql, params) };
}

test("the posting graph counts every post on an account, from any app or tool, without counting Posterract's twice", async () => {
  const postgres = await database();
  const now = Date.now();
  const at = (ms) => new Date(now - ms).toISOString();
  const user = (await postgres.query("insert into app_users (email, display_name, email_verified) values ('s@example.com', 'Sina', true) returning id")).rows[0];
  const workspaceId = (await postgres.query("insert into workspaces (owner_id, name) values ($1, 'Mine') returning id", [user.id])).rows[0].id;
  const otherId = (await postgres.query("insert into workspaces (owner_id, name) values ($1, 'Theirs') returning id", [user.id])).rows[0].id;
  const account = async (workspace, provider, handle, covered) =>
    (await postgres.query(
      `insert into social_accounts (workspace_id, provider, provider_account_id, handle, status, posts_covered_from, posts_synced_at)
       values ($1, $2, $3, $4, 'connected', $5, $6) returning id`,
      [workspace, provider, `${provider}-${handle}`, handle, covered?.from ?? null, covered?.syncedAt ?? null],
    )).rows[0].id;
  // Instagram was read an hour ago, back to 30 days ago; TikTok has never been read.
  const instagram = await account(workspaceId, "instagram", "@zeropointsina", { from: at(30 * DAY), syncedAt: at(HOUR) });
  const tiktok = await account(workspaceId, "tiktok", "@sina", null);
  const stranger = await account(otherId, "instagram", "@stranger", { from: at(30 * DAY), syncedAt: at(HOUR) });

  const platformPost = (accountId, workspace, id, ago) => postgres.query(
    `insert into platform_posts (social_account_id, workspace_id, provider, platform_post_id, published_at)
     values ($1, $2, 'instagram', $3, $4)`,
    [accountId, workspace, id, at(ago)],
  );
  await platformPost(instagram, workspaceId, "made-here", 2 * DAY); // posted through Posterract
  await platformPost(instagram, workspaceId, "postiz-1", 1 * DAY); // posted from another tool
  await platformPost(instagram, workspaceId, "app-1", 1 * DAY); // posted in the Instagram app
  await platformPost(instagram, workspaceId, "ancient", 200 * DAY); // older than the graph shows
  await platformPost(stranger, otherId, "theirs", 1 * DAY);

  const projection = async (accountId, provider, status, platformPostId, ago) => {
    const transmission = (await postgres.query(
      "insert into transmissions (workspace_id, title, status, schedule_mode, source) values ($1, 'Post', 'live', 'now', 'ui') returning id",
      [workspaceId],
    )).rows[0].id;
    await postgres.query(
      `insert into projections (transmission_id, workspace_id, social_account_id, provider, status, platform_post_id, published_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [transmission, workspaceId, accountId, provider, status, platformPostId, at(ago)],
    );
  };
  await projection(instagram, "instagram", "live", "made-here", 2 * DAY); // also in the platform list: once
  await projection(instagram, "instagram", "live", "before-reading", 60 * DAY); // before the account was first read
  await projection(instagram, "instagram", "live", "just-now", 10 * 60_000); // since the last read
  await projection(instagram, "instagram", "live", "deleted-on-instagram", 5 * DAY); // the platform no longer lists it
  await projection(tiktok, "tiktok", "live", "7301", 3 * DAY); // never read: Posterract's own posts count
  await projection(tiktok, "tiktok", "failed", null, 3 * DAY); // never went live

  const { posts } = await loadAccountPosts(postgres, workspaceId);
  const byAccount = (id) => posts.filter((post) => post.accountId === id).length;
  assert.equal(byAccount(instagram), 5, "made-here, postiz-1, app-1, before-reading and just-now");
  assert.equal(byAccount(tiktok), 1);
  assert.equal(byAccount(stranger), 0, "another workspace's posts never leak in");
  assert.equal(posts.length, 6);
  assert.ok(posts.every((post) => typeof post.publishedAt === "number" && post.publishedAt <= now));
});
