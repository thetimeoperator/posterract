import { useFrame } from "@react-three/fiber";
import gsap from "gsap";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EnergyArcs } from "./EnergyArcs";
import { ModeRing } from "./ModeRing";
import { PlatformOrbit } from "./PlatformOrbit";
import { ProgressRings } from "./ProgressRings";
import { useDeviceController } from "./animation/useDeviceController";
import { CapsuleEmitter } from "./device/CapsuleEmitter";
import { DeviceLens } from "./device/DeviceLens";
import { DeviceShell } from "./device/DeviceShell";
import { StageLightArray } from "./device/StageLightArray";
import type { DevicePresentation } from "./animation/deviceState";
import type {
  ModeId,
  PlatformId,
  PlatformAccount,
  ProductSurface,
  RunLogEntry,
  VidtryxMode,
  VidtryxPhase,
} from "../state/types";

type VidtryxCoreProps = {
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
  presentation: DevicePresentation;
  onSelectMode: (modeId: ModeId) => void;
};

export function VidtryxCore({
  modes,
  selectedMode,
  phase,
  overallProgress,
  stageProgress,
  currentStageIndex,
  artifactCount,
  publishJobCount,
  runLog,
  platformAccounts,
  selectedPlatformIds,
  presentation,
  onSelectMode,
}: VidtryxCoreProps) {
  const running = phase === "running";
  const selectedPlatformCount = selectedPlatformIds.length;
  const rootRef = useRef<THREE.Group>(null);
  const shellRef = useRef<THREE.Group>(null);
  const modeRingRef = useRef<THREE.Group>(null);
  const platformOrbitRef = useRef<THREE.Group>(null);
  const lensRef = useRef<THREE.Group>(null);
  const progressRef = useRef<THREE.Group>(null);
  const stageLightsRef = useRef<THREE.Group>(null);
  const capsuleBayRef = useRef<THREE.Group>(null);
  const energyRef = useRef<THREE.Group>(null);
  const controlTargets = useDeviceController({
    mode: presentation.mode,
    phase,
    currentStageIndex,
    stageProgress,
    selectedPlatformCount,
    artifactCount,
    publishJobCount,
  });

  useEffect(() => {
    const timeline = gsap.timeline({ defaults: { duration: 0.72, ease: "power3.out" } });
    const modeRing = modeRingRef.current;
    const platformOrbit = platformOrbitRef.current;
    const lens = lensRef.current;
    const shell = shellRef.current;

    if (modeRing) {
      timeline.to(modeRing.scale, { x: controlTargets.modeScale, y: controlTargets.modeScale, z: controlTargets.modeScale }, 0);
      timeline.to(modeRing.position, { z: controlTargets.modeZ }, 0);
    }

    if (platformOrbit) {
      timeline.to(
        platformOrbit.scale,
        { x: controlTargets.platformScale, y: controlTargets.platformScale, z: controlTargets.platformScale },
        0,
      );
      timeline.to(platformOrbit.position, { z: controlTargets.platformZ }, 0);
    }

    if (lens) {
      timeline.to(lens.scale, { x: controlTargets.lensScale, y: controlTargets.lensScale, z: controlTargets.lensScale }, 0);
    }

    if (shell) {
      timeline.to(shell.scale, { x: controlTargets.shellScale, y: controlTargets.shellScale, z: controlTargets.shellScale }, 0);
    }

    return () => {
      timeline.kill();
    };
  }, [controlTargets]);

  useEffect(() => {
    const lens = lensRef.current;
    const progress = progressRef.current;
    const capsuleBay = capsuleBayRef.current;
    const stageLights = stageLightsRef.current;
    const energy = energyRef.current;

    if (phase === "running") {
      if (lens) {
        gsap.fromTo(lens.position, { z: 0.08 }, { z: 0.18, duration: 0.42, yoyo: true, repeat: 1, ease: "power2.out" });
      }
      if (progress) {
        gsap.fromTo(progress.scale, { x: 0.96, y: 0.96, z: 0.96 }, { x: 1, y: 1, z: 1, duration: 0.65, ease: "power2.out" });
      }
      if (energy) {
        gsap.fromTo(energy.scale, { x: 0.88, y: 0.88, z: 0.88 }, { x: 1, y: 1, z: 1, duration: 0.5, ease: "power2.out" });
      }
    }

    if (phase === "complete") {
      if (lens) {
        gsap.fromTo(
          lens.scale,
          { x: 1.12, y: 1.12, z: 1.12 },
          { x: 1.02, y: 1.02, z: 1.02, duration: 0.82, ease: "elastic.out(1, 0.48)" },
        );
      }
      if (capsuleBay) {
        gsap.fromTo(
          capsuleBay.position,
          { y: -0.06, z: -0.04 },
          { y: 0.06, z: 0.14, duration: 0.74, ease: "back.out(1.8)" },
        );
      }
    } else if (capsuleBay) {
      gsap.to(capsuleBay.position, { y: 0, z: 0, duration: 0.45, ease: "power2.out" });
    }

    if (stageLights && currentStageIndex >= 0) {
      gsap.fromTo(stageLights.scale, { x: 1.04, y: 1.04, z: 1.04 }, { x: 1, y: 1, z: 1, duration: 0.36, ease: "power2.out" });
    }
  }, [artifactCount, currentStageIndex, phase]);

  useEffect(() => {
    const platformOrbit = platformOrbitRef.current;
    if (!platformOrbit || presentation.mode !== "post") return;
    gsap.fromTo(
      platformOrbit.scale,
      { x: 1.1, y: 1.1, z: 1.1 },
      { x: controlTargets.platformScale, y: controlTargets.platformScale, z: controlTargets.platformScale, duration: 0.5, ease: "power2.out" },
    );
  }, [controlTargets.platformScale, presentation.mode, publishJobCount, selectedPlatformCount]);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const root = rootRef.current;
    const shell = shellRef.current;
    const lens = lensRef.current;
    const modeRing = modeRingRef.current;
    const platformOrbit = platformOrbitRef.current;
    const progress = progressRef.current;
    const capsuleBay = capsuleBayRef.current;
    const energy = energyRef.current;

    if (root) {
      root.rotation.x = controlTargets.rootX + Math.sin(time * 0.45) * 0.018;
      root.rotation.y = Math.sin(time * (presentation.mode === "post" ? 0.42 : 0.34)) * (presentation.mode === "post" ? 0.095 : 0.062);
      root.position.y = Math.sin(time * 0.7) * 0.032;
    }

    if (shell) {
      const shellSpeed = running ? 0.19 : presentation.mode === "post" ? 0.078 : 0.033;
      shell.rotation.z = controlTargets.shellRotationZ + time * shellSpeed;
    }

    if (lens) {
      lens.rotation.z = Math.sin(time * 0.55) * 0.026;
    }

    if (modeRing) {
      const modeRingSpeed = running ? 0.18 : presentation.modeRingDimmed ? 0.025 : 0.045;
      modeRing.rotation.z = Math.sin(time * modeRingSpeed) * 0.035;
    }

    if (platformOrbit) {
      platformOrbit.rotation.z = time * 0.055;
    }

    if (progress) {
      progress.rotation.z = running || presentation.mode === "post" ? time * 0.12 : 0;
    }

    if (capsuleBay) {
      capsuleBay.rotation.z = Math.sin(time * 0.8) * 0.018;
    }

    if (energy) {
      energy.rotation.z = time * 0.55;
      energy.rotation.x = Math.sin(time * 0.8) * 0.1;
    }
  });

  return (
    <group ref={rootRef} position={[0, -0.02, 0]} scale={0.74}>
      <DeviceShell ref={shellRef} color={presentation.color} mode={presentation.mode} running={running} />
      <ModeRing
        ref={modeRingRef}
        modes={modes}
        selectedModeId={selectedMode.id}
        phase={phase}
        dimmed={presentation.modeRingDimmed}
        onSelect={onSelectMode}
      />
      <PlatformOrbit
        ref={platformOrbitRef}
        accounts={platformAccounts}
        selectedPlatformIds={selectedPlatformIds}
        visible={presentation.orbitVisible}
      />
      <ProgressRings
        ref={progressRef}
        color={presentation.color}
        overallProgress={overallProgress}
        stageProgress={stageProgress}
      />
      <StageLightArray ref={stageLightsRef} entries={runLog} color={presentation.color} />
      <DeviceLens ref={lensRef} color={presentation.color} mode={presentation.mode} phase={phase} />
      <CapsuleEmitter ref={capsuleBayRef} artifactCount={artifactCount} color={presentation.color} />
      <EnergyArcs ref={energyRef} color={presentation.color} running={running || presentation.mode === "post"} />
    </group>
  );
}
