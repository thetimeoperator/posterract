import { useEffect } from "react";
import { create } from "zustand";
import type {
  BusinessDTO,
  AccountAnalyticsResponseDTO,
  AccountPostsDTO,
  PeriodStatsDTO,
  AnalyticsDashboardDTO,
  AnalyticsRangeDays,
  ArtifactDTO,
  EventDTO,
  LeaderboardDTO,
  LeaderboardPeriod,
  PlatformId,
  PointsDashboardDTO,
  PointsFeedPageDTO,
  PointsSummaryDTO,
  CardImagesDTO,
  PortalDTO,
  ProjectionDTO,
  TransmissionDTO,
  AccountLimitDTO,
  SavagesPlanDTO,
  SavagesPlanId,
} from "@posterract/contract";
import type { AnalyticsScope, BusinessInput, CreateTransmissionInput, PeriodQuery } from "./store";
import { cloudJson } from "@/lib/cloudRequest";
import { readCached, writeCached } from "@/lib/sessionCache";
import { desktopRequest, isPosterractDesktop } from "@/lib/desktop";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";

export const getTikTokCreatorInfo = (accountId: string) =>
  request<import("@posterract/contract/tiktok").TikTokCreatorInfo>(`/v1/accounts/${encodeURIComponent(accountId)}/tiktok/creator-info`);

type Bootstrap = {
  workspaceId: string;
  artifacts: ArtifactDTO[];
  transmissions: TransmissionDTO[];
  projections: ProjectionDTO[];
  events: EventDTO[];
  portals: PortalDTO[];
  businesses: BusinessDTO[];
  points: PointsSummaryDTO;
  /** How many accounts the workspace may connect (10 on Pro, 100 for an AI FOR SAVAGES member). */
  accountLimit?: AccountLimitDTO;
};

type State = Bootstrap & {
  loaded: boolean;
  /** Keyed by range, business and accounts (see analyticsKey). */
  analytics: Record<string, AnalyticsDashboardDTO>;
  accountAnalytics: Partial<Record<AnalyticsRangeDays, AccountAnalyticsResponseDTO>>;
  /** Keyed by period and scope (see periodKey). */
  periodStats: Record<string, PeriodStatsDTO>;
  pointsDashboard?: PointsDashboardDTO;
  /** Recent points feed pages after the first, which comes with the dashboard. */
  pointsFeeds: Record<number, PointsFeedPageDTO>;
  leaderboards: Partial<Record<LeaderboardPeriod, LeaderboardDTO>>;
  /** Every post on every account in the last 120 days, from any app or tool. */
  accountPosts?: AccountPostsDTO;
  refresh: () => Promise<void>;
  loadAnalytics: (rangeDays: AnalyticsRangeDays, scope?: AnalyticsScope) => Promise<void>;
  loadAccountAnalytics: (rangeDays: AnalyticsRangeDays) => Promise<void>;
  loadPeriodStats: (query: PeriodQuery) => Promise<void>;
  loadPointsDashboard: () => Promise<void>;
  loadPointsFeed: (page: number) => Promise<void>;
  loadLeaderboard: (period: LeaderboardPeriod) => Promise<void>;
  loadAccountPosts: () => Promise<void>;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return cloudJson<T>(API_BASE, path, init);
}

/** What a visit remembers for the next one: the workspace data and the Points dashboard. */
type CachedEngine = { data: Bootstrap; pointsDashboard?: PointsDashboardDTO };

/** The signed-in user the cache belongs to, once startEngine has been told. */
let cacheUser: string | undefined;
/** One bootstrap at a time: a second caller shares the request already on its way. */
let refreshing: Promise<void> | undefined;

