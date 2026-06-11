import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { PlatformId } from "@posterract/contract";
import { PLATFORM_CAPABILITIES } from "@posterract/contract";
import {
  CELL_IDS,
  CELL_PLATFORMS,
  type CellId,
  type Vec3,
  VERTS_4D,
  cellEdges,
  cellNetPositions,
  cellVertexIndices,
  easeInOut,
  lerp,
  lerp3,
  project4Dto3D,
} from "./math";

export type CellVisualState = "dark" | "connected" | "igniting" | "live" | "failed";
export type TesseractMode = "idle" | "composing" | "scheduled" | "publishing" | "failure";

export type TesseractProps = {
  mode: TesseractMode;
  /** Visual state per platform cell (defaults to dark). */
  cellStates?: Partial<Record<PlatformId, CellVisualState>>;
  /** Overall scale of the object. */
  scale?: number;
};

const INNER_COLOR = new THREE.Color("#65ff9a");
const OUTER_COLOR = new THREE.Color("#7cf7ff");
const DARK_COLOR = new THREE.Color("#1d3a2c");
const FAIL_COLOR = new THREE.Color("#ff718f");

function targetColorFor(cell: CellId, states: Partial<Record<PlatformId, CellVisualState>>): THREE.Color {
  if (cell === "w-") return INNER_COLOR;
  if (cell === "w+") return OUTER_COLOR;
  const platform = CELL_PLATFORMS[cell];
  if (!platform) return DARK_COLOR;
  const state = states[platform] ?? "dark";
  if (state === "dark") return DARK_COLOR;
  if (state === "failed") return FAIL_COLOR;
  const accent = new THREE.Color(PLATFORM_CAPABILITIES[platform].accent);
  if (state === "connected") return accent.multiplyScalar(0.62);
  if (state === "igniting") return accent.multiplyScalar(1.6); // pushes into bloom
  return accent; // live
}

/** Per-cell render bookkeeping. */
type CellRig = {
  cell: CellId;
  vertIndices: number[];
  edgePairs: Array<[number, number]>;
  netPositions: Vec3[];
  positions: Float32Array; // 12 edges × 2 points × 3
  color: THREE.Color;
  unfold: number; // 0 folded … 1 unfolded
};

