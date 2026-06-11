import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { vPlatform, vPortalStatus } from "./schema";

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) =>
    ctx.db
      .query("portals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect(),
});

/** Demo connect/disconnect — replaced by real OAuth in the connector phases. */
export const setStatus = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    provider: vPlatform,
    status: vPortalStatus,
  },
  handler: async (ctx, args) => {
    const portal = await ctx.db
      .query("portals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) => q.eq(q.field("provider"), args.provider))
      .first();
    if (!portal) return;
    await ctx.db.patch(portal._id, {
      status: args.status,
      tokenExpiresAt: args.status === "connected" ? Date.now() + 60 * 86400_000 : portal.tokenExpiresAt,
    });
  },
});
