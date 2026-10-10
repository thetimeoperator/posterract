import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { loadAccountAnalytics, loadAnalyticsDashboard } from "../src/analytics.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = resolve(here, "../../../deploy/posterract/postgres/init");
const DAY = 86_400_000;

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  const files = (await readdir(migrationDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of files) await db.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
  const query = (sql, params) => db.query(sql, params);
  return { query, connect: async () => ({ query, release() {} }) };
}

/**
 * Oct 9 2026: TikTok and Threads cards read 0 views. TikTok has no account
 * view total (only each video's), Threads' account "views" are profile
 * views, and posts made in other apps were left out of the sums.
 */
test("total views add up every post on the account, from any app, without counting Posterract's twice", async () => {
  const postgres = await database();
  const now = Date.now();
  const at = (ms) => new Date(now - ms).toISOString();
  const user = (await postgres.query("insert into app_users (email, display_name, email_verified) values ('s@example.com', 'Sina', true) returning id")).rows[0];
  const workspaceId = (await postgres.query("insert into workspaces (owner_id, name) values ($1, 'Mine') returning id", [user.id])).rows[0].id;
  const account = async (provider, handle, scopes) =>
    (await postgres.query(
      `insert into social_accounts (workspace_id, provider, provider_account_id, handle, status, scopes)
       values ($1, $2, $3, $4, 'connected', $5) returning id`,
      [workspaceId, provider, `${provider}-${handle}`, handle, scopes],
    )).rows[0].id;
  const tiktok = await account("tiktok", "Sina The Alchemist", ["user.info.stats", "video.list"]);
  const threads = await account("threads", "@zeropointsina", ["threads_basic", "threads_manage_insights"]);

  const snapshot = (accountId, provider, totalViews, raw) => postgres.query(
    `insert into account_metric_snapshots (social_account_id, workspace_id, provider, audience, total_views, published_videos, raw_metrics, fetched_at)
     values ($1, $2, $3, 100, $4, $5, $6, now())`,
    [accountId, workspaceId, provider, totalViews, provider === "tiktok" ? 4 : null, JSON.stringify(raw)],
  );
  // TikTok: every video's views added up by the worker. Threads: no total, only profile views.
  await snapshot(tiktok, "tiktok", 12_500, { totalViews: 12_500 });
  await snapshot(threads, "threads", null, { profileViews: 9 });

  const listed = (accountId, provider, id, ago, views) => postgres.query(
    `insert into platform_posts (social_account_id, workspace_id, provider, platform_post_id, published_at, views, likes, metrics_fetched_at)
     values ($1, $2, $3, $4, $5, $6, 1, $7)`,
    [accountId, workspaceId, provider, id, at(ago), views ?? 0, views === undefined ? null : new Date(now).toISOString()],
  );
  const projection = async (accountId, provider, platformPostId, ago, views) => {
    const transmission = (await postgres.query(
      "insert into transmissions (workspace_id, title, status, schedule_mode, source) values ($1, 'Post', 'live', 'now', 'ui') returning id",
      [workspaceId],
    )).rows[0].id;
    const projectionId = (await postgres.query(
      `insert into projections (transmission_id, workspace_id, social_account_id, provider, status, platform_post_id, published_at)
       values ($1, $2, $3, $4, 'live', $5, $6) returning id`,
      [transmission, workspaceId, accountId, provider, platformPostId, at(ago)],
    )).rows[0].id;
    await postgres.query(
      `insert into publication_metric_snapshots (projection_id, workspace_id, provider, views, likes, comments, shares, raw_metrics, fetched_at)
       values ($1, $2, $3, $4, 0, 0, 0, '{}', now())`,
      [projectionId, workspaceId, provider, views],
    );
  };
  // Threads: one post made through Posterract (listed too), two in the Threads app.
  await projection(threads, "threads", "made-here", 2 * DAY, 4);
  await listed(threads, "threads", "made-here", 2 * DAY, 4);
  await listed(threads, "threads", "app-1", 3 * DAY, 40);
  await listed(threads, "threads", "app-2", 40 * DAY, 6);
  await listed(threads, "threads", "not-read-yet", 1 * DAY);
  // TikTok: videos made elsewhere, with numbers.
  await listed(tiktok, "tiktok", "7001", 5 * DAY, 3_000);
  await listed(tiktok, "tiktok", "7002", 50 * DAY, 9_000);

  const { platforms } = await loadAnalyticsDashboard(postgres, workspaceId, "total");
  const card = (provider) => platforms.find((platform) => platform.provider === provider);
  assert.equal(card("tiktok").views, 12_500, "TikTok's all-time views: every video's added up");
  assert.equal(card("threads").views, 50, "Threads: 4 + 40 + 6 from its posts, never profile views");
  assert.equal(card("threads").publishedPosts, 4, "made-here once, app-1, app-2, not-read-yet");
  assert.equal(card("threads").posts.length, 1, "the post list stays Posterract's own");

  const week = await loadAnalyticsDashboard(postgres, workspaceId, 7);
  const threadsWeek = week.platforms.find((platform) => platform.provider === "threads");
  assert.equal(threadsWeek.views, 44, "the last 7 days: made-here and app-1");
  assert.equal(threadsWeek.publishedPosts, 3);

  const { accounts } = await loadAccountAnalytics(postgres, workspaceId, "total", now);
  const row = (id) => accounts.find((item) => item.accountId === id);
  assert.equal(row(tiktok).views, 12_500);
  assert.equal(row(threads).views, 50);
  assert.equal(row(threads).publishedPosts, 4);
});
