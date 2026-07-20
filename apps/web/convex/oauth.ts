import { action, internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { vPlatform } from "./schema";
import { requireWorkspace } from "./lib";
import {
  IG_SCOPES,
  instagramAuthUrl,
  instagramExchangeCode,
  instagramRefreshToken,
} from "./connectors/instagram";
import {
  FACEBOOK_PAGE_SCOPES,
  facebookAuthUrl,
  facebookExchangeCode,
  facebookListPages,
  facebookRevokeGrant,
} from "./connectors/facebook";
import {
  threadsAuthUrl,
  threadsExchangeCode,
  threadsRefreshToken,
} from "./connectors/threads";
import { tiktokAuthUrl, tiktokExchangeCode, tiktokRefreshToken } from "./connectors/tiktok";
import {
  youtubeAuthUrl,
  youtubeExchangeCode,
  youtubeRefreshToken,
  youtubeRevokeToken,
} from "./connectors/youtube";

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
    if (args.provider === "tiktok") {
      const clientKey = process.env.TIKTOK_CLIENT_KEY;
      if (!clientKey) throw new Error("TikTok not configured");
      return {
        url: tiktokAuthUrl({ clientKey, redirectUri: redirectUri("tiktok"), state }),
      };
    }
    if (args.provider === "youtube") {
      const clientId = process.env.YOUTUBE_CLIENT_ID;
      if (!clientId) throw new Error("YouTube is not configured");
      return {
        url: youtubeAuthUrl({ clientId, redirectUri: redirectUri("youtube"), state }),
      };
    }
    if (args.provider === "facebook") {
      const clientId = process.env.FACEBOOK_APP_ID;
      if (!clientId) throw new Error("Facebook is not configured");
      return {
        url: facebookAuthUrl({
          clientId,
          redirectUri: redirectUri("facebook"),
          state,
          configId: process.env.FACEBOOK_LOGIN_CONFIG_ID,
        }),
      };
    }
    if (args.provider === "threads") {
      const clientId = process.env.THREADS_APP_ID;
      if (!clientId) throw new Error("Threads is not configured");
      return {
        url: threadsAuthUrl({ clientId, redirectUri: redirectUri("threads"), state }),
      };
    }
    throw new Error(`${args.provider} connect is not available yet`);
  },
});

type CompleteResult = {
  ok: boolean;
  handle?: string;
  error?: string;
  selectionRequired?: boolean;
  pages?: Array<{ id: string; name: string }>;
};

/** Complete a connect flow: verify state, exchange code, store token, link portal. */
export const complete = action({
  args: { provider: vPlatform, code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<CompleteResult> => {
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
          scopes: IG_SCOPES,
        });
        return { ok: true, handle: `@${token.username}` };
      }
      if (args.provider === "tiktok") {
        const token = await tiktokExchangeCode({
          clientKey: process.env.TIKTOK_CLIENT_KEY!,
          clientSecret: process.env.TIKTOK_CLIENT_SECRET!,
          redirectUri: redirectUri("tiktok"),
          code: args.code,
        });
        await ctx.runMutation(internal.oauth.saveConnection, {
          state: args.state,
          provider: "tiktok",
          handle: token.displayName,
          providerAccountId: token.openId,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
          refreshExpiresAt: token.refreshExpiresAt,
          providerUserId: token.openId,
          scopes: token.scopes,
        });
        return { ok: true, handle: token.displayName };
      }
      if (args.provider === "youtube") {
        const clientId = process.env.YOUTUBE_CLIENT_ID;
        const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
        if (!clientId || !clientSecret) throw new Error("YouTube is not configured");
        const token = await youtubeExchangeCode({
          clientId,
          clientSecret,
          redirectUri: redirectUri("youtube"),
          code: args.code,
        });
        const handle = token.handle || token.channelTitle;
        await ctx.runMutation(internal.oauth.saveConnection, {
          state: args.state,
          provider: "youtube",
          handle,
          providerAccountId: token.channelId,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
          providerUserId: token.channelId,
          scopes: token.scopes,
        });
        return { ok: true, handle };
      }
      if (args.provider === "threads") {
        const clientId = process.env.THREADS_APP_ID;
        const clientSecret = process.env.THREADS_APP_SECRET;
        if (!clientId || !clientSecret) throw new Error("Threads is not configured");
        const token = await threadsExchangeCode({
          clientId,
          clientSecret,
          redirectUri: redirectUri("threads"),
          code: args.code,
        });
        const handle = `@${token.username}`;
        await ctx.runMutation(internal.oauth.saveConnection, {
          state: args.state,
          provider: "threads",
          handle,
          providerAccountId: token.userId,
          accessToken: token.accessToken,
          expiresAt: token.expiresAt,
          providerUserId: token.userId,
          scopes: token.scopes,
        });
        return { ok: true, handle };
      }
      if (args.provider === "facebook") {
        const clientId = process.env.FACEBOOK_APP_ID;
        const clientSecret = process.env.FACEBOOK_APP_SECRET;
        if (!clientId || !clientSecret) throw new Error("Facebook is not configured");
        const token = await facebookExchangeCode({
          clientId,
          clientSecret,
          redirectUri: redirectUri("facebook"),
          code: args.code,
        });
        const pages = await facebookListPages(token.accessToken);
        if (pages.length === 0) {
          throw new Error(
            "No manageable Facebook Pages were returned. Use an account with full Page access and approve all requested permissions.",
          );
        }
        await ctx.runMutation(internal.oauth.savePendingFacebookConnection, {
          state: args.state,
          workspaceId: resolved.workspaceId,
          userAccessToken: token.accessToken,
          expiresAt: token.expiresAt,
          scopes: token.scopes,
          pages,
        });
        return {
          ok: true,
          selectionRequired: true,
          pages: pages.map((page) => ({ id: page.id, name: page.name })),
        };
      }
      return { ok: false, error: `${args.provider} is not available yet` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Connection failed" };
    }
  },
});

