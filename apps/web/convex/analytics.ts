import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { getOwnedWorkspace } from "./lib";
import { vPlatform } from "./schema";

const vRangeDays = v.union(v.literal(7), v.literal(30), v.literal(90));
const ANALYTICS_PROVIDERS = ["youtube", "tiktok"] as const;

const REQUIRED_SCOPES = {
  youtube: [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ],
  tiktok: ["user.info.stats", "video.list"],
} as const;

const dateOf = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

/** Server-only credentials and projections, grouped once per connected account. */
export const listRefreshablePortals = internalQuery({
  args: { provider: vPlatform },
  handler: async (ctx, args) => {
    if (args.provider !== "youtube" && args.provider !== "tiktok") return [];
    const portals = await ctx.db.query("portals").collect();
    const selected = portals.filter(
      (portal) => portal.provider === args.provider && portal.status === "connected",
    );
    const result = [];
    for (const portal of selected) {
      const token = await ctx.db
        .query("portalTokens")
        .withIndex("by_portal", (q) => q.eq("portalId", portal._id))
        .first();
      if (!token) continue;
      const projections = await ctx.db
        .query("projections")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", portal.workspaceId))
        .filter((q) =>
          q.and(
            q.eq(q.field("provider"), args.provider),
            q.eq(q.field("portalId"), portal._id),
            q.eq(q.field("status"), "live"),
            q.gte(q.field("updatedAt"), Date.now() - 90 * 86400_000),
          ),
        )
        .collect();
      result.push({ portal, token, projections });
    }
    return result;
  },
});

const vDailyMetric = v.object({
  date: v.string(),
  views: v.number(),
  likes: v.number(),
  comments: v.number(),
  shares: v.number(),
  watchMinutes: v.optional(v.number()),
  audienceGained: v.number(),
  audienceLost: v.number(),
});

/** YouTube returns authoritative daily history, so rows replace by date. */
export const applyYouTubeAccountRefresh = internalMutation({
  args: {
    portalId: v.id("portals"),
    audience: v.optional(v.number()),
    totalViews: v.number(),
    publishedVideos: v.number(),
    daily: v.array(vDailyMetric),
  },
  handler: async (ctx, args) => {
    const portal = await ctx.db.get(args.portalId);
    if (!portal || portal.provider !== "youtube" || portal.status !== "connected") return;
    const fetchedAt = Date.now();
    const existingAccount = await ctx.db
      .query("accountMetricSnapshots")
      .withIndex("by_portal", (q) => q.eq("portalId", portal._id))
      .first();
    const account = {
      portalId: portal._id,
      workspaceId: portal.workspaceId,
      provider: "youtube" as const,
      audience: args.audience,
      totalViews: args.totalViews,
      publishedVideos: args.publishedVideos,
      fetchedAt,
    };
    if (existingAccount) await ctx.db.patch(existingAccount._id, account);
    else await ctx.db.insert("accountMetricSnapshots", account);

    for (const row of args.daily) {
      const existing = await ctx.db
        .query("dailyMetricSnapshots")
        .withIndex("by_portal_date", (q) => q.eq("portalId", portal._id).eq("date", row.date))
        .first();
      const snapshot = {
        portalId: portal._id,
        workspaceId: portal.workspaceId,
        provider: "youtube" as const,
        ...row,
        fetchedAt,
      };
      if (existing) await ctx.db.patch(existing._id, snapshot);
      else await ctx.db.insert("dailyMetricSnapshots", snapshot);
    }
  },
});

const vTikTokVideoMetric = v.object({
  projectionId: v.id("projections"),
  views: v.number(),
  likes: v.number(),
  comments: v.number(),
  shares: v.number(),
});

/** Latest YouTube totals for each Posterract-published video. Analytics stays
 * independent from Resonance so this feature does not alter the points UI. */