function remember() {
  const state = usePostgresStore.getState();
  if (!cacheUser || !state.loaded) return;
  const data: Bootstrap = {
    workspaceId: state.workspaceId,
    artifacts: state.artifacts,
    transmissions: state.transmissions,
    projections: state.projections,
    events: state.events,
    portals: state.portals,
    businesses: state.businesses,
    points: state.points,
    accountLimit: state.accountLimit,
  };
  writeCached("engine", cacheUser, { data, pointsDashboard: state.pointsDashboard } satisfies CachedEngine);
}

const emptyPoints: PointsSummaryDTO = {
  lifetimeRP: 0,
  weekRP: 0,
  streakDays: 0,
  badges: [],
  recent: [],
};

const usePostgresStore = create<State>((set) => ({
  loaded: false,
  workspaceId: "",
  artifacts: [],
  transmissions: [],
  projections: [],
  events: [],
  portals: [],
  businesses: [],
  points: emptyPoints,
  analytics: {},
  accountAnalytics: {},
  periodStats: {},
  pointsFeeds: {},
  leaderboards: {},
  refresh: () => {
    refreshing ??= (async () => {
      try {
        const data = await request<Bootstrap>("/v1/bootstrap");
        for (const artifact of data.artifacts) {
          if (artifact.publicUrl) artifactUrls.set(artifact.id, artifact.publicUrl);
        }
        set({ ...data, loaded: true });
        remember();
      } finally {
        refreshing = undefined;
      }
    })();
    return refreshing;
  },
  loadAnalytics: async (rangeDays, scope) => {
    const query = new URLSearchParams({ rangeDays: String(rangeDays) });
    if (scope?.businessId) query.set("business", scope.businessId);
    if (scope?.accountIds?.length) query.set("accounts", scope.accountIds.join(","));
    const data = await request<AnalyticsDashboardDTO>(`/v1/analytics?${query}`);
    set((state) => ({ analytics: { ...state.analytics, [analyticsKey(rangeDays, scope)]: data } }));
  },
  loadAccountAnalytics: async (rangeDays) => {
    const data = await request<AccountAnalyticsResponseDTO>(`/v1/analytics/accounts?rangeDays=${rangeDays}`);
    set((state) => ({ accountAnalytics: { ...state.accountAnalytics, [rangeDays]: data } }));
  },
  loadPeriodStats: async (query) => {
    const params = new URLSearchParams({ from: query.from, to: query.to, tz: query.timeZone });
    if (query.businessId) params.set("business", query.businessId);
    const data = await request<PeriodStatsDTO>(`/v1/stats/period?${params}`);
    set((state) => ({ periodStats: { ...state.periodStats, [periodKey(query)]: data } }));
  },
  loadPointsDashboard: async () => {
    const data = await request<PointsDashboardDTO>("/v1/points/dashboard");
    set({ pointsDashboard: data });
    remember();
  },
  loadPointsFeed: async (page) => {
    const data = await request<PointsFeedPageDTO>(`/v1/points/feed?page=${page}`);
    set((state) => ({ pointsFeeds: { ...state.pointsFeeds, [page]: data } }));
  },
  loadAccountPosts: async () => {
    const data = await request<AccountPostsDTO>("/v1/analytics/posts");
    set({ accountPosts: { posts: data.posts, syncing: data.syncing ?? [] } });
  },
  loadLeaderboard: async (period) => {
    const data = await request<LeaderboardDTO>(`/v1/leaderboard?period=${period}`);
    set((state) => ({ leaderboards: { ...state.leaderboards, [period]: data } }));
  },
}));

export async function refreshPostgresEngine(): Promise<void> {
  await usePostgresStore.getState().refresh();
}

// Streak days follow the creator's own calendar, so once per launch the
// server is told the time zone this device is in.
let timeZoneSent = false;
function sendTimeZone() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (timeZoneSent || !timeZone) return;
  timeZoneSent = true;
  void request("/v1/points/time-zone", {
    method: "PUT",
    body: JSON.stringify({ timeZone }),
  }).catch(() => {
    timeZoneSent = false;
  });
}

