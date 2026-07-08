/**
 * LOCAL engine — the in-browser demo implementation (zustand + IndexedDB +
 * publish simulator). Used when no cloud deployment is configured, and by
 * e2e tests for deterministic offline runs.
 */
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { artifactUrls, useEngineStore } from "./store";
import { startSimulator } from "./simulator";

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

/** Demo mode has no real OAuth — Portals uses the setPortalStatus toggle instead. */
export const OAUTH_SUPPORTED = new Set<import("@posterract/contract").PlatformId>();
export function useOAuth() {
  return {
    supported: OAUTH_SUPPORTED,
    start: async () => ({ url: "" }),
    complete: async () => ({ ok: false as const, error: "Demo mode" }),
    disconnect: async () => {},
  };
}
