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
  EventDTO,
  PlatformId,
  PointsEntryDTO,
  PortalDTO,
  ProjectionDTO,
  ScheduleMode,
  TransmissionDTO,
  TransmissionStatus,
} from "@posterract/contract";
import {
  BADGES,
  PLATFORM_CAPABILITIES,
  RP_HEXACAST_BONUS,
  RP_PER_LIVE_PROJECTION,
  RP_POSTING_DAILY_CAP,
  RP_STREAK_DAILY_CAP,
  RP_STREAK_PER_DAY,
  rankFor,
} from "@posterract/contract";
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
  perPlatformOptions?: Partial<
    Record<PlatformId, Record<string, string | boolean | number>>
  >;
  accountSetId?: string;
  scheduleMode: ScheduleMode;
  scheduledFor: number;
};

/** Ledger rows keep a private refId for idempotent awarding. */
type LedgerEntry = PointsEntryDTO & { refId?: string };

type StatsState = {
  lifetimeRP: number;
  weekRP: number;
  weekStartAt: number;
  streakDays: number;
  lastPostDay?: string;
  badges: string[];
};

type EngineState = {
  hydrated: boolean;
  artifacts: ArtifactDTO[];
  transmissions: TransmissionDTO[];
  projections: ProjectionDTO[];
  events: EventDTO[];
  portals: PortalDTO[];
  points: LedgerEntry[];
  stats: StatsState;

  hydrate: () => Promise<void>;
  addArtifact: (file: File, meta: { durationMs?: number; width?: number; height?: number }) => Promise<ArtifactDTO>;
  renameArtifact: (id: string, fileName: string) => void;
  deleteArtifact: (id: string) => { ok: boolean; reason?: string };
  createTransmission: (input: CreateTransmissionInput) => TransmissionDTO;
  rescheduleTransmission: (id: string, scheduledFor: number) => Promise<void>;
  cancelTransmission: (id: string) => void;
  duplicateTransmission: (id: string) => TransmissionDTO | undefined;
  retryProjection: (projectionId: string) => void;
  setPortalStatus: (provider: PlatformId, status: PortalDTO["status"]) => void;

  /** Internal (simulator) */
  _updateProjection: (id: string, patch: Partial<ProjectionDTO>) => void;
  _emit: (event: Omit<EventDTO, "id" | "workspaceId" | "at"> & { at?: number }) => void;
  _refreshTransmissionStatus: (transmissionId: string) => void;
  _awardForLive: (projectionId: string) => void;
};

const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** Monday 00:00 UTC of the week containing ts. */
function startOfWeek(ts: number): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400_000;
}

