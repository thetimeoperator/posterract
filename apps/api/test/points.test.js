import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { LEVEL_THRESHOLDS, POINTS_START_AT, levelFor, levelProgress, rankFor, rankForLevel } from "@posterract/contract";
import {
  awardPostLive,
  followerMilestonesCrossed,
  loadLeaderboard,
  loadPointsDashboard,
  loadPointsSummary,
  personalBests,
  postTargets,
  scoreWorkspace,
  scoreWorkspacePoints,
  streakRuns,
  streakState,
} from "../src/points.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = resolve(here, "../../../deploy/posterract/postgres/init");
const DAY = 86_400_000;
const HOUR = 3_600_000;
// Scoring tests run in the weeks after launch day, when points count.
const LAUNCH = POINTS_START_AT;

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  const files = (await readdir(migrationDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of files) await db.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
  const query = (sql, params) => db.query(sql, params);
  return { query, connect: async () => ({ query, release() {} }) };
}

const one = async (postgres, sql, params) => (await postgres.query(sql, params)).rows[0];

async function workspace(postgres, { name = "Sina", verified = true } = {}) {
  const user = await one(
    postgres,
    "insert into app_users (email, display_name, email_verified) values ($1, $2, $3) returning id",
    [`${name.toLowerCase().replaceAll(" ", "")}-${Math.random()}@example.com`, name, verified],
  );
  const space = await one(postgres, "insert into workspaces (owner_id, name) values ($1, $2) returning id", [
    user.id,
    `${name} HQ`,
  ]);
  return { userId: user.id, workspaceId: space.id };
}

async function account(postgres, workspaceId, provider, handle = provider) {
  const row = await one(
    postgres,
    `insert into social_accounts (workspace_id, provider, provider_account_id, handle)
     values ($1, $2, $3, $4) returning id`,
    [workspaceId, provider, `${provider}-${Math.random()}`, handle],
  );
  return row.id;
}

async function media(postgres, workspaceId, durationMs = 25_000) {
  const row = await one(
    postgres,
    `insert into media_assets (workspace_id, original_filename, r2_key, mime_type, size_bytes, duration_ms, status)
     values ($1, 'clip.mp4', $2, 'video/mp4', 1000, $3, 'ready') returning id`,
    [workspaceId, `media/${Math.random()}`, durationMs],
  );
  return row.id;
}

async function livePost(postgres, { workspaceId, accountId, provider, mediaId, publishedAt, title = "My video" }) {
  const transmission = await one(
    postgres,
    `insert into transmissions (workspace_id, media_asset_id, title, status, schedule_mode, source)
     values ($1, $2, $3, 'live', 'now', 'ui') returning id`,
    [workspaceId, mediaId ?? null, title],
  );
  const projection = await one(
    postgres,
    `insert into projections (transmission_id, workspace_id, social_account_id, provider, status, published_at, platform_post_id)
     values ($1, $2, $3, $4, 'live', $5, $6) returning id`,
    [transmission.id, workspaceId, accountId, provider, new Date(publishedAt), `post-${Math.random()}`],
  );
  return projection.id;
}

