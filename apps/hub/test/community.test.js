import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { postgres, withTransaction } from "../src/db.js";
import {
  POINTS,
  FIRE_CAP_PER_POST,
  POSTS_PER_DAY,
  levelForPoints,
  levelProgress,
  displayHandle,
  award,
  computeStreak,
  recomputeStats,
  recomputeRanks,
  applyContributionCalendar,
  heatmapFor,
  createPost,
  toggleFire,
  reportPost,
  hideOwnPost,
  wallFeed,
  rankings,
  communityTotals,
  dashboardFor,
  githubStatus,
  githubTokenFor,
  connectGithub,
  disconnectGithub,
} from "../src/community.js";
import { openToken } from "../src/github-token.js";

// The sealing key for this run. Real deployments set it in the Hub env; the
// tests never need the production one.
process.env.AFS_GITHUB_TOKEN_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/**
 * Phase H — the community backend.
 *
 * The things worth pinning here are the ones that cost real money or real
 * trust if they drift: points must never be payable twice, a streak must mean
 * what a member thinks it means, and 🔥 must not be usable as a lever on
 * somebody else's score.
 */

const RUN = randomUUID().slice(0, 8);
const made = [];

async function makeMember({ handle = null, showOnWall = true, member = true } = {}) {
  const created = await postgres.query(
    `insert into app_users (id, email, display_name, email_verified)
     values (gen_random_uuid(), $1, $2, true) returning id`,
    [`ctest-${RUN}-${randomUUID().slice(0, 6)}@example.com`, `Test ${handle ?? "Member"}`],
  );
  const accountId = created.rows[0].id;
  made.push(accountId);

  await postgres.query(
    `insert into afs.profiles (account_id, handle, show_on_wall) values ($1, $2, $3)`,
    [accountId, handle, showOnWall],
  );

  if (member) {
    await postgres.query(
      `insert into core.memberships
         (account_id, product_id, plan, status, source, member_since)
       values ($1,'aiforsavages','monthly','active','stripe_subscription', now() - interval '3 months')`,
      [accountId],
    );
  }
  return accountId;
}

/**
 * Pretend GitHub was connected a year ago. Points are only paid from the day of
 * connection (no retroactive points), so the mechanics tests below — which
 * build calendars ending today — need an old connect date for every day to
 * count. The rule itself is pinned by its own test.
 */
async function connectedLongAgo(accountId) {
  await postgres.query(
    `insert into afs.profiles (account_id, github_connected_at)
     values ($1, now() - interval '1 year')
     on conflict (account_id) do update set github_connected_at = now() - interval '1 year'`,
    [accountId],
  );
}

/** n days of contributions ending `endingDaysAgo` days before today. */
function calendarDays(counts, endingDaysAgo = 0) {
  const days = [];
  for (let index = 0; index < counts.length; index += 1) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - endingDaysAgo - (counts.length - 1 - index));
    days.push({ date: date.toISOString().slice(0, 10), contributions: counts[index] });
  }
  return days;
}

after(async () => {
  if (made.length) {
    const ids = made;
    await postgres.query(`delete from afs.wall_reports where reporter_account_id = any($1::uuid[])`, [ids]);
    await postgres.query(`delete from afs.wall_reactions where account_id = any($1::uuid[])`, [ids]);
    await postgres.query(`delete from afs.wall_reactions where post_id in (select id from afs.wall_posts where account_id = any($1::uuid[]))`, [ids]);
    await postgres.query(`delete from afs.wall_reports where post_id in (select id from afs.wall_posts where account_id = any($1::uuid[]))`, [ids]);
    await postgres.query(`delete from afs.wall_posts where account_id = any($1::uuid[])`, [ids]);
    await postgres.query(`delete from afs.point_events where account_id = any($1::uuid[])`, [ids]);
    await postgres.query(`delete from afs.ship_days where account_id = any($1::uuid[])`, [ids]);
    await postgres.query(`delete from afs.member_stats where account_id = any($1::uuid[])`, [ids]);
    await postgres.query(`delete from afs.profiles where account_id = any($1::uuid[])`, [ids]);
    await postgres.query(`delete from core.memberships where account_id = any($1::uuid[])`, [ids]);
    await postgres.query(`delete from app_users where id = any($1::uuid[])`, [ids]);
  }
  await postgres.end();
});

