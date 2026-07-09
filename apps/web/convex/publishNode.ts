"use node";
/**
 * Node-runtime publish actions. Connectors that push raw video bytes
 * (TikTok FILE_UPLOAD, YouTube resumable upload) buffer the file in memory —
 * the default Convex runtime caps actions at 64 MB, which a ~20 MB video
 * already blows past. Node actions get 512 MB.
 */
import { v } from "convex/values";
import type { FunctionArgs } from "convex/server";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { tiktokPublishVideo, tiktokRefreshToken } from "./connectors/tiktok";

// Node runtime provides process.env; declare for app-side typechecking.
declare const process: { env: Record<string, string | undefined> };

export const tiktokPublish = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    transmissionId: v.id("transmissions"),
    projectionId: v.id("projections"),
    attempt: v.number(),
    token: v.optional(
      v.object({
        tokenId: v.id("portalTokens"),
        accessToken: v.string(),
        refreshToken: v.optional(v.string()),
        expiresAt: v.optional(v.number()),
        refreshExpiresAt: v.optional(v.number()),
        providerUserId: v.optional(v.string()),
      }),
    ),
    videoUrl: v.union(v.string(), v.null()),
    caption: v.string(),
    mimeType: v.optional(v.string()),
    pendingContainerId: v.optional(v.string()),
  },
  handler: async (ctx, job) => {
    const patch = (p: FunctionArgs<typeof internal.publishHelpers.patchProjection>) =>
      ctx.runMutation(internal.publishHelpers.patchProjection, p);
    const emit = (type: string, message: string) =>
      ctx.runMutation(internal.publishHelpers.emit, {
        workspaceId: job.workspaceId,
        transmissionId: job.transmissionId,
        projectionId: job.projectionId,
        type,
        message,
      });
    const refreshStatus = () =>
      ctx.runMutation(internal.publishHelpers.refreshStatus, { transmissionId: job.transmissionId });

    if (!job.token) {
      await patch({
        projectionId: job.projectionId,
        status: "needs_reauth",
        errorCategory: "auth",
        errorSummary: "TikTok token missing — reconnect the account",
      });
      await emit("projection.failed", "TikTok blocked — reconnect required");
      await refreshStatus();
      return;
    }
    if (!job.videoUrl) {
      await patch({
        projectionId: job.projectionId,
        status: "failed",
        errorCategory: "validation",
        errorSummary: "Video is not available to publish",
      });
      await emit("projection.failed", "TikTok blocked — video unavailable");
      await refreshStatus();
      return;
    }

    await patch({ projectionId: job.projectionId, status: "uploading", attemptCount: job.attempt });
    await refreshStatus();

    // Access tokens live 24h — refresh on demand when stale (rotates the refresh token).
    let accessToken = job.token.accessToken;
    if (job.token.refreshToken && (job.token.expiresAt ?? 0) < Date.now() + 120_000) {
      try {
        const refreshed = await tiktokRefreshToken({
          clientKey: process.env.TIKTOK_CLIENT_KEY!,
          clientSecret: process.env.TIKTOK_CLIENT_SECRET!,
          refreshToken: job.token.refreshToken,
        });
        accessToken = refreshed.accessToken;
        await ctx.runMutation(internal.oauth.applyRefreshedToken, {
          tokenId: job.token.tokenId,
          accessToken: refreshed.accessToken,
          expiresAt: refreshed.expiresAt,
          refreshToken: refreshed.refreshToken,
          refreshExpiresAt: refreshed.refreshExpiresAt,
        });
      } catch {
        await patch({
          projectionId: job.projectionId,
          status: "needs_reauth",
          errorCategory: "auth",
          errorSummary: "TikTok session expired — reconnect the account",
        });
        await emit("projection.failed", "TikTok blocked — reconnect required");
        await refreshStatus();
        return;
      }
    }

    try {
      const result = await tiktokPublishVideo({
        accessToken,
        videoUrl: job.videoUrl,
        caption: job.caption,
        mimeType: job.mimeType,
        resumePublishId: job.pendingContainerId,
        onPublishId: async (publishId) => {
          await patch({ projectionId: job.projectionId, pendingContainerId: publishId });
        },
        onProgress: async (stage, detail) => {
          await patch({
            projectionId: job.projectionId,
            status: stage === "processing" ? "processing" : "uploading",
          });
          if (detail) await emit(`projection.${stage}`, `${detail}…`);
        },
      });
      await patch({
        projectionId: job.projectionId,
        status: "live",
        platformPostId: result.postId ?? result.publishId,
        clearError: true,
        clearPendingContainer: true,
      });
      await emit(
        "projection.live",
        result.postId ? `TikTok LIVE → video ${result.postId}` : "TikTok LIVE — private while the app is unaudited",
      );
    } catch (e) {
      const retryable = (e as { retryable?: boolean }).retryable === true && job.attempt < 5;
      const message = e instanceof Error ? e.message : "TikTok publish failed";
      if (retryable) {
        await patch({
          projectionId: job.projectionId,
          status: "scheduled",
          errorCategory: "transient",
          errorSummary: message,
        });
        await emit("projection.retrying", `TikTok — ${message}; retrying`);
        await ctx.scheduler.runAfter(60_000, internal.publish.dispatch, {
          transmissionId: job.transmissionId,
        });
      } else {
        await patch({
          projectionId: job.projectionId,
          status: "failed",
          errorCategory: "platform",
          errorSummary: message,
          clearPendingContainer: true,
        });
        await emit("projection.failed", `TikTok failed — ${message}`);
      }
    }
    await refreshStatus();
  },
});
