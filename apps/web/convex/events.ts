import { query } from "./_generated/server";
import { v } from "convex/values";
import { getOwnedWorkspace } from "./lib";

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const workspace = await getOwnedWorkspace(ctx);
    if (!workspace) return [];
    return ctx.db
      .query("events")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(args.limit ?? 100);
  },
});