export const applyYouTubePostRefresh = internalMutation({
  args: {
    projectionId: v.id("projections"),
    views: v.number(),
    likes: v.number(),
    comments: v.number(),
    shares: v.number(),
  },
  handler: async (ctx, args) => {
    const projection = await ctx.db.get(args.projectionId);
    if (!projection || projection.provider !== "youtube") return;
    if (!projection.portalId) return;
    const portal = await ctx.db.get(projection.portalId);
    if (!portal || portal.provider !== "youtube" || portal.status !== "connected") return;
    const previous = await ctx.db
      .query("metricSnapshots")
      .withIndex("by_projection", (q) => q.eq("projectionId", args.projectionId))
      .first();
    const snapshot = {
      projectionId: args.projectionId,
      workspaceId: projection.workspaceId,
      provider: "youtube" as const,
      views: args.views,
      likes: args.likes,
      comments: args.comments,
      shares: args.shares,
      fetchedAt: Date.now(),
    };
    if (previous) await ctx.db.patch(previous._id, snapshot);
    else await ctx.db.insert("metricSnapshots", snapshot);
  },
});

/** TikTok exposes cumulative counters. Convert only newly observed changes
 * into today's range row while keeping the latest per-post totals. */
export const applyTikTokRefresh = internalMutation({
  args: {
    portalId: v.id("portals"),
    audience: v.number(),
    totalLikes: v.number(),
    publishedVideos: v.number(),
    videos: v.array(vTikTokVideoMetric),
  },
  handler: async (ctx, args) => {
    const portal = await ctx.db.get(args.portalId);
    if (!portal || portal.provider !== "tiktok") return;
    const fetchedAt = Date.now();
    const existingAccount = await ctx.db
      .query("accountMetricSnapshots")
      .withIndex("by_portal", (q) => q.eq("portalId", portal._id))
      .first();
    const audienceDelta = existingAccount?.audience === undefined
      ? 0
      : args.audience - existingAccount.audience;
    const account = {
      portalId: portal._id,
      workspaceId: portal.workspaceId,
      provider: "tiktok" as const,
      audience: args.audience,
      totalLikes: args.totalLikes,
      publishedVideos: args.publishedVideos,
      fetchedAt,
    };
    if (existingAccount) await ctx.db.patch(existingAccount._id, account);
    else await ctx.db.insert("accountMetricSnapshots", account);

    let views = 0;
    let likes = 0;
    let comments = 0;
    let shares = 0;
    for (const video of args.videos) {
      const projection = await ctx.db.get(video.projectionId);
      if (!projection || projection.provider !== "tiktok" || projection.portalId !== portal._id) continue;
      const previous = await ctx.db
        .query("metricSnapshots")
        .withIndex("by_projection", (q) => q.eq("projectionId", video.projectionId))
        .first();
      views += Math.max(0, video.views - (previous?.views ?? video.views));
      likes += Math.max(0, video.likes - (previous?.likes ?? video.likes));
      comments += Math.max(0, video.comments - (previous?.comments ?? video.comments));
      shares += Math.max(0, video.shares - (previous?.shares ?? video.shares));
      const snapshot = {
        projectionId: video.projectionId,
        workspaceId: projection.workspaceId,
        provider: "tiktok" as const,
        views: video.views,
        likes: video.likes,
        comments: video.comments,
        shares: video.shares,
        fetchedAt,
      };
      if (previous) await ctx.db.patch(previous._id, snapshot);
      else await ctx.db.insert("metricSnapshots", snapshot);
    }

    const date = dateOf(fetchedAt);
    const existingDaily = await ctx.db
      .query("dailyMetricSnapshots")
      .withIndex("by_portal_date", (q) => q.eq("portalId", portal._id).eq("date", date))
      .first();
    const daily = {
      portalId: portal._id,
      workspaceId: portal.workspaceId,
      provider: "tiktok" as const,
      date,
      views: (existingDaily?.views ?? 0) + views,
      likes: (existingDaily?.likes ?? 0) + likes,
      comments: (existingDaily?.comments ?? 0) + comments,
      shares: (existingDaily?.shares ?? 0) + shares,
      audienceGained: (existingDaily?.audienceGained ?? 0) + Math.max(0, audienceDelta),
      audienceLost: (existingDaily?.audienceLost ?? 0) + Math.max(0, -audienceDelta),
      fetchedAt,
    };
    if (existingDaily) await ctx.db.patch(existingDaily._id, daily);
    else await ctx.db.insert("dailyMetricSnapshots", daily);
  },
});