export function Tesseract({ mode, cellStates = {}, scale = 1 }: TesseractProps) {
  const group = useRef<THREE.Group>(null);
  const lineRefs = useRef<Record<CellId, any>>({} as Record<CellId, any>);
  const orbsRef = useRef<THREE.InstancedMesh>(null);
  const artifactRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Group>(null);
  const angles = useRef({ xw: 0.4, yz: 0.9, speed: 1 });

  const rigs = useMemo<CellRig[]>(
    () =>
      CELL_IDS.map((cell) => ({
        cell,
        vertIndices: cellVertexIndices(cell),
        edgePairs: cellEdges(cell),
        netPositions: cellNetPositions(cell),
        positions: new Float32Array(12 * 2 * 3),
        color: new THREE.Color("#1d3a2c"),
        unfold: 0,
      })),
    [],
  );

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state, dt) => {
    const clampedDt = Math.min(dt, 0.05);
    const t = state.clock.elapsedTime;

    // Rotation speed per mode (publishing freezes the 4D rotation)
    const targetSpeed =
      mode === "publishing" ? 0 : mode === "scheduled" ? 1.5 : mode === "composing" ? 0.55 : 1;
    angles.current.speed = lerp(angles.current.speed, targetSpeed, 1 - Math.exp(-3 * clampedDt));
    angles.current.xw += 0.28 * angles.current.speed * clampedDt;
    angles.current.yz += 0.2 * angles.current.speed * clampedDt;

    // Project all 16 vertices once
    const projected: Vec3[] = VERTS_4D.map((v) =>
      project4Dto3D(v, angles.current.xw, angles.current.yz),
    );

    // Per-cell: unfold progress, positions, colors
    let unfoldSum = 0;
    rigs.forEach((rig, i) => {
      const unfoldTarget = mode === "publishing" ? 1 : 0;
      // Slight stagger per cell on the way out
      const rate = mode === "publishing" ? 1.6 - i * 0.07 : 2.2;
      rig.unfold = lerp(rig.unfold, unfoldTarget, 1 - Math.exp(-rate * clampedDt));
      unfoldSum += rig.unfold;
      const k = easeInOut(rig.unfold);

      // Composing: cells breathe slightly apart
      const breathe = mode === "composing" ? 1.06 + Math.sin(t * 1.4) * 0.015 : 1;

      const folded = rig.vertIndices.map((vi) => {
        const p = projected[vi];
        return [p[0] * breathe, p[1] * breathe, p[2] * breathe] as Vec3;
      });

      for (let e = 0; e < rig.edgePairs.length; e++) {
        const [a, b] = rig.edgePairs[e];
        const pa = k > 0.001 ? lerp3(folded[a], rig.netPositions[a], k) : folded[a];
        const pb = k > 0.001 ? lerp3(folded[b], rig.netPositions[b], k) : folded[b];
        rig.positions[e * 6 + 0] = pa[0];
        rig.positions[e * 6 + 1] = pa[1];
        rig.positions[e * 6 + 2] = pa[2];
        rig.positions[e * 6 + 3] = pb[0];
        rig.positions[e * 6 + 4] = pb[1];
        rig.positions[e * 6 + 5] = pb[2];
      }

      const line = lineRefs.current[rig.cell];
      if (line) {
        line.geometry.setPositions(rig.positions);
        // Color easing toward target
        const target = targetColorFor(rig.cell, cellStates);
        rig.color.lerp(target, 1 - Math.exp(-5 * clampedDt));
        // Failure flicker on failed cells
        const platform = CELL_PLATFORMS[rig.cell];
        const isFailed = platform && cellStates[platform] === "failed";
        const flicker = isFailed && Math.sin(t * 21) > 0.55 ? 0.4 : 1;
        line.material.color.copy(rig.color).multiplyScalar(flicker);
      }

      // Vertex orbs (8 per cell)
      if (orbsRef.current) {
        for (let vIdx = 0; vIdx < 8; vIdx++) {
          const a = rig.vertIndices[vIdx];
          const folded3 = projected[a];
          const p = k > 0.001 ? lerp3(folded3, rig.netPositions[vIdx], k) : folded3;
          dummy.position.set(p[0], p[1], p[2]);
          const s = rig.cell === "w-" ? 0.028 : 0.018;
          dummy.scale.setScalar(s);
          dummy.updateMatrix();
          orbsRef.current.setMatrixAt(i * 8 + vIdx, dummy.matrix);
        }
      }
    });
    if (orbsRef.current) orbsRef.current.instanceMatrix.needsUpdate = true;

    // Group: gentle presentation wobble; failure glitch jitter; zoom for unfold
    if (group.current) {
      const unfoldAvg = unfoldSum / rigs.length;
      const fit = lerp(1, 0.52, easeInOut(unfoldAvg));
      group.current.scale.setScalar(scale * fit);
      group.current.rotation.x = -0.12 + Math.sin(t * 0.13) * 0.05;
      group.current.rotation.y = Math.sin(t * 0.09) * 0.12;
      if (mode === "failure" && Math.random() < 0.12) {
        group.current.position.x = (Math.random() - 0.5) * 0.06;
        group.current.position.y = (Math.random() - 0.5) * 0.06;
      } else {
        group.current.position.x = lerp(group.current.position.x, 0, 0.2);
        group.current.position.y = lerp(group.current.position.y, 0, 0.2);
      }
    }

    // Artifact octahedron: visible composing/scheduled — bob + spin
    if (artifactRef.current) {
      const show = mode === "composing" || mode === "scheduled";
      const target = show ? 0.34 : 0.0001;
      const cur = artifactRef.current.scale.x;
      const next = lerp(cur, target, 1 - Math.exp(-4 * clampedDt));
      artifactRef.current.scale.setScalar(next);
      artifactRef.current.rotation.y += clampedDt * 0.9;
      artifactRef.current.position.y = Math.sin(t * 1.3) * 0.08;
    }

    // Trajectory ring: scheduled mode — ring + orbiting spark
    if (ringRef.current) {
      const show = mode === "scheduled";
      const target = show ? 1 : 0.0001;
      const next = lerp(ringRef.current.scale.x, target, 1 - Math.exp(-4 * clampedDt));
      ringRef.current.scale.setScalar(next);
      ringRef.current.rotation.z = t * 0.5;
    }
  });

  return (
    <group ref={group}>
      {rigs.map((rig) => (
        <Line
          key={rig.cell}
          ref={(el: any) => (lineRefs.current[rig.cell] = el)}
          points={Array.from({ length: 24 }, () => [0, 0, 0] as Vec3)}
          segments
          lineWidth={rig.cell === "w-" ? 1.8 : 1.2}
          transparent
          opacity={rig.cell === "w+" ? 0.55 : 0.95}
          color="#1d3a2c"
        />
      ))}

      {/* Vertex orbs */}
      <instancedMesh ref={orbsRef} args={[undefined, undefined, 64]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial color="#9ccbb0" transparent opacity={0.65} blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>

      {/* The artifact — a small aurora octahedron at the heart */}
      <mesh ref={artifactRef} scale={0.0001}>
        <octahedronGeometry args={[1, 0]} />
        <meshNormalMaterial transparent opacity={0.9} />
      </mesh>

      {/* Trajectory ring (scheduled) */}
      <group ref={ringRef} scale={0.0001} rotation={[Math.PI / 2.4, 0, 0]}>
        <mesh>
          <torusGeometry args={[2.35, 0.008, 8, 96]} />
          <meshBasicMaterial color="#65ff9a" transparent opacity={0.45} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh position={[2.35, 0, 0]}>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshBasicMaterial color="#65ff9a" blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}
