/**
 * Points: what each post, posting streak and follower milestone earns on
 * Instagram, TikTok, Facebook and Threads, paid into the points ledger. The worker
 * scores a workspace after every analytics refresh; the rescore script scores
 * everyone at once. The rates, milestones and levels live in
 * @posterract/contract, so the Points tab explains exactly what this pays.
 *
 * Every post on a connected account earns, whichever app or tool made it,
 * from the day the account was first connected: posts made through
 * Posterract as projections, the rest from what the worker reads of them
 * (platform_posts). Streak days count the same posts. Follower growth is
 * measured from what each account had on launch day (POINTS_START_AT), or
 * when it was connected if that came later.
 *
 * Paying is idempotent and never takes anything back. A post keeps what each
 * of its rules has earned in post_points and a rule only ever pays the rise
 * over that; streak and follower milestones each have their own ledger
 * reference; and a workspace is scored under an advisory lock, so two account
 * refreshes landing together cannot both pay the same rise.
 *
 * What a creator hears about lands in their notifications (events): one
 * running "earned today" line per day, and a line for each level, record,
 * breakout, streak and follower milestone as it happens.
 */

import {
  BADGES,
  POINTS_FOLLOWER_MILESTONES,
  POINTS_PERSONAL_BEST,
  POINTS_PLATFORMS,
  POINTS_POST_LIVE,
  POINTS_RATES,
  POINTS_RETENTION,
  POINTS_SOURCE_LABELS,
  POINTS_START_AT,
  POINTS_STREAK_MILESTONES,
  RANK_TIERS,
  levelFor,
  levelProgress,
  nextRank,
  rankFor,
} from "@posterract/contract";

const PROVIDER_LABELS = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", threads: "Threads" };
const DAY_MS = 86_400_000;
// Achievements older than this were caught up on, not just earned, so they
// are paid without a notification: a first sync, a backfill, a late record.
const FRESH_MS = 2 * DAY_MS;
const FRESH_POST_MS = 14 * DAY_MS;

