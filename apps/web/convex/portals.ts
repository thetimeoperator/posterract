import { mutation, query } from "./_generated/server";
import { vPlatform, vPortalStatus } from "./schema";
import { getOwnedWorkspace, requireWorkspace } from "./lib";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await getOwnedWorkspace(ctx);
    if (!workspace) return [];
    return ctx.db
      .query("portals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
  },
});

/** Demo connect/disconnect — replaced by real OAuth in the connector phases. */
export const setStatus = mutation({
  args: {
    provider: vPlatform,
    status: vPortalStatus,
  },
  handler: async (ctx, args) => {
    const workspace = await requireWorkspace(ctx);
    const portal = await ctx.db
      .query("portals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .filter((q) => q.eq(q.field("provider"), args.provider))
      .first();
    if (!portal) return;
    const connecting = args.status === "connected";
    await ctx.db.patch(portal._id, {
      status: args.status,
      handle: connecting ? "@you (demo link)" : "not connected",
      tokenExpiresAt: connecting ? Date.now() + 60 * 86400_000 : undefined,
    });
  },
});