/* ---------------------------------------------------------------- levels */

test("levels match the thresholds, and progress never leaves 0..1", () => {
  assert.equal(levelForPoints(0), 1);
  assert.equal(levelForPoints(99), 1);
  assert.equal(levelForPoints(100), 2);
  assert.equal(levelForPoints(1240), 3);
  assert.equal(levelForPoints(1500), 4);
  assert.equal(levelForPoints(4180), 4);
  assert.equal(levelForPoints(5000), 5);
  // APEX SAVAGE is the top level: there is nothing above it, here or in the UI
  assert.equal(levelForPoints(9_999_999), 5);

  for (const points of [0, 50, 100, 1499, 1500, 4999, 5000, 30_000, 900_000]) {
    const { progress } = levelProgress(points);
    assert.ok(progress >= 0 && progress <= 1, `progress for ${points} was ${progress}`);
  }

  // the Hub's thresholds must equal the website's LEVELS table (design 6.2)
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((level) => levelProgress(
      [0, 100, 500, 1500, 5000][level - 1]).level),
    [1, 2, 3, 4, 5],
  );
  // topped out
  assert.equal(levelProgress(1_000_000).ceiling, null);
  assert.equal(levelProgress(1_000_000).progress, 1);
});

/* ------------------------------------------------------- display identity */

test("a person is never identified by their email address", () => {
  const account_id = "0f4ad0f2-5a2b-4c3d-8e9f-1a2b3c4d5e6f";
  assert.equal(displayHandle({ handle: "devon_ships", account_id }), "devon_ships");
  assert.equal(
    displayHandle({ handle: null, display_name: "Mar Builds", account_id }),
    "mar_builds",
  );
  // no handle and no usable name: an opaque label, NOT an email local part
  const fallback = displayHandle({ handle: null, display_name: "", account_id });
  assert.match(fallback, /^member_[0-9a-f]{6}$/);
  assert.ok(!fallback.includes("@"));
});

/* ------------------------------------------------------------ the ledger */

test("an award with the same ref can never be paid twice", async () => {
  const accountId = await makeMember();

  const first = await withTransaction((client) =>
    award(client, { accountId, kind: "ship", points: 10, refId: "2026-01-01" }),
  );
  const second = await withTransaction((client) =>
    award(client, { accountId, kind: "ship", points: 10, refId: "2026-01-01" }),
  );

  assert.equal(first, true, "first award is new");
  assert.equal(second, false, "second is refused by the unique index");

  const total = await postgres.query(
    `select coalesce(sum(points),0)::int as n from afs.point_events where account_id = $1`,
    [accountId],
  );
  assert.equal(total.rows[0].n, 10);
});

test("concurrent identical awards still only pay once", async () => {
  const accountId = await makeMember();
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      withTransaction((client) =>
        award(client, { accountId, kind: "post", points: 20, refId: "race" }),
      ),
    ),
  );
  assert.equal(results.filter(Boolean).length, 1, "exactly one writer wins");

  const total = await postgres.query(
    `select coalesce(sum(points),0)::int as n from afs.point_events where account_id = $1`,
    [accountId],
  );
  assert.equal(total.rows[0].n, 20);
});

/* ------------------------------------------------------------- streaks */

test("a streak is the unbroken run, and today being unshipped does not break it", async () => {
  // shipped for 5 days ending YESTERDAY — the day is not over yet
  const accountId = await makeMember();
  await connectedLongAgo(accountId);
  await applyContributionCalendar(accountId, {
    login: null,
    githubUserId: null,
    days: calendarDays([3, 1, 2, 4, 1], 1),
  });

  const { streak, shippedToday } = await withTransaction((client) =>
    computeStreak(client, accountId),
  );
  assert.equal(streak, 5, "yesterday still counts");
  assert.equal(shippedToday, false);
});