/**
 * Signed in: paint from what the last visit saw at once, and start loading the
 * real data now, alongside the billing check, instead of after it. The data
 * shown is only ever this user's, and is replaced the moment the request lands.
 */
export function startEngine(userId: string | undefined) {
  if (!userId) return;
  if (cacheUser !== userId) {
    cacheUser = userId;
    const cached = readCached<CachedEngine>("engine", userId);
    if (cached?.data && !usePostgresStore.getState().loaded) {
      for (const artifact of cached.data.artifacts ?? []) {
        if (artifact.publicUrl) artifactUrls.set(artifact.id, artifact.publicUrl);
      }
      usePostgresStore.setState({ ...cached.data, loaded: true, pointsDashboard: cached.pointsDashboard });
    }
  }
  void usePostgresStore
    .getState()
    .refresh()
    .catch(() => undefined);
}

export function useEngineBoot() {
  const refresh = usePostgresStore((state) => state.refresh);
  useEffect(() => {
    let active = true;
    const run = () =>
      void refresh().then(sendTimeZone, (error) => {
        if (active) console.error("PostgreSQL engine refresh failed", error);
      });
    run();
    window.addEventListener("focus", run);
    return () => {
      active = false;
      window.removeEventListener("focus", run);
    };
  }, [refresh]);
}

export const useArtifacts = () => usePostgresStore((state) => state.artifacts);
export const useTransmissions = () => usePostgresStore((state) => state.transmissions);
export const useProjections = () => usePostgresStore((state) => state.projections);
export const useEvents = () => usePostgresStore((state) => state.events);
export const usePortals = () => usePostgresStore((state) => state.portals);
export const useAccountLimit = () => usePostgresStore((state) => state.accountLimit);
export const useRefresh = () => usePostgresStore((state) => state.refresh);
/** AI FOR SAVAGES' three plans, live from Stripe through the Hub. */
export const fetchSavagesPlans = () => request<{ plans: SavagesPlanDTO[] }>("/v1/savages/plans");
/** Stripe Checkout for AI FOR SAVAGES, for the signed-in owner. */
export const startSavagesCheckout = (plan: SavagesPlanId) =>
  request<{ url: string }>("/v1/savages/checkout/member", { method: "POST", body: JSON.stringify({ plan }) });
export const useBusinesses = () => usePostgresStore((state) => state.businesses);
export const usePoints = () => usePostgresStore((state) => state.points);
/** False until the first load, so nothing shows level 1 before the real points arrive. */
export const usePointsReady = () => usePostgresStore((state) => state.loaded);

/** Every account's stats for a period, for the Businesses tab on Analytics. */
export function useAccountAnalytics(rangeDays: AnalyticsRangeDays): AccountAnalyticsResponseDTO | undefined {
  const data = usePostgresStore((state) => state.accountAnalytics[rangeDays]);
  const load = usePostgresStore((state) => state.loadAccountAnalytics);
  useEffect(() => {
    void load(rangeDays).catch((error) => console.error("Account analytics refresh failed", error));
  }, [load, rangeDays]);
  return data;
}

/**
 * When every post on each account went live (last 120 days), whichever app or
 * tool made it, for the posting graph. Undefined until the first load.
 */
