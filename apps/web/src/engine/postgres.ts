import { useEffect } from "react";
import { create } from "zustand";
import type {
  AccountSetDTO,
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
import { cloudJson } from "@/lib/cloudRequest";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";

type Bootstrap = {
  workspaceId: string;
  artifacts: ArtifactDTO[];
  transmissions: TransmissionDTO[];
  projections: ProjectionDTO[];
  events: EventDTO[];
  portals: PortalDTO[];
  accountSets: AccountSetDTO[];
  points: PointsSummaryDTO;
};

type State = Bootstrap & {
  loaded: boolean;
  analytics: Partial<Record<AnalyticsRangeDays, AnalyticsDashboardDTO>>;
  refresh: () => Promise<void>;
  loadAnalytics: (rangeDays: AnalyticsRangeDays) => Promise<void>;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return cloudJson<T>(API_BASE, path, init);
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
  accountSets: [],
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

export async function refreshPostgresEngine(): Promise<void> {
  await usePostgresStore.getState().refresh();
}

export function useEngineBoot() {
  const refresh = usePostgresStore((state) => state.refresh);
  useEffect(() => {
    let active = true;
    const run = () =>
      void refresh().catch((error) => {
        if (active) console.error("PostgreSQL engine refresh failed", error);
      });
    run();
    return () => {
      active = false;
    };
  }, [refresh]);
}

export const useArtifacts = () => usePostgresStore((state) => state.artifacts);
export const useTransmissions = () => usePostgresStore((state) => state.transmissions);
export const useProjections = () => usePostgresStore((state) => state.projections);
export const useEvents = () => usePostgresStore((state) => state.events);
export const usePortals = () => usePostgresStore((state) => state.portals);
export const useAccountSets = () => usePostgresStore((state) => state.accountSets);
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
      const { uploadVideoToR2 } = await import("@/lib/r2MultipartUpload");
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
          accountSetId: input.accountSetId,
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

export function useAccountSetActions() {
  const refresh = usePostgresStore((state) => state.refresh);
  return {
    create: async (input: { name: string; accountIds: string[] }) => {
      const result = await request<AccountSetDTO>("/v1/account-sets", {
        method: "POST",
        body: JSON.stringify(input),
      });
      await refresh();
      return result;
    },
    update: async (id: string, input: { name: string; accountIds: string[] }) => {
      const result = await request<AccountSetDTO>(
        `/v1/account-sets/${encodeURIComponent(id)}`,
        { method: "PUT", body: JSON.stringify(input) },
      );
      await refresh();
      return result;
    },
    remove: async (id: string) => {
      await request(`/v1/account-sets/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    },
  };
}
