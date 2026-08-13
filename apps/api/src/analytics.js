const ANALYTICS_PROVIDERS = [
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
  "threads",
];

const REQUIRED_SCOPES = {
  instagram: ["instagram_business_basic", "instagram_business_manage_insights"],
  youtube: [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ],
  tiktok: ["user.info.stats", "video.list"],
  facebook: ["pages_read_engagement", "read_insights"],
  threads: ["threads_basic", "threads_manage_insights"],
};

const number = (value) => Number(value ?? 0);
const optionalNumber = (value) =>
  value === null || value === undefined ? undefined : Number(value);

export async function loadAnalyticsDashboard(postgres, workspaceId, rangeDays) {
  const cutoff = new Date(Date.now() - (rangeDays - 1) * 86_400_000);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const [accountsResult, dailyResult, postsResult] = await Promise.all([
    postgres.query(
      `select a.*,
              m.audience, m.total_views, m.total_likes, m.published_videos,
              m.fetched_at as metrics_fetched_at
       from social_accounts a
       left join lateral (
         select * from account_metric_snapshots
         where social_account_id = a.id
         order by fetched_at desc, id desc
         limit 1
       ) m on true
       where a.workspace_id = $1`,
      [workspaceId],
    ),
    postgres.query(
      `select social_account_id, provider, metric_date, views, likes, comments,
              shares, watch_minutes, audience_gained, audience_lost
       from daily_metric_snapshots
       where workspace_id = $1 and metric_date >= $2::date
       order by metric_date asc`,
      [workspaceId, cutoffDate],
    ),
    postgres.query(
      `select p.id as projection_id, p.transmission_id, p.provider,
              p.platform_post_url, p.updated_at, p.published_at,
              t.title, t.scheduled_for,
              m.views, m.likes, m.comments, m.shares,
              m.estimated_minutes_watched
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
  const liveCountByProvider = new Map();
  for (const row of postsResult.rows) {
    const publishedAt = row.published_at ?? row.scheduled_for ?? row.updated_at;
    if (new Date(publishedAt).getTime() >= cutoff.getTime()) {
      liveCountByProvider.set(
        row.provider,
        (liveCountByProvider.get(row.provider) ?? 0) + 1,
      );
    }
    if (row.views === null || new Date(publishedAt).getTime() < cutoff.getTime()) {
      continue;
    }
    const posts = postsByProvider.get(row.provider) ?? [];
    posts.push({
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
      watchMinutes: optionalNumber(row.estimated_minutes_watched),
    });
    postsByProvider.set(row.provider, posts);
  }

  const platforms = ANALYTICS_PROVIDERS.map((provider) => {
    const account = accountByProvider.get(provider);
    const scopes = new Set(account?.scopes ?? []);
    const missingScopes = REQUIRED_SCOPES[provider].filter(
      (scope) => !scopes.has(scope),
    );
    const dailyRows = account ? dailyByAccount.get(account.id) ?? [] : [];
    const daily = dailyRows.map((row) => ({
      date:
        typeof row.metric_date === "string"
          ? row.metric_date.slice(0, 10)
          : new Date(row.metric_date).toISOString().slice(0, 10),
      views: number(row.views),
      likes: number(row.likes),
      comments: number(row.comments),
      shares: number(row.shares),
      watchMinutes: optionalNumber(row.watch_minutes),
      audienceGained: number(row.audience_gained),
      audienceLost: number(row.audience_lost),
    }));
    const posts = (postsByProvider.get(provider) ?? []).sort(
      (left, right) => right.views - left.views,
    );
    const dailyTotals = daily.reduce(
      (total, row) => ({
        views: total.views + row.views,
        likes: total.likes + row.likes,
        comments: total.comments + row.comments,
        shares: total.shares + row.shares,
        watchMinutes: total.watchMinutes + (row.watchMinutes ?? 0),
        audienceDelta:
          total.audienceDelta + row.audienceGained - row.audienceLost,
      }),
      {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        watchMinutes: 0,
        audienceDelta: 0,
      },
    );
    const postTotals = posts.reduce(
      (total, row) => ({
        views: total.views + row.views,
        likes: total.likes + row.likes,
        comments: total.comments + row.comments,
        shares: total.shares + row.shares,
      }),
      { views: 0, likes: 0, comments: 0, shares: 0 },
    );
    const hasObservedDailyEngagement =
      dailyTotals.views +
        dailyTotals.likes +
        dailyTotals.comments +
        dailyTotals.shares >
      0;
    const useDaily = provider === "youtube" ? daily.length > 0 : hasObservedDailyEngagement;
    const connected = account?.status === "connected";
    return {
      provider,
      connected,
      ready: connected && missingScopes.length === 0,
      missingScopes,
      handle: account?.handle ?? undefined,
      audienceLabel: provider === "youtube" ? "Subscribers" : "Followers",
      audience: optionalNumber(account?.audience),
      audienceDelta: dailyTotals.audienceDelta,
      pageViews:
        provider === "facebook"
          ? optionalNumber(account?.total_views)
          : undefined,
      postViews: provider === "facebook" ? postTotals.views : undefined,
      views: useDaily ? dailyTotals.views : postTotals.views,
      likes: useDaily ? dailyTotals.likes : postTotals.likes,
      comments: useDaily ? dailyTotals.comments : postTotals.comments,
      shares: useDaily ? dailyTotals.shares : postTotals.shares,
      watchMinutes: provider === "youtube" ? dailyTotals.watchMinutes : undefined,
      publishedPosts: liveCountByProvider.get(provider) ?? 0,
      lastSyncedAt: account?.metrics_fetched_at
        ? new Date(account.metrics_fetched_at).getTime()
        : undefined,
      daily,
      posts: posts.slice(0, 12),
    };
  });

  return { rangeDays, platforms };
}