export function useAccountPosts(): AccountPostsDTO | null | undefined {
  const data = usePostgresStore((state) => state.accountPosts);
  const load = usePostgresStore((state) => state.loadAccountPosts);
  useEffect(() => {
    const run = () => void load().catch((error) => console.error("Account posts refresh failed", error));
    run();
    window.addEventListener("focus", run);
    return () => window.removeEventListener("focus", run);
  }, [load]);
  // A new connection's past posts arrive within moments: check back until they do.
  const waiting = (data?.syncing.length ?? 0) > 0;
  useEffect(() => {
    if (!waiting) return;
    let checks = 0;
    const timer = window.setInterval(() => {
      checks += 1;
      if (checks > 45) window.clearInterval(timer);
      else void load().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [waiting, load]);
  return data;
}

function periodKey(query: PeriodQuery) {
  return `${query.from}|${query.to}|${query.timeZone}|${query.businessId ?? ""}`;
}

/** Views, points and streak for the month or week on the calendar. */
export function usePeriodStats(query: PeriodQuery): PeriodStatsDTO | undefined {
  const key = periodKey(query);
  const data = usePostgresStore((state) => state.periodStats[key]);
  const load = usePostgresStore((state) => state.loadPeriodStats);
  const { from, to, timeZone, businessId } = query;
  useEffect(() => {
    void load({ from, to, timeZone, businessId }).catch((error) => console.error("Period stats refresh failed", error));
  }, [load, from, to, timeZone, businessId]);
  return data;
}

function analyticsKey(rangeDays: AnalyticsRangeDays, scope?: AnalyticsScope) {
  return `${rangeDays}|${scope?.businessId ?? ""}|${[...(scope?.accountIds ?? [])].sort().join(",")}`;
}

export function useAnalyticsDashboard(
  rangeDays: AnalyticsRangeDays,
  scope?: AnalyticsScope,
): AnalyticsDashboardDTO | undefined {
  const key = analyticsKey(rangeDays, scope);
  const dashboard = usePostgresStore((state) => state.analytics[key]);
  const loadAnalytics = usePostgresStore((state) => state.loadAnalytics);
  const businessId = scope?.businessId;
  const accounts = scope?.accountIds?.join(",");
  useEffect(() => {
    const scoped = { businessId, accountIds: accounts ? accounts.split(",") : undefined };
    void loadAnalytics(rangeDays, scoped).catch((error) => {
      console.error("PostgreSQL analytics refresh failed", error);
    });
  }, [loadAnalytics, rangeDays, businessId, accounts]);
  return dashboard;
}

export function usePointsDashboard(): PointsDashboardDTO | undefined {
  const dashboard = usePostgresStore((state) => state.pointsDashboard);
  const loadPointsDashboard = usePostgresStore((state) => state.loadPointsDashboard);
  useEffect(() => {
    void loadPointsDashboard().catch((error) => {
      console.error("PostgreSQL points refresh failed", error);
    });
  }, [loadPointsDashboard]);
  return dashboard;
}

/** A page of the Recent points feed: the first comes with the dashboard, the rest load when someone turns to them. */
export function usePointsFeed(page: number): PointsFeedPageDTO | undefined {
  const first = usePostgresStore((state) => state.pointsDashboard?.feed);
  const later = usePostgresStore((state) => (page > 1 ? state.pointsFeeds[page] : undefined));
  const loadPointsFeed = usePostgresStore((state) => state.loadPointsFeed);
  useEffect(() => {
    if (page <= 1) return;
    void loadPointsFeed(page).catch((error) => {
      console.error("PostgreSQL points feed failed", error);
    });
  }, [loadPointsFeed, page]);
  return page <= 1 ? first : later;
}

export function useLeaderboard(period: LeaderboardPeriod): LeaderboardDTO | undefined {
  const leaderboard = usePostgresStore((state) => state.leaderboards[period]);
  const loadLeaderboard = usePostgresStore((state) => state.loadLeaderboard);
  useEffect(() => {
    void loadLeaderboard(period).catch((error) => {
      console.error("PostgreSQL leaderboard refresh failed", error);
    });
  }, [loadLeaderboard, period]);
  return leaderboard;
}

/** The pictures rank cards draw, as data URLs: the creator's avatar and the named posts' covers. */
export async function fetchCardImages(covers: string[], avatar = true): Promise<CardImagesDTO> {
  const query = new URLSearchParams();
  if (avatar) query.set("avatar", "1");
  if (covers.length) query.set("covers", covers.slice(0, 12).join(","));
  return request<CardImagesDTO>(`/v1/points/card-images?${query}`);
}

export const artifactUrls = new Map<string, string>();
export function artifactUrl(artifactId: string | undefined) {
  return artifactId ? artifactUrls.get(artifactId) : undefined;
}

export function useEngineActions() {
  const refresh = usePostgresStore((state) => state.refresh);
  const workspaceId = usePostgresStore((state) => state.workspaceId);
  return {
    addArtifact: async (
      file: File,
      meta: { durationMs?: number; width?: number; height?: number },
      onProgress?: (fraction: number) => void,
    ) => {
      let result: { mediaId: string };
      if (isPosterractDesktop()) {
        // A file from disk uploads by its path; one made in the app (a rank
        // card's video) has none, so its bytes go to the app to upload.
        const path = window.desktop?.getPathForFile(file);
        const key = path || `memory:${crypto.randomUUID()}`;
        const stopProgress = window.desktop?.on("main:event", (payload) => {
          const event = payload as { channel?: string; data?: { path?: string; progress?: number } };
          const progress = event.data?.progress;
          if (
            event.channel === "cloud:upload-progress"
            && event.data?.path === key
            && typeof progress === "number"
            && Number.isFinite(progress)
          ) {
            onProgress?.(progress);
          }
        });
        try {
          const details = { contentType: file.type, durationMs: meta.durationMs, width: meta.width, height: meta.height };
          result = path
            ? await desktopRequest<{ mediaId: string }>("cloud:upload-file", { path, ...details })
            : await desktopRequest<{ mediaId: string }>("cloud:upload-bytes", {
                key,
                name: file.name,
                bytes: new Uint8Array(await file.arrayBuffer()),
                ...details,
              });
        } finally {
          stopProgress?.();
        }
      } else {
        const { uploadVideoToR2 } = await import("@/lib/r2MultipartUpload");
        result = await uploadVideoToR2({
          file,
          workspaceId,
          apiBaseUrl: API_BASE,
          meta,
          onProgress,
        });
      }
      await refresh();
      const artifact = usePostgresStore
        .getState()
        .artifacts.find((item) => item.id === result.mediaId);
      if (!artifact) throw new Error("Uploaded media was not returned by the API");
      return artifact;
    },
    renameArtifact: (id: string, fileName: string) => {
      void request(`/v1/media/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ fileName }),
      }).then(refresh);
    },
    deleteArtifact: async (id: string) => {
      try {
        await request(`/v1/media/${encodeURIComponent(id)}`, { method: "DELETE" });
        await refresh();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : "Could not delete media",
        };
      }
    },
    createTransmission: async (input: CreateTransmissionInput) => {
      const idempotencyKey = input.idempotencyKey || crypto.randomUUID();
      const result = await request<{ id: string }>("/v1/posts", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          title: input.title,
          caption: input.baseCaption,
          hashtags: input.hashtags,
          artifactId: input.artifactId,
          platforms: input.platforms,
          perPlatform: Object.fromEntries(
            input.platforms.map((provider) => [
              provider,
              {
                caption: input.perPlatformCaptions[provider],
                options: input.perPlatformOptions?.[provider] ?? {},
              },
            ]),
          ),
          scheduledFor:
            input.scheduleMode === "now"
              ? "now"
              : new Date(input.scheduledFor).toISOString(),
          businessId: input.businessId,
          accountIds: input.accountIds,
        }),
      });
      await refresh();
      return {
        id: result.id,
        workspaceId,
        title: input.title || "Untitled post",
        baseCaption: input.baseCaption,
        hashtags: input.hashtags,
        artifactId: input.artifactId,
        status: "scheduled",
        scheduleMode: input.scheduleMode,
        scheduledFor: input.scheduledFor,
        source: "ui",
        businessId: input.businessId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } satisfies TransmissionDTO;
    },
    rescheduleTransmission: async (id: string, scheduledFor: number) => {
      const previous = usePostgresStore
        .getState()
        .transmissions.find((item) => item.id === id);
      if (!previous || previous.status !== "scheduled") {
        throw new Error("Only scheduled posts can be moved");
      }
      usePostgresStore.setState((state) => ({
        transmissions: state.transmissions.map((item) =>
          item.id === id
            ? { ...item, scheduleMode: "at", scheduledFor, updatedAt: Date.now() }
            : item,
        ),
      }));
      try {
        await request(`/v1/posts/${encodeURIComponent(id)}/reschedule`, {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ scheduledFor: new Date(scheduledFor).toISOString() }),
        });
        await refresh();
      } catch (error) {
        usePostgresStore.setState((state) => ({
          transmissions: state.transmissions.map((item) =>
            item.id === id ? previous : item,
          ),
        }));
        throw error;
      }
    },
    cancelTransmission: (id: string) => {
      void request(`/v1/posts/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      }).then(refresh);
    },
    duplicateTransmission: (id: string) => {
      void request(`/v1/posts/${encodeURIComponent(id)}/duplicate`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      }).then(refresh);
    },
    retryProjection: (id: string) => {
      void request(`/v1/projections/${encodeURIComponent(id)}/retry`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      }).then(refresh);
    },
    setPortalStatus: (_provider: PlatformId, _status: PortalDTO["status"]) => undefined,
  };
}

