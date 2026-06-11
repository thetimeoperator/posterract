import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import type { PlatformId } from "@posterract/contract";
import { PLATFORM_CAPABILITIES, PLATFORM_IDS } from "@posterract/contract";
import { Tesseract, type CellVisualState, type TesseractMode } from "@/tesseract/Tesseract";
import { lerp } from "@/tesseract/math";

export type DeviceProps = {
  mode: TesseractMode;
  cellStates?: Partial<Record<PlatformId, CellVisualState>>;
  scale?: number;
};

/* ── Materials (shared instances) ─────────────────────────────────── */
const OBSIDIAN = new THREE.MeshPhysicalMaterial({
  color: "#04060a",
  metalness: 0.9,
  roughness: 0.44,
  clearcoat: 1,
  clearcoatRoughness: 0.16,
  envMapIntensity: 0.34,
});
const GUNMETAL = new THREE.MeshStandardMaterial({
  color: "#222b30",
  metalness: 1,
  roughness: 0.26,
  envMapIntensity: 0.6,
});
const CHROME = new THREE.MeshStandardMaterial({
  color: "#5e6f6a",
  metalness: 1,
  roughness: 0.14,
  envMapIntensity: 0.85,
});

const POD_DARK = new THREE.Color("#142019");

/* ── Helper: ring of armor plates ─────────────────────────────────── */
function ArmorRing({
  radius,
  count,
  plateW,
  plateH,
  plateD,
  tilt = 0,
  material = OBSIDIAN,
}: {
  radius: number;
  count: number;
  plateW: number;
  plateH: number;
  plateD: number;
  tilt?: number;
  material?: THREE.Material;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const placed = useRef(false);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    if (!ref.current || placed.current) return;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      dummy.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      dummy.rotation.set(tilt, -a + Math.PI / 2, 0);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
    placed.current = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} material={material} frustumCulled={false}>
      <boxGeometry args={[plateW, plateH, plateD]} />
    </instancedMesh>
  );
}

/**
 * THE POSTERRACT — a legendary device. Obsidian armor rings around a green
 * reactor; eight claw pylons; six platform light pods; the 4D core visible
 * in the heart. Publishing: the claws deploy, the rings part, and the core
 * unfolds above the open chassis.
 */
