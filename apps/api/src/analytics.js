import { loadStreakSummary } from "./points.js";

const ANALYTICS_PROVIDERS = ["instagram", "tiktok", "facebook", "threads"];

const REQUIRED_SCOPES = {
  instagram: ["instagram_business_basic", "instagram_business_manage_insights"],
  tiktok: ["user.info.stats", "video.list"],
  facebook: ["pages_read_engagement", "read_insights"],
  threads: ["threads_basic", "threads_manage_insights"],
};

const PLATFORM_METRICS = {
  instagram: ["views", "reach", "likes", "comments", "shares", "saves", "totalInteractions", "watchTime", "averageWatchTime", "replays", "skipRate", "profileViews", "clicks"],
  tiktok: ["views", "likes", "comments", "shares", "followers", "following", "totalLikes", "publishedVideos", "duration"],
  facebook: ["views", "likes", "comments", "shares", "reactions", "watchTime", "pageViews", "pageEngagements"],
  threads: ["views", "likes", "replies", "reposts", "quotes", "clicks", "followers"],
};

const PLATFORM_NOTES = {
  instagram: [
    "Reach, saves, watch behavior, and profile actions depend on media type and Meta availability.",
    "Posterract never substitutes plays or page activity for unavailable post metrics.",
  ],
  tiktok: [
    "Approved TikTok scopes provide account totals and public per-video views, likes, comments, and shares.",
    "TikTok does not expose watch time, retention, traffic sources, or audience demographics through these scopes.",
  ],
  facebook: [
    "Page activity is displayed separately from views on posts published through Posterract.",
    "Facebook insight availability varies by Page, media type, and Graph API version.",
  ],
  threads: [
    "Replies, reposts, and quotes remain separate instead of being collapsed into generic engagement.",
    "Threads does not expose watch-time or retention metrics for video posts here.",
  ],
};

const number = (value) => Number(value ?? 0);
const optionalNumber = (value) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? undefined
    : Number(value);

