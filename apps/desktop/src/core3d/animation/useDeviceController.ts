import { useMemo } from "react";
import type { DeviceAnimationSnapshot } from "./deviceState";

export type DeviceControlTargets = {
  rootX: number;
  modeScale: number;
  modeZ: number;
  platformScale: number;
  platformZ: number;
  lensScale: number;
  shellScale: number;
  shellRotationZ: number;
};

export function useDeviceController(snapshot: DeviceAnimationSnapshot): DeviceControlTargets {
  return useMemo(() => {
    if (snapshot.mode === "post") {
      return {
        rootX: -0.5,
        modeScale: 0.82,
        modeZ: -0.03,
        platformScale: 1.04,
        platformZ: 0.18,
        lensScale: 1.12,
        shellScale: 1.03,
        shellRotationZ: 0.18,
      };
    }

    if (snapshot.mode === "create") {
      return {
        rootX: -0.58,
        modeScale: 1,
        modeZ: 0.07,
        platformScale: 0.86,
        platformZ: -0.06,
        lensScale: snapshot.phase === "running" ? 1.1 : 1,
        shellScale: snapshot.phase === "running" ? 1.04 : 1,
        shellRotationZ: 0,
      };
    }

    return {
      rootX: -0.54,
      modeScale: 0.96,
      modeZ: 0.02,
      platformScale: 0.98,
      platformZ: 0.06,
      lensScale: 1.04,
      shellScale: 1,
      shellRotationZ: 0,
    };
  }, [snapshot.mode, snapshot.phase]);
}
