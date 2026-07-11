import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { vPlatform } from "./schema";
import { getOwnedWorkspace, requireWorkspace } from "./lib";

/**
 * Create a post + its per-platform projections and schedule the publish at
 * the exact time via the cloud scheduler. Fires with every laptop closed.
 */
export const create = mutation({
  args: {
    title: v.string(),
    baseCaption: v.string(),
    hashtags: v.array(v.string()),
    artifactId: v.id("artifacts"),
    platforms: v.array(vPlatform),
    perPlatformCaptions: v.record(v.string(), v.string()),
    perPlatformOptions: v.optional(
      v.record(
        v.string(),
        v.record(v.string(), v.union(v.string(), v.boolean(), v.number())),
      ),
    ),
    scheduleMode: v.union(v.literal("now"), v.literal("at")),
    scheduledFor: v.number(),
    source: v.optional(v.union(v.literal("ui"), v.literal("api"))),
  },
  handler: async (ctx, args) => {
    const workspace = await requireWorkspace(ctx);
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.workspaceId !== workspace._id) throw new Error("Artifact not found");

    const now = Date.now();
    const scheduledFor = args.scheduleMode === "now" ? now : args.scheduledFor;
    const transmissionId = await ctx.db.insert("transmissions", {
      workspaceId: workspace._id,
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
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();

    for (const provider of args.platforms) {
      const platformOptions = args.perPlatformOptions?.[provider];
      await ctx.db.insert("projections", {
        transmissionId,
        workspaceId: workspace._id,
        portalId: portals.find((p) => p.provider === provider)?._id,
        provider,
        caption: args.perPlatformCaptions[provider] ?? args.baseCaption,
        hashtags: args.hashtags,
        platformOptions,
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
      workspaceId: workspace._id,
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
  args: {},
  handler: async (ctx) => {
    const workspace = await getOwnedWorkspace(ctx);
    if (!workspace) return [];
    return ctx.db
      .query("transmissions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .collect();
  },
});

export const listProjections = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await getOwnedWorkspace(ctx);
    if (!workspace) return [];
    return ctx.db
      .query("projections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
  },
});

export const cancel = mutation({
  args: { transmissionId: v.id("transmissions") },
  handler: async (ctx, args) => {
    const workspace = await requireWorkspace(ctx);
    const t = await ctx.db.get(args.transmissionId);
    if (!t || t.workspaceId !== workspace._id) throw new Error("Not found");
    if (t.status !== "scheduled" && t.status !== "draft") return;
    if (t.scheduledFnId) await ctx.scheduler.cancel(t.scheduledFnId);
    await ctx.db.patch(t._id, { status: "canceled", updatedAt: Date.now() });
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_transmission", (q) => q.eq("transmissionId", t._id))
      .collect();
    for (const p of projections) {
      if (p.status === "scheduled" || p.status === "retrying") {
        await ctx.db.patch(p._id, {
          status: "blocked",
          errorSummary: "Canceled by operator",
          updatedAt: Date.now(),
        });
      }
    }
    await ctx.db.insert("events", {
      workspaceId: workspace._id,
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
    const workspace = await requireWorkspace(ctx);
    const t = await ctx.db.get(args.transmissionId);
    if (!t || t.workspaceId !== workspace._id) throw new Error("Not found");
    if (t.status !== "scheduled") return;
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
    const workspace = await requireWorkspace(ctx);
    const t = await ctx.db.get(args.transmissionId);
    if (!t || t.workspaceId !== workspace._id || !t.artifactId) return;
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_transmission", (q) => q.eq("transmissionId", t._id))
      .collect();
    await ctx.runMutation(internal.publishHelpers.createInternal, {
      workspaceId: workspace._id,
      title: `${t.title} (copy)`,
      baseCaption: t.baseCaption,
      hashtags: t.hashtags,
      artifactId: t.artifactId,
      platforms: projections.map((p) => p.provider),
      perPlatformCaptions: Object.fromEntries(projections.map((p) => [p.provider, p.caption])),
      perPlatformOptions: Object.fromEntries(
        projections.map((p) => [p.provider, p.platformOptions ?? {}]),
      ),
      scheduledFor: Date.now() + 3600_000,
    });
  },
});

export const retryProjection = mutation({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    const workspace = await requireWorkspace(ctx);
    const p = await ctx.db.get(args.projectionId);
    if (!p || p.workspaceId !== workspace._id) throw new Error("Not found");
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