export const savePendingFacebookConnection = internalMutation({
  args: {
    state: v.string(),
    workspaceId: v.id("workspaces"),
    userAccessToken: v.string(),
    expiresAt: v.optional(v.number()),
    scopes: v.array(v.string()),
    pages: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        accessToken: v.string(),
        tasks: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pendingFacebookConnections")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    await ctx.db.insert("pendingFacebookConnections", { ...args, createdAt: Date.now() });
  },
});

export const getPendingFacebookConnection = internalQuery({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const workspace = await requireWorkspace(ctx);
    const pending = await ctx.db
      .query("pendingFacebookConnections")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .first();
    if (!pending || pending.workspaceId !== workspace._id) return null;
    if (Date.now() - pending.createdAt > 15 * 60_000) return null;
    return pending;
  },
});

export const removePendingFacebookConnection = internalMutation({
  args: { pendingId: v.id("pendingFacebookConnections") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.pendingId);
  },
});

/** Finish Facebook connection only after the user explicitly selects a Page. */
export const selectFacebookPage = action({
  args: { state: v.string(), pageId: v.string() },
  handler: async (ctx, args): Promise<CompleteResult> => {
    const pending = await ctx.runQuery(internal.oauth.getPendingFacebookConnection, {
      state: args.state,
    });
    if (!pending) return { ok: false, error: "This Page selection expired — connect Facebook again." };
    const page = pending.pages.find((candidate) => candidate.id === args.pageId);
    if (!page) return { ok: false, error: "That Page is not available to this connection." };

    await ctx.runMutation(internal.oauth.saveConnection, {
      state: args.state,
      provider: "facebook",
      handle: page.name,
      displayName: page.name,
      providerAccountId: page.id,
      accessToken: page.accessToken,
      refreshToken: pending.userAccessToken,
      expiresAt: pending.expiresAt,
      providerUserId: page.id,
      scopes: FACEBOOK_PAGE_SCOPES,
    });
    await ctx.runMutation(internal.oauth.removePendingFacebookConnection, {
      pendingId: pending._id,
    });
    return { ok: true, handle: page.name };
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

/** Remove abandoned OAuth states and unselected Page tokens after 15 minutes. */
export const purgeExpiredStates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 15 * 60_000;
    const states = await ctx.db.query("oauthStates").collect();
    const facebook = await ctx.db.query("pendingFacebookConnections").collect();
    for (const row of states) if (row.createdAt < cutoff) await ctx.db.delete(row._id);
    for (const row of facebook) if (row.createdAt < cutoff) await ctx.db.delete(row._id);
  },
});

