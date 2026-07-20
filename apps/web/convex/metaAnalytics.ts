import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  instagramAccountSummary,
  instagramPostInsights,
} from "./connectors/instagram";
import { facebookPageSummary, facebookPostInsights } from "./connectors/facebook";
import { threadsAccountInsights, threadsPostInsights } from "./connectors/threads";

type Metric = {
  projectionId: Id<"projections">;
  views: number;
  likes: number;
  comments: number;
  shares: number;
};

/** Refresh all connected Meta accounts and recent Posterract-published posts. */
export const refreshRecent = internalAction({
  args: {},
  handler: async (ctx) => {
    for (const provider of ["instagram", "facebook", "threads"] as const) {
      const accounts = await ctx.runQuery(internal.analytics.listRefreshablePortals, { provider });
      for (const account of accounts) {
        try {
          const videos: Metric[] = [];
          for (const projection of account.projections) {
            if (!projection.platformPostId) continue;
            try {
              const metric =
                provider === "instagram"
                  ? await instagramPostInsights({
                      mediaId: projection.platformPostId,
                      accessToken: account.token.accessToken,
                    })
                  : provider === "facebook"
                    ? await facebookPostInsights({
                        videoId: projection.platformPostId,
                        pageAccessToken: account.token.accessToken,
                      })
                    : await threadsPostInsights({
                        mediaId: projection.platformPostId,
                        accessToken: account.token.accessToken,
                      });
              videos.push({ projectionId: projection._id, ...metric });
            } catch {
              // A deleted or newly processing post must not block account refresh.
            }
          }

          if (provider === "instagram") {
            const summary = await instagramAccountSummary({
              userId: account.token.providerUserId!,
              accessToken: account.token.accessToken,
            });
            await ctx.runMutation(internal.analytics.applyCumulativeRefresh, {
              portalId: account.portal._id,
              provider,
              ...(summary.audience === undefined ? {} : { audience: summary.audience }),
              ...(summary.publishedVideos === undefined
                ? {}
                : { publishedVideos: summary.publishedVideos }),
              videos,
            });
          } else if (provider === "facebook") {
            const summary = await facebookPageSummary({
              pageId: account.token.providerUserId!,
              pageAccessToken: account.token.accessToken,
            });
            await ctx.runMutation(internal.analytics.applyCumulativeRefresh, {
              portalId: account.portal._id,
              provider,
              ...(summary.audience === undefined ? {} : { audience: summary.audience }),
              videos,
            });
          } else {
            const summary = await threadsAccountInsights({
              accessToken: account.token.accessToken,
            });
            await ctx.runMutation(internal.analytics.applyCumulativeRefresh, {
              portalId: account.portal._id,
              provider,
              ...(summary.audience === undefined ? {} : { audience: summary.audience }),
              ...(summary.totalViews === undefined ? {} : { totalViews: summary.totalViews }),
              ...(summary.totalLikes === undefined ? {} : { totalLikes: summary.totalLikes }),
              videos,
            });
          }
        } catch {
          // One Meta account being unavailable must not block the other portals.
        }
      }
    }
  },
});