const seedPortals: PortalDTO[] = (
  [
    ["instagram", "connected"],
    ["tiktok", "connected"],
    ["facebook", "connected"],
    ["threads", "connected"],
    ["youtube", "disconnected"],
    ["x", "disconnected"],
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
      points: [],
      stats: { lifetimeRP: 0, weekRP: 0, weekStartAt: startOfWeek(Date.now()), streakDays: 0, badges: [] },

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
          platformOptions: input.perPlatformOptions?.[provider] ?? {},
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

      rescheduleTransmission: async (id, scheduledFor) => {
        const transmission = get().transmissions.find((item) => item.id === id);
        if (!transmission || transmission.status !== "scheduled") {
          throw new Error("Only scheduled posts can be moved");
        }
        set((state) => ({
          transmissions: state.transmissions.map((item) =>
            item.id === id
              ? { ...item, scheduleMode: "at", scheduledFor, updatedAt: Date.now() }
              : item,
          ),
        }));
        get()._emit({
          type: "transmission.rescheduled",
          transmissionId: id,
          message: `“${transmission.title}” moved to ${new Date(scheduledFor).toLocaleString()}`,
        });
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

      _updateProjection: (id, patch) => {
        set((s) => ({
          projections: s.projections.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
        }));
        // Resonance mirrors the cloud engine: going live earns points, once.
        if (patch.status === "live") get()._awardForLive(id);
      },

      _awardForLive: (projectionId) => {
        const s = get();
        if (s.points.some((e) => e.refId === projectionId && e.source === "post")) return;
        const projection = s.projections.find((p) => p.id === projectionId);
        if (!projection || projection.status !== "live") return;
        const now = Date.now();
        const today = dayOf(now);

        const dayStart = new Date(now);
        dayStart.setUTCHours(0, 0, 0, 0);
        const postingSoFar = s.points
          .filter((e) => e.at >= dayStart.getTime() && (e.source === "post" || e.source === "bonus" || e.source === "streak"))
          .reduce((sum, e) => sum + e.amount, 0);
        let capLeft = Math.max(0, RP_POSTING_DAILY_CAP - postingSoFar);

        const entries: Array<Omit<LedgerEntry, "id" | "at">> = [];
        const pushCapped = (e: Omit<LedgerEntry, "id" | "at">) => {
          const amount = Math.min(e.amount, capLeft);
          if (amount <= 0) return;
          capLeft -= amount;
          entries.push({ ...e, amount });
        };

        pushCapped({
          source: "post",
          amount: RP_PER_LIVE_PROJECTION,
          refId: projectionId,
          note: `${PLATFORM_CAPABILITIES[projection.provider].label} projection live`,
        });

        let { streakDays, lastPostDay } = s.stats;
        if (lastPostDay !== today) {
          streakDays = lastPostDay === dayOf(now - 86400_000) ? streakDays + 1 : 1;
          lastPostDay = today;
          pushCapped({
            source: "streak",
            amount: Math.min(RP_STREAK_PER_DAY * streakDays, RP_STREAK_DAILY_CAP),
            refId: `day:${today}`,
            note: `Streak — day ${streakDays}`,
          });
        }

        const liveProviders = new Set(
          s.projections.filter((p) => p.transmissionId === projection.transmissionId && p.status === "live").map((p) => p.provider),
        );
        if (
          liveProviders.size === 6 &&
          !s.points.some((e) => e.refId === projection.transmissionId && e.source === "bonus")
        ) {
          pushCapped({
            source: "bonus",
            amount: RP_HEXACAST_BONUS,
            refId: projection.transmissionId,
            note: "Hexacast — all six live",
          });
        }

        const badges = new Set(s.stats.badges);
        const grant = (key: string, rp: number) => {
          if (badges.has(key)) return;
          badges.add(key);
          entries.push({ source: "milestone", amount: rp, refId: `badge:${key}`, note: BADGES[key] ?? key });
        };
        grant("first_transmission", 25);
        if (liveProviders.size === 6) grant("hexacast", 50);
        if (streakDays >= 7) grant("streak_7", 50);
        if (streakDays >= 30) grant("streak_30", 150);
        if (streakDays >= 100) grant("streak_100", 500);

        const curWeek = startOfWeek(now);
        const weekRP = s.stats.weekStartAt < curWeek ? 0 : s.stats.weekRP;
        const total = entries.reduce((sum, e) => sum + e.amount, 0);
        if (total === 0) return;

        const beforeRank = rankFor(s.stats.lifetimeRP);
        const afterRank = rankFor(s.stats.lifetimeRP + total);
        set((state) => ({
          points: [
            ...entries.map((e) => ({ ...e, id: `rp_${crypto.randomUUID().slice(0, 8)}`, at: now })),
            ...state.points,
          ].slice(0, 200),
          stats: {
            lifetimeRP: state.stats.lifetimeRP + total,
            weekRP: weekRP + total,
            weekStartAt: curWeek,
            streakDays,
            lastPostDay,
            badges: [...badges],
          },
        }));
        get()._emit({
          type: "points.awarded",
          transmissionId: projection.transmissionId,
          projectionId,
          message: `+${total} Resonance`,
        });
        if (afterRank.id !== beforeRank.id) {
          get()._emit({ type: "points.rankup", message: `Rank ascended — ${afterRank.label}` });
        }
      },

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
        points: s.points.slice(0, 100),
        stats: s.stats,
      }),
    },
  ),
);
