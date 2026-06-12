import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { vPlatform } from "./schema";
import { getOwnedWorkspace, requireWorkspace } from "./lib";

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
  args: {},
  handler: async (ctx) => {
    const workspace = await getOwnedWorkspace(ctx);
    if (!workspace) return [];
    return ctx.db
      .query("flows")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: flowFields,
  handler: async (ctx, args) => {
    const workspace = await requireWorkspace(ctx);
    return ctx.db.insert("flows", { ...args, workspaceId: workspace._id, updatedAt: Date.now() });
  },
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
    const workspace = await requireWorkspace(ctx);
    const { flowId, ...patch } = args;
    const flow = await ctx.db.get(flowId);
    if (!flow || flow.workspaceId !== workspace._id) throw new Error("Not found");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(flowId, { ...clean, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { flowId: v.id("flows") },
  handler: async (ctx, args) => {
    const workspace = await requireWorkspace(ctx);
    const flow = await ctx.db.get(args.flowId);
    if (!flow || flow.workspaceId !== workspace._id) throw new Error("Not found");
    await ctx.db.delete(args.flowId);
  },
});
