import { useEffect, useMemo, useRef } from "react";
import { Edges, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PlatformId } from "@posterract/contract";
import { PLATFORM_CAPABILITIES, PLATFORM_ORDER } from "@posterract/contract";

export type RelicMode = "idle" | "composing" | "scheduled" | "publishing" | "failure" | "ascended";
export type RelicPodState = "offline" | "ready" | "active" | "complete" | "failed";

export type PosterractRelicProps = {
  mode: RelicMode;
  podStates?: Partial<Record<PlatformId, RelicPodState>>;
  hoveredPlatform?: PlatformId | null;
  onPlatformHover?: (platform: PlatformId | null) => void;
};

const OBSIDIAN = new THREE.MeshPhysicalMaterial({
  color: "#0b1511",
  metalness: 0.92,
  roughness: 0.2,
  clearcoat: 1,
  clearcoatRoughness: 0.1,
  envMapIntensity: 0.8,
});

const BLACK_GLASS = new THREE.MeshPhysicalMaterial({
  color: "#10251a",
  metalness: 0.3,
  roughness: 0.08,
  transmission: 0.28,
  thickness: 0.8,
  transparent: true,
  opacity: 0.84,
  envMapIntensity: 0.7,
});

const CHROME = new THREE.MeshStandardMaterial({
  color: "#b4ccc1",
  metalness: 1,
  roughness: 0.13,
  envMapIntensity: 1.2,
});

const DARK_METAL = new THREE.MeshStandardMaterial({
  color: "#30443b",
  metalness: 0.92,
  roughness: 0.32,
  envMapIntensity: 0.72,
});

const ease = (current: number, target: number, speed: number, dt: number) =>
  THREE.MathUtils.lerp(current, target, 1 - Math.exp(-speed * Math.min(dt, 0.05)));

