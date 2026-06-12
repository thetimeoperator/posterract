/**
 * LOCAL engine — the in-browser demo implementation (zustand + IndexedDB +
 * publish simulator). Used when no cloud deployment is configured, and by
 * e2e tests for deterministic offline runs.
 */
import { useEffect } from "react";
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
export const useFlows = () => useEngineStore((s) => s.flows);
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
      createFlow: s.createFlow,
      updateFlow: s.updateFlow,
      deleteFlow: s.deleteFlow,
    })),
  );

export function artifactUrl(artifactId: string | undefined): string | undefined {
  return artifactId ? artifactUrls.get(artifactId) : undefined;
}
