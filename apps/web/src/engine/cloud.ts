/**
 * CLOUD engine — the Convex implementation. Same hook surface as local.ts;
 * data is live from the deployment, publishing runs on the cloud scheduler.
 */
import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { create } from "zustand";
import type {
  ArtifactDTO,
  AutomationFlowDTO,
  EventDTO,
  PlatformId,
  PortalDTO,
  ProjectionDTO,
  TransmissionDTO,
} from "@posterract/contract";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { CreateTransmissionInput, FlowInput } from "./store";

/** Workspace context (single workspace until auth lands). */
type WorkspaceState = { workspaceId: string | null; setWorkspaceId: (id: string) => void };
export const useWorkspace = create<WorkspaceState>((set) => ({
  workspaceId: null,
  setWorkspaceId: (workspaceId) => set({ workspaceId }),
}));

const wsArg = () => {
  const id = useWorkspace.getState().workspaceId;
  if (!id) throw new Error("Workspace not ready yet");
  return { workspaceId: id as Id<"workspaces"> };
};

export function useEngineBoot() {
  const bootstrap = useMutation(api.workspaces.bootstrap);
  const setWorkspaceId = useWorkspace((s) => s.setWorkspaceId);
  useEffect(() => {
    void bootstrap({}).then((id) => setWorkspaceId(id as string));
  }, [bootstrap, setWorkspaceId]);
}

function useWsQuery<T>(hook: (args: any) => T | undefined): T | undefined {
  const workspaceId = useWorkspace((s) => s.workspaceId);
  return hook(workspaceId ? { workspaceId: workspaceId as Id<"workspaces"> } : "skip");
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
    platformOptions: {},
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
    providerAccountId: `${d.provider}_cloud`,
    handle: d.handle,
    displayName: d.displayName,
    avatarUrl: undefined,
    scopes: [],
    status: d.status,
    tokenExpiresAt: d.tokenExpiresAt,
    lastHealthCheckAt: undefined,
    windowUsage:
      d.windowCap !== undefined
        ? { used: d.windowUsed ?? 0, cap: d.windowCap, windowHours: d.windowHours ?? 24 }
        : undefined,
  }));
}

export function useFlows(): AutomationFlowDTO[] {
  const docs = useWsQuery((args) => useQuery(api.flows.list, args));
  return (docs ?? []).map((d) => ({
    id: d._id as string,
    workspaceId: d.workspaceId as string,
    name: d.name,
    platforms: d.platforms,
    captionTemplates: d.captionTemplates as Partial<Record<PlatformId, string>>,
    baseCaption: d.baseCaption,
    hashtags: d.hashtags,
    defaultTimeOfDay: d.defaultTimeOfDay,
    enabled: d.enabled,
    createdAt: d._creationTime,
    updatedAt: d.updatedAt,
  }));
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
  const createFlowMut = useMutation(api.flows.create);
  const updateFlowMut = useMutation(api.flows.update);
  const removeFlowMut = useMutation(api.flows.remove);

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
        ...wsArg(),
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
        workspaceId: wsArg().workspaceId as string,
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
        ...wsArg(),
        title: input.title,
        baseCaption: input.baseCaption,
        hashtags: input.hashtags,
        artifactId: input.artifactId as Id<"artifacts">,
        platforms: input.platforms,
        perPlatformCaptions: input.perPlatformCaptions as Record<string, string>,
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
      void setPortal({ ...wsArg(), provider, status });
    },

    createFlow: (input: FlowInput) =>
      void createFlowMut({
        ...wsArg(),
        ...input,
        captionTemplates: input.captionTemplates as Record<string, string>,
      }),
    updateFlow: (id: string, patch: Partial<FlowInput>) =>
      void updateFlowMut({
        flowId: id as Id<"flows">,
        ...patch,
        captionTemplates: patch.captionTemplates as Record<string, string> | undefined,
      }),
    deleteFlow: (id: string) => void removeFlowMut({ flowId: id as Id<"flows"> }),
  };
}

export function artifactUrl(artifactId: string | undefined): string | undefined {
  return artifactId ? cloudArtifactUrls.get(artifactId) : undefined;
}
