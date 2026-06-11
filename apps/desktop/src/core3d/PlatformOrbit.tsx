import { forwardRef, useMemo } from "react";
import * as THREE from "three";
import { pointOnRing } from "./geometry";
import { glowMaterial, metalMaterial } from "./materials";
import type { PlatformAccount, PlatformId } from "../state/types";

type PlatformOrbitProps = {
  accounts: PlatformAccount[];
  selectedPlatformIds: PlatformId[];
  visible: boolean;
};

export const PlatformOrbit = forwardRef<THREE.Group, PlatformOrbitProps>(function PlatformOrbit(
  { accounts, selectedPlatformIds, visible },
  ref,
) {
  const connectedMetal = useMemo(() => metalMaterial("#101923"), []);
  const dormantMetal = useMemo(() => metalMaterial("#080d12"), []);
  const trackMaterial = useMemo(() => glowMaterial("#7cf7ff", 0.42), []);
  const selectedPlatformIdSet = useMemo(() => new Set(selectedPlatformIds), [selectedPlatformIds]);
  const selectedMaterials = useMemo(() => new Map(accounts.map((account) => [account.id, glowMaterial(account.color, 1.3)])), [accounts]);
  const connectedGlowMaterials = useMemo(() => new Map(accounts.map((account) => [account.id, glowMaterial(account.color, 0.52)])), [accounts]);

  return (
    <group ref={ref} visible={visible}>
      <mesh material={trackMaterial}>
        <torusGeometry args={[2.76, 0.012, 8, 180]} />
      </mesh>
      {accounts.map((account, index) => {
        const selected = selectedPlatformIdSet.has(account.id);
        const point = pointOnRing(2.76, index, accounts.length);
        const material = selected
          ? (selectedMaterials.get(account.id) ?? connectedMetal)
          : account.connected
            ? connectedMetal
            : dormantMetal;

        return (
          <group key={account.id} position={[point.x, point.y, 0.32]} rotation={[0, 0, point.angle]}>
            <mesh material={material}>
              <sphereGeometry args={[selected ? 0.115 : 0.085, 18, 12]} />
            </mesh>
            <mesh position={[0, -0.19, 0]} material={account.connected ? (connectedGlowMaterials.get(account.id) ?? connectedMetal) : dormantMetal}>
              <boxGeometry args={[selected ? 0.34 : 0.24, 0.035, 0.04]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
});