function TesseractReactor({ mode }: { mode: RelicMode }) {
  const rig = useRef<THREE.Group>(null);
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const crystal = useRef<THREE.Mesh>(null);
  const crystalMat = useRef<THREE.MeshStandardMaterial>(null);
  const light = useRef<THREE.PointLight>(null);

  const connectionGeometry = useMemo(() => {
    const signs = [-1, 1];
    const positions: number[] = [];
    const colors: number[] = [];
    let index = 0;
    for (const x of signs) {
      for (const y of signs) {
        for (const z of signs) {
          positions.push(x * 0.64, y * 0.64, z * 0.64, x * 0.29, y * 0.29, z * 0.29);
          const color = new THREE.Color(index % 2 ? "#65ff9a" : "#7cf7ff");
          colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
          index += 1;
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  }, []);

  useEffect(() => () => connectionGeometry.dispose(), [connectionGeometry]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const publishing = mode === "publishing";
    const failure = mode === "failure";
    const ascended = mode === "ascended";
    const speed = publishing ? 1.8 : failure ? 0.3 : ascended ? 1.2 : 0.48;

    if (rig.current) {
      rig.current.rotation.y += dt * 0.16 * speed;
      rig.current.rotation.x = -0.16 + Math.sin(t * 0.31) * 0.08;
      const targetScale = publishing ? 1.18 : ascended ? 1.26 : mode === "composing" ? 1.08 : 1;
      const next = ease(rig.current.scale.x, targetScale, 3.8, dt);
      rig.current.scale.setScalar(next);
    }
    if (outer.current) {
      outer.current.rotation.x += dt * 0.31 * speed;
      outer.current.rotation.y += dt * 0.19 * speed;
    }
    if (inner.current) {
      inner.current.rotation.x -= dt * 0.38 * speed;
      inner.current.rotation.z += dt * 0.28 * speed;
    }
    if (crystal.current) {
      crystal.current.rotation.y -= dt * 0.7 * speed;
      crystal.current.rotation.x += dt * 0.33 * speed;
      const pulse = 0.88 + Math.sin(t * (publishing ? 8 : 2.4)) * (publishing ? 0.13 : 0.06);
      crystal.current.scale.setScalar(pulse);
    }
    if (crystalMat.current) {
      const targetIntensity = failure ? 2.8 : ascended ? 4.6 : publishing ? 3.8 : 1.8;
      crystalMat.current.emissiveIntensity = ease(crystalMat.current.emissiveIntensity, targetIntensity, 4, dt);
      crystalMat.current.emissive.set(failure ? "#ff718f" : ascended ? "#eafff3" : "#65ff9a");
    }
    if (light.current) {
      light.current.intensity = ease(light.current.intensity, failure ? 7 : ascended ? 12 : publishing ? 9 : 5, 4, dt);
      light.current.color.set(failure ? "#ff718f" : ascended ? "#ffffff" : "#65ff9a");
    }
  });

  return (
    <group ref={rig}>
      <group ref={outer}>
        <mesh>
          <boxGeometry args={[1.28, 1.28, 1.28]} />
          <meshBasicMaterial color="#65ff9a" transparent opacity={0.015} depthWrite={false} />
          <Edges color="#65ff9a" threshold={12} />
        </mesh>
      </group>
      <group ref={inner}>
        <mesh>
          <boxGeometry args={[0.58, 0.58, 0.58]} />
          <meshBasicMaterial color="#7cf7ff" transparent opacity={0.025} depthWrite={false} />
          <Edges color="#baffd0" threshold={12} />
        </mesh>
      </group>
      <lineSegments geometry={connectionGeometry}>
        <lineBasicMaterial vertexColors transparent opacity={0.68} />
      </lineSegments>
      <mesh ref={crystal}>
        <octahedronGeometry args={[0.31, 0]} />
        <meshStandardMaterial
          ref={crystalMat}
          color="#07160d"
          emissive="#65ff9a"
          emissiveIntensity={1.8}
          metalness={0.1}
          roughness={0.1}
          transparent
          opacity={0.9}
        />
      </mesh>
      <pointLight ref={light} color="#65ff9a" intensity={5} distance={7} decay={2} />
    </group>
  );
}

function TimeRings({ mode }: { mode: RelicMode }) {
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const ringC = useRef<THREE.Mesh>(null);
  const marker = useRef<THREE.Mesh>(null);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const fast = mode === "publishing" ? 2.8 : mode === "scheduled" ? 1.6 : 0.45;
    if (ringA.current) ringA.current.rotation.z += dt * 0.14 * fast;
    if (ringB.current) ringB.current.rotation.z -= dt * 0.11 * fast;
    if (ringC.current) ringC.current.rotation.y += dt * 0.09 * fast;
    if (marker.current) {
      const angle = t * fast;
      marker.current.position.set(Math.cos(angle) * 1.38, Math.sin(angle) * 1.38, 0);
      const target = mode === "scheduled" || mode === "publishing" ? 1 : 0.15;
      const next = ease(marker.current.scale.x, target, 5, dt);
      marker.current.scale.setScalar(next);
    }
  });

  return (
    <group>
      <mesh ref={ringA} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.34, 0.027, 12, 128]} />
        <primitive object={CHROME} attach="material" />
      </mesh>
      <mesh ref={ringB} rotation={[Math.PI / 2.8, 0.2, 0.5]}>
        <torusGeometry args={[1.48, 0.015, 10, 128]} />
        <meshBasicMaterial color="#65ff9a" transparent opacity={0.5} />
      </mesh>
      <mesh ref={ringC} rotation={[0.25, 0, Math.PI / 2]}>
        <torusGeometry args={[1.62, 0.012, 10, 128]} />
        <meshBasicMaterial color="#7cf7ff" transparent opacity={0.28} />
      </mesh>
      <mesh ref={marker} scale={0.15}>
        <icosahedronGeometry args={[0.075, 1]} />
        <meshBasicMaterial color="#eafff3" />
      </mesh>
    </group>
  );
}

