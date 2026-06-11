import { PerspectiveCamera, Stars } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { VidtryxCore } from "./VidtryxCore";
import { resolveDevicePresentation } from "./animation/deviceState";
import type { ModeId, PlatformId, PlatformAccount, ProductSurface, RunLogEntry, VidtryxMode, VidtryxPhase } from "../state/types";

type CoreSceneProps = {
  modes: VidtryxMode[];
  selectedMode: VidtryxMode;
  productSurface: ProductSurface;
  phase: VidtryxPhase;
  overallProgress: number;
  stageProgress: number;
  currentStageIndex: number;
  artifactCount: number;
  publishJobCount: number;
  runLog: RunLogEntry[];
  platformAccounts: PlatformAccount[];
  selectedPlatformIds: PlatformId[];
  onSelectMode: (modeId: ModeId) => void;
};

export function CoreScene(props: CoreSceneProps) {
  const presentation = resolveDevicePresentation(props.productSurface, props.selectedMode);

  return (
    <Canvas className="core-canvas" dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }}>
      <PerspectiveCamera makeDefault position={[0, -0.08, 6.85]} fov={43} />
      <color attach="background" args={["#05080b"]} />
      <fog attach="fog" args={["#05080b", 5.6, 10.5]} />
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 2.6, 2.8]} intensity={7.2} color={presentation.sceneLightColor} />
      <pointLight position={[-3.8, -2.5, 3.2]} intensity={1.6} color="#b7d8ff" />
      <pointLight position={[4, -2.5, 3.2]} intensity={1.1} color="#65ff9a" />
      <Stars radius={8} depth={5} count={900} factor={1.6} fade speed={0.3} />
      <VidtryxCore {...props} presentation={presentation} />
    </Canvas>
  );
}
