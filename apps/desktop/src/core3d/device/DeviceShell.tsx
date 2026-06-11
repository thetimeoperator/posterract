import { forwardRef, useMemo } from "react";
import * as THREE from "three";
import { pointOnRing } from "../geometry";
import { glowMaterial, metalMaterial } from "../materials";
import type { DeviceMode } from "../animation/deviceState";

type DeviceShellProps = {
  color: string;
  mode: DeviceMode;
  running: boolean;
};

export const DeviceShell = forwardRef<THREE.Group, DeviceShellProps>(function DeviceShell(
  { color, mode, running },
  ref,
) {
  const darkMetal = useMemo(() => metalMaterial("#080d12"), []);
  const midMetal = useMemo(() => metalMaterial("#111923"), []);
  const bevelMetal = useMemo(() => metalMaterial("#18222c"), []);
  const accent = useMemo(() => glowMaterial(color, running ? 1.15 : 0.72), [color, running]);
  const postAccent = useMemo(() => glowMaterial(color, mode === "post" ? 0.95 : 0.24), [color, mode]);

  return (
    <group ref={ref}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={darkMetal}>
        <cylinderGeometry args={[2.86, 3.06, 0.18, 128]} />
      </mesh>
      <mesh position={[0, 0, 0.04]} rotation={[Math.PI / 2, 0, 0]} material={midMetal}>
        <cylinderGeometry args={[2.54, 2.74, 0.16, 128]} />
      </mesh>
      <mesh position={[0, 0, 0.16]} material={bevelMetal}>
        <torusGeometry args={[2.68, 0.055, 12, 192]} />
      </mesh>
      <mesh position={[0, 0, 0.2]} material={darkMetal}>
        <torusGeometry args={[2.31, 0.055, 12, 192]} />
      </mesh>
      <mesh position={[0, 0, 0.27]} material={mode === "post" ? postAccent : accent}>
        <torusGeometry args={[2.92, 0.008, 6, 192]} />
      </mesh>
      <mesh position={[0, 0, 0.3]} material={accent}>
        <torusGeometry args={[2.48, 0.012, 8, 192]} />
      </mesh>

      {Array.from({ length: 12 }).map((_, index) => {
        const point = pointOnRing(index % 3 === 0 ? 2.76 : 2.62, index, 12, -Math.PI / 2);
        const powered = mode === "post" ? index % 3 === 0 : index % 4 === 0;

        return (
          <group key={index} position={[point.x, point.y, 0.28]} rotation={[0, 0, point.angle + Math.PI / 2]}>
            <mesh material={powered ? accent : bevelMetal}>
              <boxGeometry args={[powered ? 0.44 : 0.28, powered ? 0.13 : 0.09, 0.1]} />
            </mesh>
            <mesh position={[0, -0.082, 0.055]} material={darkMetal}>
              <boxGeometry args={[powered ? 0.52 : 0.34, 0.025, 0.045]} />
            </mesh>
          </group>
        );
      })}

      <group position={[0, -2.6, 0.34]}>
        <mesh material={mode === "post" ? postAccent : accent}>
          <boxGeometry args={[0.8, 0.1, 0.12]} />
        </mesh>
        <mesh position={[0, -0.08, -0.02]} material={darkMetal}>
          <boxGeometry args={[1.04, 0.08, 0.08]} />
        </mesh>
      </group>
    </group>
  );
});