test("a gap ends the streak", async () => {
  const accountId = await makeMember();
  await connectedLongAgo(accountId);
  // 3 days, then a 4-day gap, then 2 days ending today
  await applyContributionCalendar(accountId, {
    login: null,
    githubUserId: null,
    days: [
      ...calendarDays([1, 1, 1], 10),
      ...calendarDays([1, 1], 0),
    ],
  });

  const { streak, shippedToday } = await withTransaction((client) =>
    computeStreak(client, accountId),
  );
  assert.equal(streak, 2, "only the current run counts");
  assert.equal(shippedToday, true);
});

test("a stale streak is zero, not whatever it used to be", async () => {
  const accountId = await makeMember();
  await connectedLongAgo(accountId);
  await applyContributionCalendar(accountId, {
    login: null,
    githubUserId: null,
    days: calendarDays([5, 5, 5, 5], 30),
  });

  const { streak } = await withTransaction((client) => computeStreak(client, accountId));
  assert.equal(streak, 0, "last ship was a month ago");
});

test("best_streak is a record and never goes down", async () => {
  const accountId = await makeMember();
  await connectedLongAgo(accountId);
  await applyContributionCalendar(accountId, {
    login: null,
    githubUserId: null,
    days: calendarDays([1, 1, 1, 1, 1, 1, 1], 0),
  });
  let stats = await withTransaction((client) => recomputeStats(client, accountId));
  assert.equal(stats.streak, 7);
  assert.equal(stats.best_streak, 7);

  // the streak lapses; the record stands
  await postgres.query(`delete from afs.ship_days where account_id = $1`, [accountId]);
  stats = await withTransaction((client) => recomputeStats(client, accountId));
  assert.equal(stats.streak, 0, "current streak is gone");
  assert.equal(stats.best_streak, 7, "best streak is kept");
});

/* ----------------------------------------------------- the GitHub sync */

test("connecting with a year of history fills the heatmap but pays only from today", async () => {
  const accountId = await makeMember();
  // 30 straight days of commits ending today, connected right now
  const result = await applyContributionCalendar(accountId, {
    login: "veteran",
    githubUserId: `gh_${RUN}_veteran`,
    days: calendarDays(Array(30).fill(4), 0),
  });
  assert.equal(result.ok, true);
  assert.equal(result.daysStored, 30, "the whole history is on the heatmap");
  assert.equal(result.daysShipped, 30);
  assert.equal(result.streak, 30, "the streak is real");
  // only today's ship is paid; the day-7/14/21/28 milestones were reached before connecting
  assert.equal(
    result.pointsAwarded,
    POINTS.ship,
    "no retroactive points: 29 historical days and four past milestones pay nothing",
  );

  const total = await postgres.query(
    `select coalesce(sum(points),0)::int as n, count(*)::int as events
       from afs.point_events where account_id = $1`,
    [accountId],
  );
  assert.equal(total.rows[0].n, POINTS.ship);
  assert.equal(total.rows[0].events, 1);
});

test("a calendar pays once per shipped day and re-syncing pays nothing", async () => {
  const accountId = await makeMember();
  await connectedLongAgo(accountId);
  const days = calendarDays([2, 0, 5, 1, 0, 3], 0); // 4 shipped days

  const first = await applyContributionCalendar(accountId, {
    login: "tester",
    githubUserId: `gh_${RUN}_a`,
    days,
  });
  assert.equal(first.ok, true);
  assert.equal(first.daysStored, 6);
  assert.equal(first.daysShipped, 4);
  assert.equal(first.pointsAwarded, 4 * POINTS.ship, "4 ships, no full week yet");

  const again = await applyContributionCalendar(accountId, {
    login: "tester",
    githubUserId: `gh_${RUN}_a`,
    days,
  });
  assert.equal(again.pointsAwarded, 0, "a re-sync is free");

  const total = await postgres.query(
    `select coalesce(sum(points),0)::int as n from afs.point_events where account_id = $1`,
    [accountId],
  );
  assert.equal(total.rows[0].n, 4 * POINTS.ship);
});

