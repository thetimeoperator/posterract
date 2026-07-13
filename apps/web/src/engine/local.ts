/**
 * LOCAL engine — the in-browser demo implementation (zustand + IndexedDB +
 * publish simulator). Used when no cloud deployment is configured, and by
 * e2e tests for deterministic offline runs.
 */
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { artifactUrls, useEngineStore } from "./store";
import { startSimulator } from "./simulator";
import type { AnalyticsDashboardDTO, AnalyticsRangeDays, PlatformId } from "@posterract/contract";

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
const demoDaily = (provider: "youtube" | "tiktok", rangeDays: AnalyticsRangeDays) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: rangeDays }, (_, index) => {
    const date = new Date(today.getTime() - (rangeDays - index - 1) * 86400_000);
    const wave = Math.sin(index * 0.72 + (provider === "youtube" ? 0.4 : 1.6));
    const lift = index / Math.max(1, rangeDays - 1);
    const views = Math.max(0, Math.round((provider === "youtube" ? 720 : 980) + wave * 330 + lift * 760));
    return {
      date: date.toISOString().slice(0, 10),
      views,
      likes: Math.round(views * (provider === "youtube" ? 0.052 : 0.083)),
      comments: Math.round(views * 0.009),
      shares: Math.round(views * (provider === "youtube" ? 0.006 : 0.021)),
      watchMinutes: provider === "youtube" ? Math.round(views * 0.62) : undefined,
      audienceGained: Math.max(0, Math.round(views * 0.006 + wave * 2)),
      audienceLost: index % 9 === 0 ? 2 : 0,
    };
  });
};

export function useAnalyticsDashboard(rangeDays: AnalyticsRangeDays): AnalyticsDashboardDTO {
  return useMemo(() => {
    const makePlatform = (provider: "youtube" | "tiktok") => {
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
        watchMinutes: provider === "youtube" ? Math.round(totals.watchMinutes * 0.18 * post.factor) : undefined,
      }));
      return {
        provider,
        connected: true,
        ready: true,
        missingScopes: [],
        handle: provider === "youtube" ? "@posterract-lab" : "Posterract Lab",
        audienceLabel: provider === "youtube" ? "Subscribers" as const : "Followers" as const,
        audience: provider === "youtube" ? 12840 : 21470,
        audienceDelta: totals.audienceDelta,
        views: totals.views,
        likes: totals.likes,
        comments: totals.comments,
        shares: totals.shares,
        watchMinutes: provider === "youtube" ? totals.watchMinutes : undefined,
        publishedPosts: rangeDays === 7 ? 4 : rangeDays === 30 ? 17 : 48,
        lastSyncedAt: Date.now() - 11 * 60_000,
        daily,
        posts,
      };
    };
    return { rangeDays, platforms: [makePlatform("youtube"), makePlatform("tiktok")] };
  }, [rangeDays]);
}
export const useEngineActions = () =>
  useEngineStore(
    useShallow((s) => ({
      addArtifact: s.addArtifact,
      renameArtifact: s.renameArtifact,
      deleteArtifact: s.deleteArtifact,
      createTransmission: s.createTransmission,
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
    disconnect: async () => {},
  };
}
