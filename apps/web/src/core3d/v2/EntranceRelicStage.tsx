import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Center, ContactShadows, Edges, RoundedBox, type OnCenterCallbackProps } from "@react-three/drei";
import clsx from "clsx";
import * as THREE from "three";
import type { PlatformId } from "@posterract/contract";
import { PosterractRelic, type RelicMode, type RelicPodState } from "./PosterractRelic";

export type EntrancePhase =
  | "idle"
  | "hovering"
  | "igniting"
  | "deploying"
  | "aligning"
  | "portal"
  | "navigating";

export type EntranceRelicStageProps = {
  phase: EntrancePhase;
  podStates: Partial<Record<PlatformId, RelicPodState>>;
  hoveredPlatform?: PlatformId | null;
  onPlatformHover?: (platform: PlatformId | null) => void;
  onReady?: () => void;
  className?: string;
};

type RelicBounds = Pick<OnCenterCallbackProps, "width" | "height" | "depth">;

const damp = (current: number, target: number, speed: number, dt: number) =>
  THREE.MathUtils.lerp(current, target, 1 - Math.exp(-speed * Math.min(dt, 0.05)));

const smooth = (value: number) => value * value * (3 - 2 * value);

function modeForPhase(phase: EntrancePhase): RelicMode {
  if (phase === "hovering" || phase === "igniting") return "composing";
  if (phase === "deploying" || phase === "aligning") return "publishing";
  if (phase === "portal" || phase === "navigating") return "ascended";
  return "idle";
}

function CameraRig({ bounds, phase }: { bounds: RelicBounds | null; phase: EntrancePhase }) {
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
  const size = useThree((state) => state.size);
  const baseZoom = useRef(120);

  useLayoutEffect(() => {
    camera.position.set(0, 3.2, 8);
    camera.lookAt(0, 0, 0);

    if (bounds) {
      const pitch = Math.atan2(camera.position.y, camera.position.z);
      const projectedBoxHeight = bounds.height * Math.cos(pitch) + bounds.depth * Math.sin(pitch);
      // The six-arm relic occupies only the middle of its rotated box. Fit the
      // visible radial silhouette instead of treating its empty corners as mass.
      const projectedSilhouetteHeight = projectedBoxHeight * 0.55;
      const widthCoverage = size.width < 700 ? 0.9 : size.width < 980 ? 0.82 : 0.74;
      const heightCoverage = size.height < 680 ? 0.6 : 0.68;
      const widthFit = (size.width * widthCoverage) / bounds.width;
      const heightFit = (size.height * heightCoverage) / projectedSilhouetteHeight;
      baseZoom.current = size.width < 700 ? widthFit * 1.2 : Math.min(widthFit, heightFit);
      camera.zoom = baseZoom.current;
    }

    camera.updateProjectionMatrix();
  }, [bounds, camera, size.height, size.width]);

  useFrame((state, dt) => {
    const canParallax = phase === "idle" || phase === "hovering";
    const targetX = canParallax ? state.pointer.x * 0.11 : 0;
    const targetY = 3.2 + (canParallax ? state.pointer.y * 0.06 : 0);
    const push =
      phase === "igniting"
        ? 1.05
        : phase === "deploying"
          ? 1.12
          : phase === "aligning"
            ? 1.2
            : phase === "portal" || phase === "navigating"
              ? 1.52
              : 1;

    camera.position.x = damp(camera.position.x, targetX, 4.5, dt);
    camera.position.y = damp(camera.position.y, targetY, 4.5, dt);
    camera.zoom = damp(camera.zoom, baseZoom.current * push, phase === "portal" ? 2.4 : 4, dt);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  });

  return null;
}

