import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const vPlatform = v.union(
  v.literal("instagram"),
  v.literal("tiktok"),
  v.literal("facebook"),
  v.literal("threads"),
  v.literal("x"),
  v.literal("youtube"),
);

export const vTransmissionStatus = v.union(
  v.literal("draft"),
  v.literal("scheduled"),
  v.literal("transmitting"),
  v.literal("live"),
  v.literal("partial"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const vProjectionStatus = v.union(
  v.literal("pending"),
  v.literal("scheduled"),
  v.literal("uploading"),
  v.literal("publishing"),
  v.literal("processing"),
  v.literal("live"),
  v.literal("failed"),
  v.literal("retrying"),
  v.literal("needs_reauth"),
  v.literal("blocked"),
);

export const vPortalStatus = v.union(
  v.literal("connected"),
  v.literal("needs_reauth"),
  v.literal("pending_approval"),
  v.literal("error"),
  v.literal("disconnected"),
);

export default defineSchema({
  workspaces: defineTable({
    name: v.string(),
    /** Better Auth user id of the owner. */
    ownerId: v.string(),
  }).index("by_owner", ["ownerId"]),

  portals: defineTable({
    workspaceId: v.id("workspaces"),
    provider: vPlatform,
    handle: v.string(),
    displayName: v.optional(v.string()),
    /** The platform's account id (e.g. Instagram user id) once connected. */
    providerAccountId: v.optional(v.string()),
    status: vPortalStatus,
    /** OAuth scopes actually granted by the provider. */
    scopes: v.optional(v.array(v.string())),
    tokenExpiresAt: v.optional(v.number()),
    windowUsed: v.optional(v.number()),
    windowCap: v.optional(v.number()),
    windowHours: v.optional(v.number()),
  }).index("by_workspace", ["workspaceId"]),

  /**
   * OAuth access tokens — server-only. Never returned by any client-facing
   * query; read exclusively by internal publish/refresh functions.
   * (App-level encryption is a Phase 8 hardening item; today it relies on
   * Convex's access control + internal-only reads.)
   */
  portalTokens: defineTable({
    portalId: v.id("portals"),
    workspaceId: v.id("workspaces"),
    provider: vPlatform,
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    /** When the refresh token itself dies (TikTok: 365d, rotating). */
    refreshExpiresAt: v.optional(v.number()),
    providerUserId: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
  })
    .index("by_portal", ["portalId"])
    .index("by_workspace_provider", ["workspaceId", "provider"]),

  /** Short-lived CSRF state for OAuth connect flows. */
  oauthStates: defineTable({
    state: v.string(),
    workspaceId: v.id("workspaces"),
    provider: vPlatform,
    createdAt: v.number(),
  }).index("by_state", ["state"]),

  artifacts: defineTable({
    workspaceId: v.id("workspaces"),
    fileName: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    sizeBytes: v.number(),
    durationMs: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    status: v.union(v.literal("uploading"), v.literal("ready"), v.literal("failed")),
  }).index("by_workspace", ["workspaceId"]),

  transmissions: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    baseCaption: v.string(),
    hashtags: v.array(v.string()),
    artifactId: v.optional(v.id("artifacts")),
    status: vTransmissionStatus,
    scheduleMode: v.union(v.literal("now"), v.literal("at"), v.literal("next_slot")),
    scheduledFor: v.optional(v.number()),
    source: v.union(v.literal("ui"), v.literal("api")),
    scheduledFnId: v.optional(v.id("_scheduled_functions")),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_status", ["workspaceId", "status"]),

  projections: defineTable({
    transmissionId: v.id("transmissions"),
    workspaceId: v.id("workspaces"),
    portalId: v.optional(v.id("portals")),
    provider: vPlatform,
    caption: v.string(),
    hashtags: v.array(v.string()),
    /** Provider-specific user choices captured at compose time. */
    platformOptions: v.optional(
      v.record(v.string(), v.union(v.string(), v.boolean(), v.number())),
    ),
    status: vProjectionStatus,
    attemptCount: v.number(),
    nextAttemptAt: v.optional(v.number()),
    platformPostId: v.optional(v.string()),
    platformPostUrl: v.optional(v.string()),
    errorCategory: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
    /** In-flight platform container/upload id — lets a retry resume instead of restarting. */
    pendingContainerId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_transmission", ["transmissionId"])
    .index("by_workspace", ["workspaceId"]),

  /** Resonance — append-only points ledger. One award per (refId, source). */
  pointsLedger: defineTable({
    workspaceId: v.id("workspaces"),
    source: v.union(
      v.literal("post"),
      v.literal("bonus"),
      v.literal("streak"),
      v.literal("milestone"),
      v.literal("views"),
      v.literal("likes"),
      v.literal("comments"),
    ),
    amount: v.number(),
    /** Idempotency key — projection/transmission/badge reference. */
    refId: v.optional(v.string()),
    note: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_at", ["workspaceId", "at"])
    .index("by_ref", ["refId", "source"]),

  /** Resonance aggregates — one row per workspace. */
  userStats: defineTable({
    workspaceId: v.id("workspaces"),
    lifetimeRP: v.number(),
    weekRP: v.number(),
    weekStartAt: v.number(),
    streakDays: v.number(),
    /** UTC day "YYYY-MM-DD" of the last day that earned posting RP. */
    lastPostDay: v.optional(v.string()),
    badges: v.array(v.string()),
  }).index("by_workspace", ["workspaceId"]),

  /** Last-counted platform metrics per projection (delta-based awarding). */
  metricSnapshots: defineTable({
    projectionId: v.id("projections"),
    workspaceId: v.id("workspaces"),
    provider: vPlatform,
    views: v.number(),
    engagedViews: v.optional(v.number()),
    likes: v.number(),
    comments: v.number(),
    shares: v.optional(v.number()),
    estimatedMinutesWatched: v.optional(v.number()),
    averageViewDuration: v.optional(v.number()),
    fetchedAt: v.number(),
  })
    .index("by_projection", ["projectionId"])
    .index("by_workspace_provider", ["workspaceId", "provider"]),

  /** Latest account-level totals for audience and network-wide counters. */
  accountMetricSnapshots: defineTable({
    portalId: v.id("portals"),
    workspaceId: v.id("workspaces"),
    provider: vPlatform,
    audience: v.optional(v.number()),
    totalViews: v.optional(v.number()),
    totalLikes: v.optional(v.number()),
    publishedVideos: v.optional(v.number()),
    fetchedAt: v.number(),
  })
    .index("by_portal", ["portalId"])
    .index("by_workspace_provider", ["workspaceId", "provider"]),

  /** Daily deltas used by Echoes range charts and growth calculations. */
  dailyMetricSnapshots: defineTable({
    portalId: v.id("portals"),
    workspaceId: v.id("workspaces"),
    provider: vPlatform,
    date: v.string(),
    views: v.number(),
    likes: v.number(),
    comments: v.number(),
    shares: v.number(),
    watchMinutes: v.optional(v.number()),
    audienceGained: v.number(),
    audienceLost: v.number(),
    fetchedAt: v.number(),
  })
    .index("by_portal_date", ["portalId", "date"])
    .index("by_workspace_provider_date", ["workspaceId", "provider", "date"]),

  /**
   * Resumable YouTube upload URLs are bearer-like secrets. Keep them in an
   * internal-only table rather than returning them with projection records.
   */
  youtubeUploadSessions: defineTable({
    projectionId: v.id("projections"),
    workspaceId: v.id("workspaces"),
    uploadUrl: v.string(),
    totalBytes: v.number(),
    mimeType: v.string(),
    uploadedBytes: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projection", ["projectionId"]),

  events: defineTable({
    workspaceId: v.id("workspaces"),
    transmissionId: v.optional(v.id("transmissions")),
    projectionId: v.optional(v.id("projections")),
    type: v.string(),
    message: v.string(),
    at: v.number(),
  }).index("by_workspace", ["workspaceId"]),

});
