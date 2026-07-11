"use node";
/**
 * Node-runtime publish actions. Connectors that push raw video bytes
 * (TikTok FILE_UPLOAD, YouTube resumable upload) stream or buffer video bytes.
 * Node actions provide the memory and runtime headroom required for transfers.
 */
import { v } from "convex/values";
import type { FunctionArgs } from "convex/server";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { tiktokPublishVideo, tiktokRefreshToken } from "./connectors/tiktok";
import {
  youtubeGetVideo,
  youtubeRefreshToken,
  youtubeStartResumableUpload,
  youtubeUploadResumable,
  type YouTubePrivacy,
} from "./connectors/youtube";

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

const vYouTubeOptions = v.record(
  v.string(),
  v.union(v.string(), v.boolean(), v.number()),
);

type YouTubeToken = {
  tokenId?: Id<"portalTokens">;
  _id?: Id<"portalTokens">;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

async function freshYouTubeAccessToken(ctx: ActionCtx, token: YouTubeToken): Promise<string> {
  if ((token.expiresAt ?? 0) >= Date.now() + 120_000) return token.accessToken;
  if (!token.refreshToken) throw new Error("YouTube session expired — reconnect the channel");
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("YouTube is not configured");
  const refreshed = await youtubeRefreshToken({
    clientId,
    clientSecret,
    refreshToken: token.refreshToken,
  });
  const tokenId = token.tokenId ?? token._id;
  if (!tokenId) throw new Error("YouTube credential record is missing");
  await ctx.runMutation(internal.oauth.applyRefreshedToken, {
    tokenId,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}

function parseYouTubeOptions(options: Record<string, string | boolean | number> | undefined) {
  const privacy = options?.privacy;
  const privacyStatus: YouTubePrivacy =
    privacy === "private" || privacy === "unlisted" || privacy === "public" ? privacy : "private";
  return {
    privacyStatus,
    madeForKids: options?.madeForKids === true,
    containsSyntheticMedia: options?.containsSyntheticMedia === true,
    notifySubscribers: options?.notifySubscribers !== false,
    categoryId: typeof options?.categoryId === "string" ? options.categoryId : "22",
  };
}

const youtubePublishArgs = {
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
  mimeType: v.optional(v.string()),
  totalBytes: v.number(),
  title: v.string(),
  description: v.string(),
  options: v.optional(vYouTubeOptions),
  resume: v.optional(
    v.object({ uploadUrl: v.string(), uploadedBytes: v.number() }),
  ),
};

async function runYouTubePublish(
  ctx: ActionCtx,
  job: {
    workspaceId: Id<"workspaces">;
    transmissionId: Id<"transmissions">;
    projectionId: Id<"projections">;
    attempt: number;
    token?: YouTubeToken;
    videoUrl: string | null;
    mimeType?: string;
    totalBytes: number;
    title: string;
    description: string;
    options?: Record<string, string | boolean | number>;
    resume?: { uploadUrl: string; uploadedBytes: number };
  },
) {
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

  if (!job.token) throw new Error("YouTube token missing — reconnect the channel");
  if (!job.videoUrl) throw new Error("Video is not available to upload");
  if (job.totalBytes <= 0) throw new Error("Video size is unavailable");
  const title = job.title.trim();
  if (!title || title.length > 100) throw new Error("YouTube title must be 1–100 characters");
  if (new TextEncoder().encode(job.description).byteLength > 5000) {
    throw new Error("YouTube description must be 5,000 bytes or less");
  }
  const mimeType = job.mimeType || "video/mp4";
  if (!mimeType.startsWith("video/")) throw new Error("YouTube requires a video media type");
  const requested = parseYouTubeOptions(job.options);
  const accessToken = await freshYouTubeAccessToken(ctx, job.token);

  await patch({ projectionId: job.projectionId, status: "uploading", attemptCount: job.attempt });
  await refreshStatus();
  await emit("projection.uploading", "Uploading to YouTube…");

  let uploadUrl = job.resume?.uploadUrl;
  if (!uploadUrl) {
    uploadUrl = await youtubeStartResumableUpload({
      accessToken,
      mimeType,
      totalBytes: job.totalBytes,
      metadata: {
        title,
        description: job.description,
        privacyStatus: requested.privacyStatus,
        madeForKids: requested.madeForKids,
        containsSyntheticMedia: requested.containsSyntheticMedia,
        notifySubscribers: requested.notifySubscribers,
        categoryId: requested.categoryId,
      },
    });
    await ctx.runMutation(internal.publishHelpers.saveYouTubeUploadSession, {
      projectionId: job.projectionId,
      workspaceId: job.workspaceId,
      uploadUrl,
      totalBytes: job.totalBytes,
      mimeType,
    });
  }

  const result = await youtubeUploadResumable({
    accessToken,
    uploadUrl,
    videoUrl: job.videoUrl,
    totalBytes: job.totalBytes,
    mimeType,
    startingOffset: job.resume?.uploadedBytes,
    onProgress: async (uploadedBytes) => {
      await ctx.runMutation(internal.publishHelpers.updateYouTubeUploadProgress, {
        projectionId: job.projectionId,
        uploadedBytes,
      });
      await emit(
        "projection.uploading",
        `Uploading to YouTube… ${Math.round((uploadedBytes / job.totalBytes) * 100)}%`,
      );
    },
  });
  await ctx.runMutation(internal.publishHelpers.clearYouTubeUploadSession, {
    projectionId: job.projectionId,
  });

  const url = `https://www.youtube.com/watch?v=${result.videoId}`;
  await patch({
    projectionId: job.projectionId,
    platformPostId: result.videoId,
    platformPostUrl: url,
  });
  await patch({ projectionId: job.projectionId, status: "processing" });
  await emit("projection.processing", "YouTube is processing the video…");
  let video = await youtubeGetVideo(accessToken, result.videoId);
  for (let poll = 0; poll < 10; poll += 1) {
    const processing = video?.processingDetails?.processingStatus;
    if (processing === "succeeded" || video?.status?.uploadStatus === "processed") break;
    if (processing === "failed" || video?.status?.uploadStatus === "failed") {
      throw new Error("YouTube could not process this video");
    }
    await new Promise((resolve) => setTimeout(resolve, 6000));
    video = await youtubeGetVideo(accessToken, result.videoId);
  }
  const processed =
    video?.processingDetails?.processingStatus === "succeeded" ||
    video?.status?.uploadStatus === "processed";
  if (!processed) {
    await patch({
      projectionId: job.projectionId,
      status: "processing",
      errorSummary: "Waiting for YouTube to finish processing the video",
    });
    await ctx.scheduler.runAfter(60_000, internal.publishNode.youtubeFinalize, {
      projectionId: job.projectionId,
    });
    await refreshStatus();
    return;
  }
  const actualPrivacy = video?.status?.privacyStatus || result.privacyStatus;
  await patch({
    projectionId: job.projectionId,
    status: "live",
    platformPostId: result.videoId,
    platformPostUrl: url,
    clearError: true,
  });
  await emit(
    "projection.live",
    actualPrivacy === "private"
      ? `YouTube uploaded privately → youtube.com/watch?v=${result.videoId}`
      : `YouTube LIVE → youtube.com/watch?v=${result.videoId}`,
  );
  await refreshStatus();
}

export const youtubePublish = internalAction({
  args: youtubePublishArgs,
  handler: async (ctx, job) => {
    try {
      await runYouTubePublish(ctx, job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "YouTube publish failed";
      const details = error as { retryable?: boolean; status?: number };
      const auth = details.status === 401 || /access token|credential|reconnect|invalid_grant/i.test(message);
      const latest = await ctx.runQuery(internal.publishHelpers.getProjectionWork, {
        projectionId: job.projectionId,
      });
      if (latest?.projection.platformPostId) {
        await ctx.runMutation(internal.publishHelpers.patchProjection, {
          projectionId: job.projectionId,
          status: "processing",
          errorCategory: "transient",
          errorSummary: `${message} — checking the uploaded video again shortly`,
        });
        await ctx.scheduler.runAfter(60_000, internal.publishNode.youtubeFinalize, {
          projectionId: job.projectionId,
        });
        await ctx.runMutation(internal.publishHelpers.refreshStatus, {
          transmissionId: job.transmissionId,
        });
        return;
      }
      const canResume =
        !auth &&
        Boolean(latest?.session) &&
        job.attempt < 5 &&
        (details.retryable === true || details.status === 404 || error instanceof TypeError);
      if (canResume) {
        if (details.status === 404) {
          await ctx.runMutation(internal.publishHelpers.clearYouTubeUploadSession, {
            projectionId: job.projectionId,
          });
        }
        await ctx.runMutation(internal.publishHelpers.patchProjection, {
          projectionId: job.projectionId,
          status: "scheduled",
          attemptCount: job.attempt,
          errorCategory: "transient",
          errorSummary:
            details.status === 404
              ? `${message} — starting a fresh YouTube upload session`
              : `${message} — resuming the YouTube upload`,
        });
        await ctx.scheduler.runAfter(10_000, internal.publish.dispatch, {
          transmissionId: job.transmissionId,
        });
        return;
      }
      await ctx.runMutation(internal.publishHelpers.patchProjection, {
        projectionId: job.projectionId,
        status: auth ? "needs_reauth" : "failed",
        errorCategory: auth ? "auth" : "platform",
        errorSummary: message,
      });
      await ctx.runMutation(internal.publishHelpers.emit, {
        workspaceId: job.workspaceId,
        transmissionId: job.transmissionId,
        projectionId: job.projectionId,
        type: "projection.failed",
        message: `YouTube failed — ${message}`,
      });
      await ctx.runMutation(internal.publishHelpers.refreshStatus, {
        transmissionId: job.transmissionId,
      });
    }
  },
});

export const youtubeFinalize = internalAction({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    const work = await ctx.runQuery(internal.publishHelpers.getProjectionWork, args);
    if (!work?.token || !work.projection.platformPostId) return;
    if (work.projection.status === "live") return;
    try {
      const accessToken = await freshYouTubeAccessToken(ctx, work.token);
      const video = await youtubeGetVideo(accessToken, work.projection.platformPostId);
      const processed =
        video?.processingDetails?.processingStatus === "succeeded" ||
        video?.status?.uploadStatus === "processed";
      if (processed) {
        await ctx.runMutation(internal.publishHelpers.patchProjection, {
          projectionId: work.projection._id,
          status: "live",
          clearError: true,
        });
        await ctx.runMutation(internal.publishHelpers.emit, {
          workspaceId: work.projection.workspaceId,
          transmissionId: work.transmission._id,
          projectionId: work.projection._id,
          type: "projection.live",
          message:
            video?.status?.privacyStatus === "private"
              ? `YouTube uploaded privately → youtube.com/watch?v=${work.projection.platformPostId}`
              : `YouTube LIVE → youtube.com/watch?v=${work.projection.platformPostId}`,
        });
      } else if (work.projection.attemptCount < 60) {
        await ctx.runMutation(internal.publishHelpers.patchProjection, {
          projectionId: work.projection._id,
          status: "processing",
          attemptCount: work.projection.attemptCount + 1,
          errorSummary: "Waiting for YouTube processing and scheduled publication",
        });
        await ctx.scheduler.runAfter(60_000, internal.publishNode.youtubeFinalize, args);
      } else {
        await ctx.runMutation(internal.publishHelpers.patchProjection, {
          projectionId: work.projection._id,
          status: "failed",
          errorCategory: "platform",
          errorSummary: "YouTube did not finish processing the video",
        });
      }
      await ctx.runMutation(internal.publishHelpers.refreshStatus, {
        transmissionId: work.transmission._id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not verify the YouTube video";
      const details = error as { retryable?: boolean; status?: number };
      const auth = details.status === 401 || /access token|credential|reconnect|invalid_grant/i.test(message);
      const canRetry = !auth && work.projection.attemptCount < 60 &&
        (details.retryable === true || error instanceof TypeError);
      await ctx.runMutation(internal.publishHelpers.patchProjection, {
        projectionId: work.projection._id,
        status: auth ? "needs_reauth" : canRetry ? "processing" : "failed",
        attemptCount: canRetry ? work.projection.attemptCount + 1 : undefined,
        errorCategory: auth ? "auth" : canRetry ? "transient" : "platform",
        errorSummary: message,
      });
      if (canRetry) {
        await ctx.scheduler.runAfter(120_000, internal.publishNode.youtubeFinalize, args);
      }
      await ctx.runMutation(internal.publishHelpers.refreshStatus, {
        transmissionId: work.transmission._id,
      });
    }
  },
});
