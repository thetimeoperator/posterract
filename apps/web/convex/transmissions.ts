import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { vPlatform } from "./schema";

/**
 * Create a post + its per-platform projections and schedule the publish at
 * the exact time via Convex's scheduler — this is the real version of what
 * the browser demo simulated. Fires with every laptop on Earth closed.
 */
export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    baseCaption: v.string(),
    hashtags: v.array(v.string()),
    artifactId: v.id("artifacts"),
    platforms: v.array(vPlatform),
    perPlatformCaptions: v.record(v.string(), v.string()),
    scheduleMode: v.union(v.literal("now"), v.literal("at")),
    scheduledFor: v.number(),
    source: v.optional(v.union(v.literal("ui"), v.literal("api"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const scheduledFor = args.scheduleMode === "now" ? now : args.scheduledFor;
    const transmissionId = await ctx.db.insert("transmissions", {
      workspaceId: args.workspaceId,
      title: args.title || "Untitled post",
      baseCaption: args.baseCaption,
      hashtags: args.hashtags,
      artifactId: args.artifactId,
      status: "scheduled",
      scheduleMode: args.scheduleMode,
      scheduledFor,
      source: args.source ?? "ui",
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

    const scheduledFnId = await ctx.scheduler.runAt(scheduledFor, internal.publish.dispatch, {
      transmissionId,
    });
    await ctx.db.patch(transmissionId, { scheduledFnId });

    await ctx.db.insert("events", {
      workspaceId: args.workspaceId,
      transmissionId,
      type: "transmission.scheduled",
      message:
        args.scheduleMode === "now"
          ? `“${args.title}” publishing now across ${args.platforms.length} platform(s)`
          : `“${args.title}” scheduled for ${new Date(scheduledFor).toLocaleString()}`,
      at: now,
    });

    return transmissionId;
  },
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) =>
    ctx.db
      .query("transmissions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .collect(),
});

export const listProjections = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) =>
    ctx.db
      .query("projections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect(),
});

export const cancel = mutation({
  args: { transmissionId: v.id("transmissions") },
  handler: async (ctx, args) => {
    const t = await ctx.db.get(args.transmissionId);
    if (!t || (t.status !== "scheduled" && t.status !== "draft")) return;
    if (t.scheduledFnId) await ctx.scheduler.cancel(t.scheduledFnId);
    await ctx.db.patch(t._id, { status: "canceled", updatedAt: Date.now() });
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_transmission", (q) => q.eq("transmissionId", t._id))
      .collect();
    for (const p of projections) {
      if (p.status === "scheduled") {
        await ctx.db.patch(p._id, {
          status: "blocked",
          errorSummary: "Canceled by operator",
          updatedAt: Date.now(),
        });
      }
    }
    await ctx.db.insert("events", {
      workspaceId: t.workspaceId,
      transmissionId: t._id,
      type: "transmission.canceled",
      message: `“${t.title}” canceled`,
      at: Date.now(),
    });
  },
});

/** Reschedule a scheduled post (Calendar drag / edit). */
export const reschedule = mutation({
  args: { transmissionId: v.id("transmissions"), scheduledFor: v.number() },
  handler: async (ctx, args) => {
    const t = await ctx.db.get(args.transmissionId);
    if (!t || t.status !== "scheduled") return;
    if (t.scheduledFnId) await ctx.scheduler.cancel(t.scheduledFnId);
    const scheduledFnId = await ctx.scheduler.runAt(args.scheduledFor, internal.publish.dispatch, {
      transmissionId: t._id,
    });
    await ctx.db.patch(t._id, { scheduledFor: args.scheduledFor, scheduledFnId, updatedAt: Date.now() });
  },
});

export const duplicate = mutation({
  args: { transmissionId: v.id("transmissions") },
  handler: async (ctx, args): Promise<void> => {
    const t = await ctx.db.get(args.transmissionId);
    if (!t || !t.artifactId) return;
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_transmission", (q) => q.eq("transmissionId", t._id))
      .collect();
    await ctx.runMutation(internal.publishHelpers.createInternal, {
      workspaceId: t.workspaceId,
      title: `${t.title} (copy)`,
      baseCaption: t.baseCaption,
      hashtags: t.hashtags,
      artifactId: t.artifactId,
      platforms: projections.map((p) => p.provider),
      perPlatformCaptions: Object.fromEntries(projections.map((p) => [p.provider, p.caption])),
      scheduledFor: Date.now() + 3600_000,
    });
  },
});

export const retryProjection = mutation({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.projectionId);
    if (!p) return;
    await ctx.db.patch(p._id, {
      status: "scheduled",
      errorCategory: undefined,
      errorSummary: undefined,
      updatedAt: Date.now(),
    });
    const t = await ctx.db.get(p.transmissionId);
    if (t && (t.status === "failed" || t.status === "partial")) {
      await ctx.db.patch(t._id, { status: "scheduled", updatedAt: Date.now() });
    }
    await ctx.scheduler.runAfter(0, internal.publish.dispatch, { transmissionId: p.transmissionId });
  },
});