test("every 7th consecutive day pays 25, once each", async () => {
  const accountId = await makeMember();
  await connectedLongAgo(accountId);
  const sevenDays = calendarDays(Array(7).fill(1), 0);

  const first = await applyContributionCalendar(accountId, {
    login: null, githubUserId: null, days: sevenDays,
  });
  assert.equal(first.streak, 7);
  assert.equal(first.pointsAwarded, 7 * POINTS.ship + POINTS.streak7, "one week paid");

  const again = await applyContributionCalendar(accountId, {
    login: null, githubUserId: null, days: sevenDays,
  });
  assert.equal(again.pointsAwarded, 0, "the same week is not paid twice");
});

test("a 21-day run pays three weekly bonuses, not one", async () => {
  const accountId = await makeMember();
  await connectedLongAgo(accountId);
  const result = await applyContributionCalendar(accountId, {
    login: null, githubUserId: null, days: calendarDays(Array(21).fill(1), 0),
  });
  assert.equal(result.streak, 21);
  assert.equal(
    result.pointsAwarded,
    21 * POINTS.ship + 3 * POINTS.streak7,
    "days 7, 14 and 21 each pay",
  );
});

test("one GitHub account cannot be claimed by two people", async () => {
  const first = await makeMember();
  const second = await makeMember();
  const githubUserId = `gh_${RUN}_shared`;

  const a = await applyContributionCalendar(first, {
    login: "shared", githubUserId, days: calendarDays([1], 0),
  });
  assert.equal(a.ok, true);

  const b = await applyContributionCalendar(second, {
    login: "shared", githubUserId, days: calendarDays([9, 9, 9], 0),
  });
  assert.equal(b.ok, false);
  assert.equal(b.reason, "github_already_linked", "cannot inherit someone else's ships");

  const stolen = await postgres.query(
    `select count(*)::int as n from afs.ship_days where account_id = $1`,
    [second],
  );
  assert.equal(stolen.rows[0].n, 0, "nothing was written for the second person");
});

test("the heatmap is keyed by ISO date, which is what the UI draws", async () => {
  const accountId = await makeMember();
  await applyContributionCalendar(accountId, {
    login: null, githubUserId: null, days: calendarDays([4, 0, 7], 0),
  });

  const calendar = await heatmapFor(accountId);
  const keys = Object.keys(calendar);
  assert.equal(keys.length, 3);
  for (const key of keys) assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(Math.max(...Object.values(calendar)), 7);
});

/* --------------------------------------------------------------- the Wall */

test("a post needs a real type, a real title and http(s) links", async () => {
  const accountId = await makeMember();

  assert.equal((await createPost(accountId, { type: "rant", title: "hello" })).reason, "invalid_type");
  assert.equal((await createPost(accountId, { type: "build", title: "no" })).reason, "title_too_short");
  assert.equal(
    (await createPost(accountId, { type: "build", title: "A real title", linkUrl: "javascript:alert(1)" })).reason,
    "linkUrl_invalid_url",
    "a javascript: url is refused",
  );
  assert.equal(
    (await createPost(accountId, { type: "build", title: "A real title", visibility: "everyone" })).reason,
    "invalid_visibility",
  );

  const ok = await createPost(accountId, {
    type: "build",
    title: "Auto-clipper that turns my podcast into shorts",
    linkUrl: "https://github.com/me/clipper",
    madeWith: ["Clipping Skill", "VPS Setup Guide"],
  });
  assert.equal(ok.ok, true);
  assert.ok(ok.postId);
});

test("only the first post of the day earns, and the sixth is refused", async () => {
  const accountId = await makeMember();

  for (let index = 0; index < POSTS_PER_DAY; index += 1) {
    const result = await createPost(accountId, { type: "content", title: `Post number ${index}` });
    assert.equal(result.ok, true, `post ${index} is accepted`);
  }

  const overLimit = await createPost(accountId, { type: "content", title: "One post too many" });
  assert.equal(overLimit.ok, false);
  assert.equal(overLimit.reason, "daily_post_limit", "the Wall cannot be flooded");

  const paid = await postgres.query(
    `select count(*)::int as n from afs.point_events where account_id = $1 and kind = 'post'`,
    [accountId],
  );
  assert.equal(paid.rows[0].n, 1, "first post each day (design 6.1)");
});

