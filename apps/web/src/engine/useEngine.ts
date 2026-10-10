/**
 * Engine facade — the ONLY surface pages import. Implementation is chosen
 * at build time: the Convex cloud engine when a deployment is configured
 * (VITE_CONVEX_URL), otherwise the in-browser demo engine (zustand +
 * IndexedDB + simulator), which e2e tests use for deterministic runs.
 */
import type { AccountLimitDTO, PlatformId, SavagesPlanDTO, SavagesPlanId } from "@posterract/contract";
import { PLATFORM_CAPABILITIES } from "@posterract/contract";
import * as localEngine from "./local";
import * as cloudEngine from "./cloud";
import * as postgresEngine from "./postgres";

const POSTGRES = Boolean(import.meta.env.VITE_API_URL);
const CLOUD = Boolean(import.meta.env.VITE_CONVEX_URL);
export const ENGINE_MODE: "cloud" | "demo" = POSTGRES || CLOUD ? "cloud" : "demo";
export const ENGINE_BACKEND: "postgres" | "convex" | "demo" = POSTGRES
  ? "postgres"
  : CLOUD
    ? "convex"
    : "demo";

const impl = POSTGRES ? postgresEngine : CLOUD ? cloudEngine : localEngine;

export const useEngineBoot = impl.useEngineBoot;
export const startEngine = impl.startEngine;
export const useArtifacts = impl.useArtifacts;
export const useTransmissions = impl.useTransmissions;
export const useProjections = impl.useProjections;
export const useEvents = impl.useEvents;
export const usePortals = impl.usePortals;
export const useBusinesses = impl.useBusinesses;
export const usePoints = impl.usePoints;
export const usePointsReady = impl.usePointsReady;
export const usePointsDashboard = impl.usePointsDashboard;
export const usePointsFeed = impl.usePointsFeed;
export const fetchCardImages = impl.fetchCardImages;
export const useLeaderboard = impl.useLeaderboard;
export const useAnalyticsDashboard = impl.useAnalyticsDashboard;
export const useAccountAnalytics = impl.useAccountAnalytics;
export const usePeriodStats = impl.usePeriodStats;
export const useAccountPosts = impl.useAccountPosts;
export const useEngineActions = impl.useEngineActions;
export const artifactUrl = impl.artifactUrl;
export const useOAuth = impl.useOAuth;
export const useBusinessActions = impl.useBusinessActions;
/** The workspace's account limit. Only the Postgres engine has one; the demo and Convex engines don't. */
export const useAccountLimit: () => AccountLimitDTO | undefined = POSTGRES
  ? postgresEngine.useAccountLimit
  : () => undefined;
export const useEngineRefresh: () => () => Promise<void> = POSTGRES
  ? postgresEngine.useRefresh
  : () => async () => undefined;
export const fetchSavagesPlans: () => Promise<{ plans: SavagesPlanDTO[] }> = POSTGRES
  ? postgresEngine.fetchSavagesPlans
  : async () => ({ plans: [] });
export const startSavagesCheckout: (plan: SavagesPlanId) => Promise<{ url: string }> = POSTGRES
  ? postgresEngine.startSavagesCheckout
  : async () => {
      throw new Error("AI FOR SAVAGES checkout needs the production API");
    };
export const getTikTokCreatorInfo = POSTGRES ? postgresEngine.getTikTokCreatorInfo : CLOUD
  ? async (): Promise<import("@posterract/contract/tiktok").TikTokCreatorInfo> => { throw new Error("TikTok Direct Post requires the production web API."); }
  : localEngine.getTikTokCreatorInfo;
export const OAUTH_SUPPORTED = impl.OAUTH_SUPPORTED;

// ---------------------------------------------------------------------------
// Shared, engine-independent helpers
// ---------------------------------------------------------------------------

/** Read video duration/dimensions from a file before storing it. */
export function probeVideo(file: File): Promise<{ durationMs?: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const done = (meta: { durationMs?: number; width?: number; height?: number }) => {
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    video.onloadedmetadata = () =>
      done({
        durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      });
    video.onerror = () => done({});
    video.src = url;
  });
}

export type Preflight = { id: string; label: string; status: "pass" | "warn" | "fail"; detail?: string };

/** Compute pre-flight checks for the composer. */
export function computePreflight(args: {
  artifact?: { durationMs?: number; sizeBytes: number; mimeType: string };
  platforms: PlatformId[];
  captionFor: (p: PlatformId) => string;
  portalStatus: (p: PlatformId) => string | undefined;
  durationLimits?: Partial<Record<PlatformId, number>>;
}): Preflight[] {
  const checks: Preflight[] = [];
  const { artifact, platforms, captionFor, portalStatus } = args;

  checks.push(
    artifact
      ? { id: "artifact", label: "Artifact loaded", status: "pass" }
      : { id: "artifact", label: "Artifact loaded", status: "fail", detail: "Add a video to transmit." },
  );
  checks.push(
    platforms.length > 0
      ? { id: "targets", label: `${platforms.length} platform${platforms.length > 1 ? "s" : ""} targeted`, status: "pass" }
      : { id: "targets", label: "Platforms targeted", status: "fail", detail: "Pick at least one platform." },
  );

  for (const p of platforms) {
    const caps = PLATFORM_CAPABILITIES[p];
    const label = caps.label;
    const caption = captionFor(p);
    if (caption.length > caps.captionMaxChars) {
      checks.push({
        id: `caption_${p}`,
        label: `${label} caption length`,
        status: "fail",
        detail: `${caption.length}/${caps.captionMaxChars} characters`,
      });
    } else {
      checks.push({ id: `caption_${p}`, label: `${label} caption length`, status: "pass" });
    }
    if (artifact?.durationMs) {
      const s = artifact.durationMs / 1000;
      const maximumDuration = args.durationLimits?.[p] ?? caps.video.maxDurationS;
      if (s > maximumDuration) {
        checks.push({
          id: `dur_${p}`,
          label: `${label} duration`,
          status: "fail",
          detail: `${Math.round(s)}s exceeds ${maximumDuration}s limit`,
        });
      } else if (s < caps.video.minDurationS) {
        checks.push({ id: `dur_${p}`, label: `${label} duration`, status: "fail", detail: "Too short" });
      }
    }
    if (artifact && artifact.sizeBytes / 1_000_000 > caps.video.maxSizeMB) {
      checks.push({ id: `size_${p}`, label: `${label} file size`, status: "fail", detail: "Exceeds platform limit" });
    }
    const status = portalStatus(p);
    if (status !== "connected") {
      checks.push({
        id: `portal_${p}`,
        label: `${label} portal`,
        status: "warn",
        detail: "Not connected — this projection will be blocked until aligned.",
      });
    }
  }
  return checks;
}

/** Replace flow tokens ({title}) in a caption template. */
export function renderTemplate(template: string, vars: { title: string }): string {
  return template.replaceAll(/\{title\}/gi, vars.title || "Untitled");
}
