import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Single-workspace bootstrap until auth lands (Phase 4): get or create the
 * default workspace, seeding demo portals and the sample flow on first run.
 */
export const bootstrap = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("workspaces").first();
    if (existing) return existing._id;

    const workspaceId = await ctx.db.insert("workspaces", {
      name: args.name ?? "Posterract HQ",
    });

    // Demo portal states — replaced by real OAuth in the connector phases.
    const seeds = [
      ["instagram", "connected"],
      ["tiktok", "connected"],
      ["youtube", "connected"],
      ["x", "needs_reauth"],
      ["threads", "disconnected"],
      ["facebook", "disconnected"],
    ] as const;
    const caps: Record<string, { cap: number; hours: number } | undefined> = {
      instagram: { cap: 100, hours: 24 },
      tiktok: { cap: 15, hours: 24 },
      youtube: { cap: 6, hours: 24 },
      threads: { cap: 250, hours: 24 },
    };
    for (const [provider, status] of seeds) {
      await ctx.db.insert("portals", {
        workspaceId,
        provider,
        handle: provider === "facebook" || provider === "youtube" ? "Posterract" : "@posterract",
        displayName: "Posterract",
        status,
        tokenExpiresAt: status === "connected" ? Date.now() + 54 * 86400_000 : undefined,
        windowUsed: caps[provider] ? 0 : undefined,
        windowCap: caps[provider]?.cap,
        windowHours: caps[provider]?.hours,
      });
    }

    await ctx.db.insert("flows", {
      workspaceId,
      name: "Repurpose: IG-first → X + TikTok",
      platforms: ["instagram", "x", "tiktok"],
      captionTemplates: {
        instagram: "{title} — full breakdown in this clip 🎬\n\nSave this one for later.",
        x: "{title}.\n\nThe 60-second version:",
        tiktok: "{title} — watch till the end.",
      },
      baseCaption: "{title}",
      hashtags: ["repurpose"],
      defaultTimeOfDay: "09:00",
      enabled: true,
      updatedAt: Date.now(),
    });

    return workspaceId;
  },
});

export const get = query({
  args: {},
  handler: async (ctx) => ctx.db.query("workspaces").first(),
});
