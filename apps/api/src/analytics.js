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

export async function loadAnalyticsDashboard(postgres, workspaceId, rangeDays) {
  const cutoff = new Date(Date.now() - (rangeDays - 1) * 86_400_000);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const previousCutoff = new Date(Date.now() - (rangeDays * 2 - 1) * 86_400_000);
  const previousCutoffDate = previousCutoff.toISOString().slice(0, 10);
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
         where social_account_id = a.id and fetched_at < $2::date
         order by fetched_at desc, id desc
         limit 1
       ) pm on true
       where a.workspace_id = $1`,
      [workspaceId, cutoffDate],
    ),
    postgres.query(
      `select social_account_id, provider, metric_date, views, likes, comments,
              shares, watch_minutes, audience_gained, audience_lost, raw_metrics
       from daily_metric_snapshots
       where workspace_id = $1 and metric_date >= $2::date
       order by metric_date asc`,
      [workspaceId, previousCutoffDate],
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
       where p.workspace_id = $1 and p.status = 'live'`,
      [workspaceId],
    ),
  ]);

  const accountByProvider = new Map(
    accountsResult.rows.map((account) => [account.provider, account]),
  );
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
    const isCurrent = publishedDate >= cutoffDate;
    const isPrevious = publishedDate >= previousCutoffDate && publishedDate < cutoffDate;
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
    const account = accountByProvider.get(provider);
    const accountRaw = rawObject(account?.account_raw_metrics);
    const scopes = new Set(account?.scopes ?? []);
    const missingScopes = REQUIRED_SCOPES[provider].filter((scope) => !scopes.has(scope));
    const dailyRows = account ? dailyByAccount.get(account.id) ?? [] : [];
    const daily = dailyRows
      .filter((row) => metricDate(row) >= cutoffDate)
      .map(publicDailyPoint);
    const previousDaily = dailyRows
      .filter((row) => metricDate(row) >= previousCutoffDate && metricDate(row) < cutoffDate)
      .map(publicDailyPoint);
    const posts = (postsByProvider.get(provider) ?? []).sort((left, right) => right.views - left.views);
    const previousPosts = (previousPostsByProvider.get(provider) ?? []).sort(
      (left, right) => right.views - left.views,
    );
    const connected = account?.status === "connected";
    const currentPeriod = summarizePeriod({
      daily,
      posts,
      audience: optionalNumber(account?.audience),
      publishedPosts: liveCountByProvider.get(provider) ?? 0,
    });
    const previousPeriod = summarizePeriod({
      daily: previousDaily,
      posts: previousPosts,
      audience: optionalNumber(account?.previous_audience),
      publishedPosts: previousLiveCountByProvider.get(provider) ?? 0,
    });
    const totalInteractions =
      currentPeriod.likes + currentPeriod.comments + currentPeriod.shares;

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
      previousPeriod,
    };
  });

  return { rangeDays, platforms };
}