test("🔥 pays the author once per person, and unfiring does not claw it back", async () => {
  const author = await makeMember({ handle: `author_${RUN}` });
  const fan = await makeMember({ handle: `fan_${RUN}` });

  const post = await createPost(author, { type: "build", title: "Something worth firing" });
  const postId = post.postId;

  const on = await toggleFire(fan, postId);
  assert.equal(on.fired, true);
  assert.equal(on.fireCount, 1);

  const off = await toggleFire(fan, postId);
  assert.equal(off.fired, false);
  assert.equal(off.fireCount, 0, "the reaction is gone");

  const onAgain = await toggleFire(fan, postId);
  assert.equal(onAgain.fired, true);
  assert.equal(onAgain.fireCount, 1);

  const fires = await postgres.query(
    `select coalesce(sum(points),0)::int as n from afs.point_events
      where account_id = $1 and kind = 'fire'`,
    [author],
  );
  assert.equal(
    fires.rows[0].n,
    POINTS.fire,
    "toggling on and off cannot be used to pump or drain the author's score",
  );
});

test("firing your own post earns nothing", async () => {
  const accountId = await makeMember();
  const post = await createPost(accountId, { type: "content", title: "My own work here" });
  await toggleFire(accountId, post.postId);

  const fires = await postgres.query(
    `select count(*)::int as n from afs.point_events where account_id = $1 and kind = 'fire'`,
    [accountId],
  );
  assert.equal(fires.rows[0].n, 0);
});

test("the fire count is recounted from the rows, so it cannot drift", async () => {
  const author = await makeMember();
  const post = await createPost(author, { type: "build", title: "Counting test post" });
  const fans = await Promise.all([makeMember(), makeMember(), makeMember()]);

  await Promise.all(fans.map((fan) => toggleFire(fan, post.postId)));

  const row = await postgres.query(
    `select fire_count, (select count(*) from afs.wall_reactions where post_id = $1) as actual
       from afs.wall_posts where id = $1`,
    [post.postId],
  );
  assert.equal(Number(row.rows[0].fire_count), Number(row.rows[0].actual));
  assert.equal(Number(row.rows[0].fire_count), 3);
});

test("members-only posts are withheld from non-members", async () => {
  const author = await makeMember({ handle: `priv_${RUN}` });
  const post = await createPost(author, {
    type: "build",
    title: `Members only build ${RUN}`,
    visibility: "members",
  });

  const asMember = await wallFeed({ viewerAccountId: author, viewerIsMember: true, limit: 60 });
  assert.ok(
    asMember.posts.some((entry) => entry.id === post.postId),
    "a member sees it",
  );

  const asGuest = await wallFeed({ viewerAccountId: null, viewerIsMember: false, limit: 60 });
  assert.ok(
    !asGuest.posts.some((entry) => entry.id === post.postId),
    "a non-member does not",
  );
});

test("the feed never leaks an email address", async () => {
  const author = await makeMember();
  await createPost(author, { type: "content", title: `Leak check ${RUN}` });

  const feed = await wallFeed({ viewerAccountId: author, viewerIsMember: true, limit: 60 });
  const serialised = JSON.stringify(feed);
  assert.ok(!serialised.includes("@example.com"), "no email in the payload");
  assert.ok(!serialised.includes("ctest-"), "not even the local part");
});

test("an author can hide their own post and nobody else's", async () => {
  const author = await makeMember();
  const other = await makeMember();
  const post = await createPost(author, { type: "build", title: "Hide me please" });

  assert.equal((await hideOwnPost(other, post.postId)).ok, false, "not your post");
  assert.equal((await hideOwnPost(author, post.postId)).ok, true);

  const feed = await wallFeed({ viewerAccountId: author, viewerIsMember: true, limit: 60 });
  assert.ok(!feed.posts.some((entry) => entry.id === post.postId), "gone from the feed");
});

