import { Text } from "@react-three/drei";
import { forwardRef, Suspense, useMemo } from "react";
import * as THREE from "three";
import { pointOnRing } from "../geometry";
import { glowMaterial, metalMaterial } from "../materials";
import type { RunLogEntry } from "../../state/types";

type StageLightArrayProps = {
  entries: RunLogEntry[];
  color: string;
};

export const StageLightArray = forwardRef<THREE.Group, StageLightArrayProps>(function StageLightArray(
  { entries, color },
  ref,
) {
  const inactive = useMemo(() => metalMaterial("#101821"), []);
  const socket = useMemo(() => metalMaterial("#05090c"), []);
  const activeMaterial = useMemo(() => glowMaterial(color, 2.25), [color]);
  const completeMaterial = useMemo(() => glowMaterial("#dfffee", 0.95), []);

  return (
    <group ref={ref} position={[0, 0, 0.31]}>
      {entries.map((entry, index) => {
        const point = pointOnRing(1.6, index, entries.length, -Math.PI / 2.2);
        const active = entry.status === "active";
        const complete = entry.status === "complete";
        const material = active ? activeMaterial : complete ? completeMaterial : inactive;

        return (
          <group key={entry.id} position={[point.x, point.y, 0]} rotation={[0, 0, point.angle]}>
            <mesh material={socket}>
              <cylinderGeometry args={[0.072, 0.088, 0.035, 20]} />
            </mesh>
            <mesh position={[0, 0, 0.04]} material={material}>
              <sphereGeometry args={[active ? 0.07 : 0.047, 22, 18]} />
            </mesh>
            {active && (
              <Suspense fallback={null}>
                <Text
                  position={[0, -0.2, 0.1]}
                  fontSize={0.06}
                  color="#eafff3"
                  anchorX="center"
                  anchorY="middle"
                  maxWidth={0.55}
                  textAlign="center"
                >
                  {entry.label.toUpperCase()}
                </Text>
              </Suspense>
            )}
          </group>
        );
      })}
    </group>
  );
});