export const OAUTH_SUPPORTED = new Set<PlatformId>([
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
  "threads",
]);
export function useOAuth() {
  const refresh = usePostgresStore((state) => state.refresh);
  return {
    supported: OAUTH_SUPPORTED,
    start: (provider: PlatformId) =>
      request<{ url: string }>(`/v1/oauth/${provider}/start`, { method: "POST" }),
    complete: async (provider: PlatformId, code: string, state: string) => {
      const result = await request<{
        ok: boolean;
        handle?: string;
        error?: string;
        code?: string;
        returnTo?: "desktop" | "web";
        selectionRequired?: boolean;
        pages?: Array<{ id: string; name: string }>;
      }>(`/v1/oauth/${provider}/complete`, {
        method: "POST",
        body: JSON.stringify({ code, state }),
      });
      // Desktop OAuth completes in the system browser, which intentionally
      // does not hold the desktop app's native access token. The connection
      // is already saved by the API; let the callback reopen the desktop app
      // instead of issuing an unauthenticated browser bootstrap request.
      if (result.ok && !result.selectionRequired && result.returnTo !== "desktop") {
        await refresh();
      }
      return result;
    },
    selectFacebookPage: async (state: string, pageId: string) => {
      const result = await request<{
        ok: boolean;
        handle?: string;
        error?: string;
        code?: string;
        returnTo?: "desktop" | "web";
      }>(
        "/v1/oauth/facebook/select-page",
        { method: "POST", body: JSON.stringify({ state, pageId }) },
      );
      if (result.ok && result.returnTo !== "desktop") await refresh();
      return result;
    },
    disconnect: async (accountId: string) => {
      await request(`/v1/accounts/by-id/${encodeURIComponent(accountId)}`, { method: "DELETE" });
      await refresh();
    },
    refreshProfiles: async () => {
      await request("/v1/accounts/refresh-profiles", { method: "POST" });
      await refresh();
    },
  };
}

export function useBusinessActions() {
  const refresh = usePostgresStore((state) => state.refresh);
  return {
    create: async (input: BusinessInput) => {
      const result = await request<BusinessDTO>("/v1/businesses", {
        method: "POST",
        body: JSON.stringify(input),
      });
      await refresh();
      return result;
    },
    update: async (id: string, input: BusinessInput) => {
      const result = await request<BusinessDTO>(
        `/v1/businesses/${encodeURIComponent(id)}`,
        { method: "PUT", body: JSON.stringify(input) },
      );
      await refresh();
      return result;
    },
    remove: async (id: string) => {
      await request(`/v1/businesses/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    },
  };
}