test("a report is recorded against a real post", async () => {
  const author = await makeMember();
  const reporter = await makeMember();
  const post = await createPost(author, { type: "content", title: "Reportable post here" });

  assert.equal((await reportPost(reporter, randomUUID(), "spam")).ok, false);
  assert.equal((await reportPost(reporter, post.postId, "spam")).ok, true);

  const filed = await postgres.query(
    `select reason from afs.wall_reports where post_id = $1`,
    [post.postId],
  );
  assert.equal(filed.rows[0].reason, "spam");
});

/* ------------------------------------------------------------ rankings */

test("rankings leave out anyone who turned off show_on_wall", async () => {
  const shown = await makeMember({ handle: `shown_${RUN}`, showOnWall: true });
  const hidden = await makeMember({ handle: `hidden_${RUN}`, showOnWall: false });

  for (const accountId of [shown, hidden]) {
    await applyContributionCalendar(accountId, {
      login: null, githubUserId: null, days: calendarDays(Array(5).fill(2), 0),
    });
  }
  await recomputeRanks();

  const board = await rankings({ limit: 100, withHeatmaps: false });
  const handles = board.builders.map((entry) => entry.handle);
  assert.ok(handles.includes(`shown_${RUN}`), "opted in appears");
  assert.ok(!handles.includes(`hidden_${RUN}`), "opted out does not");
});

test("ties share a rank rather than being ordered arbitrarily", async () => {
  const client = await postgres.connect();
  try {
    const board = await rankings({ limit: 100, withHeatmaps: false });
    // whatever the data, a rank must never exceed the number of rows
    for (const entry of board.builders) {
      assert.ok(entry.rank >= 1 && entry.rank <= board.builders.length);
    }
    // and positions must be non-decreasing down the list
    let previous = 0;
    for (const entry of board.builders) {
      assert.ok(entry.rank >= previous, "ranks never go backwards");
      previous = entry.rank;
    }
  } finally {
    client.release();
  }
});

test("the dashboard reports what the member actually earned", async () => {
  const accountId = await makeMember({ handle: `dash_${RUN}` });
  await connectedLongAgo(accountId);
  // a real connect: the dashboard's "connected" means the Hub holds a token
  const connected = await connectGithub(accountId, `gho_dash_${RUN}xxxxxxxxxx`, {
    fetchCalendar: async () => ({
      login: "dashuser", githubUserId: `gh_${RUN}_dash`, days: calendarDays(Array(8).fill(3), 0),
    }),
  });
  assert.equal(connected.ok, true, JSON.stringify(connected));
  await createPost(accountId, { type: "build", title: "Dashboard test build" });
  await recomputeRanks();

  const dashboard = await dashboardFor(accountId);
  // 8 shipped days, one completed week (day 7), and one first-post-of-the-day
  const expected = 8 * POINTS.ship + POINTS.streak7 + POINTS.post;

  assert.equal(dashboard.points, expected);
  assert.equal(dashboard.streak, 8);
  assert.equal(dashboard.shippedToday, true);
  assert.equal(dashboard.github.connected, true);
  assert.equal(dashboard.github.login, "dashuser");
  assert.equal(dashboard.me.handle, `dash_${RUN}`);
  assert.equal(Object.keys(dashboard.heatmap).length, 8);
  assert.ok(dashboard.level >= 1);
  assert.ok(dashboard.community.builders >= 1);
});

test("community totals count days and posts, not people twice", async () => {
  const totals = await communityTotals();
  for (const key of ["ships_month", "shipped_today", "builders", "posts"]) {
    assert.equal(typeof totals[key], "number", `${key} is a number`);
    assert.ok(totals[key] >= 0);
  }
});

/* ------------------------------------------------- the published rules */

test("the Hub's point values match the rules the website prints", () => {
  // src/lib/points.ts on the website renders these to members in the Rankings
  // tab as "the rules". If this ever fails, one of the two is lying.
  assert.deepEqual(POINTS, {
    ship: 10,
    streak7: 25,
    post: 5,
    fire: 1,
    pick: 50,
    challenge: 100,
  });
  assert.equal(FIRE_CAP_PER_POST, 20);
  assert.equal(POSTS_PER_DAY, 5);
});

