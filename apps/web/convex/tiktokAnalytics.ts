import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  tiktokGetUserStats,
  tiktokGetVideoStats,
  tiktokRefreshToken,
} from "./connectors/tiktok";

declare const process: { env: Record<string, string | undefined> };

const REQUIRED = ["user.info.stats", "video.list"];

export const refreshRecent = internalAction({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.runQuery(internal.analytics.listRefreshablePortals, {
      provider: "tiktok",
    });
    for (const { portal, token, projections } of rows) {
      const scopes = new Set(token.scopes ?? portal.scopes ?? []);
      if (!REQUIRED.every((scope) => scopes.has(scope))) continue;
      try {
        let accessToken = token.accessToken;
        if ((token.expiresAt ?? 0) < Date.now() + 120_000) {
          if (!token.refreshToken) throw new Error("TikTok refresh token missing");
          const clientKey = process.env.TIKTOK_CLIENT_KEY;
          const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
          if (!clientKey || !clientSecret) throw new Error("TikTok is not configured");
          const refreshed = await tiktokRefreshToken({
            clientKey,
            clientSecret,
            refreshToken: token.refreshToken,
          });
          accessToken = refreshed.accessToken;
          await ctx.runMutation(internal.oauth.applyRefreshedToken, {
            tokenId: token._id,
            accessToken: refreshed.accessToken,
            expiresAt: refreshed.expiresAt,
            refreshToken: refreshed.refreshToken,
            refreshExpiresAt: refreshed.refreshExpiresAt,
          });
        }

        const account = await tiktokGetUserStats(accessToken);
        const projectionByPostId = new Map(
          projections.flatMap((projection) =>
            projection.platformPostId ? [[projection.platformPostId, projection] as const] : [],
          ),
        );
        const postIds = [...projectionByPostId.keys()];
        const videos = [];
        for (let index = 0; index < postIds.length; index += 20) {
          videos.push(...await tiktokGetVideoStats(accessToken, postIds.slice(index, index + 20)));
        }
        await ctx.runMutation(internal.analytics.applyTikTokRefresh, {
          portalId: portal._id,
          audience: account.followers,
          totalLikes: account.totalLikes,
          publishedVideos: account.videos,
          videos: videos.flatMap((video) => {
            const projection = projectionByPostId.get(video.id);
            return projection
              ? [{ projectionId: projection._id, ...video }]
              : [];
          }),
        });
      } catch (error) {
        await ctx.runMutation(internal.publishHelpers.emit, {
          workspaceId: portal.workspaceId,
          type: "analytics.refresh_failed",
          message: `TikTok analytics refresh failed — ${error instanceof Error ? error.message : "unknown error"}`,
        });
      }
    }
  },
});
