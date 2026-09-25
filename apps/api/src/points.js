/**
 * Points: what each post, posting streak and follower milestone earns on
 * Instagram, Facebook and Threads, paid into the points ledger. The worker
 * scores a workspace after every analytics refresh; the rescore script scores
 * everyone at once. The rates, milestones and levels live in
 * @posterract/contract, so the Points tab explains exactly what this pays.
 *
 * Everyone started at zero on launch day (POINTS_START_AT): only posts
 * published from then earn, streak days count from then, and follower growth
 * is measured from what each account had then (or when it was connected).
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

const PROVIDER_LABELS = { instagram: "Instagram", facebook: "Facebook", threads: "Threads" };
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
            t.title, m.duration_ms,
            s.views, s.likes, s.comments, s.shares, s.watch_time_seconds,
            s.average_view_duration_seconds, s.raw_metrics, s.fetched_at
     from projections p
     join transmissions t on t.id = p.transmission_id
     left join media_assets m on m.id = t.media_asset_id
     left join lateral (
       select * from publication_metric_snapshots s
       where s.projection_id = p.id
       order by s.fetched_at desc, s.id desc
       limit 1
     ) s on true
     where p.workspace_id = $1 and p.status = 'live' and p.provider = any($2::text[])`,
    [workspaceId, POINTS_PLATFORMS],
  );
  return result.rows;
}

/**
 * The local days a workspace posted something new since launch day. Only live
 * posts count, and a video counts once: posting the same file again, on any
 * platform or any day, keeps nobody's streak alive.
 */