test("🔥 stops paying once a post has earned its cap", async () => {
  const author = await makeMember();
  const fan = await makeMember();
  const post = await createPost(author, { type: "build", title: "Already a viral post" });

  // Fill the post to its cap with reactions from people who are not in this
  // test, which is what would have happened on a real post.
  const filler = Array.from({ length: FIRE_CAP_PER_POST }, (_, index) =>
    `${post.postId}:filler-${index}`,
  );
  await postgres.query(
    `insert into afs.point_events (account_id, kind, points, ref_id)
     select $1, 'fire', $2, ref from unnest($3::text[]) as ref`,
    [author, POINTS.fire, filler],
  );

  const before = await postgres.query(
    `select coalesce(sum(points),0)::int as n from afs.point_events
      where account_id = $1 and kind = 'fire'`,
    [author],
  );

  const result = await toggleFire(fan, post.postId);
  assert.equal(result.fired, true, "the reaction still registers");
  assert.equal(result.fireCount, 1, "and is still counted");

  const afterwards = await postgres.query(
    `select coalesce(sum(points),0)::int as n from afs.point_events
      where account_id = $1 and kind = 'fire'`,
    [author],
  );
  assert.equal(
    afterwards.rows[0].n,
    before.rows[0].n,
    "but it pays nothing past the cap, so one hit cannot own the leaderboard",
  );
});

/* ========================================================================== */
/* GitHub connect — the token the site hands over                              */
/* ========================================================================== */

/** A year-ish calendar ending today, every day shipped. */
function calendarEndingToday(days, { login, githubUserId }) {
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push({ date: d.toISOString().slice(0, 10), contributions: 3 });
  }
  return { login, githubUserId, days: out };
}

test("connect proves the token, stores it sealed, and pays from today only", async () => {
  const member = await makeMember({ handle: `gh-${RUN}` });
  const token = `gho_test_${RUN}_${randomUUID()}`;
  const calendar = calendarEndingToday(30, { login: "octo", githubUserId: `gh-${RUN}-1` });

  const result = await connectGithub(member, token, { fetchCalendar: async () => calendar });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.login, "octo");
  assert.equal(result.daysShipped, 30, "the whole history fills the heatmap");
  assert.equal(result.pointsAwarded, POINTS.ship, "but only today is paid");

  const stored = await postgres.query(
    `select github_token_enc, github_login, github_user_id from afs.profiles where account_id = $1`,
    [member],
  );
  const blob = stored.rows[0].github_token_enc;
  assert.ok(Buffer.isBuffer(blob) && blob.length > 28, "a sealed blob is stored");
  assert.equal(blob.includes(Buffer.from(token, "utf8")), false, "never the token in clear");
  assert.equal(openToken(blob), token, "and it opens back to the token");
  assert.equal(stored.rows[0].github_login, "octo");
  assert.equal(stored.rows[0].github_user_id, `gh-${RUN}-1`);

  const status = await githubStatus(member);
  assert.equal(status.connected, true);
  assert.equal(status.login, "octo");

  const lookup = await githubTokenFor(member);
  assert.deepEqual(lookup, { ok: true, token });
});

test("a token GitHub rejects is never stored; a GitHub outage is not 'invalid'", async () => {
  const member = await makeMember({ handle: `ghbad-${RUN}` });

  const rejected = await connectGithub(member, "gho_bad", {
    fetchCalendar: async () => { throw new Error("github_http_401"); },
  });
  assert.deepEqual(rejected, { ok: false, reason: "github_token_invalid" });

  const outage = await connectGithub(member, "gho_whatever_token", {
    fetchCalendar: async () => { throw new Error("github_http_502"); },
  });
  assert.deepEqual(outage, { ok: false, reason: "github_unavailable" });

  const tooShort = await connectGithub(member, "x", { fetchCalendar: async () => ({}) });
  assert.deepEqual(tooShort, { ok: false, reason: "github_token_invalid" });

  const stored = await postgres.query(
    `select github_token_enc from afs.profiles where account_id = $1`,
    [member],
  );
  assert.equal(stored.rows[0].github_token_enc, null);
  assert.equal((await githubStatus(member)).connected, false);
  assert.deepEqual(await githubTokenFor(member), { ok: false, reason: "github_not_connected" });
});

