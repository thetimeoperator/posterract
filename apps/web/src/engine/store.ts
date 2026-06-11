/**
 * The Posterract engine store — the ONLY interface pages talk to.
 * Today it is a local simulation (metadata in localStorage, video blobs in
 * IndexedDB, publishes simulated). The Convex backend replaces the
 * internals behind the same shapes in the backend phase.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ArtifactDTO,
  AutomationFlowDTO,
  EventDTO,
  PlatformId,
  PortalDTO,
  ProjectionDTO,
  ScheduleMode,
  TransmissionDTO,
  TransmissionStatus,
} from "@posterract/contract";
import { PLATFORM_CAPABILITIES } from "@posterract/contract";
import { blobStore } from "./idb";

const WS = "ws_local";

/** Object URLs for artifact blobs live outside persistence. */
export const artifactUrls = new Map<string, string>();

export type CreateTransmissionInput = {
  title: string;
  baseCaption: string;
  hashtags: string[];
  artifactId: string;
  platforms: PlatformId[];
  perPlatformCaptions: Partial<Record<PlatformId, string>>;
  scheduleMode: ScheduleMode;
  scheduledFor: number;
};

export type FlowInput = Omit<AutomationFlowDTO, "id" | "workspaceId" | "createdAt" | "updatedAt">;

type EngineState = {
  hydrated: boolean;
  artifacts: ArtifactDTO[];
  transmissions: TransmissionDTO[];
  projections: ProjectionDTO[];
  events: EventDTO[];
  portals: PortalDTO[];
  flows: AutomationFlowDTO[];

  hydrate: () => Promise<void>;
  addArtifact: (file: File, meta: { durationMs?: number; width?: number; height?: number }) => Promise<ArtifactDTO>;
  renameArtifact: (id: string, fileName: string) => void;
  deleteArtifact: (id: string) => { ok: boolean; reason?: string };
  createTransmission: (input: CreateTransmissionInput) => TransmissionDTO;
  cancelTransmission: (id: string) => void;
  duplicateTransmission: (id: string) => TransmissionDTO | undefined;
  retryProjection: (projectionId: string) => void;
  setPortalStatus: (provider: PlatformId, status: PortalDTO["status"]) => void;
  createFlow: (input: FlowInput) => AutomationFlowDTO;
  updateFlow: (id: string, patch: Partial<FlowInput>) => void;
  deleteFlow: (id: string) => void;

  /** Internal (simulator) */
  _updateProjection: (id: string, patch: Partial<ProjectionDTO>) => void;
  _emit: (event: Omit<EventDTO, "id" | "workspaceId" | "at"> & { at?: number }) => void;
  _refreshTransmissionStatus: (transmissionId: string) => void;
};

const seedPortals: PortalDTO[] = (
  [
    ["instagram", "connected"],
    ["tiktok", "connected"],
    ["youtube", "connected"],
    ["x", "needs_reauth"],
    ["threads", "disconnected"],
    ["facebook", "disconnected"],
  ] as Array<[PlatformId, PortalDTO["status"]]>
).map(([provider, status]) => ({
  id: `portal_${provider}`,
  workspaceId: WS,
  provider,
  providerAccountId: `${provider}_demo`,
  handle: provider === "facebook" || provider === "youtube" ? "Posterract" : "@posterract",
  displayName: "Posterract",
  scopes: [],
  status,
  tokenExpiresAt: status === "connected" ? Date.now() + 54 * 86400_000 : undefined,
  windowUsage: PLATFORM_CAPABILITIES[provider].apiWindowCap
    ? {
        used: Math.floor(Math.random() * 5),
        cap: PLATFORM_CAPABILITIES[provider].apiWindowCap!.posts,
        windowHours: PLATFORM_CAPABILITIES[provider].apiWindowCap!.windowHours,
      }
    : undefined,
}));