const round2 = (value) => Math.round(value * 100) / 100;
const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const optionalNumber = (value) => {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function isPointsPlatform(provider) {
  return POINTS_PLATFORMS.includes(provider);
}

/** Whether a post earns: it is on a points platform and people can see it (not a TikTok Only me post). */
export function earnsPoints(provider, platformOptions) {
  return isPointsPlatform(provider) && !(provider === "tiktok" && platformOptions?.privacyLevel === "SELF_ONLY");
}

// The same rule in SQL, for queries over projections aliased `p`.
const VISIBLE_POST = "not (p.provider = 'tiktok' and coalesce(p.platform_options->>'privacyLevel', '') = 'SELF_ONLY')";

// When the account (aliased `a`) was first connected: its posts earn from then.
const CONNECTED_AT = "coalesce(a.connected_at, a.created_at)";

// The video ID in a Facebook post's link (/reel/123/, /videos/123/, ?v=123):
// what a Facebook projection keeps as its post ID. For platform_posts aliased `pp`.
const FACEBOOK_VIDEO_ID = `coalesce(
  substring(pp.permalink from '/reels?/([0-9]+)'),
  substring(pp.permalink from '/videos/([0-9]+)'),
  substring(pp.permalink from '[?&]v=([0-9]+)'))`;

/** A post made in another app goes by `provider:postId` wherever a projection would go by its ID. */
const elsewhereKey = (provider, platformPostId) => `${provider}:${platformPostId}`;

/** A post made elsewhere is titled by its caption's first line, or by its platform. */
function captionTitle(caption, provider) {
  const line = (caption ?? "")
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return `${PROVIDER_LABELS[provider] ?? provider} post`;
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

// The listed copy of a paid post made elsewhere (aliased `pp`, from
// platform_post_points), as `post`: the one with the newest numbers. A post
// since deleted from its platform keeps its points with no copy left.
const LISTED_POST = `left join lateral (
  select listed.* from platform_posts listed
  where listed.workspace_id = pp.workspace_id and listed.provider = pp.provider
    and listed.platform_post_id = pp.platform_post_id
  order by listed.metrics_fetched_at desc nulls last
  limit 1
) post on true`;

// ---------------------------------------------------------------------------
// What a post is worth
// ---------------------------------------------------------------------------

/**
 * A post's metrics from its latest analytics snapshot, in one shape for every
 * platform: Facebook's reactions stand in for likes, and on Threads replies
 * are its comments and reposts, quotes and shares its shares (the connector
 * already folds them into `shares`).
 */
export function postMetrics(row) {
  const raw = row.raw_metrics && typeof row.raw_metrics === "object" ? row.raw_metrics : {};
  const views = number(row.views);
  const averageWatchSeconds =
    optionalNumber(row.average_view_duration_seconds) ?? optionalNumber(raw.averageWatchSeconds);
  const watchTimeSeconds = optionalNumber(row.watch_time_seconds) ?? optionalNumber(raw.watchTimeSeconds);
  return {
    views,
    likes: row.provider === "facebook" ? optionalNumber(raw.reactions) ?? number(row.likes) : number(row.likes),
    comments: number(row.comments),
    shares: number(row.shares),
    saves: number(raw.saves),
    // Total watch time where the platform reports it; otherwise what the
    // average says it comes to, which is the same figure from the other side.
    watchSeconds:
      watchTimeSeconds ?? (averageWatchSeconds !== undefined ? averageWatchSeconds * views : undefined),
    averageWatchSeconds,
  };
}

/**
 * What each rule of a post is worth now, as `{ source: { points, value } }`.
 * `durationSeconds` is the video's length, `ageHours` how long the post has
 * been live, and `bests` whether it is a record or a breakout for its account.
 */
export function postTargets({ provider, metrics, durationSeconds, ageHours, bests = {} }) {
  const rates = POINTS_RATES[provider];
  if (!rates) return {};
  const targets = {
    post: { points: POINTS_POST_LIVE },
  };
  if (!metrics) return targets;

  targets.views = { points: round2(metrics.views / rates.views), value: metrics.views };
  targets.likes = { points: round2(metrics.likes / rates.likes), value: metrics.likes };
  targets.comments = { points: round2(metrics.comments / rates.comments), value: metrics.comments };
  targets.shares = { points: round2(metrics.shares / rates.shares), value: metrics.shares };
  if (rates.saves) {
    targets.saves = { points: round2(metrics.saves / rates.saves), value: metrics.saves };
  }
  if (rates.watchHours && metrics.watchSeconds !== undefined) {
    const hours = metrics.watchSeconds / 3600;
    targets.watch = { points: round2(hours / rates.watchHours), value: round2(hours) };
  }

  // Judged from day 3 on, for posts enough people saw for the average to mean
  // something; the best tier reached is what stays (see payPostRule).
  if (
    rates.watchHours &&
    metrics.views >= POINTS_RETENTION.minViews &&
    ageHours >= POINTS_RETENTION.minAgeHours &&
    durationSeconds > 0 &&
    metrics.averageWatchSeconds !== undefined
  ) {
    const share = metrics.averageWatchSeconds / durationSeconds;
    let points = 0;
    for (const tier of POINTS_RETENTION.tiers) if (share >= tier.share) points = tier.points;
    if (points > 0) targets.retention = { points, value: round2(share * 100) };
  }

  if (bests.record) targets.record = { points: POINTS_PERSONAL_BEST.record, value: metrics.views };
  if (bests.breakout) targets.breakout = { points: POINTS_PERSONAL_BEST.breakout, value: metrics.views };
  return targets;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Which posts are personal bests for their own account. A post needs 1,000+
 * views and at least five earlier posts on the account: beating every earlier
 * post's views is a record; 3× the account's usual views (the median of the
 * 30 days before it, or of its last five posts when it posted less than that)
 * is a breakout. `posts` are `{ id, accountId, publishedAt, views }`.
 */
export function personalBests(posts) {
  const flags = new Map();
  const byAccount = new Map();
  for (const post of posts) {
    if (!post.accountId || post.views === undefined) continue;
    const list = byAccount.get(post.accountId) ?? [];
    list.push(post);
    byAccount.set(post.accountId, list);
  }
  for (const list of byAccount.values()) {
    list.sort((left, right) => left.publishedAt - right.publishedAt);
    for (let index = 0; index < list.length; index += 1) {
      const post = list[index];
      const earlier = list.slice(0, index);
      if (post.views < POINTS_PERSONAL_BEST.minViews || earlier.length < POINTS_PERSONAL_BEST.minEarlierPosts) continue;
      const record = post.views > Math.max(...earlier.map((item) => item.views));
      const windowStart = post.publishedAt - POINTS_PERSONAL_BEST.breakoutWindowDays * DAY_MS;
      let usual = earlier.filter((item) => item.publishedAt >= windowStart);
      if (usual.length < POINTS_PERSONAL_BEST.minEarlierPosts) {
        usual = earlier.slice(-POINTS_PERSONAL_BEST.minEarlierPosts);
      }
      const typical = median(usual.map((item) => item.views));
      const breakout = typical > 0 && post.views >= POINTS_PERSONAL_BEST.breakoutMultiple * typical;
      if (record || breakout) flags.set(post.id, { record, breakout });
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Streaks and follower milestones
// ---------------------------------------------------------------------------

const dayNumber = (day) => {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / DAY_MS;
};

/** The day `timestamp` falls on in `timeZone`, as `YYYY-MM-DD`. */
export function localDay(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Runs of consecutive posting days, from distinct `YYYY-MM-DD` days in any order. */
export function streakRuns(days) {
  const sorted = [...new Set(days)].sort();
  const runs = [];
  for (const day of sorted) {
    const current = runs.at(-1);
    if (current && dayNumber(day) - dayNumber(current.end) === 1) {
      current.end = day;
      current.length += 1;
    } else {
      runs.push({ start: day, end: day, length: 1 });
    }
  }
  return runs;
}

/**
 * The streak still going on `today`: a run ending today, or yesterday while
 * today's post can still come. The best run is the longest there has been.
 */
export function streakState(runs, today) {
  const last = runs.at(-1);
  const alive = last && dayNumber(today) - dayNumber(last.end) <= 1;
  const current = alive ? last.length : 0;
  const best = runs.reduce((longest, run) => Math.max(longest, run.length), 0);
  const next = POINTS_STREAK_MILESTONES.find((milestone) => milestone.days > current);
  return { current, best, next: next ? { days: next.days, points: next.points } : undefined };
}

/** The follower milestones crossed since the account was connected. */
export function followerMilestonesCrossed(baseline, followers) {
  return POINTS_FOLLOWER_MILESTONES.filter(
    (milestone) => baseline < milestone.followers && followers >= milestone.followers,
  );
}

// ---------------------------------------------------------------------------
// Scoring a workspace
// ---------------------------------------------------------------------------

async function loadScoredPosts(database, workspaceId) {
  const result = await database.query(
    `select p.id, p.transmission_id, p.provider, p.social_account_id,
            coalesce(p.published_at, p.created_at) as published_at,
            ${CONNECTED_AT} as connected_at,
            t.title, m.duration_ms,
            s.views, s.likes, s.comments, s.shares, s.watch_time_seconds,
            s.average_view_duration_seconds, s.raw_metrics, s.fetched_at
     from projections p
     join transmissions t on t.id = p.transmission_id
     left join social_accounts a on a.id = p.social_account_id
     left join media_assets m on m.id = t.media_asset_id
     left join lateral (
       select * from publication_metric_snapshots s
       where s.projection_id = p.id
       order by s.fetched_at desc, s.id desc
       limit 1
     ) s on true
     where p.workspace_id = $1 and p.status = 'live' and p.provider = any($2::text[]) and ${VISIBLE_POST}`,
    [workspaceId, POINTS_PLATFORMS],
  );
  return result.rows;
}

/**
 * Posts made in other apps, as the worker's hourly read of each account lists
 * them: one row a post (the copy with the newest numbers, when two of the
 * workspace's accounts list it), published since its account was connected.
 * `$1` is the workspace, `$2` the points platforms, `$3` now; `scope` narrows
 * the list further.
 *
 * Posts Posterract made are left to their projections: matched by the
 * platform's post ID, or on Facebook by the video ID in the post's link. A
 * public TikTok that Posterract posted can be listed before TikTok has given
 * its projection the public ID, so TikToks within a day of such a post wait
 * for it (for at most the week TikTok is asked). `sinceConnected: false` keeps
 * the posts from before the account was connected too, which earn nothing
 * but still count on the Analytics page.
 */
function postsMadeElsewhereQuery(scope = "", { sinceConnected = true } = {}) {
  return `
    with accounts as (
      select a.id, ${CONNECTED_AT} as connected_at
      from social_accounts a
      where a.workspace_id = $1 and a.provider = any($2::text[])
    ), listed as (
      select distinct on (pp.provider, pp.platform_post_id)
             pp.*, accounts.connected_at,
             case when pp.provider = 'facebook' then ${FACEBOOK_VIDEO_ID} end as video_id
      from platform_posts pp
      join accounts on accounts.id = pp.social_account_id
      where pp.workspace_id = $1 ${scope}
      order by pp.provider, pp.platform_post_id, pp.metrics_fetched_at desc nulls last, pp.first_seen_at desc
    )
    select listed.* from listed
    where ${sinceConnected ? "listed.published_at >= listed.connected_at" : "true"}
      and not exists (
        select 1 from projections p
        where p.workspace_id = $1 and p.provider = listed.provider and p.status = 'live' and ${VISIBLE_POST}
          and p.platform_post_id in (listed.platform_post_id, listed.video_id)
      )
      and not (listed.provider = 'tiktok' and exists (
        select 1 from projections p
        where p.workspace_id = $1 and p.provider = 'tiktok' and p.status = 'live' and ${VISIBLE_POST}
          and p.social_account_id = listed.social_account_id
          and coalesce(p.platform_post_id, '') !~ '^[0-9]+$'
          and coalesce(p.published_at, p.created_at) > $3::timestamptz - interval '7 days'
          and abs(extract(epoch from coalesce(p.published_at, p.created_at) - listed.published_at)) < 86400
      ))`;
}

async function loadPostsMadeElsewhere(database, workspaceId, now) {
  const result = await database.query(postsMadeElsewhereQuery(), [workspaceId, POINTS_PLATFORMS, new Date(now)]);
  return result.rows;
}

/**
 * The posts on one account made elsewhere that the worker asks the platform
 * for numbers on: every post the hourly read lists (120 days back), from
 * before the account was connected too, so the Analytics page counts them.
 * Only the ones since the connection earn points.
 */
export async function loadAccountPostsMadeElsewhere(database, { workspaceId, accountId }, now = Date.now()) {
  const result = await database.query(
    postsMadeElsewhereQuery("and pp.social_account_id = $4 and pp.published_at >= $3::timestamptz - interval '120 days'", { sinceConnected: false }),
    [workspaceId, POINTS_PLATFORMS, new Date(now), accountId],
  );
  return result.rows.map((row) => ({
    platformPostId: row.platform_post_id,
    permalink: row.permalink ?? undefined,
    videoId: row.video_id ?? undefined,
    publishedAt: new Date(row.published_at).getTime(),
    metricsFetchedAt: row.metrics_fetched_at ? new Date(row.metrics_fetched_at).getTime() : undefined,
  }));
}

/**
 * The local days a workspace posted something that earns. Only live posts
 * count, and a Posterract video counts once: posting the same file again, on
 * any platform or any day, keeps nobody's streak alive.
 */
async function loadPostingDays(database, workspaceId, timeZone, now = Date.now()) {
  const result = await database.query(
    `with live as (
       select p.transmission_id, t.media_asset_id,
              min(coalesce(p.published_at, p.created_at)) as published_at
       from projections p
       join transmissions t on t.id = p.transmission_id
       left join social_accounts a on a.id = p.social_account_id
       where p.workspace_id = $1 and p.status = 'live' and p.provider = any($2::text[]) and ${VISIBLE_POST}
         and coalesce(p.published_at, p.created_at) >= coalesce(${CONNECTED_AT}, '-infinity'::timestamptz)
       group by p.transmission_id, t.media_asset_id
     ), firsts as (
       select published_at,
              row_number() over (
                partition by coalesce(media_asset_id::text, transmission_id::text)
                order by published_at
              ) as use
       from live
     )
     select published_at from firsts where use = 1
     union all
     select published_at from (${postsMadeElsewhereQuery()}) elsewhere`,
    [workspaceId, POINTS_PLATFORMS, new Date(now)],
  );
  return result.rows.map((row) => localDay(new Date(row.published_at).getTime(), timeZone));
}

async function loadTimeZone(database, workspaceId) {
  const result = await database.query("select time_zone from workspaces where id = $1", [workspaceId]);
  return result.rows[0]?.time_zone || "UTC";
}

function noteFor(source, provider, title) {
  const parts = [POINTS_SOURCE_LABELS[source] ?? source, PROVIDER_LABELS[provider] ?? provider];
  if (title) parts.push(title.length > 80 ? `${title.slice(0, 79)}…` : title);
  return parts.join(" · ");
}

const formatAmount = (value) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const shortTitle = (title) => {
  const text = (title || "Untitled post").trim();
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
};

async function ledgerTotal(client, workspaceId) {
  const result = await client.query(
    "select coalesce(sum(amount), 0) as total from points_ledger where workspace_id = $1",
    [workspaceId],
  );
  return round2(Number(result.rows[0]?.total ?? 0));
}

async function addEvent(client, { workspaceId, type, message, projectionId, transmissionId, payload = {} }) {
  await client.query(
    `insert into events (workspace_id, transmission_id, projection_id, type, message, payload)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [workspaceId, transmissionId ?? null, projectionId ?? null, type, message, JSON.stringify(payload)],
  );
}

/** A notification when points carry the workspace into a new level, and tier. */
async function notifyLevel(client, workspaceId, before, after) {
  const level = levelFor(after);
  if (level <= levelFor(before)) return;
  const rank = rankFor(after);
  const newTier = rank.tier !== rankFor(before).tier;
  await addEvent(client, {
    workspaceId,
    type: "points.level",
    message: newTier
      ? `You made ${RANK_TIERS[rank.tierIndex].label}! You're now ${rank.label}, level ${level}.`
      : `You're now ${rank.label}, level ${level}.`,
    payload: { level, rank: rank.id },
  });
}

/**
 * The day's running total, kept as one notification per day (in the
 * workspace's time zone) that each scoring pass brings up to date.
 */
async function notifyToday(client, workspaceId, timeZone, now) {
  const day = localDay(now, timeZone);
  const result = await client.query(
    `select coalesce(sum(amount), 0) as amount from points_ledger
     where workspace_id = $1 and awarded_at >= (($2::date)::timestamp at time zone $3)`,
    [workspaceId, day, timeZone],
  );
  const amount = round2(Number(result.rows[0]?.amount ?? 0));
  if (amount <= 0) return;
  const message = `You've earned +${formatAmount(amount)} points today.`;
  const payload = JSON.stringify({ day, amount });
  const updated = await client.query(
    `update events set message = $3, payload = $4::jsonb, occurred_at = now()
     where id = (
       select id from events
       where workspace_id = $1 and type = 'points.earned' and payload->>'day' = $2
       order by id desc limit 1
     )
     returning id`,
    [workspaceId, day, message, payload],
  );
  if (!updated.rows.length) {
    await addEvent(client, { workspaceId, type: "points.earned", message, payload: { day, amount } });
  }
}

/**
 * Pays one post rule up to `target`, if that is more than it has had. Returns
 * the amount paid (0 when there was nothing to pay). `post` is a projection
 * (`projectionId`) or a post made elsewhere (`platformPostId`).
 */
async function payPostRule(client, { post, workspaceId, source, target, value, current, awardedAt, dryRun }) {
  if (target <= current + 0.004) return 0;
  const amount = round2(target - current);
  if (dryRun) return amount;
  const reference = post.projectionId
    ? `projection:${post.projectionId}:${source}:${target.toFixed(2)}`
    : `platform:${workspaceId}:${post.provider}:${post.platformPostId}:${source}:${target.toFixed(2)}`;
  await client.query(
    `insert into points_ledger
       (workspace_id, source, amount, reference_id, note, awarded_at,
        projection_id, platform_post_id, social_account_id, provider)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (reference_id, source) do nothing`,
    [
      workspaceId,
      source,
      amount,
      reference,
      noteFor(source, post.provider, post.title),
      awardedAt,
      post.projectionId ?? null,
      post.projectionId ? null : post.platformPostId,
      post.socialAccountId ?? null,
      post.provider,
    ],
  );
  if (post.projectionId) {
    await client.query(
      `insert into post_points
         (projection_id, source, workspace_id, social_account_id, provider, points, metric_value, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (projection_id, source) do update
         set points = greatest(post_points.points, excluded.points),
             metric_value = excluded.metric_value,
             updated_at = now()`,
      [post.projectionId, source, workspaceId, post.socialAccountId ?? null, post.provider, target, value ?? null],
    );
  } else {
    await client.query(
      `insert into platform_post_points
         (workspace_id, provider, platform_post_id, source, social_account_id, points, metric_value, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (workspace_id, provider, platform_post_id, source) do update
         set points = greatest(platform_post_points.points, excluded.points),
             metric_value = excluded.metric_value,
             social_account_id = coalesce(excluded.social_account_id, platform_post_points.social_account_id),
             updated_at = now()`,
      [workspaceId, post.provider, post.platformPostId, source, post.socialAccountId ?? null, target, value ?? null],
    );
  }
  return amount;
}

async function payMilestone(client, { workspaceId, source, amount, reference, note, awardedAt, accountId, provider, dryRun }) {
  if (dryRun) {
    const exists = await client.query(
      "select 1 from points_ledger where reference_id = $1 and source = $2",
      [reference, source],
    );
    return exists.rows.length ? 0 : amount;
  }
  const inserted = await client.query(
    `insert into points_ledger
       (workspace_id, source, amount, reference_id, note, awarded_at, social_account_id, provider)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (reference_id, source) do nothing
     returning id`,
    [workspaceId, source, amount, reference, note, awardedAt, accountId ?? null, provider ?? null],
  );
  return inserted.rows.length ? amount : 0;
}

/**
 * Scores everything a workspace has earned so far and pays what it has not
 * been paid. With `dryRun` nothing is written and the report says what would
 * be. Returns `{ paid, bySource }`.
 */
export async function scoreWorkspacePoints(postgres, workspaceId, options = {}) {
  const client = await postgres.connect();
  try {
    await client.query("begin");
    const report = await scoreWorkspace(client, workspaceId, options);
    await client.query(options.dryRun ? "rollback" : "commit");
    return report;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The scoring itself, inside a transaction the caller holds: the worker's
 * through scoreWorkspacePoints, or the rescore script's, which clears a
 * workspace first to see what a clean relaunch would pay.
 *
 * `backfill` dates what posts earn at their publish time instead of when the
 * metrics were read, so a relaunch spreads old posts' points over the weeks
 * they were posted in. `notify` (on unless dry-running) writes notifications.
 */
export async function scoreWorkspace(
  client,
  workspaceId,
  { dryRun = false, now = Date.now(), backfill = false, notify = !dryRun } = {},
) {
  const bySource = {};
  const tally = (source, amount) => {
    if (amount > 0) bySource[source] = round2((bySource[source] ?? 0) + amount);
  };
  const news = [];
  const announce = notify && !dryRun;
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`points:${workspaceId}`]);

  const before = announce ? await ledgerTotal(client, workspaceId) : 0;
  const timeZone = await loadTimeZone(client, workspaceId);
  const time = (value) => new Date(value).getTime();
  // Every post in one shape: Posterract's own (projections), then the ones
  // made in other apps.
  const posts = [
    ...(await loadScoredPosts(client, workspaceId)).map((row) => ({
      key: row.id,
      projectionId: row.id,
      transmissionId: row.transmission_id,
      provider: row.provider,
      socialAccountId: row.social_account_id,
      title: row.title,
      publishedAt: time(row.published_at),
      connectedAt: row.connected_at ? time(row.connected_at) : -Infinity,
      durationSeconds: number(row.duration_ms) / 1000,
      fetchedAt: row.fetched_at ? time(row.fetched_at) : undefined,
      metrics: row.fetched_at ? postMetrics(row) : undefined,
    })),
    ...(await loadPostsMadeElsewhere(client, workspaceId, now)).map((row) => ({
      key: elsewhereKey(row.provider, row.platform_post_id),
      platformPostId: row.platform_post_id,
      provider: row.provider,
      socialAccountId: row.social_account_id,
      title: captionTitle(row.caption, row.provider),
      publishedAt: time(row.published_at),
      connectedAt: time(row.connected_at),
      durationSeconds: number(row.duration_seconds),
      fetchedAt: row.metrics_fetched_at ? time(row.metrics_fetched_at) : undefined,
      metrics: row.metrics_fetched_at ? postMetrics(row) : undefined,
    })),
  ];
  const paidRows = await client.query(
    `select projection_id::text as key, source, points from post_points where workspace_id = $1
     union all
     select provider || ':' || platform_post_id, source, points from platform_post_points where workspace_id = $1`,
    [workspaceId],
  );
  const paid = new Map(paidRows.rows.map((row) => [`${row.key}:${row.source}`, Number(row.points)]));
  // Posts whose numbers have earned something already.
  const counted = new Set(paidRows.rows.filter((row) => row.source !== "post").map((row) => row.key));

  const bests = personalBests(
    posts
      .filter((post) => post.metrics)
      .map((post) => ({
        id: post.key,
        accountId: post.socialAccountId,
        publishedAt: post.publishedAt,
        views: post.metrics.views,
      })),
  );

  for (const post of posts) {
    const { publishedAt } = post;
    // Posts from before the account was connected still set the bar for
    // records and breakouts, but earn nothing.
    if (publishedAt < post.connectedAt) continue;
    const targets = postTargets({
      provider: post.provider,
      metrics: post.metrics,
      durationSeconds: post.durationSeconds,
      ageHours: (now - publishedAt) / 3_600_000,
      bests: bests.get(post.key),
    });
    // Numbers read for the first time days after the post went live (a post
    // caught up on, like one made elsewhere before its points counted) are
    // dated when it went live, so they land in the weeks they were earned in.
    const caughtUp = !counted.has(post.key) && now - publishedAt > FRESH_MS;
    for (const [source, { points, value }] of Object.entries(targets)) {
      const amount = await payPostRule(client, {
        post,
        workspaceId,
        source,
        target: points,
        value,
        current: paid.get(`${post.key}:${source}`) ?? 0,
        // When the points were earned: the post going live, or the moment its
        // metrics were read. A backfill dates them all at the post, so old
        // posts land in the past, not all in this week.
        awardedAt:
          source === "post" || !post.metrics || backfill || caughtUp
            ? new Date(publishedAt)
            : new Date(post.fetchedAt),
        dryRun,
      });
      tally(source, amount);
      if (amount > 0 && (source === "record" || source === "breakout") && now - publishedAt <= FRESH_POST_MS) {
        const where = `${PROVIDER_LABELS[post.provider]}: “${shortTitle(post.title)}”`;
        news.push({
          type: `points.${source}`,
          projectionId: post.projectionId,
          transmissionId: post.transmissionId,
          message:
            source === "record"
              ? `New views record on ${where} (+${formatAmount(amount)} points).`
              : `Breakout on ${where} got ${POINTS_PERSONAL_BEST.breakoutMultiple}× your usual views (+${formatAmount(amount)} points).`,
        });
      }
    }
  }

  // Streak milestones: each once per run of consecutive posting days.
  const runs = streakRuns(await loadPostingDays(client, workspaceId, timeZone, now));
  for (const run of runs) {
    for (const milestone of POINTS_STREAK_MILESTONES) {
      if (run.length < milestone.days) continue;
      const reachedOn = new Date((dayNumber(run.start) + milestone.days - 1) * DAY_MS);
      const amount = await payMilestone(client, {
        workspaceId,
        source: "streak",
        amount: milestone.points,
        reference: `streak:${run.start}:${milestone.days}`,
        note: `${milestone.days}-day streak`,
        awardedAt: reachedOn,
        dryRun,
      });
      tally("streak", amount);
      if (amount > 0 && now - reachedOn.getTime() <= FRESH_MS) {
        news.push({
          type: "points.streak",
          message: `${milestone.days}-day posting streak (+${formatAmount(amount)} points).`,
        });
      }
    }
  }

  // Follower milestones: growth since launch day, or since the account was
  // connected if that came later.
  const accounts = await client.query(
    `select a.id, a.provider, a.handle, b.followers as baseline,
            (select s.audience from account_metric_snapshots s
             where s.social_account_id = a.id and s.audience is not null
             order by s.fetched_at desc, s.id desc limit 1) as followers,
            (select s.audience from account_metric_snapshots s
             where s.social_account_id = a.id and s.audience is not null and s.fetched_at <= $3
             order by s.fetched_at desc, s.id desc limit 1) as launch_followers,
            (select s.audience from account_metric_snapshots s
             where s.social_account_id = a.id and s.audience is not null
             order by s.fetched_at asc, s.id asc limit 1) as first_followers
     from social_accounts a
     left join follower_baselines b on b.social_account_id = a.id
     where a.workspace_id = $1 and a.provider = any($2::text[])`,
    [workspaceId, POINTS_PLATFORMS, new Date(POINTS_START_AT)],
  );
  for (const account of accounts.rows) {
    if (account.followers === null || account.followers === undefined) continue;
    let baseline = optionalNumber(account.baseline);
    if (baseline === undefined) {
      baseline = number(account.launch_followers ?? account.first_followers ?? account.followers);
      if (!dryRun) {
        await client.query(
          `insert into follower_baselines (social_account_id, workspace_id, followers)
           values ($1, $2, $3) on conflict (social_account_id) do nothing`,
          [account.id, workspaceId, baseline],
        );
      }
    }
    for (const milestone of followerMilestonesCrossed(baseline, number(account.followers))) {
      const reached = await client.query(
        `select min(fetched_at) as at from account_metric_snapshots
         where social_account_id = $1 and audience >= $2`,
        [account.id, milestone.followers],
      );
      const reachedAt = new Date(
        Math.max(POINTS_START_AT, reached.rows[0]?.at ? new Date(reached.rows[0].at).getTime() : now),
      );
      const amount = await payMilestone(client, {
        workspaceId,
        source: "followers",
        amount: milestone.points,
        reference: `followers:${account.id}:${milestone.followers}`,
        note: `${milestone.followers.toLocaleString("en-US")} followers · ${PROVIDER_LABELS[account.provider]} ${account.handle}`,
        awardedAt: reachedAt,
        accountId: account.id,
        provider: account.provider,
        dryRun,
      });
      tally("followers", amount);
      if (amount > 0 && now - reachedAt.getTime() <= FRESH_MS) {
        news.push({
          type: "points.followers",
          message: `${account.handle} passed ${milestone.followers.toLocaleString("en-US")} followers on ${PROVIDER_LABELS[account.provider]} (+${formatAmount(amount)} points).`,
        });
      }
    }
  }

  const total = round2(Object.values(bySource).reduce((sum, amount) => sum + amount, 0));
  if (announce && total > 0) {
    await notifyToday(client, workspaceId, timeZone, now);
    for (const item of news) await addEvent(client, { workspaceId, ...item });
    await notifyLevel(client, workspaceId, before, round2(before + total));
  }
  return { paid: total, bySource };
}

/**
 * The point for a post going live, paid the moment the platform confirms it
 * rather than at the next analytics refresh. Instagram, TikTok, Facebook and
 * Threads only (not TikTok Only me posts); the other platforms earn nothing yet.
 */
export async function awardPostLive(postgres, { projectionId, workspaceId, provider, socialAccountId, title, platformOptions }) {
  if (!earnsPoints(provider, platformOptions)) return 0;
  const client = await postgres.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`points:${workspaceId}`]);
    const current = await client.query(
      "select points from post_points where projection_id = $1 and source = 'post'",
      [projectionId],
    );
    const before = await ledgerTotal(client, workspaceId);
    const amount = await payPostRule(client, {
      post: { projectionId, provider, socialAccountId, title },
      workspaceId,
      source: "post",
      target: POINTS_POST_LIVE,
      current: Number(current.rows[0]?.points ?? 0),
      awardedAt: new Date(),
    });
    if (amount > 0) await notifyLevel(client, workspaceId, before, round2(before + amount));
    await client.query("commit");
    return amount;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Reading points
// ---------------------------------------------------------------------------

function entryFromRow(row) {
  return {
    id: String(row.id),
    source: row.source,
    amount: Number(row.amount),
    note: row.note ?? undefined,
    // The post that earned it: a projection, or a post made elsewhere by its key.
    projectionId:
      row.projection_id ?? (row.platform_post_id ? elsewhereKey(row.provider, row.platform_post_id) : undefined),
    provider: row.provider ?? undefined,
    at: new Date(row.awarded_at).getTime(),
  };
}

/**
 * A post's latest numbers for its stat card, from its newest analytics
 * snapshot: saves only where the platform reports them, retention as the
 * share of the video watched on average.
 */
function metricsFromSnapshot(row) {
  const metrics = postMetrics(row);
  // The video's length: Posterract's own file, or what the platform says (Facebook).
  const durationSeconds =
    optionalNumber(row.duration_ms) !== undefined
      ? Number(row.duration_ms) / 1000
      : optionalNumber(row.duration_seconds);
  const retention =
    metrics.averageWatchSeconds !== undefined && durationSeconds
      ? Math.min(1, metrics.averageWatchSeconds / durationSeconds)
      : undefined;
  return {
    views: metrics.views,
    likes: metrics.likes,
    comments: metrics.comments,
    shares: metrics.shares,
    saves: POINTS_RATES[row.provider]?.saves ? metrics.saves : undefined,
    watchHours: metrics.watchSeconds === undefined ? undefined : round2(metrics.watchSeconds / 3600),
    averageWatchSeconds: metrics.averageWatchSeconds,
    retention: retention === undefined ? undefined : Math.round(retention * 1000) / 1000,
  };
}

async function loadTotals(database, workspaceId) {
  const result = await database.query(
    `select coalesce(sum(amount), 0) as total,
            coalesce(sum(amount) filter (where awarded_at >= date_trunc('week', now())), 0) as week,
            coalesce(sum(amount) filter (where awarded_at >= date_trunc('month', now())), 0) as month
     from points_ledger where workspace_id = $1`,
    [workspaceId],
  );
  const row = result.rows[0] ?? {};
  return { total: round2(Number(row.total ?? 0)), week: round2(Number(row.week ?? 0)), month: round2(Number(row.month ?? 0)) };
}

async function loadStreak(database, workspaceId, timeZone, now = Date.now()) {
  const runs = streakRuns(await loadPostingDays(database, workspaceId, timeZone, now));
  return streakState(runs, localDay(now, timeZone));
}

/** The streak as the calendar shows it: its days, whether today's post is in yet, and the next bonus. */
export async function loadStreakSummary(database, workspaceId, now = Date.now()) {
  const timeZone = await loadTimeZone(database, workspaceId);
  const runs = streakRuns(await loadPostingDays(database, workspaceId, timeZone, now));
  const today = localDay(now, timeZone);
  const state = streakState(runs, today);
  return { days: state.current, postedToday: runs.at(-1)?.end === today, next: state.next };
}

async function loadBadges(database, workspaceId, streak) {
  // Any post, Posterract's own or made elsewhere.
  const anyPost = (condition) =>
    `(exists (select 1 from post_points where workspace_id = $1 and ${condition})
      or exists (select 1 from platform_post_points where workspace_id = $1 and ${condition}))`;
  const result = await database.query(
    `select
       ${anyPost("source = 'post'")} as posted,
       ${anyPost("source = 'views' and metric_value >= 100000")} as club,
       ${anyPost("source = 'record'")} as record,
       ${anyPost("source = 'breakout'")} as breakout`,
    [workspaceId],
  );
  const row = result.rows[0] ?? {};
  const badges = [];
  if (row.posted) badges.push("first_transmission");
  for (const days of [7, 30, 100, 365]) if (streak.best >= days) badges.push(`streak_${days}`);
  if (row.club) badges.push("club_100k");
  if (row.record) badges.push("record");
  if (row.breakout) badges.push("breakout");
  return badges.filter((badge) => badge in BADGES);
}

/** The short summary the app loads with everything else (`/v1/bootstrap`, `/v1/points`). */
export async function loadPointsSummary(database, workspaceId) {
  const timeZone = await loadTimeZone(database, workspaceId);
  const [totals, streak, recent] = await Promise.all([
    loadTotals(database, workspaceId),
    loadStreak(database, workspaceId, timeZone),
    database.query(
      `select id, source, amount, note, awarded_at, projection_id, platform_post_id, provider from points_ledger
       where workspace_id = $1 order by awarded_at desc, id desc limit 30`,
      [workspaceId],
    ),
  ]);
  return {
    lifetimeRP: totals.total,
    weekRP: totals.week,
    streakDays: streak.current,
    badges: await loadBadges(database, workspaceId, streak),
    recent: recent.rows.map(entryFromRow),
  };
}

/** Everything the My Points tab shows. */
export async function loadPointsDashboard(database, workspaceId, now = Date.now()) {
  const timeZone = await loadTimeZone(database, workspaceId);
  const [totals, streak, recent, posts, accounts, feed] = await Promise.all([
    loadTotals(database, workspaceId),
    loadStreak(database, workspaceId, timeZone, now),
    database.query(
      `select id, source, amount, note, awarded_at, projection_id, platform_post_id, provider from points_ledger
       where workspace_id = $1 order by awarded_at desc, id desc limit 30`,
      [workspaceId],
    ),
    database.query(
      `with paid as (
         select pp.projection_id::text as key, pp.provider, pp.source, pp.points, pp.metric_value,
                p.platform_post_url as url, coalesce(p.published_at, p.created_at) as published_at,
                t.title, null::text as caption, t.media_asset_id, a.handle
         from post_points pp
         join projections p on p.id = pp.projection_id
         join transmissions t on t.id = p.transmission_id
         left join social_accounts a on a.id = p.social_account_id
         where pp.workspace_id = $1
         union all
         select pp.provider || ':' || pp.platform_post_id, pp.provider, pp.source, pp.points, pp.metric_value,
                post.permalink, post.published_at, null, post.caption, null, a.handle
         from platform_post_points pp
         ${LISTED_POST}
         left join social_accounts a on a.id = pp.social_account_id
         where pp.workspace_id = $1
       )
       select *, sum(points) over (partition by key) as total from paid
       order by total desc, key, points desc`,
      [workspaceId],
    ),
    database.query(
      `select a.id, a.provider, a.handle, a.avatar_url, b.followers as baseline,
              (select s.audience from account_metric_snapshots s
               where s.social_account_id = a.id and s.audience is not null
               order by s.fetched_at desc, s.id desc limit 1) as followers
       from social_accounts a
       left join follower_baselines b on b.social_account_id = a.id
       where a.workspace_id = $1 and a.provider = any($2::text[]) and a.status = 'connected'
       order by a.created_at asc`,
      [workspaceId, POINTS_PLATFORMS],
    ),
    loadPointsFeed(database, workspaceId, 1),
  ]);

  const byPost = new Map();
  for (const row of posts.rows) {
    let post = byPost.get(row.key);
    if (!post) {
      if (byPost.size >= 10) continue;
      post = {
        projectionId: row.key,
        provider: row.provider,
        title: row.title ?? captionTitle(row.caption, row.provider),
        url: row.url ?? undefined,
        publishedAt: row.published_at ? new Date(row.published_at).getTime() : undefined,
        total: round2(Number(row.total)),
        parts: [],
        artifactId: row.media_asset_id ?? undefined,
        handle: row.handle ?? undefined,
      };
      byPost.set(row.key, post);
    }
    if (Number(row.points) > 0) {
      post.parts.push({
        source: row.source,
        points: Number(row.points),
        value: optionalNumber(row.metric_value),
      });
    }
  }
  const progress = levelProgress(totals.total);
  const rank = rankFor(totals.total);
  const upcoming = nextRank(totals.total);
  return {
    totalPoints: totals.total,
    weekPoints: totals.week,
    monthPoints: totals.month,
    level: progress.level,
    levelFloor: progress.floor,
    nextLevelAt: progress.next,
    rank: { id: rank.id, label: rank.label },
    nextRank: upcoming ? { id: upcoming.id, label: upcoming.label, minLevel: upcoming.minLevel } : undefined,
    streak,
    followers: accounts.rows
      .filter((row) => row.followers !== null && row.followers !== undefined)
      .map((row) => {
        const followers = number(row.followers);
        const baseline = optionalNumber(row.baseline) ?? followers;
        const next = POINTS_FOLLOWER_MILESTONES.find((milestone) => milestone.followers > Math.max(followers, baseline));
        return {
          accountId: row.id,
          provider: row.provider,
          handle: row.handle,
          avatarUrl: row.avatar_url ?? undefined,
          followers,
          baseline,
          next: next ? { followers: next.followers, points: next.points } : undefined,
        };
      }),
    topPosts: [...byPost.values()],
    recent: recent.rows.map(entryFromRow),
    feed,
    badges: await loadBadges(database, workspaceId, streak),
    timeZone,
  };
}

/** The platform's own cover, when it is one the app can show. */
const coverUrl = (value) => (typeof value === "string" && value.startsWith("https://") ? value : undefined);

/**
 * Posts as the feed and its stat cards show them: points rule by rule, the
 * video (for the thumbnail), the account, and the latest analytics numbers.
 * `keys` are projection IDs and the `provider:postId` keys of posts made elsewhere.
 */
async function loadPostCards(database, workspaceId, keys) {
  const cards = new Map();
  const projectionIds = keys.filter((key) => !key.includes(":"));
  const elsewhereKeys = keys.filter((key) => key.includes(":"));
  if (elsewhereKeys.length) {
    const elsewhere = await database.query(
      `select pp.provider, pp.platform_post_id, pp.source, pp.points, pp.metric_value, a.handle,
              post.permalink, post.published_at, post.caption, post.thumbnail_url, post.views, post.likes,
              post.comments, post.shares, post.watch_time_seconds, post.average_view_duration_seconds,
              post.duration_seconds, post.raw_metrics, post.metrics_fetched_at
       from platform_post_points pp
       ${LISTED_POST}
       left join social_accounts a on a.id = pp.social_account_id
       where pp.workspace_id = $1 and pp.provider || ':' || pp.platform_post_id = any($2::text[])
       order by pp.provider, pp.platform_post_id, pp.points desc`,
      [workspaceId, elsewhereKeys],
    );
    for (const row of elsewhere.rows) {
      const key = elsewhereKey(row.provider, row.platform_post_id);
      let card = cards.get(key);
      if (!card) {
        card = {
          projectionId: key,
          provider: row.provider,
          title: captionTitle(row.caption, row.provider),
          url: row.permalink ?? undefined,
          publishedAt: row.published_at ? new Date(row.published_at).getTime() : undefined,
          total: 0,
          parts: [],
          thumbnailUrl: coverUrl(row.thumbnail_url),
          handle: row.handle ?? undefined,
          metrics: row.metrics_fetched_at ? metricsFromSnapshot(row) : undefined,
        };
        cards.set(key, card);
      }
      if (Number(row.points) > 0) {
        card.total = round2(card.total + Number(row.points));
        card.parts.push({ source: row.source, points: Number(row.points), value: optionalNumber(row.metric_value) });
      }
    }
  }
  if (projectionIds.length === 0) return cards;
  const [posts, snapshots] = await Promise.all([
    database.query(
      `select p.id as projection_id, p.provider, p.platform_post_url,
              coalesce(p.published_at, p.created_at) as published_at,
              t.title, t.media_asset_id, a.handle, pp.source, pp.points, pp.metric_value
       from projections p
       join transmissions t on t.id = p.transmission_id
       left join social_accounts a on a.id = p.social_account_id
       left join post_points pp on pp.projection_id = p.id
       where p.workspace_id = $1 and p.id = any($2::uuid[])
       order by p.id, pp.points desc nulls last`,
      [workspaceId, projectionIds],
    ),
    database.query(
      `select distinct on (s.projection_id) s.projection_id, p.provider, s.views, s.likes, s.comments, s.shares,
              s.watch_time_seconds, s.average_view_duration_seconds, s.raw_metrics, m.duration_ms
       from publication_metric_snapshots s
       join projections p on p.id = s.projection_id
       join transmissions t on t.id = p.transmission_id
       left join media_assets m on m.id = t.media_asset_id
       where p.workspace_id = $1 and s.projection_id = any($2::uuid[])
       order by s.projection_id, s.fetched_at desc, s.id desc`,
      [workspaceId, projectionIds],
    ),
  ]);
  for (const row of posts.rows) {
    let card = cards.get(row.projection_id);
    if (!card) {
      card = {
        projectionId: row.projection_id,
        provider: row.provider,
        title: row.title,
        url: row.platform_post_url ?? undefined,
        publishedAt: row.published_at ? new Date(row.published_at).getTime() : undefined,
        total: 0,
        parts: [],
        artifactId: row.media_asset_id ?? undefined,
        handle: row.handle ?? undefined,
      };
      cards.set(row.projection_id, card);
    }
    if (row.source && Number(row.points) > 0) {
      card.total = round2(card.total + Number(row.points));
      card.parts.push({ source: row.source, points: Number(row.points), value: optionalNumber(row.metric_value) });
    }
  }
  for (const row of snapshots.rows) {
    const card = cards.get(row.projection_id);
    if (!card) continue;
    card.metrics = metricsFromSnapshot(row);
    // The platform's own cover, saved with each refresh: it outlives the posted video,
    // which storage lets go of two days after the post goes live.
    const cover = coverUrl(row.raw_metrics?.thumbnailUrl);
    if (cover) card.thumbnailUrl = cover;
  }
  return cards;
}

export const POINTS_FEED_PAGE = 10;

/**
 * The Recent points feed, newest first, a page at a time: each post once, at
 * its latest points, with what it earned in the day up to them; streak and
 * follower milestones each stand on their own.
 */
export async function loadPointsFeed(database, workspaceId, page = 1, size = POINTS_FEED_PAGE) {
  // A post goes by its projection, or by `provider:postId` when made elsewhere.
  const postKey = "coalesce(projection_id::text, provider || ':' || platform_post_id)";
  const items = `
    select 'post' as kind, ${postKey} as key, max(awarded_at) as at
    from points_ledger
    where workspace_id = $1 and (projection_id is not null or platform_post_id is not null)
    group by 2
    union all
    select 'bonus', id::text, awarded_at
    from points_ledger
    where workspace_id = $1 and projection_id is null and platform_post_id is null`;
  const [rows, count] = await Promise.all([
    database.query(`select kind, key, at from (${items}) items order by at desc, key limit $2 offset $3`, [
      workspaceId,
      size,
      (page - 1) * size,
    ]),
    database.query(`select count(*) as total from (${items}) items`, [workspaceId]),
  ]);
  const postIds = rows.rows.filter((row) => row.kind === "post").map((row) => row.key);
  const bonusIds = rows.rows.filter((row) => row.kind === "bonus").map((row) => row.key);
  const [entries, bonuses, cards] = await Promise.all([
    postIds.length
      ? database.query(
          `with keyed as (
             select id, source, amount, note, awarded_at, projection_id, platform_post_id, provider,
                    ${postKey} as key
             from points_ledger
             where workspace_id = $1 and (projection_id is not null or platform_post_id is not null)
           ), latest as (
             select key, max(awarded_at) as at from keyed where key = any($2::text[]) group by key
           )
           select keyed.* from keyed
           join latest on latest.key = keyed.key
           where keyed.awarded_at > latest.at - interval '24 hours'
           order by keyed.awarded_at desc, keyed.id desc`,
          [workspaceId, postIds],
        )
      : { rows: [] },
    bonusIds.length
      ? database.query(
          `select id, source, amount, note, awarded_at, projection_id, platform_post_id, provider
           from points_ledger where workspace_id = $1 and id = any($2::bigint[])`,
          [workspaceId, bonusIds],
        )
      : { rows: [] },
    loadPostCards(database, workspaceId, postIds),
  ]);
  const byPost = new Map();
  for (const row of entries.rows) {
    const list = byPost.get(row.key) ?? [];
    if (list.length < 24) list.push(entryFromRow(row));
    byPost.set(row.key, list);
  }
  const bonusById = new Map(bonuses.rows.map((row) => [String(row.id), entryFromRow(row)]));
  const total = Number(count.rows[0]?.total ?? 0);
  return {
    items: rows.rows
      .map((row) => {
        if (row.kind === "bonus") {
          const entry = bonusById.get(row.key);
          return entry ? { kind: "bonus", entry } : undefined;
        }
        const post = cards.get(row.key);
        if (!post) return undefined;
        const list = byPost.get(row.key) ?? [];
        return {
          kind: "post",
          post,
          entries: list,
          amount: round2(list.reduce((sum, entry) => sum + entry.amount, 0)),
          at: new Date(row.at).getTime(),
        };
      })
      .filter(Boolean),
    page,
    pages: Math.max(1, Math.ceil(total / size)),
    total,
  };
}

// Where the creator's avatar and their posts' covers are hosted. Rank cards
// draw them on a canvas, and these CDNs send no CORS headers, so the API reads
// them, only from these hosts, and hands them over as data URLs.
const CARD_IMAGE_HOSTS = [
  "cdninstagram.com",
  "fbcdn.net",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktokcdn-eu.com",
  "googleusercontent.com",
  "ggpht.com",
  "clerk.com",
];
const CARD_IMAGE_BYTES = 4 * 1024 * 1024;
const CARD_COVERS_MAX = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCardImageUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      CARD_IMAGE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

async function cardImage(url, fetchImage) {
  if (!isCardImageUrl(url)) return undefined;
  try {
    const response = await fetchImage(url, { signal: AbortSignal.timeout(6_000) });
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!response.ok || !type.startsWith("image/") || type === "image/svg+xml") return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > CARD_IMAGE_BYTES) return undefined;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/**
 * The pictures a rank card shows: the creator's avatar (their own picture,
 * else a connected account's, Instagram first, the account the card names) and the covers of their posts, by
 * post key. Only the workspace's own posts; anything that can't be read is
 * left out, and the card draws without it.
 */
export async function loadCardImages(database, workspaceId, { avatar = false, covers = [] } = {}, fetchImage = fetch) {
  const keys = [...new Set(covers)].filter((key) => typeof key === "string" && key.length > 0 && key.length <= 200).slice(0, CARD_COVERS_MAX);
  const [owner, cards] = await Promise.all([
    avatar
      ? database.query(
          `select u.image_url,
                  (select a.avatar_url from social_accounts a
                   where a.workspace_id = w.id and a.status = 'connected' and a.avatar_url is not null
                   order by case a.provider when 'instagram' then 0 when 'threads' then 1 when 'tiktok' then 2
                                            when 'facebook' then 3 else 4 end, a.created_at asc
                   limit 1) as account_avatar
           from workspaces w left join app_users u on u.id = w.owner_id
           where w.id = $1`,
          [workspaceId],
        )
      : { rows: [] },
    keys.length ? loadPostCards(database, workspaceId, keys.filter((key) => key.includes(":") || UUID.test(key))) : new Map(),
  ]);
  const row = owner.rows[0];
  const [avatarUrl, ...coverUrls] = await Promise.all([
    row ? cardImage(row.image_url, fetchImage).then((image) => image ?? cardImage(row.account_avatar, fetchImage)) : undefined,
    ...keys.map((key) => cardImage(cards.get(key)?.thumbnailUrl, fetchImage)),
  ]);
  return {
    avatar: avatarUrl,
    covers: Object.fromEntries(keys.map((key, index) => [key, coverUrls[index]]).filter(([, image]) => image)),
  };
}

/**
 * One post's points on each platform, rule by rule, for a post (transmission)
 * in the workspace. Undefined when the post isn't there.
 */
export async function loadPostPoints(database, workspaceId, transmissionId) {
  const result = await database.query(
    `select t.title, p.id as projection_id, p.provider, p.status, p.platform_post_url,
            coalesce(p.published_at, p.created_at) as published_at,
            pp.source, pp.points, pp.metric_value
     from transmissions t
     join projections p on p.transmission_id = t.id
     left join post_points pp on pp.projection_id = p.id
     where t.id = $1 and t.workspace_id = $2
     order by p.created_at asc, pp.points desc nulls last`,
    [transmissionId, workspaceId],
  );
  if (result.rows.length === 0) return undefined;
  const platforms = new Map();
  for (const row of result.rows) {
    let platform = platforms.get(row.projection_id);
    if (!platform) {
      platform = {
        provider: row.provider,
        status: row.status,
        url: row.platform_post_url ?? undefined,
        publishedAt: row.published_at ? new Date(row.published_at).getTime() : undefined,
        total: 0,
        parts: [],
      };
      platforms.set(row.projection_id, platform);
    }
    if (row.source && Number(row.points) > 0) {
      platform.total = round2(platform.total + Number(row.points));
      platform.parts.push({ source: row.source, points: Number(row.points), value: optionalNumber(row.metric_value) });
    }
  }
  const list = [...platforms.values()];
  return {
    title: result.rows[0].title,
    total: round2(list.reduce((sum, platform) => sum + platform.total, 0)),
    platforms: list,
  };
}

const PERIOD_START = {
  week: "date_trunc('week', now())",
  month: "date_trunc('month', now())",
  all: null,
};

/**
 * Everyone on the base plan or above — a paid plan, or an AI FOR SAVAGES
 * membership, which includes it — ranked by points in the period. Mirrors the
 * access rule in billing.js; without the `core` schema only paid plans count,
 * the way billing falls back.
 */
export async function loadLeaderboard(database, workspaceId, period = "week", limit = 100) {
  const since = PERIOD_START[period];
  if (since === undefined) throw Object.assign(new Error("invalid_period"), { statusCode: 400 });
  // A view point is a platform's rate of views, so the period's views are its view points times that rate.
  const viewRate = `case l.provider ${POINTS_PLATFORMS.map((platform) => `when '${platform}' then ${POINTS_RATES[platform].views}`).join(" ")} else 1000 end`;
  const query = (withMembership) => `
    with eligible as (
      select w.id as workspace_id, w.name as workspace_name, w.created_at,
             u.display_name, u.image_url
      from workspaces w
      left join app_users u on u.id = w.owner_id
      where (
              -- The same subscription billing judges access by (billing.js loadSubscription).
              select s.recognized_plan = true and s.status = 'active'
                     and coalesce(s.last_payment_status, '') <> 'failed'
              from billing_subscriptions s
              where s.workspace_id = w.id
              order by s.recognized_plan desc,
                       case s.status when 'active' then 0 when 'trialing' then 1 when 'past_due' then 2
                                     when 'unpaid' then 3 when 'paused' then 4 else 5 end,
                       s.updated_at desc
              limit 1
            ) is true
         ${withMembership ? "or (u.email_verified = true and core.has_membership(u.id, 'aiforsavages'))" : ""}
    ), totals as (
      select l.workspace_id,
             coalesce(sum(l.amount), 0) as lifetime,
             coalesce(sum(l.amount) ${since ? `filter (where l.awarded_at >= ${since})` : ""}, 0) as points,
             coalesce(sum(l.amount * ${viewRate}) filter (where l.source = 'views'${since ? ` and l.awarded_at >= ${since}` : ""}), 0) as views
      from points_ledger l
      where l.workspace_id in (select workspace_id from eligible)
      group by l.workspace_id
    ), ranked as (
      select e.workspace_id, e.workspace_name, e.display_name, e.image_url,
             (select a.handle from social_accounts a
              where a.workspace_id = e.workspace_id and a.status = 'connected' and a.handle is not null
              order by a.created_at asc limit 1) as account_handle,
             coalesce(t.points, 0) as points, coalesce(t.lifetime, 0) as lifetime, coalesce(t.views, 0) as views,
             row_number() over (order by coalesce(t.points, 0) desc, coalesce(t.lifetime, 0) desc, e.created_at asc) as position,
             (select a.avatar_url from social_accounts a
              where a.workspace_id = e.workspace_id and a.avatar_url is not null
              order by a.created_at asc limit 1) as account_avatar
      from eligible e
      left join totals t on t.workspace_id = e.workspace_id
    )
    select *, (select count(*) from ranked) as total from ranked
    where position <= $1 or workspace_id = $2
    order by position`;

  let result;
  try {
    result = await database.query(query(true), [limit, workspaceId]);
  } catch {
    result = await database.query(query(false), [limit, workspaceId]);
  }

  const entry = (row) => {
    const lifetime = round2(Number(row.lifetime));
    const rank = rankFor(lifetime);
    return {
      position: Number(row.position),
      name: publicName(row),
      avatarUrl: row.image_url ?? row.account_avatar ?? undefined,
      level: levelProgress(lifetime).level,
      rank: { id: rank.id, label: rank.label },
      points: round2(Number(row.points)),
      views: Math.round(Number(row.views ?? 0)),
      isMe: row.workspace_id === workspaceId,
    };
  };
  const rows = result.rows.map(entry);
  return {
    period,
    entries: rows.filter((row) => row.position <= limit),
    me: rows.find((row) => row.isMe),
    total: Number(result.rows[0]?.total ?? 0),
  };
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * The name the leaderboard shows everyone: the owner's name, the workspace's,
 * or the first connected account's public handle. Never an email address:
 * workspaces are often named after their owner's email.
 */
function publicName(row) {
  for (const candidate of [row.display_name, row.workspace_name, row.account_handle]) {
    const name = candidate?.trim();
    if (name && !EMAIL.test(name)) return name;
  }
  return "Posterract creator";
}

export function isValidTimeZone(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerPointsRoutes(app, { postgres, requireScope, requireSession, requiredWorkspace }) {
  app.get("/v1/points", { preHandler: requireScope("points:read") }, async (request) =>
    loadPointsSummary(postgres, requiredWorkspace(request)),
  );

  app.get("/v1/points/dashboard", { preHandler: requireScope("points:read") }, async (request) =>
    loadPointsDashboard(postgres, requiredWorkspace(request)),
  );

  app.get("/v1/points/feed", { preHandler: requireScope("points:read") }, async (request, reply) => {
    const page = Number(request.query?.page ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 10_000) return reply.code(400).send({ error: "invalid_page" });
    return loadPointsFeed(postgres, requiredWorkspace(request), page);
  });

  // `avatar=1` and `covers=<post key>,<post key>`: the pictures for rank cards, as data URLs.
  app.get("/v1/points/card-images", { preHandler: requireScope("points:read") }, async (request, reply) => {
    const covers = typeof request.query?.covers === "string" && request.query.covers ? request.query.covers.split(",") : [];
    if (covers.length > CARD_COVERS_MAX) return reply.code(400).send({ error: "too_many_covers" });
    reply.header("cache-control", "private, max-age=600");
    return loadCardImages(postgres, requiredWorkspace(request), { avatar: request.query?.avatar === "1", covers });
  });

  app.get("/v1/points/ledger", { preHandler: requireScope("points:read") }, async (request, reply) => {
    const limit = Math.min(100, Math.max(1, Number(request.query?.limit ?? 30)));
    if (!Number.isInteger(limit)) return reply.code(400).send({ error: "invalid_limit" });
    const beforeValue = request.query?.before;
    const before = beforeValue ? new Date(beforeValue) : undefined;
    if (before && !Number.isFinite(before.getTime())) {
      return reply.code(400).send({ error: "invalid_cursor" });
    }
    const result = await postgres.query(
      `select id, source, amount, reference_id, note, awarded_at, projection_id, platform_post_id, provider
       from points_ledger
       where workspace_id = $1
         and ($2::timestamptz is null or awarded_at < $2)
       order by awarded_at desc, id desc
       limit $3`,
      [requiredWorkspace(request), before ?? null, limit],
    );
    return {
      entries: result.rows.map((row) => ({
        id: String(row.id),
        source: row.source,
        amount: Number(row.amount),
        referenceId: row.reference_id ?? undefined,
        note: row.note ?? undefined,
        projectionId: row.projection_id ?? undefined,
        platformPostId: row.platform_post_id ?? undefined,
        provider: row.provider ?? undefined,
        awardedAt: new Date(row.awarded_at).getTime(),
      })),
      nextCursor:
        result.rows.length === limit
          ? new Date(result.rows.at(-1).awarded_at).toISOString()
          : undefined,
    };
  });

  app.get("/v1/leaderboard", { preHandler: requireScope("points:read") }, async (request, reply) => {
    const period = request.query?.period ?? "week";
    if (!(period in PERIOD_START)) return reply.code(400).send({ error: "invalid_period" });
    return loadLeaderboard(postgres, requiredWorkspace(request), period);
  });

  // The browser's time zone, so a streak day is the creator's own day.
  app.put("/v1/points/time-zone", { preHandler: requireSession }, async (request, reply) => {
    const timeZone = request.body?.timeZone;
    if (!isValidTimeZone(timeZone)) return reply.code(400).send({ error: "invalid_time_zone" });
    await postgres.query("update workspaces set time_zone = $2 where id = $1", [
      requiredWorkspace(request),
      timeZone,
    ]);
    return { timeZone };
  });
}