test("one GitHub account cannot be connected to two people", async () => {
  const first = await makeMember({ handle: `ghone-${RUN}` });
  const second = await makeMember({ handle: `ghtwo-${RUN}` });
  const shared = { login: "shared", githubUserId: `gh-${RUN}-shared` };

  const a = await connectGithub(first, `gho_first_${RUN}xxxxxxxx`, {
    fetchCalendar: async () => calendarEndingToday(3, shared),
  });
  assert.equal(a.ok, true);

  const b = await connectGithub(second, `gho_second_${RUN}xxxxxxx`, {
    fetchCalendar: async () => calendarEndingToday(3, shared),
  });
  assert.deepEqual(b, { ok: false, reason: "github_already_linked" });

  const stored = await postgres.query(
    `select github_token_enc, github_user_id from afs.profiles where account_id = $1`,
    [second],
  );
  assert.equal(stored.rows[0].github_token_enc, null, "the loser keeps no token");
  assert.equal(stored.rows[0].github_user_id, null);
});

test("disconnect forgets the token but keeps the history and the points", async () => {
  const member = await makeMember({ handle: `ghoff-${RUN}` });
  const connected = await connectGithub(member, `gho_off_${RUN}xxxxxxxxxx`, {
    fetchCalendar: async () => calendarEndingToday(10, { login: "leaver", githubUserId: `gh-${RUN}-off` }),
  });
  assert.equal(connected.ok, true);

  const gone = await disconnectGithub(member);
  assert.deepEqual(gone, { ok: true, wasConnected: true });

  assert.equal((await githubStatus(member)).connected, false);
  assert.deepEqual(await githubTokenFor(member), { ok: false, reason: "github_not_connected" });

  const kept = await postgres.query(
    `select
       (select count(*)::int from afs.ship_days where account_id = $1) as days,
       (select coalesce(sum(points),0)::int from afs.point_events where account_id = $1) as points,
       (select github_connected_at is not null from afs.profiles where account_id = $1) as dated`,
    [member],
  );
  assert.equal(kept.rows[0].days, 10, "heatmap history stays");
  assert.equal(kept.rows[0].points, POINTS.ship, "points are never clawed back");
  assert.equal(kept.rows[0].dated, true, "the original connect date stays");

  // and the freed GitHub account can be connected by someone else now
  const other = await makeMember({ handle: `ghnext-${RUN}` });
  const reused = await connectGithub(other, `gho_next_${RUN}xxxxxxxxx`, {
    fetchCalendar: async () => calendarEndingToday(2, { login: "leaver", githubUserId: `gh-${RUN}-off` }),
  });
  assert.equal(reused.ok, true);
});

test("without the sealing key, connect refuses and writes nothing", async () => {
  const member = await makeMember({ handle: `ghkey-${RUN}` });
  const saved = process.env.AFS_GITHUB_TOKEN_KEY;
  delete process.env.AFS_GITHUB_TOKEN_KEY;
  try {
    const result = await connectGithub(member, `gho_nokey_${RUN}xxxxxxxx`, {
      fetchCalendar: async () => calendarEndingToday(2, { login: "nokey", githubUserId: `gh-${RUN}-nokey` }),
    });
    assert.deepEqual(result, { ok: false, reason: "github_not_configured" });
    assert.deepEqual(await githubTokenFor(member), { ok: false, reason: "github_not_configured" });
  } finally {
    process.env.AFS_GITHUB_TOKEN_KEY = saved;
  }
  const stored = await postgres.query(
    `select github_token_enc, github_user_id from afs.profiles where account_id = $1`,
    [member],
  );
  assert.equal(stored.rows[0].github_token_enc, null);
  assert.equal(stored.rows[0].github_user_id, null);
});
