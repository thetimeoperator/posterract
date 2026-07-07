import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import type { FunctionArgs } from "convex/server";

/**
 * The publish engine. Today every platform runs the FAKE connector — the
 * same staged lifecycle the product shows (uploading → publishing →
 * processing → live) — so the cloud loop is real end-to-end before the
 * platform APIs are wired in. Real connectors replace `runFakeConnector`
 * one platform at a time in the connector phases.
 */

const LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  threads: "Threads",
  x: "X",
  youtube: "YouTube",
};

/** Platforms that ingest from a URL get a platform-side processing stage. */
const PULL_PLATFORMS = new Set(["instagram", "threads", "tiktok"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (base: number) => base * (0.7 + Math.random() * 0.6);

export const dispatch = internalAction({
  args: { transmissionId: v.id("transmissions") },
  handler: async (ctx, args) => {
    const work = await ctx.runQuery(internal.publishHelpers.getWork, {
      transmissionId: args.transmissionId,
    });
    if (!work || work.transmission.status === "canceled") return;
    const { transmission, projections, portals, artifact, artifactUrl, tokensByPortal } = work;
    const sizeMB = Math.max(8, Math.round((artifact?.sizeBytes ?? 40_000_000) / 1_000_000));

    await Promise.all(
      projections
        .filter((p) => p.status === "scheduled" || p.status === "retrying")
        .map(async (projection) => {
          const label = LABELS[projection.provider];
          const portal = portals.find((x) => x._id === projection.portalId);

          if (!portal || portal.status !== "connected") {
            await ctx.runMutation(internal.publishHelpers.patchProjection, {
              projectionId: projection._id,
              status: "needs_reauth",
              errorCategory: "auth",
              errorSummary: `${label} account is not connected`,
            });
            await ctx.runMutation(internal.publishHelpers.emit, {
              workspaceId: transmission.workspaceId,
              transmissionId: transmission._id,
              projectionId: projection._id,
              type: "projection.failed",
              message: `${label} blocked — account not connected`,
            });
            return;
          }

          // Real connector for Instagram; simulator for the rest (until wired).
          if (projection.provider === "instagram") {
            await runInstagramConnector(ctx, {
              workspaceId: transmission.workspaceId,
              transmissionId: transmission._id,
              projectionId: projection._id,
              attempt: projection.attemptCount + 1,
              igUserId: tokensByPortal[portal._id]?.providerUserId,
              accessToken: tokensByPortal[portal._id]?.accessToken,
              videoUrl: artifactUrl,
              caption: projection.caption,
              pendingContainerId: projection.pendingContainerId,
            });
            return;
          }

          await runFakeConnector(ctx, {
            workspaceId: transmission.workspaceId,
            transmissionId: transmission._id,
            projectionId: projection._id,
            provider: projection.provider,
            label,
            sizeMB,
            attempt: projection.attemptCount + 1,
          });
        }),
    );

    await ctx.runMutation(internal.publishHelpers.refreshStatus, {
      transmissionId: args.transmissionId,
    });
  },
});

async function runFakeConnector(
  ctx: ActionCtx,
  job: {
    workspaceId: Id<"workspaces">;
    transmissionId: Id<"transmissions">;
    projectionId: Id<"projections">;
    provider: string;
    label: string;
    sizeMB: number;
    attempt: number;
  },
): Promise<void> {
  type ProjectionPatch = Omit<
    FunctionArgs<typeof internal.publishHelpers.patchProjection>,
    "projectionId"
  >;
  const patch = (p: ProjectionPatch) =>
    ctx.runMutation(internal.publishHelpers.patchProjection, { projectionId: job.projectionId, ...p });
  const emit = (type: string, message: string) =>
    ctx.runMutation(internal.publishHelpers.emit, {
      workspaceId: job.workspaceId,
      transmissionId: job.transmissionId,
      projectionId: job.projectionId,
      type,
      message,
    });
  const refresh = () =>
    ctx.runMutation(internal.publishHelpers.refreshStatus, { transmissionId: job.transmissionId });

  // Upload
  await patch({ status: "uploading", attemptCount: job.attempt });
  await refresh();
  const chunks = 3 + Math.floor(Math.random() * 3);
  for (let i = 1; i <= chunks; i++) {
    await sleep(jitter(450));
    await emit(
      "projection.uploading",
      `Uploading to ${job.label}… ${Math.round((i / chunks) * job.sizeMB)}/${job.sizeMB} MB`,
    );
  }

  // Seeded transient failure on first attempt → one automatic retry
  if (job.attempt === 1 && Math.random() < 0.1) {
    await patch({
      status: "retrying",
      errorCategory: "transient",
      errorSummary: `${job.label} media processing hiccup — retrying`,
    });
    await emit("projection.retrying", `${job.label} processing error — automatic retry in 4s`);
    await refresh();
    await sleep(4000);
    return runFakeConnector(ctx, { ...job, attempt: job.attempt + 1 });
  }

  // Publish
  await patch({ status: "publishing" });
  await emit("projection.publishing", `Publishing to ${job.label}…`);
  await sleep(jitter(900));

  // Platform-side processing for pull-from-URL platforms
  if (PULL_PLATFORMS.has(job.provider)) {
    await patch({ status: "processing" });
    await emit("projection.processing", `${job.label} is processing the media container…`);
    await sleep(jitter(1300));
  }

  // Live
  const postId = Math.random().toString(36).slice(2, 10);
  const url = `https://${job.provider === "youtube" ? "youtube.com/shorts" : `${job.provider}.com/p`}/${postId}`;
  await patch({ status: "live", platformPostId: postId, platformPostUrl: url, clearError: true });
  await emit("projection.live", `${job.label} LIVE → ${url.replace("https://", "")}`);
  await refresh();
}

/** Real Instagram publish — container → poll → publish, with retry semantics. */
async function runInstagramConnector(
  ctx: ActionCtx,
  job: {
    workspaceId: Id<"workspaces">;
    transmissionId: Id<"transmissions">;
    projectionId: Id<"projections">;
    attempt: number;
    igUserId?: string;
    accessToken?: string;
    videoUrl: string | null;
    caption: string;
    pendingContainerId?: string;
  },
): Promise<void> {
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

  if (!job.accessToken || !job.igUserId) {
    await patch({
      projectionId: job.projectionId,
      status: "needs_reauth",
      errorCategory: "auth",
      errorSummary: "Instagram token missing — reconnect the account",
    });
    await emit("projection.failed", "Instagram blocked — reconnect required");
    return;
  }
  if (!job.videoUrl) {
    await patch({
      projectionId: job.projectionId,
      status: "failed",
      errorCategory: "validation",
      errorSummary: "Video is not available to publish",
    });
    await emit("projection.failed", "Instagram blocked — video unavailable");
    return;
  }

  await patch({ projectionId: job.projectionId, status: "uploading", attemptCount: job.attempt });
  await ctx.runMutation(internal.publishHelpers.refreshStatus, { transmissionId: job.transmissionId });

  try {
    const { instagramPublishReel } = await import("./connectors/instagram");
    const result = await instagramPublishReel({
      igUserId: job.igUserId,
      accessToken: job.accessToken,
      videoUrl: job.videoUrl,
      caption: job.caption,
      resumeContainerId: job.pendingContainerId,
      onContainer: async (containerId) => {
        await patch({ projectionId: job.projectionId, pendingContainerId: containerId });
      },
      onProgress: async (stage, detail) => {
        await patch({
          projectionId: job.projectionId,
          status: stage === "publishing" ? "publishing" : stage === "processing" ? "processing" : "uploading",
        });
        if (detail) await emit(`projection.${stage}`, `${detail}…`);
      },
    });
    await patch({
      projectionId: job.projectionId,
      status: "live",
      platformPostId: result.mediaId,
      platformPostUrl: result.permalink ?? `https://www.instagram.com/reel/${result.mediaId}`,
      clearError: true,
      clearPendingContainer: true,
    });
    await emit("projection.live", `Instagram LIVE → ${(result.permalink ?? "instagram.com").replace("https://", "")}`);
  } catch (e) {
    const retryable = (e as { retryable?: boolean }).retryable === true && job.attempt < 5;
    const message = e instanceof Error ? e.message : "Instagram publish failed";
    if (retryable) {
      await patch({
        projectionId: job.projectionId,
        status: "scheduled",
        errorCategory: "transient",
        errorSummary: message,
      });
      await emit("projection.retrying", `Instagram — ${message}; retrying`);
      await ctx.scheduler.runAfter(60_000, internal.publish.dispatch, { transmissionId: job.transmissionId });
    } else {
      await patch({
        projectionId: job.projectionId,
        status: "failed",
        errorCategory: "platform",
        errorSummary: message,
        clearPendingContainer: true,
      });
      await emit("projection.failed", `Instagram failed — ${message}`);
    }
  }
  await ctx.runMutation(internal.publishHelpers.refreshStatus, { transmissionId: job.transmissionId });
}

/** Cron sweeper: re-dispatch posts that are due but lost their run. */
export const sweep = internalAction({
  args: {},
  handler: async (ctx) => {
    const sweepables = await ctx.runQuery(internal.publishHelpers.getSweepables, {});
    for (const { transmissionId, workspaceId } of sweepables) {
      await ctx.runMutation(internal.publishHelpers.emit, {
        workspaceId,
        transmissionId,
        type: "sweep.requeue",
        message: "Sweeper re-queued a stalled post",
      });
      await ctx.scheduler.runAfter(0, internal.publish.dispatch, { transmissionId });
    }
  },
});