function SourceArtifact({ phase }: { phase: EntrancePhase }) {
  const root = useRef<THREE.Group>(null);
  const face = useRef<THREE.MeshStandardMaterial>(null);
  const elapsed = useRef(0);
  const previousPhase = useRef(phase);

  useFrame((_state, dt) => {
    if (previousPhase.current !== phase) {
      previousPhase.current = phase;
      elapsed.current = 0;
    }
    elapsed.current += dt;

    if (!root.current || !face.current) return;
    const active = phase === "igniting";
    root.current.visible = active;
    if (!active) return;

    const progress = smooth(Math.min(1, elapsed.current / 0.82));
    root.current.position.set(0, THREE.MathUtils.lerp(2.45, 0.12, progress), THREE.MathUtils.lerp(0.9, 0.1, progress));
    root.current.rotation.x = THREE.MathUtils.lerp(-0.12, -0.55, progress);
    root.current.rotation.z = Math.sin(progress * Math.PI) * 0.08;
    root.current.scale.setScalar(THREE.MathUtils.lerp(1, 0.14, progress));
    face.current.opacity = Math.sin(Math.min(1, progress) * Math.PI) * 0.78;
    face.current.emissiveIntensity = 1.8 + progress * 4.2;
  });

  return (
    <group ref={root} visible={false}>
      <RoundedBox args={[0.72, 1.24, 0.055]} radius={0.065} smoothness={5}>
        <meshStandardMaterial
          ref={face}
          color="#0b1b13"
          emissive="#65ff9a"
          emissiveIntensity={1.8}
          transparent
          opacity={0}
          metalness={0.35}
          roughness={0.16}
        />
        <Edges color="#dfffea" threshold={16} />
      </RoundedBox>
      <mesh position={[0, 0.33, 0.034]}>
        <planeGeometry args={[0.5, 0.035]} />
        <meshBasicMaterial color="#eafff3" transparent opacity={0.8} />
      </mesh>
      <mesh position={[-0.11, 0.18, 0.034]}>
        <planeGeometry args={[0.28, 0.025]} />
        <meshBasicMaterial color="#65ff9a" transparent opacity={0.72} />
      </mesh>
      <mesh position={[0, -0.16, 0.034]}>
        <planeGeometry args={[0.5, 0.38]} />
        <meshBasicMaterial color="#142b20" transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

function AlignmentWaves({ phase }: { phase: EntrancePhase }) {
  const rings = useRef<THREE.Group>(null);
  const elapsed = useRef(0);
  const previousPhase = useRef(phase);

  useFrame((_state, dt) => {
    if (previousPhase.current !== phase) {
      previousPhase.current = phase;
      elapsed.current = 0;
    }
    elapsed.current += dt;
    if (!rings.current) return;

    const active = phase === "aligning" || phase === "portal" || phase === "navigating";
    rings.current.visible = active;
    if (!active) return;

    rings.current.children.forEach((child, index) => {
      const wave = Math.max(0, Math.min(1, elapsed.current * 0.8 - index * 0.22));
      const eased = smooth(wave);
      child.scale.setScalar(0.12 + eased * 3.8);
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      material.opacity = Math.max(0, (1 - eased) * 0.6);
    });
  });

  return (
    <group ref={rings} visible={false} rotation={[Math.PI / 2, 0, 0]}>
      {[0, 1, 2].map((index) => (
        <mesh key={index}>
          <ringGeometry args={[0.94, 0.975, 96]} />
          <meshBasicMaterial color={index === 1 ? "#7cf7ff" : "#65ff9a"} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function SceneReady({ onReady }: { onReady?: () => void }) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => onReady?.());
    return () => cancelAnimationFrame(frame);
  }, [onReady]);
  return null;
}

export function EntranceRelicStage({
  phase,
  podStates,
  hoveredPlatform,
  onPlatformHover,
  onReady,
  className,
}: EntranceRelicStageProps) {
  const [bounds, setBounds] = useState<RelicBounds | null>(null);
  const fitRelic = useCallback(({ width, height, depth }: OnCenterCallbackProps) => {
    setBounds({ width, height, depth });
  }, []);

  return (
    <div className={clsx("isolate", className)} aria-hidden>
      <Canvas
        orthographic
        dpr={[1, 2]}
        shadows
        camera={{ position: [0, 3.2, 8], zoom: 120, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      >
        <Suspense fallback={null}>
          <SceneReady onReady={onReady} />
          <CameraRig bounds={bounds} phase={phase} />
          <Center onCentered={fitRelic}>
            <group>
              <PosterractRelic
                mode={modeForPhase(phase)}
                podStates={podStates}
                hoveredPlatform={hoveredPlatform}
                onPlatformHover={onPlatformHover}
              />
              <SourceArtifact phase={phase} />
              <AlignmentWaves phase={phase} />
            </group>
          </Center>

          <hemisphereLight args={["#dfffea", "#020504", 2.2]} />
          <ambientLight intensity={0.82} />
          <directionalLight position={[4, 7, 5]} intensity={4.1} color="#eafff3" castShadow />
          <directionalLight position={[-5, 1, 3]} intensity={2.4} color="#65ff9a" />
          <directionalLight position={[4, -2, -3]} intensity={1.65} color="#7cf7ff" />
          <rectAreaLight position={[0, 4, 6]} rotation={[-0.52, 0, 0]} width={8} height={5} intensity={5.5} color="#eafff3" />
          <spotLight position={[0, 8, 2]} angle={0.5} penumbra={0.82} intensity={5.5} color="#65ff9a" castShadow />
          <pointLight position={[0, 0.4, 2]} intensity={phase === "portal" ? 20 : 8} distance={10} color="#65ff9a" />
          <ContactShadows position={[0, -1.42, 0]} opacity={0.5} scale={10} blur={3.1} far={6} color="#0d2d1c" />
        </Suspense>
      </Canvas>
      <div className="hk-scanlines pointer-events-none absolute inset-0 opacity-25" />
      <div className="entrance-stage-vignette pointer-events-none absolute inset-0" />
    </div>
  );
}
