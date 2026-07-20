/**
 * CLOUD engine — the Convex implementation. Same hook surface as local.ts;
 * data is live from the deployment, publishing runs on the cloud scheduler.
 */
import { useEffect } from "react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { create } from "zustand";
import type {
  ArtifactDTO,
  AnalyticsRangeDays,
  EventDTO,
  PlatformId,
  PointsSummaryDTO,
  PortalDTO,
  ProjectionDTO,
  TransmissionDTO,
} from "@posterract/contract";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { CreateTransmissionInput } from "./store";

/** Workspace context (single workspace until auth lands). */
type WorkspaceState = { workspaceId: string | null; setWorkspaceId: (id: string) => void };
export const useWorkspace = create<WorkspaceState>((set) => ({
  workspaceId: null,
  setWorkspaceId: (workspaceId) => set({ workspaceId }),
}));



export function useEngineBoot() {
  const { isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.workspaces.ensure);
  const setWorkspaceId = useWorkspace((s) => s.setWorkspaceId);
  useEffect(() => {
    if (!isAuthenticated) return;
    void ensure({}).then((id) => setWorkspaceId(id as string));
  }, [isAuthenticated, ensure, setWorkspaceId]);
}

function useWsQuery<T>(hook: (args: any) => T | undefined): T | undefined {
  const workspaceId = useWorkspace((s) => s.workspaceId);
  return hook(workspaceId ? {} : "skip");
}

/** Playback URLs resolved by the artifacts query, readable synchronously. */
export const cloudArtifactUrls = new Map<string, string>();

export function useArtifacts(): ArtifactDTO[] {
  const docs = useWsQuery((args) => useQuery(api.artifacts.list, args));
  return (docs ?? []).map((d) => {
    if (d.url) cloudArtifactUrls.set(d._id as string, d.url);
    return {
      id: d._id as string,
      workspaceId: d.workspaceId as string,
      fileName: d.fileName,
      r2Key: d.storageId as string,
      publicUrl: d.url ?? undefined,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      durationMs: d.durationMs,
      width: d.width,
      height: d.height,
      status: d.status,
      createdAt: d._creationTime,
    };
  });
}

export function useTransmissions(): TransmissionDTO[] {
  const docs = useWsQuery((args) => useQuery(api.transmissions.list, args));
  return (docs ?? []).map((d) => ({
    id: d._id as string,
    workspaceId: d.workspaceId as string,
    title: d.title,
    baseCaption: d.baseCaption,
    hashtags: d.hashtags,
    artifactId: d.artifactId as string | undefined,
    status: d.status,
    scheduleMode: d.scheduleMode,
    scheduledFor: d.scheduledFor,
    source: d.source,
    createdAt: d._creationTime,
    updatedAt: d.updatedAt,
  }));
}

export function useProjections(): ProjectionDTO[] {
  const docs = useWsQuery((args) => useQuery(api.transmissions.listProjections, args));
  return (docs ?? []).map((d) => ({
    id: d._id as string,
    transmissionId: d.transmissionId as string,
    workspaceId: d.workspaceId as string,
    portalId: (d.portalId as string | undefined) ?? "",
    provider: d.provider,
    caption: d.caption,
    hashtags: d.hashtags,
    platformOptions: d.platformOptions ?? {},
    status: d.status,
    attemptCount: d.attemptCount,
    nextAttemptAt: d.nextAttemptAt,
    platformPostId: d.platformPostId,
    platformPostUrl: d.platformPostUrl,
    errorCategory: d.errorCategory as ProjectionDTO["errorCategory"],
    errorSummary: d.errorSummary,
    updatedAt: d.updatedAt,
  }));
}

export function useEvents(): EventDTO[] {
  const docs = useWsQuery((args) => useQuery(api.events.list, args));
  return (docs ?? []).map((d) => ({
    id: d._id as string,
    workspaceId: d.workspaceId as string,
    transmissionId: d.transmissionId as string | undefined,
    projectionId: d.projectionId as string | undefined,
    type: d.type,
    message: d.message,
    at: d.at,
  }));
}

export function usePortals(): PortalDTO[] {
  const docs = useWsQuery((args) => useQuery(api.portals.list, args));
  return (docs ?? []).map((d) => ({
    id: d._id as string,
    workspaceId: d.workspaceId as string,
    provider: d.provider,
    providerAccountId: d.providerAccountId ?? `${d.provider}_cloud`,
    handle: d.handle,
    displayName: d.displayName,
    avatarUrl: undefined,
    scopes: d.scopes ?? [],
    status: d.status,
    tokenExpiresAt: d.tokenExpiresAt,
    lastHealthCheckAt: undefined,
    windowUsage:
      d.provider !== "youtube" && d.windowCap !== undefined
        ? { used: d.windowUsed ?? 0, cap: d.windowCap, windowHours: d.windowHours ?? 24 }
        : undefined,
  }));
}

