import { forwardRef, useMemo } from "react";
import * as THREE from "three";
import { clamp } from "../lib/format";
import { makeArcGeometry } from "./geometry";
import { glowMaterial, metalMaterial } from "./materials";

type ProgressRingsProps = {
  color: string;
  overallProgress: number;
  stageProgress: number;
};

function ProgressArc({
  color,
  progress,
  radius,
  tube,
  rotationZ,
}: {
  color: string;
  progress: number;
  radius: number;
  tube: number;
  rotationZ: number;
}) {
  const geometry = useMemo(() => makeArcGeometry(radius, tube, clamp(progress)), [progress, radius, tube]);
  const material = useMemo(() => glowMaterial(color, 2.1), [color]);

  return <mesh geometry={geometry} material={material} rotation={[0, 0, rotationZ]} />;
}

export const ProgressRings = forwardRef<THREE.Group, ProgressRingsProps>(function ProgressRings(
  { color, overallProgress, stageProgress },
  ref,
) {
  const track = useMemo(() => metalMaterial("#111923"), []);

  return (
    <group ref={ref} position={[0, 0, -0.04]}>
      <mesh material={track}>
        <torusGeometry args={[1.78, 0.018, 8, 160]} />
      </mesh>
      <mesh material={track}>
        <torusGeometry args={[1.92, 0.014, 8, 160]} />
      </mesh>
      <ProgressArc color={color} progress={overallProgress} radius={1.78} tube={0.024} rotationZ={-Math.PI / 2} />
      <ProgressArc color="#dfffee" progress={stageProgress} radius={1.92} tube={0.014} rotationZ={Math.PI / 3} />
    </group>
  );
});
