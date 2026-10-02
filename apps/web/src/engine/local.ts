/**
 * LOCAL engine — the in-browser demo implementation (zustand + IndexedDB +
 * publish simulator). Used when no cloud deployment is configured, and by
 * e2e tests for deterministic offline runs.
 */
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { artifactUrls, useEngineStore, type AnalyticsScope, type BusinessInput, type PeriodQuery } from "./store";
import { startSimulator } from "./simulator";
import {
  POINTS_SOURCE_LABELS,
  levelProgress,
  nextRank,
  rankFor,
  type BusinessDTO,
  type AccountAnalyticsDTO,
  type AccountAnalyticsResponseDTO,
  type PeriodStatsDTO,
  type AnalyticsDashboardDTO,
  type AnalyticsRangeDays,
  type LeaderboardDTO,
  type LeaderboardPeriod,
  type PlatformId,
  type PointsDashboardDTO,
  type PointsEntryDTO,
  type PointsPlatform,
  type PointsSource,
  type PostPointsDTO,
} from "@posterract/contract";

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
export async function getTikTokCreatorInfo(accountId: string): Promise<import("@posterract/contract/tiktok").TikTokCreatorInfo> {
  const account = useEngineStore.getState().portals.find((p) => p.id === accountId && p.provider === "tiktok");
  if (!account || account.status !== "connected") throw new Error("Reconnect this TikTok account in Portals.");
  return { creator_nickname: account.displayName || account.handle, creator_username: account.handle.replace(/^@/, ""),
    creator_avatar_url: account.avatarUrl || "", privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
    comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 600 };
}
export const useBusinesses = (): BusinessDTO[] => useEngineStore((s) => s.businesses);
export const usePointsReady = () => true;
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
// Demo points: posts scored under the real rules (see POINTS_RATES), so the
// Points tab shows what a working creator's month looks like.
const DEMO_POINTS_POSTS: Array<{
  provider: PointsPlatform;
  title: string;
  daysAgo: number;
  parts: Array<[PointsSource, number, number?]>;
}> = [
  { provider: "instagram", title: "The habit that changed my mornings", daysAgo: 3, parts: [
    ["watch", 96.5, 96.5], ["views", 48.2, 48_200], ["saves", 34.6, 692], ["likes", 31.4, 3_140],
    ["comments", 28.6, 286], ["shares", 20.5, 410], ["record", 10, 48_200], ["retention", 5, 58.3], ["post", 1],
  ] },
  { provider: "facebook", title: "Building the studio in 30 seconds", daysAgo: 6, parts: [
    ["watch", 61.2, 61.2], ["views", 31.6, 31_600], ["likes", 19.2, 1_920], ["shares", 19, 380],
    ["comments", 14.4, 144], ["retention", 10, 79.1], ["breakout", 5, 31_600], ["post", 1],
  ] },
  { provider: "threads", title: "The product drop nobody expected", daysAgo: 9, parts: [
    ["comments", 32, 320], ["views", 29.2, 58_400], ["likes", 26.1, 2_610], ["shares", 22.5, 450], ["post", 1],
  ] },
  { provider: "instagram", title: "Five edits that doubled my watch time", daysAgo: 12, parts: [
    ["watch", 38.4, 38.4], ["views", 22.9, 22_900], ["saves", 15.5, 310], ["likes", 11.8, 1_180],
    ["comments", 9.6, 96], ["shares", 7, 140], ["post", 1],
  ] },
  { provider: "facebook", title: "Studio tour, part two", daysAgo: 15, parts: [
    ["watch", 21.7, 21.7], ["views", 12.4, 12_400], ["likes", 6.4, 640], ["comments", 5.2, 52], ["shares", 4.4, 88], ["post", 1],
  ] },
  { provider: "instagram", title: "Lighting setup under $100", daysAgo: 18, parts: [
    ["watch", 8.2, 8.2], ["views", 6.1, 6_100], ["saves", 3.7, 74], ["likes", 2.8, 280],
    ["comments", 2.2, 22], ["shares", 0.9, 18], ["post", 1],
  ] },
  { provider: "threads", title: "Why I stopped posting daily", daysAgo: 21, parts: [
    ["comments", 6.4, 64], ["views", 4.9, 9_800], ["likes", 4.2, 420], ["shares", 1.8, 36], ["post", 1],
  ] },
  { provider: "facebook", title: "The 3-second hook rule", daysAgo: 24, parts: [
    ["watch", 5.6, 5.6], ["views", 4.3, 4_300], ["likes", 1.9, 190], ["comments", 1.4, 14], ["shares", 0.6, 12], ["post", 1],
  ] },
];

const DEMO_PROVIDER_LABELS: Record<PointsPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
};

const round2 = (value: number) => Math.round(value * 100) / 100;

