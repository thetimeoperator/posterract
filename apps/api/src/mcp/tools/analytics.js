/**
 * Analytics for Instagram, Facebook and Threads: account totals for a
 * period and the best posts, trimmed to what an agent needs to answer
 * "how are my videos doing?".
 */

import { CONNECTOR_PLATFORMS, UUID } from "../context.js";

const round = (value, places = 0) => {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return undefined;
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
};

const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

function describePlatform(row) {
  const topPosts = [...(row.posts ?? [])]
    .sort((left, right) => (right.views ?? 0) - (left.views ?? 0))
    .slice(0, 5)
    .map((post) =>
      compact({
        title: post.title,
        published: post.publishedAt ? new Date(post.publishedAt).toISOString() : undefined,
        views: post.views,
        likes: post.likes,
        comments: post.comments,
        shares: post.shares,
        saves: post.saves,
        average_watch_seconds: round(post.averageWatchSeconds, 1),
        url: post.platformPostUrl,
      }),
    );
  return compact({
    platform: row.provider,
    account: row.handle,
    connected: row.connected,
    followers: row.audience,
    follower_change: row.audienceDelta,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
    watch_minutes: round(row.watchMinutes),
    average_watch_seconds: round(row.averageWatchSeconds, 1),
    posts_published: row.publishedPosts,
    last_updated: row.lastSyncedAt ? new Date(row.lastSyncedAt).toISOString() : undefined,
    top_posts: topPosts,
  });
}

export const getAnalytics = {
  name: "get_analytics",
  title: "Get analytics",
  description:
    "Shows how the user's Instagram, Facebook and Threads accounts are doing over a period: followers, views, likes, " +
    "comments, shares, saves, watch time and their best posts. Stats refresh twice a day.",
  scopes: ["analytics:read"],
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      period: { type: "string", enum: ["7", "30", "90", "total"], description: "Days to cover: 7, 30 or 90, or total. Defaults to 30." },
      platform: { type: "string", enum: CONNECTOR_PLATFORMS, description: "Only this platform." },
      business_id: { type: "string", pattern: UUID, description: "Only this business's accounts, from list_accounts." },
      account_ids: { type: "array", items: { type: "string", pattern: UUID }, minItems: 1, maxItems: 30, uniqueItems: true, description: "Only these accounts, e.g. one of two Instagram accounts." },
    },
    additionalProperties: false,
  },
  async run(context, args) {
    const period = args.period ?? "30";
    const query = new URLSearchParams({ rangeDays: period });
    if (args.business_id) query.set("business", args.business_id);
    if (args.account_ids) query.set("accounts", args.account_ids.join(","));
    const dashboard = await context.api("GET", `/v1/analytics?${query}`);
    const platforms = (dashboard.platforms ?? [])
      .filter((row) => CONNECTOR_PLATFORMS.includes(row.provider))
      .filter((row) => !args.platform || row.provider === args.platform)
      .filter((row) => row.connected);
    const sum = (field) => platforms.reduce((total, row) => total + (Number(row[field]) || 0), 0);
    return {
      period: period === "total" ? "all time" : `last ${period} days`,
      totals: { views: sum("views"), likes: sum("likes"), comments: sum("comments"), shares: sum("shares") },
      platforms: platforms.map(describePlatform),
      ...(platforms.length === 0 ? { note: "No Instagram, Facebook or Threads account with analytics is connected yet." } : {}),
    };
  },
};

export const ANALYTICS_TOOLS = [getAnalytics];
