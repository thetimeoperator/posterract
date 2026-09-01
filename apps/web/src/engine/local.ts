/**
 * LOCAL engine — the in-browser demo implementation (zustand + IndexedDB +
 * publish simulator). Used when no cloud deployment is configured, and by
 * e2e tests for deterministic offline runs.
 */
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { artifactUrls, useEngineStore } from "./store";
import { startSimulator } from "./simulator";
import type { AccountSetDTO, AnalyticsDashboardDTO, AnalyticsRangeDays, PlatformId } from "@posterract/contract";

export function useEngineBoot() {
  const hydrate = useEngineStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate().then(() => import("./samples").then((m) => m.seedSamplesOnce()));
    const stop = startSimulator();
    if (import.meta.env.DEV) {
      // Console/e2e access: window.__engine.getState().addArtifact(...) etc.
      (window as unknown as Record<string, unknown>).__engine = useEngineStore;
    }
    return stop;
  }, [hydrate]);
}

export const useArtifacts = () => useEngineStore((s) => s.artifacts);
export const useTransmissions = () => useEngineStore((s) => s.transmissions);
export const useProjections = () => useEngineStore((s) => s.projections);
export const useEvents = () => useEngineStore((s) => s.events);
export const usePortals = () => useEngineStore((s) => s.portals);
export const useAccountSets = (): AccountSetDTO[] => [];
export const usePoints = () => {
  // Select stable refs; derive the summary in a memo (a fresh object from the
  // selector itself would loop the zustand equality check forever).
  const stats = useEngineStore((s) => s.stats);
  const points = useEngineStore((s) => s.points);
  return useMemo(
    () => ({
      lifetimeRP: stats.lifetimeRP,
      weekRP: stats.weekRP,
      streakDays: stats.streakDays,
      badges: stats.badges,
      recent: points.slice(0, 30),
    }),
    [stats, points],
  );
};
type DemoAnalyticsProvider = "instagram" | "tiktok" | "facebook" | "threads";

const demoDaily = (provider: DemoAnalyticsProvider, rangeDays: AnalyticsRangeDays) => {
  const historyDays = rangeDays === "total" ? 365 : rangeDays;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: historyDays }, (_, index) => {
    const date = new Date(today.getTime() - (historyDays - index - 1) * 86400_000);
    const offsets = { instagram: 0.4, tiktok: 0.9, facebook: 1.2, threads: 2.1 };
    const baselines = { instagram: 980, tiktok: 1480, facebook: 720, threads: 540 };
    const wave = Math.sin(index * 0.72 + offsets[provider]);
    const lift = index / Math.max(1, historyDays - 1);
    const views = Math.max(0, Math.round(baselines[provider] + wave * 280 + lift * 690));
    return {
      date: date.toISOString().slice(0, 10),
      views,
      likes: Math.round(views * (provider === "threads" ? 0.095 : 0.072)),
      comments: Math.round(views * 0.009),
      shares: Math.round(views * (provider === "threads" ? 0.026 : 0.015)),
      reach: provider === "instagram" ? Math.round(views * 0.82) : undefined,
      saves: provider === "instagram" ? Math.round(views * 0.012) : undefined,
      replies: provider === "threads" ? Math.round(views * 0.009) : undefined,
      reposts: provider === "threads" ? Math.round(views * 0.018) : undefined,
      quotes: provider === "threads" ? Math.round(views * 0.008) : undefined,
      clicks: provider === "threads" ? Math.round(views * 0.006) : undefined,
      watchMinutes: provider === "instagram" ? Math.round(views * 0.12) : undefined,
      audienceGained: Math.max(0, Math.round(views * 0.006 + wave * 2)),
      audienceLost: index % 9 === 0 ? 2 : 0,
    };
  });
};