async function snapshot(postgres, { projectionId, workspaceId, provider, views, likes = 0, comments = 0, shares = 0, watch, average, raw = {}, at = Date.now() }) {
  await postgres.query(
    `insert into publication_metric_snapshots
       (projection_id, workspace_id, provider, views, likes, comments, shares,
        watch_time_seconds, average_view_duration_seconds, raw_metrics, fetched_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [projectionId, workspaceId, provider, views, likes, comments, shares, watch ?? null, average ?? null, JSON.stringify(raw), new Date(at)],
  );
}

async function followers(postgres, { accountId, workspaceId, provider, audience, at }) {
  await postgres.query(
    `insert into account_metric_snapshots (social_account_id, workspace_id, provider, audience, fetched_at)
     values ($1, $2, $3, $4, $5)`,
    [accountId, workspaceId, provider, audience, new Date(at)],
  );
}

const total = async (postgres, workspaceId) =>
  Number((await one(postgres, "select coalesce(sum(amount), 0) as total from points_ledger where workspace_id = $1", [workspaceId])).total);

// ---------------------------------------------------------------------------

test("the relaunch migration deletes the points paid under the old rules", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const files = (await readdir(migrationDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  const apply = async (names) => {
    for (const name of names) await db.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
  };
  await apply(files.filter((name) => name < "022"));
  const user = await db.query("insert into app_users (email, display_name) values ('old@example.com', 'Old') returning id");
  const space = await db.query("insert into workspaces (owner_id, name) values ($1, 'Old HQ') returning id", [user.rows[0].id]);
  await db.query(
    "insert into points_ledger (workspace_id, source, amount, reference_id) values ($1, 'post', 10, 'projection:legacy')",
    [space.rows[0].id],
  );
  await apply(files.filter((name) => name >= "022"));
  const left = await db.query("select count(*) as count from points_ledger");
  assert.equal(Number(left.rows[0].count), 0);
});

test("levels run 1 to 100, level 100 needs 24.19 million points, and each level is a tier and a title", () => {
  assert.equal(LEVEL_THRESHOLDS.length, 100);
  for (let index = 1; index < LEVEL_THRESHOLDS.length; index += 1) {
    assert.ok(LEVEL_THRESHOLDS[index] > LEVEL_THRESHOLDS[index - 1], `level ${index + 1} must need more than ${index}`);
  }
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(9.99), 1);
  assert.equal(levelFor(10), 2);
  assert.equal(levelFor(24_189_999), 99);
  assert.equal(levelFor(24_190_000), 100);
  assert.equal(levelFor(1e12), 100);
  assert.deepEqual(levelProgress(24_190_000).next, null);
  assert.equal(levelProgress(15).floor, 10);
  assert.equal(rankFor(0).label, "Bronze Recruit"); // level 1
  assert.equal(rankFor(159).label, "Bronze Commander"); // level 9
  assert.equal(rankFor(160).label, "Bronze General"); // level 10
  assert.equal(rankFor(190).label, "Silver Recruit"); // level 11
  assert.equal(rankFor(1_740).label, "Gold Captain"); // level 26
  assert.equal(rankFor(6_700_000).id, "mythic-general"); // level 90
  assert.equal(rankFor(44_700).label, "Master Recruit"); // level 51
  assert.equal(rankFor(24_190_000).label, "Legendary General"); // level 100
  assert.equal(rankForLevel(100).minRP, 24_190_000);
  assert.equal(new Set(Array.from({ length: 100 }, (_, index) => rankForLevel(index + 1).id)).size, 100);
});

test("a post earns the founder's rates, platform by platform", () => {
  const instagram = postTargets({
    provider: "instagram",
    metrics: { views: 10_000, likes: 400, comments: 20, shares: 50, saves: 60, watchSeconds: 100_000, averageWatchSeconds: 10 },
    durationSeconds: 25,
    ageHours: 120,
  });
  assert.equal(instagram.post.points, 1);
  assert.equal(instagram.views.points, 10); // 1 per 1,000 views
  assert.equal(instagram.likes.points, 4); // 1 per 100 likes
  assert.equal(instagram.comments.points, 2); // 1 per 10 comments
  assert.equal(instagram.shares.points, 2.5); // 1 per 20 shares
  assert.equal(instagram.saves.points, 3); // 1 per 20 saves
  assert.equal(instagram.watch.points, 27.78); // 1 per hour watched
  assert.equal(instagram.retention, undefined); // 40% watched: no bonus

  const threads = postTargets({
    provider: "threads",
    metrics: { views: 5_000, likes: 100, comments: 15, shares: 10, saves: 0, watchSeconds: undefined },
    durationSeconds: 0,
    ageHours: 120,
  });
  assert.equal(threads.views.points, 2.5); // 1 per 2,000 views on Threads
  assert.equal(threads.likes.points, 1);
  assert.equal(threads.comments.points, 1.5);
  assert.equal(threads.shares.points, 0.5);
  assert.equal(threads.saves, undefined);
  assert.equal(threads.watch, undefined);

  // TikTok and YouTube earn nothing yet.
  assert.deepEqual(postTargets({ provider: "tiktok", metrics: { views: 1e6 } }), {});
});

test("the retention bonus waits for day 3 and 1,000 views, and pays +5 at half watched, +10 at three quarters", () => {
  const base = { provider: "facebook", durationSeconds: 20, ageHours: 80 };
  const metrics = (views, average) => ({ views, likes: 0, comments: 0, shares: 0, saves: 0, watchSeconds: views * average, averageWatchSeconds: average });
  assert.equal(postTargets({ ...base, metrics: metrics(2_000, 10) }).retention.points, 5);
  assert.equal(postTargets({ ...base, metrics: metrics(2_000, 15) }).retention.points, 10);
  assert.equal(postTargets({ ...base, metrics: metrics(2_000, 9) }).retention, undefined);
  assert.equal(postTargets({ ...base, ageHours: 48, metrics: metrics(2_000, 15) }).retention, undefined);
  assert.equal(postTargets({ ...base, metrics: metrics(999, 15) }).retention, undefined);
});

test("streaks are runs of consecutive days, alive until a whole day passes without a post", () => {
  const runs = streakRuns(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-05", "2026-09-06", "2026-09-02"]);
  assert.deepEqual(runs.map((run) => run.length), [3, 2]);
  assert.deepEqual(streakState(runs, "2026-09-06").current, 2);
  assert.deepEqual(streakState(runs, "2026-09-07").current, 2); // today's post can still come
  assert.deepEqual(streakState(runs, "2026-09-08").current, 0);
  assert.equal(streakState(runs, "2026-09-08").best, 3);
  assert.deepEqual(streakState(runs, "2026-09-06").next, { days: 7, points: 10 });
});

test("personal bests need 1,000 views and five earlier posts", () => {
  const posts = [1, 2, 3, 4, 5].map((index) => ({ id: `p${index}`, accountId: "a", publishedAt: index * DAY, views: 1_000 }));
  const record = personalBests([...posts, { id: "big", accountId: "a", publishedAt: 6 * DAY, views: 5_000 }]).get("big");
  assert.deepEqual(record, { record: true, breakout: true });
  const small = personalBests([...posts, { id: "up", accountId: "a", publishedAt: 6 * DAY, views: 1_500 }]).get("up");
  assert.deepEqual(small, { record: true, breakout: false });
  assert.equal(personalBests(posts.slice(0, 4).concat({ id: "x", accountId: "a", publishedAt: 9 * DAY, views: 9_000 })).get("x"), undefined);
  assert.equal(personalBests([...posts, { id: "low", accountId: "a", publishedAt: 6 * DAY, views: 900 }]).get("low"), undefined);
});

test("follower milestones count only growth since connecting", () => {
  assert.deepEqual(followerMilestonesCrossed(3_000, 12_000).map((m) => m.followers), [5_000, 10_000]);
  assert.deepEqual(followerMilestonesCrossed(0, 999), []);
  assert.deepEqual(followerMilestonesCrossed(999_999, 1_000_000).map((m) => m.points), [5_000]);
});

test("scoring pays each post, milestone and account once, and never takes points back", async () => {
  const postgres = await database();
  const { workspaceId } = await workspace(postgres);
  const now = LAUNCH + 40 * DAY;
  const publishedAt = now - 5 * DAY;
  const clip = await media(postgres, workspaceId, 25_000);

  const ig = await account(postgres, workspaceId, "instagram", "sina");
  const fb = await account(postgres, workspaceId, "facebook", "sinapage");
  const th = await account(postgres, workspaceId, "threads", "sina");
  const igPost = await livePost(postgres, { workspaceId, accountId: ig, provider: "instagram", mediaId: clip, publishedAt });
  const fbPost = await livePost(postgres, { workspaceId, accountId: fb, provider: "facebook", mediaId: clip, publishedAt });
  const thPost = await livePost(postgres, { workspaceId, accountId: th, provider: "threads", mediaId: clip, publishedAt });

  await snapshot(postgres, { projectionId: igPost, workspaceId, provider: "instagram", views: 10_000, likes: 400, comments: 20, shares: 50, watch: 100_000, average: 13, raw: { saves: 60 }, at: now - HOUR });
  await snapshot(postgres, { projectionId: fbPost, workspaceId, provider: "facebook", views: 2_000, likes: 50, comments: 5, shares: 4, watch: 3_600, average: 13, raw: { reactions: 80 }, at: now - HOUR });
  await snapshot(postgres, { projectionId: thPost, workspaceId, provider: "threads", views: 5_000, likes: 100, comments: 15, shares: 10, at: now - HOUR });
  await followers(postgres, { accountId: ig, workspaceId, provider: "instagram", audience: 900, at: now - 10 * DAY });
  await followers(postgres, { accountId: ig, workspaceId, provider: "instagram", audience: 1_200, at: now - DAY });

  const first = await scoreWorkspacePoints(postgres, workspaceId, { now });
  // Instagram 1 + 10 + 4 + 2 + 2.5 + 3 + 27.78 + 5 (52% watched) = 55.28
  // Facebook 1 + 2 + 0.8 (80 reactions) + 0.5 + 0.2 + 1 + 5 = 10.5
  // Threads 1 + 2.5 + 1 + 1.5 + 0.5 = 6.5
  // Instagram passed 1,000 followers after connecting: +10
  assert.equal(first.paid, 82.28);
  assert.equal(await total(postgres, workspaceId), 82.28);
  assert.equal(first.bySource.retention, 10);
  assert.equal(first.bySource.followers, 10);

  // Running again pays nothing twice.
  assert.equal((await scoreWorkspacePoints(postgres, workspaceId, { now })).paid, 0);
  assert.equal(await total(postgres, workspaceId), 82.28);

  // Growth pays the rise; a dip takes nothing back.
  await snapshot(postgres, { projectionId: igPost, workspaceId, provider: "instagram", views: 20_000, likes: 300, comments: 20, shares: 50, watch: 100_000, average: 13, raw: { saves: 60 }, at: now + 1_000 });
  const second = await scoreWorkspacePoints(postgres, workspaceId, { now });
  assert.deepEqual(second.bySource, { views: 10 });
  assert.equal(await total(postgres, workspaceId), 92.28);

  // A dry run reports and writes nothing.
  await snapshot(postgres, { projectionId: thPost, workspaceId, provider: "threads", views: 9_000, likes: 100, comments: 15, shares: 10, at: now + 2_000 });
  assert.equal((await scoreWorkspacePoints(postgres, workspaceId, { now, dryRun: true })).paid, 2);
  assert.equal(await total(postgres, workspaceId), 92.28);

  const dashboard = await loadPointsDashboard(postgres, workspaceId, now);
  assert.equal(dashboard.totalPoints, 92.28);
  assert.equal(dashboard.level, 7); // 85 ≤ 92.28 < 105
  assert.equal(dashboard.nextLevelAt, 105);
  assert.equal(dashboard.rank.label, "Bronze Major");
  assert.equal(dashboard.topPosts[0].projectionId, igPost);
  assert.equal(dashboard.topPosts[0].total, 65.28);
  assert.ok(dashboard.topPosts[0].parts.some((part) => part.source === "watch" && part.points === 27.78));
  const igFollowers = dashboard.followers.find((row) => row.accountId === ig);
  assert.deepEqual({ baseline: igFollowers.baseline, next: igFollowers.next }, { baseline: 900, next: { followers: 5_000, points: 40 } });
  assert.ok(dashboard.badges.includes("first_transmission"));

  const summary = await loadPointsSummary(postgres, workspaceId);
  assert.equal(summary.lifetimeRP, 92.28);
});

test("a streak pays each milestone once per run, and a reposted video keeps nothing alive", async () => {
  const postgres = await database();
  const { workspaceId } = await workspace(postgres);
  const ig = await account(postgres, workspaceId, "instagram");
  const start = LAUNCH + 15 * HOUR;
  const post = async (day, mediaId) => livePost(postgres, { workspaceId, accountId: ig, provider: "instagram", mediaId: mediaId ?? (await media(postgres, workspaceId)), publishedAt: start + day * DAY });

  for (let day = 0; day < 7; day += 1) await post(day);
  const reused = await media(postgres, workspaceId);
  await post(7, reused);
  await post(8, reused); // the same file again: not a new day of posting
  await post(20); // a new run after the break
  for (let day = 21; day < 27; day += 1) await post(day);

  const report = await scoreWorkspacePoints(postgres, workspaceId, { now: start + 30 * DAY });
  // Two 7-day runs ([0..7] is 8 days, [20..26] is 7): +10 each, nothing for 30.
  assert.equal(report.bySource.streak, 20);
  assert.equal((await scoreWorkspacePoints(postgres, workspaceId, { now: start + 30 * DAY })).paid, 0);
});

test("scoring notifies once a day with a running total, plus levels and fresh achievements", async () => {
  const postgres = await database();
  const { workspaceId } = await workspace(postgres);
  const now = LAUNCH + 60 * DAY + 15 * HOUR;
  const ig = await account(postgres, workspaceId, "instagram", "@sina");
  // Five earlier posts around 1,200 views, then one with 50,000: a record and a breakout.
  for (let index = 0; index < 5; index += 1) {
    const earlier = await livePost(postgres, { workspaceId, accountId: ig, provider: "instagram", publishedAt: now - (40 - index) * DAY, title: `Old ${index}` });
    await snapshot(postgres, { projectionId: earlier, workspaceId, provider: "instagram", views: 1_000 + index * 100, at: now - DAY });
  }
  const hit = await livePost(postgres, { workspaceId, accountId: ig, provider: "instagram", publishedAt: now - 2 * DAY, title: "The hit" });
  await snapshot(postgres, { projectionId: hit, workspaceId, provider: "instagram", views: 50_000, at: now - 60_000 });
  const events = async () =>
    (await postgres.query(
      "select type, message from events where workspace_id = $1 and type like 'points.%' order by id",
      [workspaceId],
    )).rows;

  // 6 posts live + 6 points of older views + 50 views, 10 record, 5 breakout = 77: level 6.
  assert.equal((await scoreWorkspacePoints(postgres, workspaceId, { now })).paid, 77);
  assert.deepEqual(await events(), [
    { type: "points.earned", message: "You've earned +65 points today." },
    { type: "points.record", message: "New views record on Instagram: “The hit” (+10 points)." },
    { type: "points.breakout", message: "Breakout on Instagram: “The hit” got 3× your usual views (+5 points)." },
    { type: "points.level", message: "You're now Bronze Captain, level 6." },
  ]);

  // More views the same day update the day's line instead of adding one.
  await snapshot(postgres, { projectionId: hit, workspaceId, provider: "instagram", views: 55_000, at: now - 30_000 });
  assert.equal((await scoreWorkspacePoints(postgres, workspaceId, { now })).paid, 5);
  const after = await events();
  assert.equal(after.length, 4);
  assert.equal(after.find((row) => row.type === "points.earned").message, "You've earned +70 points today.");

  // A dry run notifies nobody.
  await snapshot(postgres, { projectionId: hit, workspaceId, provider: "instagram", views: 90_000, at: now - 10_000 });
  assert.equal((await scoreWorkspacePoints(postgres, workspaceId, { now, dryRun: true })).paid, 35);
  assert.deepEqual(await events(), after);
});

test("a relaunch backfill is silent and dates each post's points when it went live", async () => {
  const postgres = await database();
  const { workspaceId } = await workspace(postgres);
  const now = LAUNCH + 40 * DAY + 15 * HOUR;
  const publishedAt = now - 20 * DAY;
  const ig = await account(postgres, workspaceId, "instagram");
  const post = await livePost(postgres, { workspaceId, accountId: ig, provider: "instagram", publishedAt });
  await snapshot(postgres, { projectionId: post, workspaceId, provider: "instagram", views: 12_000, likes: 300, at: now - 60_000 });

  const client = await postgres.connect();
  await client.query("begin");
  const report = await scoreWorkspace(client, workspaceId, { now, backfill: true, notify: false });
  await client.query("commit");
  assert.equal(report.paid, 16); // 1 + 12 + 3
  const dates = await one(
    postgres,
    "select min(awarded_at) as first, max(awarded_at) as last from points_ledger where workspace_id = $1",
    [workspaceId],
  );
  assert.equal(new Date(dates.first).getTime(), publishedAt);
  assert.equal(new Date(dates.last).getTime(), publishedAt);
  const notified = await one(postgres, "select count(*) as count from events where workspace_id = $1", [workspaceId]);
  assert.equal(Number(notified.count), 0);
});

test("everyone starts at zero on launch day: earlier posts, posting days and followers earn nothing", async () => {
  const postgres = await database();
  const { workspaceId } = await workspace(postgres);
  const now = LAUNCH + 3 * DAY + 12 * HOUR;
  const ig = await account(postgres, workspaceId, "instagram", "@sina");
  // Six days of posting before launch, around 1,250 views each.
  for (let index = 0; index < 6; index += 1) {
    const earlier = await livePost(postgres, { workspaceId, accountId: ig, provider: "instagram", publishedAt: LAUNCH - (6 - index) * DAY + 12 * HOUR });
    await snapshot(postgres, { projectionId: earlier, workspaceId, provider: "instagram", views: 1_000 + index * 100, at: LAUNCH - HOUR });
  }
  // Launch day: the seventh day in a row, and 50,000 views.
  const hit = await livePost(postgres, { workspaceId, accountId: ig, provider: "instagram", publishedAt: LAUNCH + 12 * HOUR, title: "The hit" });
  await snapshot(postgres, { projectionId: hit, workspaceId, provider: "instagram", views: 50_000, at: now - HOUR });
  // 1,100 followers at launch; the 1,000 milestone was passed before it.
  await followers(postgres, { accountId: ig, workspaceId, provider: "instagram", audience: 800, at: LAUNCH - 10 * DAY });
  await followers(postgres, { accountId: ig, workspaceId, provider: "instagram", audience: 1_100, at: LAUNCH - HOUR });
  await followers(postgres, { accountId: ig, workspaceId, provider: "instagram", audience: 5_200, at: LAUNCH + 2 * DAY });

  const report = await scoreWorkspacePoints(postgres, workspaceId, { now });
  // The earlier posts still set the bar: 50,000 views is a record and a breakout.
  assert.deepEqual(report.bySource, { post: 1, views: 50, record: 10, breakout: 5, followers: 40 });
  assert.equal(report.paid, 106);
  const scored = await one(postgres, "select count(distinct projection_id) as posts from post_points where workspace_id = $1", [workspaceId]);
  assert.equal(Number(scored.posts), 1);
  const baseline = await one(postgres, "select followers from follower_baselines where social_account_id = $1", [ig]);
  assert.equal(Number(baseline.followers), 1_100);
  const dashboard = await loadPointsDashboard(postgres, workspaceId, LAUNCH + 12 * HOUR);
  assert.equal(dashboard.streak.current, 1);
});

test("the live-post point is paid once, on Instagram, Facebook and Threads only", async () => {
  const postgres = await database();
  const { workspaceId } = await workspace(postgres);
  const ig = await account(postgres, workspaceId, "instagram");
  const tt = await account(postgres, workspaceId, "tiktok");
  const igPost = await livePost(postgres, { workspaceId, accountId: ig, provider: "instagram", publishedAt: LAUNCH + DAY });
  const ttPost = await livePost(postgres, { workspaceId, accountId: tt, provider: "tiktok", publishedAt: LAUNCH + DAY });
  const pay = (projectionId, provider, accountId) =>
    awardPostLive(postgres, { projectionId, workspaceId, provider, socialAccountId: accountId, title: "Clip" });
  assert.equal(await pay(igPost, "instagram", ig), 1);
  assert.equal(await pay(igPost, "instagram", ig), 0);
  assert.equal(await pay(ttPost, "tiktok", tt), 0);
  assert.equal(await total(postgres, workspaceId), 1);
  // The analytics pass sees the post already paid.
  assert.equal((await scoreWorkspacePoints(postgres, workspaceId, { now: LAUNCH + 2 * DAY })).paid, 0);
});

test("reaching a new tier gets its own notification", async () => {
  const postgres = await database();
  const { workspaceId } = await workspace(postgres);
  const ig = await account(postgres, workspaceId, "instagram");
  await postgres.query(
    "insert into points_ledger (workspace_id, source, amount, reference_id) values ($1, 'bonus', 189.5, 'test:start')",
    [workspaceId],
  );
  const post = await livePost(postgres, { workspaceId, accountId: ig, provider: "instagram", publishedAt: LAUNCH + DAY });
  await awardPostLive(postgres, { projectionId: post, workspaceId, provider: "instagram", socialAccountId: ig, title: "Clip" });
  const event = await one(postgres, "select message from events where workspace_id = $1 and type = 'points.level'", [workspaceId]);
  assert.equal(event.message, "You made Silver! You're now Silver Recruit, level 11.");
});

test("the leaderboard ranks everyone on a paid plan or an AI FOR SAVAGES membership", async () => {
  const postgres = await database();
  const paid = await workspace(postgres, { name: "Paid Pro" });
  const member = await workspace(postgres, { name: "Savage" });
  const unpaid = await workspace(postgres, { name: "No Plan" });
  const failing = await workspace(postgres, { name: "Card Declined" });
  const unverified = await workspace(postgres, { name: "Unverified", verified: false });

  const subscribe = (workspaceId, id, lastPayment = null) =>
    postgres.query(
      `insert into billing_subscriptions (stripe_subscription_id, workspace_id, stripe_customer_id, status, recognized_plan, last_payment_status)
       values ($1, $2, 'cus', 'active', true, $3)`,
      [id, workspaceId, lastPayment],
    );
  await subscribe(paid.workspaceId, "sub_paid");
  await subscribe(failing.workspaceId, "sub_failing", "failed");
  for (const { userId } of [member, unverified]) {
    await postgres.query(
      `insert into core.memberships (account_id, product_id, plan, status, source)
       values ($1, 'aiforsavages', 'lifetime', 'active', 'manual')`,
      [userId],
    );
  }

  const award = (workspaceId, amount, at) =>
    postgres.query(
      "insert into points_ledger (workspace_id, source, amount, reference_id, awarded_at) values ($1, 'bonus', $2, $3, $4)",
      [workspaceId, amount, `test:${Math.random()}`, new Date(at)],
    );
  await award(paid.workspaceId, 100, Date.now());
  await award(member.workspaceId, 50, Date.now());
  await award(member.workspaceId, 400, Date.now() - 90 * DAY);
  await award(unpaid.workspaceId, 5_000, Date.now());
  await award(failing.workspaceId, 5_000, Date.now());
  await award(unverified.workspaceId, 5_000, Date.now());
  // Billing judges the most relevant subscription: here the newest, whose payment failed.
  const mixed = await workspace(postgres, { name: "Mixed" });
  await postgres.query(
    `insert into billing_subscriptions (stripe_subscription_id, workspace_id, stripe_customer_id, status, recognized_plan, last_payment_status, updated_at)
     values ('sub_old', $1, 'cus', 'active', true, null, now() - interval '10 days'),
            ('sub_new', $1, 'cus', 'active', true, 'failed', now())`,
    [mixed.workspaceId],
  );
  await award(mixed.workspaceId, 5_000, Date.now());

  // Named after an email, with no display name: the board shows the public handle instead.
  const emailNamed = await one(
    postgres,
    "insert into app_users (email, display_name, email_verified) values ('private@example.com', null, true) returning id",
  );
  const emailSpace = await one(postgres, "insert into workspaces (owner_id, name) values ($1, 'private@example.com') returning id", [emailNamed.id]);
  await subscribe(emailSpace.id, "sub_email");
  await account(postgres, emailSpace.id, "instagram", "@publichandle");
  await award(emailSpace.id, 1, Date.now() - 90 * DAY);

  const week = await loadLeaderboard(postgres, paid.workspaceId, "week");
  assert.deepEqual(week.entries.map((entry) => [entry.name, entry.points]), [["Paid Pro", 100], ["Savage", 50], ["@publichandle", 0]]);
  assert.equal(week.total, 3);
  assert.ok(week.entries.every((entry) => !entry.name.includes("@example.com")));
  assert.equal(week.me.position, 1);
  assert.equal(week.me.isMe, true);

  const all = await loadLeaderboard(postgres, paid.workspaceId, "all");
  assert.deepEqual(all.entries.map((entry) => [entry.name, entry.points, entry.level]), [["Savage", 450, 16], ["Paid Pro", 100, 7], ["@publichandle", 1, 1]]);

  // Someone without the base plan is not on the board.
  assert.equal((await loadLeaderboard(postgres, unpaid.workspaceId, "all")).me, undefined);
});