/** One normalized read model powers the YouTube, TikTok, and All filters. */
export const dashboard = query({
  args: { rangeDays: vRangeDays },
  handler: async (ctx, args) => {
    const workspace = await getOwnedWorkspace(ctx);
    if (!workspace) return { rangeDays: args.rangeDays, platforms: [] };
    const cutoffTime = Date.now() - (args.rangeDays - 1) * 86400_000;
    const cutoffDate = dateOf(cutoffTime);
    const portals = await ctx.db
      .query("portals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const transmissions = await ctx.db
      .query("transmissions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const transmissionMap = new Map(transmissions.map((row) => [row._id, row]));

    const platforms = [];
    for (const provider of ANALYTICS_PROVIDERS) {
      const portal = portals.find((row) => row.provider === provider);
      const scopes = new Set(portal?.scopes ?? []);
      const missingScopes = REQUIRED_SCOPES[provider].filter((scope) => !scopes.has(scope));
      const account = portal
        ? await ctx.db
            .query("accountMetricSnapshots")
            .withIndex("by_portal", (q) => q.eq("portalId", portal._id))
            .first()
        : null;
      const daily = portal
        ? await ctx.db
            .query("dailyMetricSnapshots")
            .withIndex("by_portal_date", (q) => q.eq("portalId", portal._id).gte("date", cutoffDate))
            .collect()
        : [];
      const metrics = await ctx.db
        .query("metricSnapshots")
        .withIndex("by_workspace_provider", (q) =>
          q.eq("workspaceId", workspace._id).eq("provider", provider),
        )
        .collect();
      const metricMap = new Map(metrics.map((row) => [row.projectionId, row]));
      const providerProjections = projections.filter(
        (projection) => projection.provider === provider && projection.status === "live",
      );
      const posts = providerProjections
        .flatMap((projection) => {
          const metric = metricMap.get(projection._id);
          const transmission = transmissionMap.get(projection.transmissionId);
          if (!metric || !transmission) return [];
          const publishedAt = transmission.scheduledFor ?? projection.updatedAt;
          if (publishedAt < cutoffTime) return [];
          return [{
            projectionId: projection._id,
            transmissionId: projection.transmissionId,
            provider,
            title: transmission.title,
            publishedAt,
            platformPostUrl: projection.platformPostUrl,
            views: metric.views,
            likes: metric.likes,
            comments: metric.comments,
            shares: metric.shares ?? 0,
            watchMinutes: metric.estimatedMinutesWatched,
          }];
        })
        .sort((a, b) => b.views - a.views);
      const dailyTotals = daily.reduce(
        (total, row) => ({
          views: total.views + row.views,
          likes: total.likes + row.likes,
          comments: total.comments + row.comments,
          shares: total.shares + row.shares,
          watchMinutes: total.watchMinutes + (row.watchMinutes ?? 0),
          audienceDelta: total.audienceDelta + row.audienceGained - row.audienceLost,
        }),
        { views: 0, likes: 0, comments: 0, shares: 0, watchMinutes: 0, audienceDelta: 0 },
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
      const hasObservedTikTokDeltas =
        dailyTotals.views + dailyTotals.likes + dailyTotals.comments + dailyTotals.shares > 0;
      const useDailyTotals = provider === "youtube" ? daily.length > 0 : hasObservedTikTokDeltas;
      platforms.push({
        provider,
        connected: portal?.status === "connected",
        ready: portal?.status === "connected" && missingScopes.length === 0,
        missingScopes,
        handle: portal?.handle,
        audienceLabel: provider === "youtube" ? "Subscribers" as const : "Followers" as const,
        audience: account?.audience,
        audienceDelta: dailyTotals.audienceDelta,
        views: useDailyTotals ? dailyTotals.views : postTotals.views,
        likes: useDailyTotals ? dailyTotals.likes : postTotals.likes,
        comments: useDailyTotals ? dailyTotals.comments : postTotals.comments,
        shares: useDailyTotals ? dailyTotals.shares : postTotals.shares,
        watchMinutes: provider === "youtube" ? dailyTotals.watchMinutes : undefined,
        publishedPosts: providerProjections.filter((row) => row.updatedAt >= cutoffTime).length,
        lastSyncedAt: account?.fetchedAt,
        daily: daily
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((row) => ({
            date: row.date,
            views: row.views,
            likes: row.likes,
            comments: row.comments,
            shares: row.shares,
            watchMinutes: row.watchMinutes,
            audienceGained: row.audienceGained,
            audienceLost: row.audienceLost,
          })),
        posts: posts.slice(0, 12),
      });
    }
    return { rangeDays: args.rangeDays, platforms };
  },
});
