/**
 * Engine hooks — the page-facing API. Pages never import the store
 * internals; when Convex lands, these hooks swap implementation.
 */
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import type { PlatformId } from "@posterract/contract";
import { PLATFORM_CAPABILITIES } from "@posterract/contract";
import { artifactUrls, useEngineStore } from "./store";
import { startSimulator } from "./simulator";

export function useEngineBoot() {
  const hydrate = useEngineStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
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
      if (s > caps.video.maxDurationS) {
        checks.push({
          id: `dur_${p}`,
          label: `${label} duration`,
          status: "fail",
          detail: `${Math.round(s)}s exceeds ${caps.video.maxDurationS}s limit`,
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