export function PosterractDevice({ mode, cellStates = {}, scale = 1 }: DeviceProps) {
  const root = useRef<THREE.Group>(null);
  const ringTop = useRef<THREE.Group>(null);
  const ringMid = useRef<THREE.Group>(null);
  const ringBot = useRef<THREE.Group>(null);
  const claws = useRef<THREE.Group[]>([]);
  const coreGroup = useRef<THREE.Group>(null);
  const reactorMat = useRef<THREE.MeshStandardMaterial>(null);
  const reactorLight = useRef<THREE.PointLight>(null);
  const open = useRef(0); // 0 closed … 1 deployed

  const podMats = useMemo(
    () =>
      Object.fromEntries(
        PLATFORM_IDS.map((p) => [
          p,
          new THREE.MeshStandardMaterial({
            color: POD_DARK.clone(),
            emissive: POD_DARK.clone(),
            emissiveIntensity: 0.6,
            metalness: 0.4,
            roughness: 0.4,
          }),
        ]),
      ) as Record<PlatformId, THREE.MeshStandardMaterial>,
    [],
  );

  const floorTexture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, "rgba(101,255,154,0.32)");
    g.addColorStop(0.4, "rgba(101,255,154,0.1)");
    g.addColorStop(1, "rgba(101,255,154,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const t = state.clock.elapsedTime;

    // Deploy amount per mode
    const openTarget = mode === "publishing" ? 1 : mode === "composing" ? 0.25 : mode === "failure" ? 0.12 : 0.05;
    open.current = lerp(open.current, openTarget, 1 - Math.exp(-2.2 * d));
    const k = open.current;

    // Ring rotation (counter-rotating; spin up while publishing)
    const spin = mode === "publishing" ? 2.2 : mode === "scheduled" ? 1.4 : 1;
    if (ringTop.current) {
      ringTop.current.rotation.y += 0.1 * spin * d;
      ringTop.current.position.y = 0.34 + k * 0.42;
    }
    if (ringMid.current) ringMid.current.rotation.y -= 0.07 * spin * d;
    if (ringBot.current) {
      ringBot.current.rotation.y += 0.05 * spin * d;
      ringBot.current.position.y = -0.34 - k * 0.42;
    }

    // Claws deploy outward/up
    claws.current.forEach((claw, i) => {
      if (!claw) return;
      const base = (i / 8) * Math.PI * 2;
      claw.rotation.z = -0.22 - k * 0.55; // pitch outward
      claw.position.y = 0.12 + k * 0.3;
      claw.rotation.y = base + Math.sin(t * 0.2) * 0.01;
    });

    // Reactor breath + publish surge
    const breathe = 0.7 + Math.sin(t * 1.7) * 0.15;
    const surge = mode === "publishing" ? 1.6 : mode === "composing" || mode === "scheduled" ? 1.1 : breathe;
    if (reactorMat.current) {
      reactorMat.current.emissiveIntensity = lerp(reactorMat.current.emissiveIntensity, surge, 1 - Math.exp(-4 * d));
      if (mode === "failure") {
        const flick = Math.sin(t * 23) > 0.5 ? 0.5 : 1;
        reactorMat.current.emissive.setStyle(flick < 1 ? "#ff718f" : "#65ff9a");
      } else {
        reactorMat.current.emissive.setStyle("#65ff9a");
      }
    }
    if (reactorLight.current) {
      reactorLight.current.intensity = lerp(reactorLight.current.intensity, surge * 1.1, 1 - Math.exp(-4 * d));
      reactorLight.current.color.setStyle(mode === "failure" ? "#ff718f" : "#65ff9a");
    }

    // The 4D core rises + grows as the device opens
    if (coreGroup.current) {
      const coreScale = 0.26 + k * 0.38;
      coreGroup.current.scale.setScalar(coreScale);
      coreGroup.current.position.y = k * 0.72;
    }

    // Platform pods
    PLATFORM_IDS.forEach((p) => {
      const matEntry = podMats[p];
      const cellState = cellStates[p] ?? "dark";
      const accent = new THREE.Color(PLATFORM_CAPABILITIES[p].accent);
      const target =
        cellState === "dark"
          ? POD_DARK
          : cellState === "failed"
            ? new THREE.Color("#ff718f")
            : cellState === "connected"
              ? accent.clone().multiplyScalar(0.5)
              : cellState === "igniting"
                ? accent.clone().multiplyScalar(2.2)
                : accent;
      matEntry.emissive.lerp(target, 1 - Math.exp(-5 * d));
      matEntry.emissiveIntensity = cellState === "igniting" ? 3 : cellState === "live" ? 1.6 : 0.8;
    });

    // Failure jitter
    if (root.current) {
      if (mode === "failure" && Math.random() < 0.1) {
        root.current.position.x = (Math.random() - 0.5) * 0.05;
      } else {
        root.current.position.x = lerp(root.current.position.x, 0, 0.25);
      }
      root.current.rotation.y = Math.sin(t * 0.07) * 0.08;
    }
  });

  return (
    <group ref={root} scale={scale} position={[0, -0.3, 0]}>
      {/* ── Reactor heart ── */}
      <mesh>
        <sphereGeometry args={[0.46, 48, 48]} />
        <meshStandardMaterial
          ref={reactorMat}
          color="#06120c"
          emissive="#65ff9a"
          emissiveIntensity={0.7}
          roughness={0.15}
          metalness={0.1}
          transparent
          opacity={0.38}
          depthWrite={false}
        />
      </mesh>
      <pointLight ref={reactorLight} intensity={1.6} distance={5.5} decay={2} color="#65ff9a" />

      {/* The 4D core, visible in the heart; unfolds above when deployed */}
      <group ref={coreGroup} scale={0.26}>
        <Tesseract mode={mode} cellStates={cellStates} scale={1} />
      </group>

      {/* Lens ring around the heart */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.62, 0.05, 16, 64]} />
        <primitive object={CHROME} attach="material" />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.78, 0.085, 16, 64]} />
        <primitive object={OBSIDIAN} attach="material" />
      </mesh>

      {/* ── Armor rings ── */}
      <group ref={ringTop} position={[0, 0.34, 0]}>
        <ArmorRing radius={1.22} count={14} plateW={0.5} plateH={0.16} plateD={0.34} tilt={0.18} />
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.05, 0.035, 12, 72]} />
          <primitive object={GUNMETAL} attach="material" />
        </mesh>
      </group>

      <group ref={ringMid}>
        <ArmorRing radius={1.55} count={18} plateW={0.52} plateH={0.22} plateD={0.42} />
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.34, 0.045, 12, 80]} />
          <primitive object={CHROME} attach="material" />
        </mesh>
        {/* Six platform pods on the mid ring */}
        {PLATFORM_IDS.map((p, i) => {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          return (
            <mesh
              key={p}
              position={[Math.cos(a) * 1.55, 0.16, Math.sin(a) * 1.55]}
              rotation={[0, -a + Math.PI / 2, 0]}
              material={podMats[p]}
            >
              <capsuleGeometry args={[0.045, 0.16, 6, 12]} />
            </mesh>
          );
        })}
      </group>

      <group ref={ringBot} position={[0, -0.34, 0]}>
        <ArmorRing radius={1.18} count={14} plateW={0.48} plateH={0.16} plateD={0.32} tilt={-0.18} />
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.0, 0.035, 12, 72]} />
          <primitive object={GUNMETAL} attach="material" />
        </mesh>
      </group>

      {/* ── Claw pylons (8) ── */}
      {Array.from({ length: 8 }, (_, i) => (
        <group
          key={i}
          ref={(el) => {
            if (el) claws.current[i] = el;
          }}
          rotation={[0, (i / 8) * Math.PI * 2, 0]}
          position={[0, 0.12, 0]}
        >
          <group position={[2.05, 0, 0]}>
            {/* tapered arm segment */}
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.1, 0.17, 0.9, 4]} />
              <primitive object={OBSIDIAN} attach="material" />
            </mesh>
            {/* arm tip */}
            <mesh position={[0.62, 0.05, 0]} rotation={[0, 0, Math.PI / 2 + 0.25]}>
              <cylinderGeometry args={[0.04, 0.1, 0.5, 4]} />
              <primitive object={GUNMETAL} attach="material" />
            </mesh>
            {/* emissive strip */}
            <mesh position={[0, 0.1, 0]}>
              <boxGeometry args={[0.55, 0.025, 0.06]} />
              <meshStandardMaterial color="#0c1410" emissive="#65ff9a" emissiveIntensity={1.6} />
            </mesh>
          </group>
        </group>
      ))}

      {/* ── Floor light pool ── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.45, 0]}>
        <circleGeometry args={[3.2, 48]} />
        <meshBasicMaterial map={floorTexture} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.44, 0]}>
        <ringGeometry args={[2.2, 2.24, 64]} />
        <meshBasicMaterial color="#65ff9a" transparent opacity={0.18} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* ── Lighting ── */}
      <ambientLight intensity={0.16} />
      <directionalLight position={[4, 6, 3]} intensity={0.34} color="#eafff3" />
      <directionalLight position={[-5, 3, -4]} intensity={0.22} color="#7cf7ff" />
      <Environment resolution={64} frames={1}>
        <Lightformer intensity={0.8} position={[0, 5, -9]} scale={[12, 8, 1]} color="#dfffe9" />
        <Lightformer intensity={0.8} position={[-6, 1, 2]} rotation-y={Math.PI / 2} scale={[16, 0.6, 1]} color="#65ff9a" />
        <Lightformer intensity={0.6} position={[6, -1, 2]} rotation-y={-Math.PI / 2} scale={[16, 0.8, 1]} color="#7cf7ff" />
        <Lightformer intensity={0.45} position={[0, -6, 4]} scale={[14, 1, 1]} color="#ffffff" />
      </Environment>
    </group>
  );
}
