import type { ProductSurface, VidtryxMode, VidtryxPhase } from "../../state/types";

export type DeviceMode = "home" | "create" | "post";

const POST_DEVICE_COLOR = "#7cf7ff";

export type DeviceAnimationSnapshot = {
  mode: DeviceMode;
  phase: VidtryxPhase;
  currentStageIndex: number;
  stageProgress: number;
  selectedPlatformCount: number;
  artifactCount: number;
  publishJobCount: number;
};

export type DevicePresentation = {
  mode: DeviceMode;
  color: string;
  modeRingDimmed: boolean;
  orbitVisible: boolean;
  sceneLightColor: string;
};

function resolveDeviceMode(surface: ProductSurface): DeviceMode {
  if (surface === "post" || surface === "schedule" || surface === "capsule-detail") return "post";
  if (surface === "create") return "create";
  return "home";
}

export function resolveDevicePresentation(surface: ProductSurface, selectedMode: VidtryxMode): DevicePresentation {
  const mode = resolveDeviceMode(surface);
  const postSurface = surface === "post" || surface === "schedule";

  return {
    mode,
    color: mode === "post" ? POST_DEVICE_COLOR : selectedMode.color,
    modeRingDimmed: postSurface,
    orbitVisible: mode === "home" || mode === "post",
    sceneLightColor: postSurface ? POST_DEVICE_COLOR : selectedMode.color,
  };
}