function demoPointsDashboard(): PointsDashboardDTO {
  const now = Date.now();
  const topPosts: PostPointsDTO[] = DEMO_POINTS_POSTS.map((post, index) => ({
    projectionId: `points_demo_${index}`,
    provider: post.provider,
    title: post.title,
    publishedAt: now - post.daysAgo * 86_400_000,
    total: round2(post.parts.reduce((sum, [, points]) => sum + points, 0)),
    parts: post.parts.map(([source, points, value]) => ({ source, points, value })),
  }));
  const recent: PointsEntryDTO[] = [
    { id: "demo_streak_7", source: "streak" as const, amount: 10, note: "7-day streak", at: now - 5 * 86_400_000 },
    { id: "demo_followers_5k", source: "followers" as const, amount: 40, note: "5,000 followers · Threads @posterract-lab", at: now - 8 * 86_400_000 },
    ...DEMO_POINTS_POSTS.slice(0, 4).flatMap((post, postIndex) =>
      post.parts.slice(0, 3).map(([source, points], partIndex) => ({
        id: `demo_${postIndex}_${source}`,
        source,
        amount: round2(points / (partIndex + 2)),
        note: `${POINTS_SOURCE_LABELS[source]} · ${DEMO_PROVIDER_LABELS[post.provider]} · ${post.title}`,
        at: now - (postIndex * 2 + partIndex + 1) * 3_600_000,
      })),
    ),
  ].sort((left, right) => right.at - left.at);
  const totalPoints = round2(topPosts.reduce((sum, post) => sum + post.total, 0) + 10 + 40);
  const progress = levelProgress(totalPoints);
  const rank = rankFor(totalPoints);
  const upcoming = nextRank(totalPoints);
  return {
    totalPoints,
    weekPoints: 86.45,
    monthPoints: 402.7,
    level: progress.level,
    levelFloor: progress.floor,
    nextLevelAt: progress.next,
    rank: { id: rank.id, label: rank.label },
    nextRank: upcoming ? { id: upcoming.id, label: upcoming.label, minLevel: upcoming.minLevel } : undefined,
    streak: { current: 12, best: 19, next: { days: 30, points: 1_000 } },
    followers: [
      { accountId: "demo_ig", provider: "instagram", handle: "@posterract-lab", followers: 21_470, baseline: 18_200, next: { followers: 25_000, points: 150 } },
      { accountId: "demo_fb", provider: "facebook", handle: "Posterract Lab", followers: 12_840, baseline: 12_100, next: { followers: 25_000, points: 150 } },
      { accountId: "demo_th", provider: "threads", handle: "@posterract-lab", followers: 7_460, baseline: 4_300, next: { followers: 10_000, points: 50 } },
    ],
    topPosts,
    recent,
    badges: ["first_transmission", "streak_7", "record", "breakout"],
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

const DEMO_CREATORS = [
  "Mara Vance", "Theo Lindqvist", "Juno Okafor", "Ren Castillo", "Ivy Marchetti", "Soren Blake",
  "Lena Ashworth", "Dax Moreau", "Noor Haddad", "Callum Reyes", "Tess Navarro", "Ezra Quinn",
  "Priya Sandoval", "Milo Kerrigan", "Wren Takahashi", "Otis Delacroix", "Ada Whitlock", "Jonah Ferreira",
  "Kira Lozano", "Silas Brennan", "Nadia Petrov", "Hugo Almeida", "Rhea Kessler",
];

function demoLeaderboard(period: LeaderboardPeriod, me: PointsDashboardDTO): LeaderboardDTO {
  const scale = period === "week" ? 0.07 : period === "month" ? 0.3 : 1;
  const mine = period === "week" ? me.weekPoints : period === "month" ? me.monthPoints : me.totalPoints;
  const rows = DEMO_CREATORS.map((name, index) => {
    const lifetime = round2(42_000 / (index + 1) ** 1.6 + 60);
    const points = round2(lifetime * scale * (1 + ((index * 37) % 11) / 40));
    return { name, lifetime, points, isMe: false };
  });
  rows.push({ name: "Posterract Lab", lifetime: me.totalPoints, points: mine, isMe: true });
  rows.sort((left, right) => right.points - left.points || right.lifetime - left.lifetime);
  const entries = rows.map((row, index) => {
    const rank = rankFor(row.lifetime);
    return {
      position: index + 1,
      name: row.name,
      level: levelProgress(row.lifetime).level,
      rank: { id: rank.id, label: rank.label },
      points: row.points,
      isMe: row.isMe,
    };
  });
  return { period, entries, me: entries.find((entry) => entry.isMe), total: entries.length };
}

export function usePointsDashboard(): PointsDashboardDTO {
  return useMemo(demoPointsDashboard, []);
}

export function useLeaderboard(period: LeaderboardPeriod): LeaderboardDTO {
  const me = usePointsDashboard();
  return useMemo(() => demoLeaderboard(period, me), [period, me]);
}

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

/** A stable 0..1 number per account, so every demo creator performs differently but the same each time. */
const demoWeight = (id: string) => {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return 0.35 + (hash % 1000) / 1000 * 1.3;
};

export function useAccountAnalytics(rangeDays: AnalyticsRangeDays): AccountAnalyticsResponseDTO {
  const portals = useEngineStore((s) => s.portals);
  const businesses = useEngineStore((s) => s.businesses);
  return useMemo(() => {
    const members = new Set(businesses.flatMap((business) => business.accountIds));
    const accounts = portals
      .filter((portal): portal is typeof portal & { provider: DemoAnalyticsProvider } =>
        ["instagram", "tiktok", "facebook", "threads"].includes(portal.provider) && (portal.status === "connected" || members.has(portal.id)))
      .map((portal): AccountAnalyticsDTO => {
        const weight = demoWeight(portal.id);
        const all = demoDaily(portal.provider, rangeDays === "total" ? 90 : (rangeDays * 2) as AnalyticsRangeDays);
        const half = rangeDays === "total" ? 0 : rangeDays;
        const currentDays = rangeDays === "total" ? all : all.slice(half);
        const previousDays = rangeDays === "total" ? [] : all.slice(0, half);
        const scale = (value: number) => Math.round(value * weight);
        const sum = (days: typeof all, key: "views" | "likes" | "comments" | "shares") => days.reduce((total, day) => total + scale(day[key]), 0);
        const views = sum(currentDays, "views");
        const likes = sum(currentDays, "likes");
        const comments = sum(currentDays, "comments");
        const shares = sum(currentDays, "shares");
        const interactions = likes + comments + shares;
        const posts = Math.max(1, Math.round(currentDays.length / 3 * weight));
        const quiet = weight < 0.6;
        return {
          accountId: portal.id,
          provider: portal.provider,
          handle: portal.handle,
          displayName: portal.displayName,
          avatarUrl: portal.avatarUrl,
          status: portal.status,
          audience: Math.round(18_000 * weight),
          audienceDelta: currentDays.reduce((total, day) => total + scale(day.audienceGained - day.audienceLost), 0),
          views, likes, comments, shares,
          interactions,
          engagementRate: views ? interactions / views : undefined,
          publishedPosts: quiet ? 0 : posts,
          lastPostAt: Date.now() - (quiet ? 9 : 1) * 86_400_000,
          points: Math.round(views / 1000 * 10) / 10 + (quiet ? 0 : posts),
          failedPosts: portal.status === "connected" ? 0 : 1,
          daily: currentDays.map((day) => ({ date: day.date, views: scale(day.views) })),
          previous: rangeDays === "total" ? undefined : {
            views: sum(previousDays, "views"),
            interactions: sum(previousDays, "likes") + sum(previousDays, "comments") + sum(previousDays, "shares"),
            audienceDelta: previousDays.reduce((total, day) => total + scale(day.audienceGained - day.audienceLost), 0),
            publishedPosts: Math.max(0, posts - 1),
            points: Math.round(sum(previousDays, "views") / 1000 * 10) / 10,
          },
          lastSyncedAt: Date.now() - 11 * 60_000,
        };
      });
    return { rangeDays, accounts };
  }, [portals, businesses, rangeDays]);
}

export function usePeriodStats(query: PeriodQuery): PeriodStatsDTO {
  const stats = useEngineStore((s) => s.stats);
  const points = useEngineStore((s) => s.points);
  return useMemo(() => {
    const start = new Date(`${query.from}T00:00:00`).getTime();
    const end = new Date(`${query.to}T00:00:00`).getTime() + 86_400_000;
    const span = end - start;
    const earned = (low: number, high: number) => points.filter((entry) => entry.at >= low && entry.at < high).reduce((total, entry) => total + entry.amount, 0);
    const today = Date.now();
    const days = Math.max(0, Math.round((Math.min(end, today) - start) / 86_400_000));
    const dailyViews = Array.from({ length: days }, (_, index) => {
      const date = new Date(start + index * 86_400_000);
      return { date: date.toISOString().slice(0, 10), views: 2_400 + Math.round(Math.sin(index * 0.7) * 600 + index * 40) };
    });
    const views = dailyViews.reduce((total, day) => total + day.views, 0);
    return {
      from: query.from,
      to: query.to,
      timeZone: query.timeZone,
      views,
      previousViews: Math.round(views * 0.82),
      dailyViews,
      points: Math.round(earned(start, end) * 100) / 100,
      previousPoints: Math.round(earned(start - span, start) * 100) / 100,
      streak: { days: stats.streakDays, postedToday: stats.lastPostDay === new Date().toISOString().slice(0, 10), next: { days: 7, points: 10 } },
    };
  }, [query.from, query.to, query.timeZone, stats, points]);
}

export function useAnalyticsDashboard(rangeDays: AnalyticsRangeDays, _scope?: AnalyticsScope): AnalyticsDashboardDTO {
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
    disconnect: async (accountId: string) => {
      useEngineStore.setState((state) => ({ portals: state.portals.map((account) => account.id === accountId ? { ...account, status: "disconnected" as const } : account) }));
    },
    refreshProfiles: async () => {},
  };
}

export function useBusinessActions() {
  return {
    create: async (input: BusinessInput) => useEngineStore.getState().saveBusiness(undefined, input),
    update: async (id: string, input: BusinessInput) => useEngineStore.getState().saveBusiness(id, input),
    remove: async (id: string) => useEngineStore.getState().removeBusiness(id),
  };
}

/** The demo engine has no platform post lists: the posting graph counts its own posts. */
export function useAccountPosts(): import("@posterract/contract").AccountPostDTO[] | null | undefined {
  return null;
}