function rawObject(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function metric(raw, ...names) {
  for (const name of names) {
    const value = optionalNumber(raw[name]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function sumOptional(rows, key) {
  const values = rows
    .map((row) => optionalNumber(row[key]))
    .filter((value) => value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
}

function weightedAverage(rows, valueKey, weightKey = "views") {
  let weighted = 0;
  let weight = 0;
  for (const row of rows) {
    const value = optionalNumber(row[valueKey]);
    const rowWeight = number(row[weightKey]);
    if (value === undefined || rowWeight <= 0) continue;
    weighted += value * rowWeight;
    weight += rowWeight;
  }
  return weight ? weighted / weight : undefined;
}

function metricDate(row) {
  return typeof row.metric_date === "string"
    ? row.metric_date.slice(0, 10)
    : new Date(row.metric_date).toISOString().slice(0, 10);
}

function publicDailyPoint(row) {
  const raw = rawObject(row.raw_metrics);
  return {
    date: metricDate(row),
    views: number(row.views),
    likes: number(row.likes),
    comments: number(row.comments),
    shares: number(row.shares),
    reach: metric(raw, "reach"),
    saves: metric(raw, "saves"),
    replies: metric(raw, "replies"),
    reposts: metric(raw, "reposts"),
    quotes: metric(raw, "quotes"),
    clicks: metric(raw, "clicks"),
    watchMinutes: optionalNumber(row.watch_minutes),
    audienceGained: number(row.audience_gained),
    audienceLost: number(row.audience_lost),
  };
}

/**
 * Several accounts on one platform read as one: their follower counts, totals
 * and raw counters are added up. (Before businesses, one arbitrary account
 * stood in for the whole platform.)
 */
function combineAccounts(accounts) {
  if (accounts.length <= 1) return accounts[0];
  const sum = (key) => {
    const values = accounts.map((account) => optionalNumber(account[key])).filter((value) => value !== undefined);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  const raw = {};
  for (const account of accounts) {
    for (const [key, value] of Object.entries(rawObject(account.account_raw_metrics))) {
      const amount = optionalNumber(value);
      if (amount !== undefined) raw[key] = (raw[key] ?? 0) + amount;
    }
  }
  const fetched = accounts
    .map((account) => account.metrics_fetched_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime());
  return {
    ...accounts[0],
    handle: accounts.map((account) => account.handle).filter(Boolean).join(", "),
    audience: sum("audience"),
    previous_audience: sum("previous_audience"),
    total_views: sum("total_views"),
    total_likes: sum("total_likes"),
    published_videos: sum("published_videos"),
    account_raw_metrics: raw,
    metrics_fetched_at: fetched.length ? new Date(Math.max(...fetched)) : null,
  };
}

/** Daily rows of several accounts, added up per day. */
function combineDaily(rows) {
  const byDate = new Map();
  for (const row of rows) {
    const date = metricDate(row);
    const current = byDate.get(date);
    if (!current) {
      byDate.set(date, { ...row, metric_date: date, raw_metrics: { ...rawObject(row.raw_metrics) } });
      continue;
    }
    for (const key of ["views", "likes", "comments", "shares", "audience_gained", "audience_lost"]) {
      current[key] = number(current[key]) + number(row[key]);
    }
    if (optionalNumber(row.watch_minutes) !== undefined) {
      current.watch_minutes = number(current.watch_minutes) + number(row.watch_minutes);
    }
    for (const [key, value] of Object.entries(rawObject(row.raw_metrics))) {
      const amount = optionalNumber(value);
      if (amount !== undefined) current.raw_metrics[key] = (optionalNumber(current.raw_metrics[key]) ?? 0) + amount;
    }
  }
  return [...byDate.values()].sort((left, right) => metricDate(left).localeCompare(metricDate(right)));
}

function summarizeDaily(rows) {
  const total = {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    watchMinutes: 0,
    audienceDelta: 0,
  };
  for (const row of rows) {
    total.views += row.views;
    total.likes += row.likes;
    total.comments += row.comments;
    total.shares += row.shares;
    total.watchMinutes += row.watchMinutes ?? 0;
    total.audienceDelta += row.audienceGained - row.audienceLost;
  }
  return total;
}

function summarizePeriod({ daily, posts, audience, publishedPosts }) {
  const dailyTotals = summarizeDaily(daily);
  const postTotals = posts.reduce(
    (total, row) => ({
      views: total.views + row.views,
      likes: total.likes + row.likes,
      comments: total.comments + row.comments,
      shares: total.shares + row.shares,
    }),
    { views: 0, likes: 0, comments: 0, shares: 0 },
  );
  const useDaily =
    dailyTotals.views +
      dailyTotals.likes +
      dailyTotals.comments +
      dailyTotals.shares >
    0;
  const hasDailyWatch = daily.some((row) => row.watchMinutes !== undefined);
  return {
    audience,
    audienceDelta: dailyTotals.audienceDelta,
    views: useDaily ? dailyTotals.views : postTotals.views,
    likes: useDaily ? dailyTotals.likes : postTotals.likes,
    comments: useDaily ? dailyTotals.comments : postTotals.comments,
    shares: useDaily ? dailyTotals.shares : postTotals.shares,
    reach: sumOptional(daily, "reach") ?? sumOptional(posts, "reach"),
    saves: sumOptional(daily, "saves") ?? sumOptional(posts, "saves"),
    replies: sumOptional(daily, "replies") ?? sumOptional(posts, "replies"),
    reposts: sumOptional(daily, "reposts") ?? sumOptional(posts, "reposts"),
    quotes: sumOptional(daily, "quotes") ?? sumOptional(posts, "quotes"),
    clicks: sumOptional(daily, "clicks") ?? sumOptional(posts, "clicks"),
    watchMinutes: hasDailyWatch
      ? dailyTotals.watchMinutes
      : sumOptional(posts, "watchMinutes"),
    publishedPosts,
  };
}

/**
 * The Analytics page. `accountIds` narrows it to a business's or picked
 * accounts; null means every connected account.
 */
/**
 * When every post on the workspace's accounts went live in the last 120 days,
 * for the Analytics posting graph. The platform lists (read by the worker
 * each hour) cover posts from any app or tool, Posterract's included; a post
 * made through Posterract counts on its own only where those lists can't see
 * it yet: before an account was first read, or since its last read.
 * `syncing` lists connected accounts whose posts are still being read for
 * the first time (a new connection), so the graph can say so.
 */
export async function loadAccountPosts(postgres, workspaceId) {
  const result = await postgres.query(
    `select pp.social_account_id as account_id, pp.published_at
     from platform_posts pp
     where pp.workspace_id = $1 and pp.published_at >= now() - interval '120 days'
     union all
     select p.social_account_id, coalesce(p.published_at, t.scheduled_for, p.updated_at)
     from projections p
     join transmissions t on t.id = p.transmission_id
     join social_accounts a on a.id = p.social_account_id
     where p.workspace_id = $1 and p.status = 'live'
       and coalesce(p.published_at, t.scheduled_for, p.updated_at) >= now() - interval '120 days'
       and not exists (
         select 1 from platform_posts pp
         where pp.social_account_id = p.social_account_id
           and pp.platform_post_id = p.platform_post_id
       )
       and (a.posts_covered_from is null
            or coalesce(p.published_at, t.scheduled_for, p.updated_at) < a.posts_covered_from
            or coalesce(p.published_at, t.scheduled_for, p.updated_at) >= a.posts_synced_at)`,
    [workspaceId],
  );
  const unread = await postgres.query(
    `select id from social_accounts
     where workspace_id = $1 and status = 'connected' and posts_synced_at is null
       and ((provider = 'instagram' and 'instagram_business_basic' = any(scopes))
         or (provider = 'threads' and 'threads_basic' = any(scopes))
         or (provider = 'tiktok' and 'video.list' = any(scopes))
         or (provider = 'facebook' and 'pages_read_engagement' = any(scopes)))`,
    [workspaceId],
  );
  return {
    posts: result.rows.map((row) => ({
      accountId: row.account_id,
      publishedAt: new Date(row.published_at).getTime(),
    })),
    syncing: unread.rows.map((row) => row.id),
  };
}

export async function loadAnalyticsDashboard(postgres, workspaceId, rangeDays, { accountIds = null } = {}) {
  const isTotal = rangeDays === "total";
  const cutoffDate = isTotal
    ? null
    : new Date(Date.now() - (rangeDays - 1) * 86_400_000).toISOString().slice(0, 10);
  const previousCutoffDate = isTotal
    ? null
    : new Date(Date.now() - (rangeDays * 2 - 1) * 86_400_000).toISOString().slice(0, 10);
  const [accountsResult, dailyResult, postsResult] = await Promise.all([
    postgres.query(
      `select a.*,
              m.audience, m.total_views, m.total_likes, m.published_videos,
              m.raw_metrics as account_raw_metrics,
              m.fetched_at as metrics_fetched_at,
              pm.audience as previous_audience
       from social_accounts a
       left join lateral (
         select * from account_metric_snapshots
         where social_account_id = a.id
         order by fetched_at desc, id desc
         limit 1
       ) m on true
       left join lateral (
         select audience from account_metric_snapshots
         where social_account_id = a.id
           and $2::date is not null
           and fetched_at < $2::date
         order by fetched_at desc, id desc
         limit 1
       ) pm on true
       where a.workspace_id = $1 and a.status = 'connected'
         and ($3::uuid[] is null or a.id = any($3::uuid[]))
       order by a.created_at asc`,
      [workspaceId, cutoffDate, accountIds],
    ),
    postgres.query(
      `select social_account_id, provider, metric_date, views, likes, comments,
              shares, watch_minutes, audience_gained, audience_lost, raw_metrics
       from daily_metric_snapshots
       where workspace_id = $1
         and ($2::date is null or metric_date >= $2::date)
         and ($3::uuid[] is null or social_account_id = any($3::uuid[]))
       order by metric_date asc`,
      [workspaceId, previousCutoffDate, accountIds],
    ),
    postgres.query(
      `select p.id as projection_id, p.transmission_id, p.provider,
              p.platform_post_url, p.updated_at, p.published_at,
              t.title, t.scheduled_for,
              m.views, m.likes, m.comments, m.shares,
              m.estimated_minutes_watched, m.watch_time_seconds,
              m.average_view_duration_seconds, m.average_view_percentage,
              m.full_video_watched_rate, m.raw_metrics
       from projections p
       join transmissions t on t.id = p.transmission_id
       left join lateral (
         select * from publication_metric_snapshots
         where projection_id = p.id
         order by fetched_at desc, id desc
         limit 1
       ) m on true
       where p.workspace_id = $1 and p.status = 'live'
         and ($2::uuid[] is null or p.social_account_id = any($2::uuid[]))`,
      [workspaceId, accountIds],
    ),
  ]);

  const accountsByProvider = new Map();
  for (const account of accountsResult.rows) {
    const accounts = accountsByProvider.get(account.provider) ?? [];
    accounts.push(account);
    accountsByProvider.set(account.provider, accounts);
  }
  const dailyByAccount = new Map();
  for (const row of dailyResult.rows) {
    const rows = dailyByAccount.get(row.social_account_id) ?? [];
    rows.push(row);
    dailyByAccount.set(row.social_account_id, rows);
  }

  const postsByProvider = new Map();
  const previousPostsByProvider = new Map();
  const liveCountByProvider = new Map();
  const previousLiveCountByProvider = new Map();
  for (const row of postsResult.rows) {
    const publishedAt = row.published_at ?? row.scheduled_for ?? row.updated_at;
    const publishedDate = new Date(publishedAt).toISOString().slice(0, 10);
    const isCurrent = isTotal || publishedDate >= cutoffDate;
    const isPrevious = !isTotal && publishedDate >= previousCutoffDate && publishedDate < cutoffDate;
    if (isCurrent) {
      liveCountByProvider.set(row.provider, (liveCountByProvider.get(row.provider) ?? 0) + 1);
    } else if (isPrevious) {
      previousLiveCountByProvider.set(
        row.provider,
        (previousLiveCountByProvider.get(row.provider) ?? 0) + 1,
      );
    }
    if (row.views === null || (!isCurrent && !isPrevious)) continue;
    const raw = rawObject(row.raw_metrics);
    const watchTimeSeconds = optionalNumber(row.watch_time_seconds) ?? metric(raw, "watchTimeSeconds");
    const post = {
      projectionId: row.projection_id,
      transmissionId: row.transmission_id,
      provider: row.provider,
      title: row.title,
      publishedAt: new Date(publishedAt).getTime(),
      platformPostUrl: row.platform_post_url ?? undefined,
      views: number(row.views),
      likes: number(row.likes),
      comments: number(row.comments),
      shares: number(row.shares),
      reach: metric(raw, "reach"),
      saves: metric(raw, "saves"),
      replies: metric(raw, "replies"),
      reposts: metric(raw, "reposts"),
      quotes: metric(raw, "quotes"),
      clicks: metric(raw, "clicks"),
      replays: metric(raw, "replays"),
      watchMinutes: optionalNumber(row.estimated_minutes_watched) ?? (watchTimeSeconds === undefined ? undefined : watchTimeSeconds / 60),
      averageWatchSeconds: optionalNumber(row.average_view_duration_seconds) ?? metric(raw, "averageWatchSeconds"),
      skipRate: metric(raw, "skipRate"),
      durationSeconds: metric(raw, "durationSeconds"),
    };
    const target = isCurrent ? postsByProvider : previousPostsByProvider;
    const posts = target.get(row.provider) ?? [];
    posts.push(post);
    target.set(row.provider, posts);
  }

  const platforms = ANALYTICS_PROVIDERS.map((provider) => {
    const providerAccounts = accountsByProvider.get(provider) ?? [];
    const account = combineAccounts(providerAccounts);
    const accountRaw = rawObject(account?.account_raw_metrics);
    const missingScopes = REQUIRED_SCOPES[provider].filter((scope) =>
      providerAccounts.some((item) => !(item.scopes ?? []).includes(scope)),
    );
    const dailyRows = combineDaily(providerAccounts.flatMap((item) => dailyByAccount.get(item.id) ?? []));
    const daily = dailyRows
      .filter((row) => isTotal || metricDate(row) >= cutoffDate)
      .map(publicDailyPoint);
    const previousDaily = dailyRows
      .filter((row) => !isTotal && metricDate(row) >= previousCutoffDate && metricDate(row) < cutoffDate)
      .map(publicDailyPoint);
    const posts = (postsByProvider.get(provider) ?? []).sort((left, right) => right.views - left.views);
    const previousPosts = (previousPostsByProvider.get(provider) ?? []).sort(
      (left, right) => right.views - left.views,
    );
    const connected = account?.status === "connected";
    const period = summarizePeriod({
      daily,
      posts,
      audience: optionalNumber(account?.audience),
      publishedPosts: liveCountByProvider.get(provider) ?? 0,
    });
    const allPostTotals = summarizePeriod({
      daily: [],
      posts,
      audience: optionalNumber(account?.audience),
      publishedPosts: liveCountByProvider.get(provider) ?? 0,
    });
    const totalViews = optionalNumber(account?.total_views) ?? metric(
      accountRaw,
      "totalViews",
      "views",
    );
    const totalLikes = optionalNumber(account?.total_likes) ?? metric(
      accountRaw,
      "totalLikes",
      "likes",
    );
    const currentPeriod = isTotal
      ? {
          ...allPostTotals,
          audienceDelta: period.audienceDelta,
          views: totalViews ?? allPostTotals.views,
          likes: totalLikes ?? allPostTotals.likes,
          publishedPosts: optionalNumber(account?.published_videos) ?? allPostTotals.publishedPosts,
        }
      : period;
    const previousPeriod = summarizePeriod({
      daily: previousDaily,
      posts: previousPosts,
      audience: optionalNumber(account?.previous_audience),
      publishedPosts: previousLiveCountByProvider.get(provider) ?? 0,
    });
    const totalInteractions = isTotal
      ? metric(accountRaw, "totalInteractions", "pageEngagements") ??
        currentPeriod.likes + currentPeriod.comments + currentPeriod.shares
      : currentPeriod.likes + currentPeriod.comments + currentPeriod.shares;

    return {
      provider,
      connected,
      ready: connected && missingScopes.length === 0,
      missingScopes,
      handle: account?.handle ?? undefined,
      audienceLabel: "Followers",
      audience: currentPeriod.audience,
      audienceDelta: currentPeriod.audienceDelta,
      following: metric(accountRaw, "following"),
      totalLikes: optionalNumber(account?.total_likes),
      publishedVideos: optionalNumber(account?.published_videos),
      reach: currentPeriod.reach ?? metric(accountRaw, "reach"),
      saves: currentPeriod.saves,
      replies: currentPeriod.replies,
      reposts: currentPeriod.reposts,
      quotes: currentPeriod.quotes,
      clicks: currentPeriod.clicks ?? metric(accountRaw, "clicks"),
      replays: sumOptional(posts, "replays"),
      profileViews: metric(accountRaw, "profileViews"),
      accountsEngaged: metric(accountRaw, "accountsEngaged"),
      totalInteractions,
      averageWatchSeconds: weightedAverage(posts, "averageWatchSeconds"),
      skipRate: weightedAverage(posts, "skipRate"),
      pageViews: provider === "facebook" ? optionalNumber(account?.total_views) : undefined,
      postViews: provider === "facebook" ? currentPeriod.views : undefined,
      views: currentPeriod.views,
      likes: currentPeriod.likes,
      comments: currentPeriod.comments,
      shares: currentPeriod.shares,
      watchMinutes: currentPeriod.watchMinutes,
      publishedPosts: currentPeriod.publishedPosts,
      lastSyncedAt: account?.metrics_fetched_at ? new Date(account.metrics_fetched_at).getTime() : undefined,
      availableMetrics: PLATFORM_METRICS[provider],
      metricNotes: PLATFORM_NOTES[provider],
      daily,
      posts: posts.slice(0, 24),
      previousPeriod: isTotal ? undefined : previousPeriod,
    };
  });

  return { rangeDays, platforms };
}

const DAY_MS = 86_400_000;

/**
 * Every account on an analytics platform that is connected or sits in a
 * business, with its stats for a period and for the period before. The
 * Businesses tab adds these up per business, so one request covers every
 * campaign and every creator in it.
 */
export async function loadAccountAnalytics(postgres, workspaceId, rangeDays, now = Date.now()) {
  const isTotal = rangeDays === "total";
  const cutoffDate = isTotal ? null : new Date(now - (rangeDays - 1) * DAY_MS).toISOString().slice(0, 10);
  const previousCutoffDate = isTotal ? null : new Date(now - (rangeDays * 2 - 1) * DAY_MS).toISOString().slice(0, 10);
  const [accountsResult, dailyResult, postsResult, pointsResult, failedResult] = await Promise.all([
    postgres.query(
      `select a.id, a.provider, a.handle, a.display_name, a.avatar_url, a.status,
              m.audience, m.fetched_at as metrics_fetched_at, pm.audience as previous_audience
       from social_accounts a
       left join lateral (
         select audience, fetched_at from account_metric_snapshots
         where social_account_id = a.id order by fetched_at desc, id desc limit 1
       ) m on true
       left join lateral (
         select audience from account_metric_snapshots
         where social_account_id = a.id and $2::date is not null and fetched_at < $2::date
         order by fetched_at desc, id desc limit 1
       ) pm on true
       where a.workspace_id = $1 and a.provider = any($3::text[])
         and (a.status = 'connected' or exists (select 1 from business_accounts b where b.social_account_id = a.id))
       order by a.provider, a.created_at`,
      [workspaceId, cutoffDate, ANALYTICS_PROVIDERS],
    ),
    postgres.query(
      `select social_account_id, metric_date, views, likes, comments, shares, watch_minutes,
              audience_gained, audience_lost, raw_metrics
       from daily_metric_snapshots
       where workspace_id = $1 and ($2::date is null or metric_date >= $2::date)
       order by metric_date asc`,
      [workspaceId, previousCutoffDate],
    ),
    postgres.query(
      `select p.social_account_id, coalesce(p.published_at, t.scheduled_for, p.updated_at) as published_at,
              m.views, m.likes, m.comments, m.shares, m.estimated_minutes_watched, m.watch_time_seconds, m.raw_metrics
       from projections p
       join transmissions t on t.id = p.transmission_id
       left join lateral (
         select * from publication_metric_snapshots
         where projection_id = p.id order by fetched_at desc, id desc limit 1
       ) m on true
       where p.workspace_id = $1 and p.status = 'live' and p.social_account_id is not null`,
      [workspaceId],
    ),
    postgres.query(
      `select social_account_id,
              coalesce(sum(amount) filter (where $2::date is null or awarded_at >= $2::date), 0) as points,
              coalesce(sum(amount) filter (where $3::date is not null and awarded_at >= $3::date and awarded_at < $2::date), 0) as previous_points
       from points_ledger
       where workspace_id = $1 and social_account_id is not null
       group by social_account_id`,
      [workspaceId, cutoffDate, previousCutoffDate],
    ),
    postgres.query(
      `select social_account_id, count(*)::int as failed
       from projections
       where workspace_id = $1 and status in ('failed', 'needs_reauth', 'blocked')
         and ($2::date is null or updated_at >= $2::date)
       group by social_account_id`,
      [workspaceId, cutoffDate],
    ),
  ]);

  const group = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const list = map.get(row.social_account_id) ?? [];
      list.push(row);
      map.set(row.social_account_id, list);
    }
    return map;
  };
  const dailyByAccount = group(dailyResult.rows);
  const postsByAccount = group(postsResult.rows);
  const pointsByAccount = new Map(pointsResult.rows.map((row) => [row.social_account_id, row]));
  const failedByAccount = new Map(failedResult.rows.map((row) => [row.social_account_id, row.failed]));
  const inCurrent = (date) => isTotal || date >= cutoffDate;
  const inPrevious = (date) => !isTotal && date >= previousCutoffDate && date < cutoffDate;
  const postOf = (row) => {
    const raw = rawObject(row.raw_metrics);
    const watchTimeSeconds = optionalNumber(row.watch_time_seconds) ?? metric(raw, "watchTimeSeconds");
    return {
      views: number(row.views),
      likes: number(row.likes),
      comments: number(row.comments),
      shares: number(row.shares),
      saves: metric(raw, "saves"),
      watchMinutes: optionalNumber(row.estimated_minutes_watched) ?? (watchTimeSeconds === undefined ? undefined : watchTimeSeconds / 60),
    };
  };

  const accounts = accountsResult.rows.map((account) => {
    const daily = (dailyByAccount.get(account.id) ?? []).map(publicDailyPoint);
    const allPosts = postsByAccount.get(account.id) ?? [];
    const dated = allPosts.map((row) => ({ row, date: new Date(row.published_at).toISOString().slice(0, 10) }));
    const currentPosts = dated.filter(({ date }) => inCurrent(date));
    const previousPosts = dated.filter(({ date }) => inPrevious(date));
    const current = summarizePeriod({
      daily: daily.filter((point) => inCurrent(point.date)),
      posts: currentPosts.filter(({ row }) => row.views !== null).map(({ row }) => postOf(row)),
      audience: optionalNumber(account.audience),
      publishedPosts: currentPosts.length,
    });
    const previous = isTotal ? undefined : summarizePeriod({
      daily: daily.filter((point) => inPrevious(point.date)),
      posts: previousPosts.filter(({ row }) => row.views !== null).map(({ row }) => postOf(row)),
      audience: optionalNumber(account.previous_audience),
      publishedPosts: previousPosts.length,
    });
    const interactions = current.likes + current.comments + current.shares;
    const points = pointsByAccount.get(account.id);
    const lastPost = allPosts.reduce((latest, row) => Math.max(latest, new Date(row.published_at).getTime()), 0);
    return {
      accountId: account.id,
      provider: account.provider,
      handle: account.handle,
      displayName: account.display_name ?? undefined,
      avatarUrl: account.avatar_url ?? undefined,
      status: account.status,
      audience: current.audience,
      audienceDelta: current.audienceDelta,
      views: current.views,
      likes: current.likes,
      comments: current.comments,
      shares: current.shares,
      saves: current.saves,
      watchMinutes: current.watchMinutes,
      interactions,
      engagementRate: current.views > 0 ? interactions / current.views : undefined,
      publishedPosts: current.publishedPosts,
      lastPostAt: lastPost || undefined,
      points: Math.round(Number(points?.points ?? 0) * 100) / 100,
      failedPosts: failedByAccount.get(account.id) ?? 0,
      daily: daily.filter((point) => inCurrent(point.date)).map((point) => ({ date: point.date, views: point.views })),
      previous: previous && {
        views: previous.views,
        interactions: previous.likes + previous.comments + previous.shares,
        audienceDelta: previous.audienceDelta,
        publishedPosts: previous.publishedPosts,
        points: Math.round(Number(points?.previous_points ?? 0) * 100) / 100,
      },
      lastSyncedAt: account.metrics_fetched_at ? new Date(account.metrics_fetched_at).getTime() : undefined,
    };
  });
  return { rangeDays, accounts };
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const shiftDay = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Views and points for the period on the calendar (a month or a week, as
 * local dates from/to inclusive) and for the same number of days before it,
 * plus the posting streak. Points count from the moment they were earned in
 * the user's time zone; views by the day Posterract recorded them.
 * `accountIds` narrows it to a business or picked accounts; streak bonuses
 * belong to no account, so they only count in the overall view.
 */
export async function loadPeriodStats(postgres, workspaceId, { from, to, timeZone, accountIds = null }, now = Date.now()) {
  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  const previousFrom = shiftDay(from, -span);
  const previousTo = shiftDay(from, -1);
  const [viewsResult, pointsResult, streak] = await Promise.all([
    postgres.query(
      `select metric_date::text as date, sum(views)::bigint as views
       from daily_metric_snapshots
       where workspace_id = $1 and metric_date between $2::date and $3::date
         and ($4::uuid[] is null or social_account_id = any($4::uuid[]))
       group by metric_date order by metric_date`,
      [workspaceId, previousFrom, to, accountIds],
    ),
    postgres.query(
      `select
         coalesce(sum(amount) filter (where awarded_at >= ($2::date::timestamp at time zone $5)
                                       and awarded_at < (($3::date + 1)::timestamp at time zone $5)), 0) as points,
         coalesce(sum(amount) filter (where awarded_at >= ($4::date::timestamp at time zone $5)
                                       and awarded_at < ($2::date::timestamp at time zone $5)), 0) as previous_points
       from points_ledger
       where workspace_id = $1 and ($6::uuid[] is null or social_account_id = any($6::uuid[]))`,
      [workspaceId, from, to, previousFrom, timeZone, accountIds],
    ),
    loadStreakSummary(postgres, workspaceId, now),
  ]);
  const dailyViews = viewsResult.rows.map((row) => ({ date: String(row.date).slice(0, 10), views: Number(row.views) }));
  const sum = (low, high) => dailyViews.filter((row) => row.date >= low && row.date <= high).reduce((total, row) => total + row.views, 0);
  const round = (value) => Math.round(Number(value ?? 0) * 100) / 100;
  return {
    from,
    to,
    timeZone,
    views: sum(from, to),
    previousViews: sum(previousFrom, previousTo),
    dailyViews: dailyViews.filter((row) => row.date >= from),
    points: round(pointsResult.rows[0]?.points),
    previousPoints: round(pointsResult.rows[0]?.previous_points),
    streak,
  };
}

/** Checks `from`/`to` (YYYY-MM-DD, from ≤ to, at most 400 days apart), or returns an error code. */
export function periodProblem(from, to) {
  if (!isoDay.test(from ?? "") || !isoDay.test(to ?? "")) return "invalid_period";
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
  if (!Number.isFinite(span) || span < 0 || span > 400) return "invalid_period";
  return undefined;
}
