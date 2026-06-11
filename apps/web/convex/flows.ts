import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { vPlatform } from "./schema";

const flowFields = {
  name: v.string(),
  platforms: v.array(vPlatform),
  captionTemplates: v.record(v.string(), v.string()),
  baseCaption: v.string(),
  hashtags: v.array(v.string()),
  defaultTimeOfDay: v.optional(v.string()),
  enabled: v.boolean(),
};

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) =>
    ctx.db
      .query("flows")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .collect(),
});

export const create = mutation({
  args: { workspaceId: v.id("workspaces"), ...flowFields },
  handler: async (ctx, args) => ctx.db.insert("flows", { ...args, updatedAt: Date.now() }),
});

export const update = mutation({
  args: {
    flowId: v.id("flows"),
    name: v.optional(v.string()),
    platforms: v.optional(v.array(vPlatform)),
    captionTemplates: v.optional(v.record(v.string(), v.string())),
    baseCaption: v.optional(v.string()),
    hashtags: v.optional(v.array(v.string())),
    defaultTimeOfDay: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { flowId, ...patch } = args;
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(flowId, { ...clean, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { flowId: v.id("flows") },
  handler: async (ctx, args) => ctx.db.delete(args.flowId),
});