const seedFlows: AutomationFlowDTO[] = [
  {
    id: "flow_sample",
    workspaceId: WS,
    name: "Repurpose: IG-first → X + TikTok",
    platforms: ["instagram", "x", "tiktok"],
    captionTemplates: {
      instagram: "{title} — full breakdown in this clip 🎬\n\nSave this one for later.",
      x: "{title}.\n\nThe 60-second version:",
      tiktok: "{title} — watch till the end.",
    },
    baseCaption: "{title}",
    hashtags: ["repurpose"],
    defaultTimeOfDay: "09:00",
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

function deriveStatus(projections: ProjectionDTO[]): TransmissionStatus {
  if (projections.length === 0) return "draft";
  const states = projections.map((p) => p.status);
  if (states.every((s) => s === "live")) return "live";
  if (states.every((s) => s === "failed" || s === "needs_reauth" || s === "blocked")) return "failed";
  if (states.some((s) => s === "uploading" || s === "publishing" || s === "processing" || s === "retrying"))
    return "transmitting";
  if (states.some((s) => s === "live") && states.some((s) => s === "failed" || s === "needs_reauth"))
    return "partial";
  if (states.some((s) => s === "live")) return "transmitting";
  return "scheduled";
}

export const useEngineStore = create<EngineState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      artifacts: [],
      transmissions: [],
      projections: [],
      events: [],
      portals: seedPortals,
      flows: seedFlows,

      hydrate: async () => {
        // Recreate object URLs for persisted artifacts from IndexedDB.
        const { artifacts } = get();
        const valid: string[] = [];
        for (const artifact of artifacts) {
          if (artifactUrls.has(artifact.id)) {
            valid.push(artifact.id);
            continue;
          }
          const blob = await blobStore.get(artifact.id).catch(() => undefined);
          if (blob) {
            artifactUrls.set(artifact.id, URL.createObjectURL(blob));
            valid.push(artifact.id);
          }
        }
        // Drop artifacts whose blobs vanished
        set((s) => ({
          hydrated: true,
          artifacts: s.artifacts.filter((a) => valid.includes(a.id)),
        }));
      },

      addArtifact: async (file, meta) => {
        const id = `art_${crypto.randomUUID().slice(0, 8)}`;
        await blobStore.put(id, file);
        artifactUrls.set(id, URL.createObjectURL(file));
        const artifact: ArtifactDTO = {
          id,
          workspaceId: WS,
          fileName: file.name,
          r2Key: `local/${id}`,
          mimeType: file.type,
          sizeBytes: file.size,
          durationMs: meta.durationMs,
          width: meta.width,
          height: meta.height,
          status: "ready",
          createdAt: Date.now(),
        };
        set((s) => ({ artifacts: [artifact, ...s.artifacts] }));
        get()._emit({ type: "artifact.encapsulated", message: `Artifact “${file.name}” secured in the Vault` });
        return artifact;
      },

      renameArtifact: (id, fileName) =>
        set((s) => ({
          artifacts: s.artifacts.map((a) => (a.id === id ? { ...a, fileName } : a)),
        })),

      deleteArtifact: (id) => {
        const { transmissions } = get();
        const used = transmissions.some(
          (t) => t.artifactId === id && (t.status === "scheduled" || t.status === "transmitting"),
        );
        if (used) return { ok: false, reason: "Artifact is attached to a scheduled transmission." };
        void blobStore.delete(id);
        const url = artifactUrls.get(id);
        if (url) URL.revokeObjectURL(url);
        artifactUrls.delete(id);
        set((s) => ({ artifacts: s.artifacts.filter((a) => a.id !== id) }));
        return { ok: true };
      },

      createTransmission: (input) => {
        const now = Date.now();
        const id = `tx_${crypto.randomUUID().slice(0, 8)}`;
        const transmission: TransmissionDTO = {
          id,
          workspaceId: WS,
          title: input.title || "Untitled transmission",
          baseCaption: input.baseCaption,
          hashtags: input.hashtags,
          artifactId: input.artifactId,
          status: "scheduled",
          scheduleMode: input.scheduleMode,
          scheduledFor: input.scheduleMode === "now" ? now : input.scheduledFor,
          source: "ui",
          createdAt: now,
          updatedAt: now,
        };
        const portalByProvider = new Map(get().portals.map((p) => [p.provider, p]));
        const projections: ProjectionDTO[] = input.platforms.map((provider) => ({
          id: `prj_${crypto.randomUUID().slice(0, 8)}`,
          transmissionId: id,
          workspaceId: WS,
          portalId: portalByProvider.get(provider)?.id ?? `portal_${provider}`,
          provider,
          caption: input.perPlatformCaptions[provider] ?? input.baseCaption,
          hashtags: input.hashtags,
          platformOptions: {},
          status: "scheduled",
          attemptCount: 0,
          updatedAt: now,
        }));
        set((s) => ({
          transmissions: [transmission, ...s.transmissions],
          projections: [...projections, ...s.projections],
        }));
        get()._emit({
          type: "transmission.scheduled",
          transmissionId: id,
          message:
            input.scheduleMode === "now"
              ? `“${transmission.title}” initiating now across ${projections.length} platforms`
              : `“${transmission.title}” in trajectory for ${new Date(transmission.scheduledFor!).toLocaleString()}`,
        });
        return transmission;
      },

      cancelTransmission: (id) => {
        set((s) => ({
          transmissions: s.transmissions.map((t) =>
            t.id === id && (t.status === "scheduled" || t.status === "draft")
              ? { ...t, status: "canceled", updatedAt: Date.now() }
              : t,
          ),
          projections: s.projections.map((p) =>
            p.transmissionId === id && p.status === "scheduled"
              ? { ...p, status: "blocked", errorSummary: "Canceled by operator", updatedAt: Date.now() }
              : p,
          ),
        }));
        get()._emit({ type: "transmission.canceled", transmissionId: id, message: "Transmission canceled" });
      },

      duplicateTransmission: (id) => {
        const t = get().transmissions.find((x) => x.id === id);
        if (!t) return undefined;
        const projections = get().projections.filter((p) => p.transmissionId === id);
        return get().createTransmission({
          title: `${t.title} (copy)`,
          baseCaption: t.baseCaption,
          hashtags: t.hashtags,
          artifactId: t.artifactId!,
          platforms: projections.map((p) => p.provider),
          perPlatformCaptions: Object.fromEntries(projections.map((p) => [p.provider, p.caption])),
          scheduleMode: "at",
          scheduledFor: Date.now() + 3600_000,
        });
      },

      retryProjection: (projectionId) => {
        const projection = get().projections.find((p) => p.id === projectionId);
        if (!projection) return;
        get()._updateProjection(projectionId, {
          status: "scheduled",
          errorCategory: undefined,
          errorSummary: undefined,
          nextAttemptAt: Date.now(),
        });
        const t = get().transmissions.find((x) => x.id === projection.transmissionId);
        if (t && (t.status === "failed" || t.status === "partial")) {
          set((s) => ({
            transmissions: s.transmissions.map((x) =>
              x.id === t.id ? { ...x, status: "scheduled", scheduledFor: Date.now(), updatedAt: Date.now() } : x,
            ),
          }));
        }
        get()._emit({
          type: "projection.retry",
          transmissionId: projection.transmissionId,
          projectionId,
          message: `Retrying ${PLATFORM_CAPABILITIES[projection.provider].label} projection`,
        });
      },

      setPortalStatus: (provider, status) =>
        set((s) => ({
          portals: s.portals.map((p) =>
            p.provider === provider
              ? {
                  ...p,
                  status,
                  tokenExpiresAt: status === "connected" ? Date.now() + 60 * 86400_000 : p.tokenExpiresAt,
                }
              : p,
          ),
        })),

      createFlow: (input) => {
        const now = Date.now();
        const flow: AutomationFlowDTO = {
          ...input,
          id: `flow_${crypto.randomUUID().slice(0, 8)}`,
          workspaceId: WS,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ flows: [flow, ...s.flows] }));
        return flow;
      },

      updateFlow: (id, patch) =>
        set((s) => ({
          flows: s.flows.map((f) => (f.id === id ? { ...f, ...patch, updatedAt: Date.now() } : f)),
        })),

      deleteFlow: (id) => set((s) => ({ flows: s.flows.filter((f) => f.id !== id) })),

      _updateProjection: (id, patch) =>
        set((s) => ({
          projections: s.projections.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
        })),

      _emit: (event) =>
        set((s) => ({
          events: [
            {
              id: `ev_${crypto.randomUUID().slice(0, 8)}`,
              workspaceId: WS,
              at: event.at ?? Date.now(),
              type: event.type,
              message: event.message,
              transmissionId: event.transmissionId,
              projectionId: event.projectionId,
            },
            ...s.events,
          ].slice(0, 200),
        })),

      _refreshTransmissionStatus: (transmissionId) => {
        const projections = get().projections.filter((p) => p.transmissionId === transmissionId);
        const status = deriveStatus(projections);
        set((s) => ({
          transmissions: s.transmissions.map((t) =>
            t.id === transmissionId && t.status !== "canceled" && t.status !== status
              ? { ...t, status, updatedAt: Date.now() }
              : t,
          ),
        }));
      },
    }),
    {
      name: "posterract.engine",
      partialize: (s) => ({
        artifacts: s.artifacts,
        transmissions: s.transmissions,
        projections: s.projections,
        events: s.events.slice(0, 50),
        portals: s.portals,
        flows: s.flows,
      }),
    },
  ),
);