export function useAnalyticsDashboard(rangeDays: AnalyticsRangeDays): AnalyticsDashboardDTO {
  return useMemo(() => {
    const makePlatform = (provider: DemoAnalyticsProvider) => {
      const daily = demoDaily(provider, rangeDays);
      const totals = daily.reduce(
        (sum, day) => ({
          views: sum.views + day.views,
          likes: sum.likes + day.likes,
          comments: sum.comments + day.comments,
          shares: sum.shares + day.shares,
          watchMinutes: sum.watchMinutes + (day.watchMinutes ?? 0),
          audienceDelta: sum.audienceDelta + day.audienceGained - day.audienceLost,
        }),
        { views: 0, likes: 0, comments: 0, shares: 0, watchMinutes: 0, audienceDelta: 0 },
      );
      const posts = [
        { title: "The habit that changed my mornings", factor: 1 },
        { title: "Building the studio in 30 seconds", factor: 0.68 },
        { title: "The product drop nobody expected", factor: 0.42 },
      ].map((post, index) => ({
        projectionId: `${provider}_demo_${index}`,
        transmissionId: `demo_${index}`,
        provider: provider as PlatformId,
        title: post.title,
        publishedAt: Date.now() - (index + 1) * 86400_000,
        platformPostUrl: undefined,
        views: Math.round(totals.views * 0.18 * post.factor),
        likes: Math.round(totals.likes * 0.2 * post.factor),
        comments: Math.round(totals.comments * 0.2 * post.factor),
        shares: Math.round(totals.shares * 0.2 * post.factor),
        reach: provider === "instagram" ? Math.round(totals.views * 0.14 * post.factor) : undefined,
        saves: provider === "instagram" ? Math.round(totals.views * 0.002 * post.factor) : undefined,
        replies: provider === "threads" ? Math.round(totals.comments * 0.2 * post.factor) : undefined,
        reposts: provider === "threads" ? Math.round(totals.shares * 0.14 * post.factor) : undefined,
        quotes: provider === "threads" ? Math.round(totals.shares * 0.06 * post.factor) : undefined,
        watchMinutes: provider === "instagram" ? Math.round(totals.views * 0.02 * post.factor) : undefined,
        averageWatchSeconds: provider === "instagram" ? 8.4 + index * 0.7 : undefined,
        skipRate: provider === "instagram" ? 31 + index * 3 : undefined,
        durationSeconds: provider === "tiktok" ? 24 + index * 8 : undefined,
      }));
      const providerMetrics = {
        instagram: ["views", "reach", "likes", "comments", "shares", "saves", "watchTime", "averageWatchTime", "skipRate"],
        tiktok: ["views", "likes", "comments", "shares", "followers", "following", "totalLikes", "publishedVideos", "duration"],
        facebook: ["views", "likes", "comments", "shares", "pageViews", "pageEngagements"],
        threads: ["views", "likes", "replies", "reposts", "quotes", "clicks", "followers"],
      };
      const audience = provider === "instagram"
        ? 21470
        : provider === "tiktok"
          ? 38200
          : provider === "facebook"
            ? 12840
            : 7460;
      return {
        provider,
        connected: true,
        ready: true,
        missingScopes: [],
        handle: provider === "facebook" ? "Posterract Lab" : "@posterract-lab",
        audienceLabel: "Followers" as const,
        audience,
        audienceDelta: totals.audienceDelta,
        following: provider === "tiktok" ? 412 : undefined,
        totalLikes: provider === "tiktok" ? 486300 : undefined,
        publishedVideos: provider === "tiktok" ? 184 : undefined,
        reach: provider === "instagram" ? Math.round(totals.views * 0.82) : undefined,
        saves: provider === "instagram" ? Math.round(totals.views * 0.012) : undefined,
        replies: provider === "threads" ? totals.comments : undefined,
        reposts: provider === "threads" ? Math.round(totals.shares * 0.7) : undefined,
        quotes: provider === "threads" ? Math.round(totals.shares * 0.3) : undefined,
        clicks: provider === "threads" ? Math.round(totals.views * 0.006) : undefined,
        pageViews: provider === "facebook" ? Math.round(totals.views * 0.18) : undefined,
        postViews: provider === "facebook" ? totals.views : undefined,
        totalInteractions: totals.likes + totals.comments + totals.shares,
        averageWatchSeconds: provider === "instagram" ? 9.1 : undefined,
        skipRate: provider === "instagram" ? 34 : undefined,
        views: totals.views,
        likes: totals.likes,
        comments: totals.comments,
        shares: totals.shares,
        watchMinutes: provider === "instagram" ? totals.watchMinutes : undefined,
        publishedPosts: rangeDays === "total" ? 184 : rangeDays === 7 ? 4 : rangeDays === 30 ? 17 : 48,
        lastSyncedAt: Date.now() - 11 * 60_000,
        availableMetrics: providerMetrics[provider],
        metricNotes: provider === "tiktok"
          ? ["TikTok analytics cover public account and per-video counters; watch time and retention are not exposed by the approved scopes."]
          : provider === "facebook"
            ? ["Page activity and Posterract-published post views remain separate."]
            : provider === "threads"
              ? ["Replies, reposts, and quotes remain separate signals."]
              : ["Advanced Reel metrics depend on media type and Meta availability."],
        daily,
        posts,
        previousPeriod: rangeDays === "total" ? undefined : {
          audience: audience - totals.audienceDelta,
          audienceDelta: Math.round(totals.audienceDelta * 0.72),
          views: Math.round(totals.views * 0.84),
          likes: Math.round(totals.likes * 0.81),
          comments: Math.round(totals.comments * 0.87),
          shares: Math.round(totals.shares * 0.78),
          reach: provider === "instagram" ? Math.round(totals.views * 0.69) : undefined,
          saves: provider === "instagram" ? Math.round(totals.views * 0.009) : undefined,
          replies: provider === "threads" ? Math.round(totals.comments * 0.84) : undefined,
          reposts: provider === "threads" ? Math.round(totals.shares * 0.58) : undefined,
          quotes: provider === "threads" ? Math.round(totals.shares * 0.22) : undefined,
          clicks: provider === "threads" ? Math.round(totals.views * 0.004) : undefined,
          watchMinutes: provider === "instagram" ? Math.round(totals.watchMinutes * 0.8) : undefined,
          publishedPosts: rangeDays === 7 ? 3 : rangeDays === 30 ? 14 : 42,
        },
      };
    };
    return { rangeDays, platforms: [makePlatform("instagram"), makePlatform("tiktok"), makePlatform("facebook"), makePlatform("threads")] };
  }, [rangeDays]);
}
export const useEngineActions = () =>
  useEngineStore(
    useShallow((s) => ({
      addArtifact: s.addArtifact,
      renameArtifact: s.renameArtifact,
      deleteArtifact: s.deleteArtifact,
      createTransmission: s.createTransmission,
      rescheduleTransmission: s.rescheduleTransmission,
      cancelTransmission: s.cancelTransmission,
      duplicateTransmission: s.duplicateTransmission,
      retryProjection: s.retryProjection,
      setPortalStatus: s.setPortalStatus,
    })),
  );

export function artifactUrl(artifactId: string | undefined): string | undefined {
  return artifactId ? artifactUrls.get(artifactId) : undefined;
}

/** Demo mode has no real OAuth — Portals uses the setPortalStatus toggle instead. */
export const OAUTH_SUPPORTED = new Set<import("@posterract/contract").PlatformId>();
export function useOAuth() {
  return {
    supported: OAUTH_SUPPORTED,
    start: async () => ({ url: "" }),
    complete: async () => ({ ok: false as const, error: "Demo mode" }),
    selectFacebookPage: async () => ({ ok: false as const, error: "Demo mode" }),
    disconnect: async (_accountId: string) => {},
    refreshProfiles: async () => {},
  };
}

export function useAccountSetActions() {
  return {
    create: async (_input: { name: string; accountIds: string[] }) => { throw new Error("Account sets require the PostgreSQL engine"); },
    update: async (_id: string, _input: { name: string; accountIds: string[] }) => { throw new Error("Account sets require the PostgreSQL engine"); },
    remove: async (_id: string) => undefined,
  };
}
