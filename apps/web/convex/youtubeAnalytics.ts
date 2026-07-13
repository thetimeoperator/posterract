import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  youtubeChannelAnalyticsReport,
  youtubeGetMyChannel,
  youtubeGetVideos,
  youtubeRefreshToken,
} from "./connectors/youtube";

declare const process: { env: Record<string, string | undefined> };

const REQUIRED = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];
const dateOf = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

/** Refresh account totals, 90-day history, and Posterract-published videos. */
export const refreshRecent = internalAction({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.runQuery(internal.analytics.listRefreshablePortals, {
      provider: "youtube",
    });
    const startDate = dateOf(Date.now() - 89 * 86400_000);
    const endDate = dateOf(Date.now());

    for (const { portal, token, projections } of rows) {
      const scopes = new Set(token.scopes ?? portal.scopes ?? []);
      if (!REQUIRED.every((scope) => scopes.has(scope))) continue;
      try {
        let accessToken = token.accessToken;
        if ((token.expiresAt ?? 0) < Date.now() + 120_000) {
          if (!token.refreshToken) throw new Error("YouTube refresh token missing");
          const clientId = process.env.YOUTUBE_CLIENT_ID;
          const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
          if (!clientId || !clientSecret) throw new Error("YouTube is not configured");
          const refreshed = await youtubeRefreshToken({
            clientId,
            clientSecret,
            refreshToken: token.refreshToken,
          });
          accessToken = refreshed.accessToken;
          await ctx.runMutation(internal.oauth.applyRefreshedToken, {
            tokenId: token._id,
            accessToken: refreshed.accessToken,
            expiresAt: refreshed.expiresAt,
          });
        }

        const [channel, history] = await Promise.all([
          youtubeGetMyChannel(accessToken),
          youtubeChannelAnalyticsReport({ accessToken, startDate, endDate }),
        ]);
        await ctx.runMutation(internal.analytics.applyYouTubeAccountRefresh, {
          portalId: portal._id,
          audience: channel.statistics.subscribers,
          totalViews: channel.statistics.views,
          publishedVideos: channel.statistics.videos,
          daily: history.map((row) => ({
            date: row.date,
            views: row.views,
            likes: row.likes,
            comments: row.comments,
            shares: row.shares,
            watchMinutes: row.estimatedMinutesWatched,
            audienceGained: row.subscribersGained,
            audienceLost: row.subscribersLost,
          })),
        });

        const projectionByPostId = new Map(
          projections.flatMap((projection) =>
            projection.platformPostId ? [[projection.platformPostId, projection] as const] : [],
          ),
        );
        const postIds = [...projectionByPostId.keys()];
        for (let index = 0; index < postIds.length; index += 50) {
          const videos = await youtubeGetVideos(accessToken, postIds.slice(index, index + 50));
          for (const video of videos) {
            const projection = projectionByPostId.get(video.id);
            if (!projection) continue;
            await ctx.runMutation(internal.analytics.applyYouTubePostRefresh, {
              projectionId: projection._id,
              views: Number(video.statistics?.viewCount ?? 0),
              likes: Number(video.statistics?.likeCount ?? 0),
              comments: Number(video.statistics?.commentCount ?? 0),
              shares: 0,
            });
          }
        }
      } catch (error) {
        await ctx.runMutation(internal.publishHelpers.emit, {
          workspaceId: portal.workspaceId,
          type: "analytics.refresh_failed",
          message: `YouTube analytics refresh failed — ${error instanceof Error ? error.message : "unknown error"}`,
        });
      }
    }
  },
});
