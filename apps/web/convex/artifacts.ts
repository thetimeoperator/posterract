import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Browser asks for a short-lived URL, PUTs the video file straight to storage. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    durationMs: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const artifactId = await ctx.db.insert("artifacts", { ...args, status: "ready" });
    await ctx.db.insert("events", {
      workspaceId: args.workspaceId,
      type: "artifact.encapsulated",
      message: `Artifact “${args.fileName}” secured in the Library`,
      at: Date.now(),
    });
    return artifactId;
  },
});

/** List artifacts with resolved playback URLs. */
export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .collect();
    return Promise.all(
      artifacts.map(async (a) => ({ ...a, url: await ctx.storage.getUrl(a.storageId) })),
    );
  },
});

export const rename = mutation({
  args: { artifactId: v.id("artifacts"), fileName: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.artifactId, { fileName: args.fileName });
  },
});

export const remove = mutation({
  args: { artifactId: v.id("artifacts") },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) return { ok: true as const };
    const inFlight = await ctx.db
      .query("transmissions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", artifact.workspaceId))
      .filter((q) =>
        q.and(
          q.eq(q.field("artifactId"), args.artifactId),
          q.or(q.eq(q.field("status"), "scheduled"), q.eq(q.field("status"), "transmitting")),
        ),
      )
      .first();
    if (inFlight) {
      return { ok: false as const, reason: "Artifact is attached to a scheduled post." };
    }
    await ctx.storage.delete(artifact.storageId);
    await ctx.db.delete(args.artifactId);
    return { ok: true as const };
  },
});