export function usePoints(): PointsSummaryDTO | undefined {
  const data = useWsQuery((args) => useQuery(api.points.getMyPoints, args));
  if (!data) return undefined;
  return {
    lifetimeRP: data.lifetimeRP,
    weekRP: data.weekRP,
    streakDays: data.streakDays,
    badges: data.badges,
    recent: data.recent.map((e) => ({ id: e.id, source: e.source, amount: e.amount, note: e.note, at: e.at })),
  };
}

export function useAnalyticsDashboard(rangeDays: AnalyticsRangeDays) {
  const workspaceId = useWorkspace((state) => state.workspaceId);
  return useQuery(api.analytics.dashboard, workspaceId ? { rangeDays } : "skip");
}

export function useEngineActions() {
  const generateUploadUrl = useMutation(api.artifacts.generateUploadUrl);
  const createArtifact = useMutation(api.artifacts.create);
  const renameArtifactMut = useMutation(api.artifacts.rename);
  const removeArtifact = useMutation(api.artifacts.remove);
  const createTx = useMutation(api.transmissions.create);
  const cancelTx = useMutation(api.transmissions.cancel);
  const duplicateTx = useMutation(api.transmissions.duplicate);
  const retryProj = useMutation(api.transmissions.retryProjection);
  const setPortal = useMutation(api.portals.setStatus);

  return {
    addArtifact: async (
      file: File,
      meta: { durationMs?: number; width?: number; height?: number },
    ): Promise<ArtifactDTO> => {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const { storageId } = (await res.json()) as { storageId: string };
      const artifactId = await createArtifact({
        storageId: storageId as Id<"_storage">,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        durationMs: meta.durationMs,
        width: meta.width,
        height: meta.height,
      });
      return {
        id: artifactId as string,
        workspaceId: useWorkspace.getState().workspaceId ?? "",
        fileName: file.name,
        r2Key: storageId,
        mimeType: file.type,
        sizeBytes: file.size,
        durationMs: meta.durationMs,
        width: meta.width,
        height: meta.height,
        status: "ready",
        createdAt: Date.now(),
      };
    },

    renameArtifact: (id: string, fileName: string) =>
      void renameArtifactMut({ artifactId: id as Id<"artifacts">, fileName }),

    deleteArtifact: async (id: string) => removeArtifact({ artifactId: id as Id<"artifacts"> }),

    createTransmission: (input: CreateTransmissionInput) => {
      void createTx({
        title: input.title,
        baseCaption: input.baseCaption,
        hashtags: input.hashtags,
        artifactId: input.artifactId as Id<"artifacts">,
        platforms: input.platforms,
        perPlatformCaptions: input.perPlatformCaptions as Record<string, string>,
        perPlatformOptions: input.perPlatformOptions,
        scheduleMode: input.scheduleMode === "now" ? "now" : "at",
        scheduledFor: input.scheduledFor,
      });
      return { title: input.title || "Untitled post" } as TransmissionDTO;
    },

    cancelTransmission: (id: string) => void cancelTx({ transmissionId: id as Id<"transmissions"> }),
    duplicateTransmission: (id: string) =>
      void duplicateTx({ transmissionId: id as Id<"transmissions"> }),
    retryProjection: (id: string) => void retryProj({ projectionId: id as Id<"projections"> }),

    setPortalStatus: (provider: PlatformId, status: PortalDTO["status"]) => {
      if (status === "pending_approval" || status === "error") return;
      void setPortal({ provider, status });
    },
  };
}

export function artifactUrl(artifactId: string | undefined): string | undefined {
  return artifactId ? cloudArtifactUrls.get(artifactId) : undefined;
}

/** Providers with a real OAuth connector wired (vs. the demo toggle). */
export const OAUTH_SUPPORTED = new Set<PlatformId>([
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
  "threads",
]);

export function useOAuth() {
  const start = useMutation(api.oauth.start);
  const complete = useAction(api.oauth.complete);
  const selectFacebookPage = useAction(api.oauth.selectFacebookPage);
  const disconnect = useAction(api.oauth.disconnect);
  return {
    supported: OAUTH_SUPPORTED,
    start: (provider: PlatformId) => start({ provider }),
    complete: (provider: PlatformId, code: string, state: string) =>
      complete({ provider, code, state }),
    selectFacebookPage: (state: string, pageId: string) =>
      selectFacebookPage({ state, pageId }),
    disconnect: (provider: PlatformId) => disconnect({ provider }),
  };
}
