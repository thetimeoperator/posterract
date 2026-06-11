import { forwardRef, useMemo } from "react";
import * as THREE from "three";
import { glowMaterial } from "./materials";

type EnergyArcsProps = {
  color: string;
  running: boolean;
};

export const EnergyArcs = forwardRef<THREE.Group, EnergyArcsProps>(function EnergyArcs({ color, running }, ref) {
  const material = useMemo(() => glowMaterial(color, running ? 1.35 : 0.35), [color, running]);

  return (
    <group ref={ref} visible={running} position={[0, 0, 0.34]}>
      {[0, 1, 2].map((index) => (
        <mesh
          key={index}
          rotation={[0, 0, (index * Math.PI * 2) / 3]}
          position={[0, 0, index * 0.015]}
          material={material}
        >
          <torusGeometry args={[2.68 + index * 0.12, 0.006, 6, 80, Math.PI * 1.35]} />
        </mesh>
      ))}
    </group>
  );
});
