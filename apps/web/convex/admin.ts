import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Factory-reset a workspace's activity for a clean demo run: transmissions,
 * projections, events, points, and (optionally) portal connections/tokens.
 * Artifacts (uploaded videos) and the workspace itself are kept.
 * Internal-only — run via `npx convex run admin:resetWorkspace '{...}' --prod`.
 */
export const resetWorkspace = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    disconnectPortals: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const counts: Record<string, number> = {};

    for (const table of ["transmissions", "projections", "events", "pointsLedger", "userStats"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
      counts[table] = rows.length;
    }

    // No by_workspace index on these two small tables — filter scan is fine.
    const snapshots = await ctx.db
      .query("metricSnapshots")
      .filter((q) => q.eq(q.field("workspaceId"), args.workspaceId))
      .collect();
    for (const row of snapshots) await ctx.db.delete(row._id);
    counts.metricSnapshots = snapshots.length;

    const states = await ctx.db
      .query("oauthStates")
      .filter((q) => q.eq(q.field("workspaceId"), args.workspaceId))
      .collect();
    for (const row of states) await ctx.db.delete(row._id);
    counts.oauthStates = states.length;

    if (args.disconnectPortals) {
      const tokens = await ctx.db
        .query("portalTokens")
        .withIndex("by_workspace_provider", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      for (const t of tokens) await ctx.db.delete(t._id);
      counts.portalTokens = tokens.length;

      const portals = await ctx.db
        .query("portals")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      for (const p of portals) {
        await ctx.db.patch(p._id, {
          status: "disconnected",
          handle: "not connected",
          providerAccountId: undefined,
          tokenExpiresAt: undefined,
        });
      }
      counts.portalsReset = portals.length;
    }

    return counts;
  },
});
