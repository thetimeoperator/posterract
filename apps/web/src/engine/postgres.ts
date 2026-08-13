import { useEffect } from "react";
import { create } from "zustand";
import type {
  AnalyticsDashboardDTO,
  AnalyticsRangeDays,
  ArtifactDTO,
  EventDTO,
  PlatformId,
  PointsSummaryDTO,
  PortalDTO,
  ProjectionDTO,
  TransmissionDTO,
} from "@posterract/contract";
import type { CreateTransmissionInput } from "./store";
import { uploadVideoToR2 } from "@/lib/r2MultipartUpload";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";

type Bootstrap = {
  workspaceId: string;
  artifacts: ArtifactDTO[];
  transmissions: TransmissionDTO[];
  projections: ProjectionDTO[];
  events: EventDTO[];
  portals: PortalDTO[];
  points: PointsSummaryDTO;
};

type State = Bootstrap & {
  loaded: boolean;
  analytics: Partial<Record<AnalyticsRangeDays, AnalyticsDashboardDTO>>;
  refresh: () => Promise<void>;
  loadAnalytics: (rangeDays: AnalyticsRangeDays) => Promise<void>;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as
      | { error?: string }
      | undefined;
    throw new Error(payload?.error ?? `Posterract API failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
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
  points: emptyPoints,
  analytics: {},
  refresh: async () => {
    const data = await request<Bootstrap>("/v1/bootstrap");
    for (const artifact of data.artifacts) {
      if (artifact.publicUrl) artifactUrls.set(artifact.id, artifact.publicUrl);
    }
    set({ ...data, loaded: true });
  },
  loadAnalytics: async (rangeDays) => {
    const data = await request<AnalyticsDashboardDTO>(
      `/v1/analytics?rangeDays=${rangeDays}`,
    );
    set((state) => ({ analytics: { ...state.analytics, [rangeDays]: data } }));
  },
}));

export function useEngineBoot() {
  const refresh = usePostgresStore((state) => state.refresh);
  useEffect(() => {
    let active = true;
    const run = () =>
      void refresh().catch((error) => {
        if (active) console.error("PostgreSQL engine refresh failed", error);
      });
    run();
    const timer = window.setInterval(run, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refresh]);
}

export const useArtifacts = () => usePostgresStore((state) => state.artifacts);
export const useTransmissions = () => usePostgresStore((state) => state.transmissions);
export const useProjections = () => usePostgresStore((state) => state.projections);
export const useEvents = () => usePostgresStore((state) => state.events);
export const usePortals = () => usePostgresStore((state) => state.portals);
export const usePoints = () => usePostgresStore((state) => state.points);

export function useAnalyticsDashboard(
  rangeDays: AnalyticsRangeDays,
): AnalyticsDashboardDTO | undefined {
  const dashboard = usePostgresStore((state) => state.analytics[rangeDays]);
  const loadAnalytics = usePostgresStore((state) => state.loadAnalytics);
  useEffect(() => {
    void loadAnalytics(rangeDays).catch((error) => {
      console.error("PostgreSQL analytics refresh failed", error);
    });
  }, [loadAnalytics, rangeDays]);
  return dashboard;
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
    ) => {
      const result = await uploadVideoToR2({
        file,
        workspaceId,
        apiBaseUrl: API_BASE,
        meta,
      });
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
    createTransmission: (input: CreateTransmissionInput) => {
      const idempotencyKey = crypto.randomUUID();
      void request<{ id: string }>("/v1/posts", {
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
        }),
      }).then(refresh);
      return {
        id: `pending-${idempotencyKey}`,
        workspaceId,
        title: input.title || "Untitled post",
        baseCaption: input.baseCaption,
        hashtags: input.hashtags,
        artifactId: input.artifactId,
        status: "scheduled",
        scheduleMode: input.scheduleMode,
        scheduledFor: input.scheduledFor,
        source: "ui",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } satisfies TransmissionDTO;
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
        selectionRequired?: boolean;
        pages?: Array<{ id: string; name: string }>;
      }>(`/v1/oauth/${provider}/complete`, {
        method: "POST",
        body: JSON.stringify({ code, state }),
      });
      if (result.ok && !result.selectionRequired) await refresh();
      return result;
    },
    selectFacebookPage: async (state: string, pageId: string) => {
      const result = await request<{ ok: boolean; handle?: string; error?: string }>(
        "/v1/oauth/facebook/select-page",
        { method: "POST", body: JSON.stringify({ state, pageId }) },
      );
      if (result.ok) await refresh();
      return result;
    },
    disconnect: async (provider: PlatformId) => {
      await request(`/v1/accounts/${provider}`, { method: "DELETE" });
      await refresh();
    },
  };
}
