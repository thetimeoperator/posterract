import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { authComponent } from "./auth";
import { getOwnedWorkspace } from "./lib";

/**
 * Get-or-create the signed-in user's workspace, seeding demo portals on
 * first run. Called once on boot after sign-in.
 */
export const ensure = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);

    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .first();
    if (existing) return existing._id;

    const workspaceId = await ctx.db.insert("workspaces", {
      name: args.name ?? (user.name ? `${user.name}'s workspace` : "My workspace"),
      ownerId: user._id,
    });

    // Demo portal states — replaced by real OAuth in the connector phases.
    const seeds = [
      ["instagram", "disconnected"],
      ["tiktok", "disconnected"],
      ["youtube", "disconnected"],
      ["x", "disconnected"],
      ["threads", "disconnected"],
      ["facebook", "disconnected"],
    ] as const;
    const caps: Record<string, { cap: number; hours: number } | undefined> = {
      instagram: { cap: 100, hours: 24 },
      tiktok: { cap: 15, hours: 24 },
      threads: { cap: 250, hours: 24 },
    };
    for (const [provider, status] of seeds) {
      await ctx.db.insert("portals", {
        workspaceId,
        provider,
        handle: "not connected",
        displayName: undefined,
        status,
        windowUsed: caps[provider] ? 0 : undefined,
        windowCap: caps[provider]?.cap,
        windowHours: caps[provider]?.hours,
      });
    }

    await ctx.db.insert("events", {
      workspaceId,
      type: "workspace.created",
      message: "Welcome aboard — your Posterract is online.",
      at: Date.now(),
    });

    return workspaceId;
  },
});

export const get = query({
  args: {},
  handler: async (ctx) => getOwnedWorkspace(ctx),
});

export const rename = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const workspace = await getOwnedWorkspace(ctx);
    if (!workspace) throw new Error("Not signed in");
    await ctx.db.patch(workspace._id, { name: args.name });
  },
});
