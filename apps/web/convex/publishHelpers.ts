import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { vPlatform, vProjectionStatus, vTransmissionStatus } from "./schema";

/** Internal twin of transmissions.create (used by duplicate + future API). */
export const createInternal = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    baseCaption: v.string(),
    hashtags: v.array(v.string()),
    artifactId: v.id("artifacts"),
    platforms: v.array(vPlatform),
    perPlatformCaptions: v.record(v.string(), v.string()),
    scheduledFor: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const transmissionId = await ctx.db.insert("transmissions", {
      workspaceId: args.workspaceId,
      title: args.title,
      baseCaption: args.baseCaption,
      hashtags: args.hashtags,
      artifactId: args.artifactId,
      status: "scheduled",
      scheduleMode: "at",
      scheduledFor: args.scheduledFor,
      source: "ui",
      updatedAt: now,
    });
    const portals = await ctx.db
      .query("portals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const provider of args.platforms) {
      await ctx.db.insert("projections", {
        transmissionId,
        workspaceId: args.workspaceId,
        portalId: portals.find((p) => p.provider === provider)?._id,
        provider,
        caption: args.perPlatformCaptions[provider] ?? args.baseCaption,
        hashtags: args.hashtags,
        status: "scheduled",
        attemptCount: 0,
        updatedAt: now,
      });
    }
    const scheduledFnId = await ctx.scheduler.runAt(args.scheduledFor, internal.publish.dispatch, {
      transmissionId,
    });
    await ctx.db.patch(transmissionId, { scheduledFnId });
    return transmissionId;
  },
});

/** Everything the publish action needs, in one read. */
export const getWork = internalQuery({
  args: { transmissionId: v.id("transmissions") },
  handler: async (ctx, args) => {
    const transmission = await ctx.db.get(args.transmissionId);
    if (!transmission) return null;
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_transmission", (q) => q.eq("transmissionId", args.transmissionId))
      .collect();
    const portals = await ctx.db
      .query("portals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", transmission.workspaceId))
      .collect();
    const artifact = transmission.artifactId ? await ctx.db.get(transmission.artifactId) : null;
    const artifactUrl = artifact ? await ctx.storage.getUrl(artifact.storageId) : null;

    // Tokens for the connected portals we may publish through (internal-only).
    const tokens = await ctx.db
      .query("portalTokens")
      .withIndex("by_workspace_provider", (q) => q.eq("workspaceId", transmission.workspaceId))
      .collect();
    const tokensByPortal: Record<
      string,
      { accessToken: string; providerUserId?: string; expiresAt?: number }
    > = {};
    for (const t of tokens) {
      tokensByPortal[t.portalId] = {
        accessToken: t.accessToken,
        providerUserId: t.providerUserId,
        expiresAt: t.expiresAt,
      };
    }

    return { transmission, projections, portals, artifact, artifactUrl, tokensByPortal };
  },
});

export const patchProjection = internalMutation({
  args: {
    projectionId: v.id("projections"),
    status: v.optional(vProjectionStatus),
    attemptCount: v.optional(v.number()),
    platformPostId: v.optional(v.string()),
    platformPostUrl: v.optional(v.string()),
    errorCategory: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
    pendingContainerId: v.optional(v.string()),
    clearError: v.optional(v.boolean()),
    clearPendingContainer: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { projectionId, clearError, clearPendingContainer, ...patch } = args;
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(projectionId, {
      ...clean,
      ...(clearError ? { errorCategory: undefined, errorSummary: undefined } : {}),
      ...(clearPendingContainer ? { pendingContainerId: undefined } : {}),
      updatedAt: Date.now(),
    });
  },
});

export const emit = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    transmissionId: v.optional(v.id("transmissions")),
    projectionId: v.optional(v.id("projections")),
    type: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("events", { ...args, at: Date.now() });
  },
});

/** Recompute a transmission's status from its projections. */
export const refreshStatus = internalMutation({
  args: { transmissionId: v.id("transmissions") },
  handler: async (ctx, args) => {
    const t = await ctx.db.get(args.transmissionId);
    if (!t || t.status === "canceled") return;
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_transmission", (q) => q.eq("transmissionId", args.transmissionId))
      .collect();
    const states = projections.map((p) => p.status);
    let status: typeof t.status = "scheduled";
    if (states.length === 0) status = "draft";
    else if (states.every((s) => s === "live")) status = "live";
    else if (states.every((s) => s === "failed" || s === "needs_reauth" || s === "blocked")) status = "failed";
    else if (states.some((s) => ["uploading", "publishing", "processing", "retrying"].includes(s)))
      status = "transmitting";
    else if (states.some((s) => s === "live") && states.some((s) => ["failed", "needs_reauth"].includes(s)))
      status = "partial";
    else if (states.some((s) => s === "live")) status = "transmitting";
    if (status !== t.status) await ctx.db.patch(t._id, { status, updatedAt: Date.now() });
  },
});

export const setTransmissionStatus = internalMutation({
  args: { transmissionId: v.id("transmissions"), status: vTransmissionStatus },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.transmissionId, { status: args.status, updatedAt: Date.now() });
  },
});

/** Sweep support: posts that are due/stuck but have no live scheduled run. */
export const getSweepables = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const candidates = [];
    for (const status of ["scheduled", "transmitting"] as const) {
      const due = await ctx.db
        .query("transmissions")
        .filter((q) => q.and(q.eq(q.field("status"), status), q.lte(q.field("scheduledFor"), now)))
        .collect();
      candidates.push(...due);
    }
    const sweepables = [];
    for (const t of candidates) {
      // Stale = no progress for 2+ minutes past due.
      if (now - t.updatedAt > 120_000)
        sweepables.push({ transmissionId: t._id, workspaceId: t.workspaceId });
    }
    return sweepables;
  },
});
