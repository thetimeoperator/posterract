import { forwardRef, useMemo } from "react";
import * as THREE from "three";
import { glassMaterial, glowMaterial, metalMaterial } from "../materials";
import type { DeviceMode } from "../animation/deviceState";
import type { VidtryxPhase } from "../../state/types";

type DeviceLensProps = {
  color: string;
  mode: DeviceMode;
  phase: VidtryxPhase;
};

export const DeviceLens = forwardRef<THREE.Group, DeviceLensProps>(function DeviceLens({ color, mode, phase }, ref) {
  const lensMaterial = useMemo(() => glassMaterial(color), [color]);
  const coreGlow = useMemo(() => glowMaterial(color, phase === "running" ? 2.6 : 1.45), [color, phase]);
  const softGlow = useMemo(() => glowMaterial(color, mode === "home" ? 0.8 : 1.15), [color, mode]);
  const metal = useMemo(() => metalMaterial("#101820"), []);
  const innerMetal = useMemo(() => metalMaterial("#060a0e"), []);

  return (
    <group ref={ref}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={metal}>
        <cylinderGeometry args={[1.38, 1.6, 0.3, 128]} />
      </mesh>
      <mesh position={[0, 0, 0.08]} rotation={[Math.PI / 2, 0, 0]} material={innerMetal}>
        <cylinderGeometry args={[1.05, 1.24, 0.08, 96]} />
      </mesh>
      <mesh position={[0, 0, 0.13]} material={lensMaterial}>
        <sphereGeometry args={[1.04, 80, 40, 0, Math.PI * 2, 0, Math.PI / 2.28]} />
      </mesh>
      <mesh position={[0, 0, 0.235]} material={coreGlow}>
        <torusGeometry args={[0.94, 0.035, 10, 160]} />
      </mesh>
      <mesh position={[0, 0, 0.25]} material={softGlow}>
        <torusGeometry args={[0.69, 0.012, 8, 160]} />
      </mesh>
      <mesh position={[0, 0, 0.265]} material={softGlow}>
        <torusGeometry args={[0.43, 0.006, 6, 128]} />
      </mesh>
      {mode === "post" && (
        <>
          <mesh position={[0, 0, 0.29]} material={softGlow}>
            <torusGeometry args={[1.17, 0.014, 8, 160]} />
          </mesh>
          <mesh position={[0, 0, 0.31]} material={softGlow}>
            <boxGeometry args={[0.16, 0.96, 0.036]} />
          </mesh>
          <mesh position={[0, 0, 0.315]} rotation={[0, 0, Math.PI / 2]} material={softGlow}>
            <boxGeometry args={[0.16, 0.96, 0.036]} />
          </mesh>
        </>
      )}
    </group>
  );
});