/** Persist token + flip the portal to connected. Consumes the state row. */
export const saveConnection = internalMutation({
  args: {
    state: v.string(),
    provider: vPlatform,
    handle: v.string(),
    displayName: v.optional(v.string()),
    providerAccountId: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    refreshExpiresAt: v.optional(v.number()),
    providerUserId: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
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
      displayName: args.displayName,
      providerAccountId: args.providerAccountId,
      tokenExpiresAt: args.expiresAt,
      scopes: args.scopes,
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
      refreshToken: args.refreshToken,
      expiresAt: args.expiresAt,
      refreshExpiresAt: args.refreshExpiresAt,
      providerUserId: args.providerUserId,
      scopes: args.scopes,
    });

    await ctx.db.delete(stateRow._id);
    await ctx.db.insert("events", {
      workspaceId,
      type: "portal.connected",
      message: `${args.provider} connected — ${args.handle}`,
      at: Date.now(),
    });
    if (args.provider === "instagram" || args.provider === "facebook" || args.provider === "threads") {
      await ctx.scheduler.runAfter(5_000, internal.metaAnalytics.refreshRecent, {});
    }
  },
});

/** Disconnect and revoke Google authorization before clearing local credentials. */
export const disconnect = action({
  args: { provider: vPlatform },
  handler: async (ctx, args): Promise<void> => {
    const token = await ctx.runQuery(internal.oauth.getDisconnectToken, { provider: args.provider });
    if (!token) return;
    if (args.provider === "youtube") {
      try {
        await youtubeRevokeToken(token.refreshToken || token.accessToken);
      } catch {
        // Local deletion must still succeed; Google may already have revoked
        // the grant or may be temporarily unreachable.
      }
    }
    if (args.provider === "facebook" && token.refreshToken) {
      try {
        await facebookRevokeGrant(token.refreshToken);
      } catch {
        // Local credential deletion still has to succeed.
      }
    }
    await ctx.runMutation(internal.oauth.clearConnection, {
      portalId: token.portalId,
      workspaceId: token.workspaceId,
      provider: args.provider,
    });
  },
});

export const getDisconnectToken = internalQuery({
  args: { provider: vPlatform },
  handler: async (ctx, args) => {
    const workspace = await requireWorkspace(ctx);
    const token = await ctx.db
      .query("portalTokens")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", workspace._id).eq("provider", args.provider),
      )
      .first();
    return token
      ? {
          portalId: token.portalId,
          workspaceId: token.workspaceId,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
        }
      : null;
  },
});

