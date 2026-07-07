import { action, internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { vPlatform } from "./schema";
import { requireWorkspace } from "./lib";
import { instagramAuthUrl, instagramExchangeCode, instagramRefreshToken } from "./connectors/instagram";

declare const process: { env: Record<string, string | undefined> };

function redirectUri(provider: string): string {
  const base = process.env.SITE_URL ?? "https://www.posterract.app";
  return `${base}/oauth/callback/${provider}`;
}

/** Begin a connect flow: mint a CSRF state, return the provider authorize URL. */
export const start = mutation({
  args: { provider: vPlatform },
  handler: async (ctx, args) => {
    const workspace = await requireWorkspace(ctx);
    const state = crypto.randomUUID();
    await ctx.db.insert("oauthStates", {
      state,
      workspaceId: workspace._id,
      provider: args.provider,
      createdAt: Date.now(),
    });

    if (args.provider === "instagram") {
      const clientId = process.env.INSTAGRAM_APP_ID;
      if (!clientId) throw new Error("Instagram not configured");
      return {
        url: instagramAuthUrl({ clientId, redirectUri: redirectUri("instagram"), state }),
      };
    }
    throw new Error(`${args.provider} connect is not available yet`);
  },
});

/** Complete a connect flow: verify state, exchange code, store token, link portal. */
export const complete = action({
  args: { provider: vPlatform, code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; handle?: string; error?: string }> => {
    const resolved = await ctx.runQuery(internal.oauth.resolveState, { state: args.state });
    if (!resolved || resolved.provider !== args.provider) {
      return { ok: false, error: "This connection link expired — try again." };
    }

    try {
      if (args.provider === "instagram") {
        const clientId = process.env.INSTAGRAM_APP_ID!;
        const clientSecret = process.env.INSTAGRAM_APP_SECRET!;
        const token = await instagramExchangeCode({
          clientId,
          clientSecret,
          redirectUri: redirectUri("instagram"),
          code: args.code,
        });
        await ctx.runMutation(internal.oauth.saveConnection, {
          state: args.state,
          provider: "instagram",
          handle: `@${token.username}`,
          providerAccountId: token.userId,
          accessToken: token.accessToken,
          expiresAt: token.expiresAt,
          providerUserId: token.userId,
        });
        return { ok: true, handle: `@${token.username}` };
      }
      return { ok: false, error: `${args.provider} is not available yet` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Connection failed" };
    }
  },
});

export const resolveState = internalQuery({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .first();
    if (!row) return null;
    if (Date.now() - row.createdAt > 15 * 60_000) return null; // 15-min TTL
    return { workspaceId: row.workspaceId, provider: row.provider };
  },
});

/** Persist token + flip the portal to connected. Consumes the state row. */
export const saveConnection = internalMutation({
  args: {
    state: v.string(),
    provider: vPlatform,
    handle: v.string(),
    providerAccountId: v.string(),
    accessToken: v.string(),
    expiresAt: v.optional(v.number()),
    providerUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stateRow = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .first();
    if (!stateRow) throw new Error("state expired");
    const workspaceId = stateRow.workspaceId;

    const portal = await ctx.db
      .query("portals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .filter((q) => q.eq(q.field("provider"), args.provider))
      .first();
    if (!portal) throw new Error("portal missing");

    await ctx.db.patch(portal._id, {
      status: "connected",
      handle: args.handle,
      providerAccountId: args.providerAccountId,
      tokenExpiresAt: args.expiresAt,
    });

    // Replace any existing token for this portal.
    const existing = await ctx.db
      .query("portalTokens")
      .withIndex("by_portal", (q) => q.eq("portalId", portal._id))
      .collect();
    for (const t of existing) await ctx.db.delete(t._id);
    await ctx.db.insert("portalTokens", {
      portalId: portal._id,
      workspaceId,
      provider: args.provider,
      accessToken: args.accessToken,
      expiresAt: args.expiresAt,
      providerUserId: args.providerUserId,
    });

    await ctx.db.delete(stateRow._id);
    await ctx.db.insert("events", {
      workspaceId,
      type: "portal.connected",
      message: `${args.provider} connected — ${args.handle}`,
      at: Date.now(),
    });
  },
});

/** Disconnect: clear token + reset portal. */
export const disconnect = mutation({
  args: { provider: vPlatform },
  handler: async (ctx, args) => {
    const workspace = await requireWorkspace(ctx);
    const portal = await ctx.db
      .query("portals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .filter((q) => q.eq(q.field("provider"), args.provider))
      .first();
    if (!portal) return;
    const tokens = await ctx.db
      .query("portalTokens")
      .withIndex("by_portal", (q) => q.eq("portalId", portal._id))
      .collect();
    for (const t of tokens) await ctx.db.delete(t._id);
    await ctx.db.patch(portal._id, {
      status: "disconnected",
      handle: "not connected",
      providerAccountId: undefined,
      tokenExpiresAt: undefined,
    });
  },
});

// ---------------------------------------------------------------------------
// Token upkeep — long-lived IG tokens last 60 days; refresh before they die.
// ---------------------------------------------------------------------------

const REFRESH_WINDOW_MS = 10 * 86400_000; // start refreshing once <10 days remain
const REAUTH_WINDOW_MS = 2 * 86400_000; // flag the portal once <2 days remain

export const listExpiringTokens = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() + REFRESH_WINDOW_MS;
    const tokens = await ctx.db.query("portalTokens").collect();
    return tokens
      .filter((t) => t.provider === "instagram" && t.expiresAt !== undefined && t.expiresAt < cutoff)
      .map((t) => ({
        tokenId: t._id,
        portalId: t.portalId,
        workspaceId: t.workspaceId,
        accessToken: t.accessToken,
        expiresAt: t.expiresAt!,
      }));
  },
});

export const applyRefreshedToken = internalMutation({
  args: { tokenId: v.id("portalTokens"), accessToken: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const token = await ctx.db.get(args.tokenId);
    if (!token) return;
    await ctx.db.patch(args.tokenId, { accessToken: args.accessToken, expiresAt: args.expiresAt });
    await ctx.db.patch(token.portalId, { tokenExpiresAt: args.expiresAt });
  },
});

export const markNeedsReauth = internalMutation({
  args: { portalId: v.id("portals"), workspaceId: v.id("workspaces"), reason: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.portalId, { status: "needs_reauth" });
    await ctx.db.insert("events", {
      workspaceId: args.workspaceId,
      type: "portal.needs_reauth",
      message: args.reason,
      at: Date.now(),
    });
  },
});

/** Daily cron: extend soon-to-expire tokens; flag portals whose refresh keeps failing. */
export const refreshExpiringTokens = internalAction({
  args: {},
  handler: async (ctx) => {
    const expiring = await ctx.runQuery(internal.oauth.listExpiringTokens, {});
    for (const t of expiring) {
      try {
        const refreshed = await instagramRefreshToken(t.accessToken);
        await ctx.runMutation(internal.oauth.applyRefreshedToken, {
          tokenId: t.tokenId,
          accessToken: refreshed.accessToken,
          expiresAt: refreshed.expiresAt,
        });
      } catch {
        // Transient failures retry tomorrow; flag only when the token is nearly dead.
        if (t.expiresAt < Date.now() + REAUTH_WINDOW_MS) {
          await ctx.runMutation(internal.oauth.markNeedsReauth, {
            portalId: t.portalId,
            workspaceId: t.workspaceId,
            reason: "Instagram token expired — reconnect the account",
          });
        }
      }
    }
  },
});