async function loadPostingDays(database, workspaceId, timeZone) {
  const result = await database.query(
    `with live as (
       select p.transmission_id, t.media_asset_id,
              min(coalesce(p.published_at, p.created_at)) as published_at
       from projections p
       join transmissions t on t.id = p.transmission_id
       where p.workspace_id = $1 and p.status = 'live' and p.provider = any($2::text[])
       group by p.transmission_id, t.media_asset_id
     ), firsts as (
       select published_at,
              row_number() over (
                partition by coalesce(media_asset_id::text, transmission_id::text)
                order by published_at
              ) as use
       from live
     )
     select published_at from firsts where use = 1 and published_at >= $3`,
    [workspaceId, POINTS_PLATFORMS, new Date(POINTS_START_AT)],
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
 * the amount paid (0 when there was nothing to pay).
 */
async function payPostRule(client, { post, workspaceId, source, target, value, current, awardedAt, dryRun }) {
  if (target <= current + 0.004) return 0;
  const amount = round2(target - current);
  if (dryRun) return amount;
  await client.query(
    `insert into points_ledger
       (workspace_id, source, amount, reference_id, note, awarded_at,
        projection_id, social_account_id, provider)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (reference_id, source) do nothing`,
    [
      workspaceId,
      source,
      amount,
      `projection:${post.id}:${source}:${target.toFixed(2)}`,
      noteFor(source, post.provider, post.title),
      awardedAt,
      post.id,
      post.social_account_id ?? null,
      post.provider,
    ],
  );
  await client.query(
    `insert into post_points
       (projection_id, source, workspace_id, social_account_id, provider, points, metric_value, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (projection_id, source) do update
       set points = greatest(post_points.points, excluded.points),
           metric_value = excluded.metric_value,
           updated_at = now()`,
    [post.id, source, workspaceId, post.social_account_id ?? null, post.provider, target, value ?? null],
  );
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
  const posts = await loadScoredPosts(client, workspaceId);
  const paidRows = await client.query(
    "select projection_id, source, points from post_points where workspace_id = $1",
    [workspaceId],
  );
  const paid = new Map(paidRows.rows.map((row) => [`${row.projection_id}:${row.source}`, Number(row.points)]));

  const bests = personalBests(
    posts
      .filter((post) => post.views !== null && post.views !== undefined)
      .map((post) => ({
        id: post.id,
        accountId: post.social_account_id,
        publishedAt: new Date(post.published_at).getTime(),
        views: number(post.views),
      })),
  );

  for (const post of posts) {
    const publishedAt = new Date(post.published_at).getTime();
    // Earlier posts still set the bar for records and breakouts, but earn nothing.
    if (publishedAt < POINTS_START_AT) continue;
    const hasSnapshot = post.fetched_at !== null && post.fetched_at !== undefined;
    const targets = postTargets({
      provider: post.provider,
      metrics: hasSnapshot ? postMetrics(post) : undefined,
      durationSeconds: number(post.duration_ms) / 1000,
      ageHours: (now - publishedAt) / 3_600_000,
      bests: bests.get(post.id),
    });
    for (const [source, { points, value }] of Object.entries(targets)) {
      const amount = await payPostRule(client, {
        post,
        workspaceId,
        source,
        target: points,
        value,
        current: paid.get(`${post.id}:${source}`) ?? 0,
        // When the points were earned: the post going live, or the moment its
        // metrics were read. A backfill dates them all at the post, so old
        // posts land in the past, not all in this week.
        awardedAt:
          source === "post" || !hasSnapshot || backfill ? new Date(publishedAt) : new Date(post.fetched_at),
        dryRun,
      });
      tally(source, amount);
      if (amount > 0 && (source === "record" || source === "breakout") && now - publishedAt <= FRESH_POST_MS) {
        const where = `${PROVIDER_LABELS[post.provider]}: “${shortTitle(post.title)}”`;
        news.push({
          type: `points.${source}`,
          projectionId: post.id,
          transmissionId: post.transmission_id,
          message:
            source === "record"
              ? `New views record on ${where} (+${formatAmount(amount)} points).`
              : `Breakout on ${where} got ${POINTS_PERSONAL_BEST.breakoutMultiple}× your usual views (+${formatAmount(amount)} points).`,
        });
      }
    }
  }

  // Streak milestones: each once per run of consecutive posting days.
  const runs = streakRuns(await loadPostingDays(client, workspaceId, timeZone));
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
 * rather than at the next analytics refresh. Instagram, Facebook and Threads
 * only; the other platforms earn nothing yet.
 */
export async function awardPostLive(postgres, { projectionId, workspaceId, provider, socialAccountId, title }) {
  if (!isPointsPlatform(provider)) return 0;
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
      post: { id: projectionId, provider, social_account_id: socialAccountId, title },
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
    at: new Date(row.awarded_at).getTime(),
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
  const runs = streakRuns(await loadPostingDays(database, workspaceId, timeZone));
  return streakState(runs, localDay(now, timeZone));
}

async function loadBadges(database, workspaceId, streak) {
  const result = await database.query(
    `select
       exists (select 1 from post_points where workspace_id = $1 and source = 'post') as posted,
       exists (select 1 from post_points where workspace_id = $1 and source = 'views' and metric_value >= 100000) as club,
       exists (select 1 from post_points where workspace_id = $1 and source = 'record') as record,
       exists (select 1 from post_points where workspace_id = $1 and source = 'breakout') as breakout`,
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
      `select id, source, amount, note, awarded_at from points_ledger
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
  const [totals, streak, recent, posts, accounts] = await Promise.all([
    loadTotals(database, workspaceId),
    loadStreak(database, workspaceId, timeZone, now),
    database.query(
      `select id, source, amount, note, awarded_at from points_ledger
       where workspace_id = $1 order by awarded_at desc, id desc limit 30`,
      [workspaceId],
    ),
    database.query(
      `select pp.projection_id, pp.provider, pp.source, pp.points, pp.metric_value,
             p.platform_post_url, coalesce(p.published_at, p.created_at) as published_at, t.title,
             sum(pp.points) over (partition by pp.projection_id) as total
       from post_points pp
       join projections p on p.id = pp.projection_id
       join transmissions t on t.id = p.transmission_id
       where pp.workspace_id = $1
       order by total desc, pp.projection_id, pp.points desc`,
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
  ]);

  const byPost = new Map();
  for (const row of posts.rows) {
    let post = byPost.get(row.projection_id);
    if (!post) {
      if (byPost.size >= 10) continue;
      post = {
        projectionId: row.projection_id,
        provider: row.provider,
        title: row.title,
        url: row.platform_post_url ?? undefined,
        publishedAt: row.published_at ? new Date(row.published_at).getTime() : undefined,
        total: round2(Number(row.total)),
        parts: [],
      };
      byPost.set(row.projection_id, post);
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
    badges: await loadBadges(database, workspaceId, streak),
    timeZone,
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
             coalesce(sum(l.amount) ${since ? `filter (where l.awarded_at >= ${since})` : ""}, 0) as points
      from points_ledger l
      where l.workspace_id in (select workspace_id from eligible)
      group by l.workspace_id
    ), ranked as (
      select e.workspace_id, e.workspace_name, e.display_name, e.image_url,
             (select a.handle from social_accounts a
              where a.workspace_id = e.workspace_id and a.status = 'connected' and a.handle is not null
              order by a.created_at asc limit 1) as account_handle,
             coalesce(t.points, 0) as points, coalesce(t.lifetime, 0) as lifetime,
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

  app.get("/v1/points/ledger", { preHandler: requireScope("points:read") }, async (request, reply) => {
    const limit = Math.min(100, Math.max(1, Number(request.query?.limit ?? 30)));
    if (!Number.isInteger(limit)) return reply.code(400).send({ error: "invalid_limit" });
    const beforeValue = request.query?.before;
    const before = beforeValue ? new Date(beforeValue) : undefined;
    if (before && !Number.isFinite(before.getTime())) {
      return reply.code(400).send({ error: "invalid_cursor" });
    }
    const result = await postgres.query(
      `select id, source, amount, reference_id, note, awarded_at, projection_id, provider
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