export const clearConnection = internalMutation({
  args: {
    portalId: v.id("portals"),
    workspaceId: v.id("workspaces"),
    provider: vPlatform,
  },
  handler: async (ctx, args) => {
    const tokens = await ctx.db
      .query("portalTokens")
      .withIndex("by_portal", (q) => q.eq("portalId", args.portalId))
      .collect();
    for (const token of tokens) await ctx.db.delete(token._id);

    // Disconnect is also a deletion request for cached platform analytics.
    const accountSnapshots = await ctx.db
      .query("accountMetricSnapshots")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("provider", args.provider),
      )
      .collect();
    const dailySnapshots = await ctx.db
      .query("dailyMetricSnapshots")
      .withIndex("by_workspace_provider_date", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("provider", args.provider),
      )
      .collect();
    const postSnapshots = await ctx.db
      .query("metricSnapshots")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("provider", args.provider),
      )
      .collect();

    for (const snapshot of accountSnapshots) await ctx.db.delete(snapshot._id);
    for (const snapshot of dailySnapshots) await ctx.db.delete(snapshot._id);
    for (const snapshot of postSnapshots) await ctx.db.delete(snapshot._id);

    await ctx.db.patch(args.portalId, {
      status: "disconnected",
      handle: "not connected",
      displayName: undefined,
      providerAccountId: undefined,
      tokenExpiresAt: undefined,
      scopes: undefined,
    });
    await ctx.db.insert("events", {
      workspaceId: args.workspaceId,
      type: "portal.disconnected",
      message: `${args.provider} disconnected`,
      at: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Token upkeep. Instagram: 60-day tokens, refresh inside the last 10 days.
// TikTok: 24h access tokens with a rotating 365-day refresh token — refresh
// every run so the connection stays warm for the scheduler.
// ---------------------------------------------------------------------------

const REFRESH_WINDOW_MS = 10 * 86400_000; // IG: start refreshing once <10 days remain
const REAUTH_WINDOW_MS = 2 * 86400_000; // flag the portal once <2 days remain

export const listExpiringTokens = internalQuery({
  args: {},
  handler: async (ctx) => {
    const igCutoff = Date.now() + REFRESH_WINDOW_MS;
    const tokens = await ctx.db.query("portalTokens").collect();
    return tokens
      .filter((t) => {
        if (t.provider === "instagram" || t.provider === "threads") {
          return t.expiresAt !== undefined && t.expiresAt < igCutoff;
        }
        if (t.provider === "tiktok") return t.refreshToken !== undefined;
        if (t.provider === "youtube") {
          return t.refreshToken !== undefined && (t.expiresAt ?? 0) < Date.now() + 10 * 60_000;
        }
        return false;
      })
      .map((t) => ({
        tokenId: t._id,
        portalId: t.portalId,
        workspaceId: t.workspaceId,
        provider: t.provider,
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        expiresAt: t.expiresAt ?? 0,
        refreshExpiresAt: t.refreshExpiresAt,
      }));
  },
});

export const applyRefreshedToken = internalMutation({
  args: {
    tokenId: v.id("portalTokens"),
    accessToken: v.string(),
    expiresAt: v.number(),
    refreshToken: v.optional(v.string()),
    refreshExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const token = await ctx.db.get(args.tokenId);
    if (!token) return;
    await ctx.db.patch(args.tokenId, {
      accessToken: args.accessToken,
      expiresAt: args.expiresAt,
      ...(args.refreshToken ? { refreshToken: args.refreshToken } : {}),
      ...(args.refreshExpiresAt ? { refreshExpiresAt: args.refreshExpiresAt } : {}),
    });
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
        if (t.provider === "instagram") {
          const refreshed = await instagramRefreshToken(t.accessToken);
          await ctx.runMutation(internal.oauth.applyRefreshedToken, {
            tokenId: t.tokenId,
            accessToken: refreshed.accessToken,
            expiresAt: refreshed.expiresAt,
          });
        } else if (t.provider === "threads") {
          const refreshed = await threadsRefreshToken(t.accessToken);
          await ctx.runMutation(internal.oauth.applyRefreshedToken, {
            tokenId: t.tokenId,
            accessToken: refreshed.accessToken,
            expiresAt: refreshed.expiresAt,
          });
        } else if (t.provider === "tiktok" && t.refreshToken) {
          const refreshed = await tiktokRefreshToken({
            clientKey: process.env.TIKTOK_CLIENT_KEY!,
            clientSecret: process.env.TIKTOK_CLIENT_SECRET!,
            refreshToken: t.refreshToken,
          });
          await ctx.runMutation(internal.oauth.applyRefreshedToken, {
            tokenId: t.tokenId,
            accessToken: refreshed.accessToken,
            expiresAt: refreshed.expiresAt,
            refreshToken: refreshed.refreshToken,
            refreshExpiresAt: refreshed.refreshExpiresAt,
          });
        } else if (t.provider === "youtube" && t.refreshToken) {
          const clientId = process.env.YOUTUBE_CLIENT_ID;
          const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
          if (!clientId || !clientSecret) throw new Error("YouTube is not configured");
          const refreshed = await youtubeRefreshToken({
            clientId,
            clientSecret,
            refreshToken: t.refreshToken,
          });
          await ctx.runMutation(internal.oauth.applyRefreshedToken, {
            tokenId: t.tokenId,
            accessToken: refreshed.accessToken,
            expiresAt: refreshed.expiresAt,
          });
        }
      } catch {
        // Transient failures retry tomorrow; flag only when the credential is nearly dead.
        const dying =
          t.provider === "tiktok"
            ? (t.refreshExpiresAt ?? 0) < Date.now() + REAUTH_WINDOW_MS
            : t.expiresAt < Date.now() + REAUTH_WINDOW_MS;
        if (dying) {
          await ctx.runMutation(internal.oauth.markNeedsReauth, {
            portalId: t.portalId,
            workspaceId: t.workspaceId,
            reason: `${t.provider} token expired — reconnect the account`,
          });
        }
      }
    }
  },
});