function PlatformChamber({
  platform,
  index,
  mode,
  state,
  hovered,
  onHover,
}: {
  platform: PlatformId;
  index: number;
  mode: RelicMode;
  state: RelicPodState;
  hovered: boolean;
  onHover?: (platform: PlatformId | null) => void;
}) {
  const root = useRef<THREE.Group>(null);
  const chamber = useRef<THREE.Group>(null);
  const accentMat = useRef<THREE.MeshStandardMaterial>(null);
  const beaconMat = useRef<THREE.MeshStandardMaterial>(null);
  const angle = (index / 6) * Math.PI * 2;
  const accent = PLATFORM_CAPABILITIES[platform].accent;

  useFrame((frame, dt) => {
    const t = frame.clock.elapsedTime;
    const publishing = mode === "publishing" || mode === "ascended";
    const composing = mode === "composing";
    const open = publishing ? 0.7 : composing ? 0.25 : 0;
    const delayWave = publishing ? Math.max(0, Math.sin(t * 1.4 - index * 0.45)) : 0;

    if (root.current) {
      root.current.rotation.y = -angle;
      root.current.position.y = ease(root.current.position.y, publishing ? Math.sin(index * 2.1) * 0.1 : 0, 3, dt);
    }
    if (chamber.current) {
      chamber.current.position.x = ease(chamber.current.position.x, 1.72 + open + (hovered ? 0.12 : 0), 4.5, dt);
      chamber.current.rotation.z = ease(chamber.current.rotation.z, publishing ? (index % 2 ? -0.1 : 0.1) : 0, 4, dt);
      const scale = ease(chamber.current.scale.x, hovered ? 1.08 : 1, 6, dt);
      chamber.current.scale.setScalar(scale);
    }

    const targetColor =
      state === "failed"
        ? new THREE.Color("#ff718f")
        : state === "offline"
          ? new THREE.Color("#183127")
          : new THREE.Color(accent);
    const intensity =
      state === "active" ? 5 + delayWave * 2 : state === "complete" ? 3 : state === "ready" ? 1.25 : state === "failed" ? 4 : 0.2;
    if (accentMat.current) {
      accentMat.current.emissive.lerp(targetColor, 1 - Math.exp(-6 * Math.min(dt, 0.05)));
      accentMat.current.color.lerp(targetColor.clone().multiplyScalar(0.28), 1 - Math.exp(-5 * Math.min(dt, 0.05)));
      accentMat.current.emissiveIntensity = ease(accentMat.current.emissiveIntensity, hovered ? intensity * 1.55 : intensity, 5, dt);
    }
    if (beaconMat.current) {
      beaconMat.current.emissive.lerp(targetColor, 1 - Math.exp(-6 * Math.min(dt, 0.05)));
      beaconMat.current.emissiveIntensity = ease(beaconMat.current.emissiveIntensity, intensity * 1.4, 5, dt);
    }
  });

  return (
    <group ref={root} rotation={[0, -angle, 0]}>
      <group ref={chamber} position={[1.72, 0, 0]}>
        <group
          onPointerEnter={(event) => {
            event.stopPropagation();
            onHover?.(platform);
            document.body.style.cursor = "pointer";
          }}
          onPointerLeave={(event) => {
            event.stopPropagation();
            onHover?.(null);
            document.body.style.cursor = "default";
          }}
        >
          <RoundedBox args={[1.22, 0.32, 0.7]} radius={0.1} smoothness={5} position={[-0.28, 0, 0]}>
            <primitive object={OBSIDIAN} attach="material" />
          </RoundedBox>
          <RoundedBox args={[0.72, 0.48, 0.92]} radius={0.14} smoothness={6} position={[0.48, 0, 0]}>
            <primitive object={BLACK_GLASS} attach="material" />
            <Edges color={hovered ? "#eafff3" : accent} threshold={18} />
          </RoundedBox>
          <mesh position={[0.47, 0.02, 0]} rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.08, 0.28, 8, 16]} />
            <meshStandardMaterial
              ref={accentMat}
              color="#07120d"
              emissive={accent}
              emissiveIntensity={0.4}
              metalness={0.35}
              roughness={0.18}
            />
          </mesh>
          <mesh position={[-0.66, 0.17, 0]}>
            <boxGeometry args={[0.74, 0.025, 0.09]} />
            <meshStandardMaterial
              ref={beaconMat}
              color="#07120d"
              emissive={accent}
              emissiveIntensity={0.4}
            />
          </mesh>
          <mesh position={[0.93, 0, 0]}>
            <octahedronGeometry args={[0.13, 0]} />
            <primitive object={CHROME} attach="material" />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function CentralChassis({ mode }: { mode: RelicMode }) {
  const crown = useRef<THREE.Group>(null);
  const lower = useRef<THREE.Group>(null);
  const haloMat = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const deployed = mode === "publishing" || mode === "ascended";
    if (crown.current) {
      crown.current.position.y = ease(crown.current.position.y, deployed ? 0.72 : 0.48, 3, dt);
      crown.current.rotation.y += dt * 0.08;
    }
    if (lower.current) {
      lower.current.position.y = ease(lower.current.position.y, deployed ? -0.72 : -0.48, 3, dt);
      lower.current.rotation.y -= dt * 0.06;
    }
    if (haloMat.current) haloMat.current.emissiveIntensity = 1.1 + Math.sin(t * 1.7) * 0.28;
  });

  return (
    <group>
      <RoundedBox args={[1.82, 0.4, 1.82]} radius={0.22} smoothness={8}>
        <primitive object={DARK_METAL} attach="material" />
        <Edges color="#527363" threshold={18} />
      </RoundedBox>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.94, 0.12, 18, 96]} />
        <primitive object={OBSIDIAN} attach="material" />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.79, 0.025, 12, 96]} />
        <meshStandardMaterial ref={haloMat} color="#153323" emissive="#65ff9a" emissiveIntensity={1.1} />
      </mesh>

      <group ref={crown} position={[0, 0.48, 0]}>
        <mesh>
          <cylinderGeometry args={[0.82, 1.02, 0.32, 6, 1, false]} />
          <primitive object={OBSIDIAN} attach="material" />
        </mesh>
        <mesh position={[0, 0.17, 0]}>
          <cylinderGeometry args={[0.58, 0.74, 0.1, 6]} />
          <primitive object={CHROME} attach="material" />
        </mesh>
      </group>
      <group ref={lower} position={[0, -0.48, 0]}>
        <mesh>
          <cylinderGeometry args={[1.02, 0.82, 0.32, 6, 1, false]} />
          <primitive object={OBSIDIAN} attach="material" />
        </mesh>
        <mesh position={[0, -0.17, 0]}>
          <cylinderGeometry args={[0.74, 0.58, 0.1, 6]} />
          <primitive object={CHROME} attach="material" />
        </mesh>
      </group>
    </group>
  );
}

