import { forwardRef, useMemo } from "react";
import * as THREE from "three";
import { pointOnRing } from "./geometry";
import { glowMaterial, metalMaterial } from "./materials";
import type { ModeId, VidtryxMode, VidtryxPhase } from "../state/types";

type ModeRingProps = {
  modes: VidtryxMode[];
  selectedModeId: ModeId;
  phase: VidtryxPhase;
  dimmed: boolean;
  onSelect: (modeId: ModeId) => void;
};

export const ModeRing = forwardRef<THREE.Group, ModeRingProps>(function ModeRing(
  { modes, selectedModeId, phase, dimmed, onSelect },
  ref,
) {
  const activeMode = modes.find((mode) => mode.id === selectedModeId) ?? modes[0];
  const metal = useMemo(() => metalMaterial("#0d1218"), []);
  const activeGlow = useMemo(() => glowMaterial(activeMode.color, phase === "running" ? 1.8 : 1.1), [activeMode.color, phase]);
  const modeGlowMaterials = useMemo(() => new Map(modes.map((mode) => [mode.id, glowMaterial(mode.color, 1.2)])), [modes]);

  return (
    <group ref={ref}>
      <mesh material={metal}>
        <torusGeometry args={[2.38, 0.075, 12, 160]} />
      </mesh>
      <mesh material={activeGlow}>
        <torusGeometry args={[2.08, 0.025, 8, 160]} />
      </mesh>

      {modes.map((mode, index) => {
        const point = pointOnRing(2.36, index, modes.length);
        const selected = mode.id === selectedModeId;

        return (
          <group
            key={mode.id}
            position={[point.x, point.y, 0.2]}
            rotation={[0, 0, point.angle + Math.PI / 2]}
            onClick={(event) => {
              event.stopPropagation();
              if (dimmed) return;
              onSelect(mode.id);
            }}
          >
            <mesh material={selected ? (modeGlowMaterials.get(mode.id) ?? metal) : metal}>
              <boxGeometry args={[selected ? 0.52 : 0.34, selected ? 0.12 : 0.08, 0.08]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
});
