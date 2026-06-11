import { forwardRef, useMemo } from "react";
import * as THREE from "three";
import { glowMaterial, metalMaterial } from "../materials";

type CapsuleEmitterProps = {
  artifactCount: number;
  color: string;
};

export const CapsuleEmitter = forwardRef<THREE.Group, CapsuleEmitterProps>(function CapsuleEmitter(
  { artifactCount, color },
  ref,
) {
  const metal = useMemo(() => metalMaterial("#080d12"), []);
  const rail = useMemo(() => metalMaterial("#15202a"), []);
  const glow = useMemo(() => glowMaterial(color, artifactCount > 0 ? 1.35 : 0.45), [artifactCount, color]);

  return (
    <group position={[0, -2.42, 0.24]}>
      <group ref={ref}>
        <mesh material={metal}>
          <boxGeometry args={[1.04, 0.16, 0.14]} />
        </mesh>
        <mesh position={[0, 0.11, 0.05]} material={rail}>
          <boxGeometry args={[0.74, 0.045, 0.08]} />
        </mesh>
        <mesh position={[0, 0.18, 0.16]} material={glow}>
          <boxGeometry args={[0.54, 0.032, 0.04]} />
        </mesh>
        {artifactCount > 0 && (
          <mesh position={[0.34, 0.05, 0.22]} material={glow}>
            <sphereGeometry args={[0.075, 24, 18]} />
          </mesh>
        )}
      </group>
    </group>
  );
});