export function PosterractRelic({
  mode,
  podStates = {},
  hoveredPlatform,
  onPlatformHover,
}: PosterractRelicProps) {
  const root = useRef<THREE.Group>(null);
  const ascensionRing = useRef<THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>(null);

  useFrame((_state, dt) => {
    if (root.current) {
      root.current.rotation.y = ease(root.current.rotation.y, 0.16, 5, dt);
      root.current.position.y = ease(root.current.position.y, 0, 8, dt);
      root.current.rotation.z = ease(root.current.rotation.z, 0, 9, dt);
    }
    if (ascensionRing.current) {
      const target = mode === "ascended" ? 4.8 : 0.001;
      const next = mode === "ascended"
        ? ease(ascensionRing.current.scale.x, target, 0.75, dt)
        : ease(ascensionRing.current.scale.x, target, 5, dt);
      ascensionRing.current.scale.setScalar(next);
      ascensionRing.current.material.opacity = mode === "ascended" ? Math.max(0, 0.6 - next * 0.1) : 0;
    }
  });

  return (
    <group ref={root} position={[0, 0, 0]} rotation={[0, 0.16, 0]}>
      <CentralChassis mode={mode} />
      {PLATFORM_ORDER.map((platform, index) => (
        <PlatformChamber
          key={platform}
          platform={platform}
          index={index}
          mode={mode}
          state={podStates[platform] ?? "offline"}
          hovered={hoveredPlatform === platform}
          onHover={onPlatformHover}
        />
      ))}
      <TimeRings mode={mode} />
      <TesseractReactor mode={mode} />
      <mesh ref={ascensionRing} rotation={[-Math.PI / 2, 0, 0]} scale={0.001}>
        <ringGeometry args={[0.94, 1.02, 96]} />
        <meshBasicMaterial color="#eafff3" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}
