import { Suspense, useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Center, ContactShadows, Environment, Lightformer, type OnCenterCallbackProps } from "@react-three/drei";
import clsx from "clsx";
import type { PlatformId } from "@posterract/contract";
import { PosterractRelic, type RelicMode, type RelicPodState } from "./PosterractRelic";

export type RelicStageProps = {
  mode: RelicMode;
  podStates?: Partial<Record<PlatformId, RelicPodState>>;
  hoveredPlatform?: PlatformId | null;
  onPlatformHover?: (platform: PlatformId | null) => void;
  className?: string;
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function StaticRelic() {
  return (
    <svg viewBox="0 0 420 420" className="h-[72%] w-[72%] max-h-[620px] max-w-[620px]" fill="none" aria-hidden>
      <defs>
        <radialGradient id="relic-core">
          <stop offset="0" stopColor="#eafff3" />
          <stop offset="0.28" stopColor="#65ff9a" />
          <stop offset="1" stopColor="#65ff9a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="210" cy="210" r="75" fill="url(#relic-core)" opacity="0.5" />
      <g stroke="#65ff9a" strokeWidth="2" opacity="0.86">
        <rect x="168" y="168" width="84" height="84" />
        <rect x="188" y="188" width="44" height="44" />
        <path d="m168 168 20 20m64-20-20 20m-64 64 20-20m64 20-20-20" />
      </g>
      {Array.from({ length: 6 }, (_, index) => {
        const angle = (index / 6) * Math.PI * 2;
        const x1 = 210 + Math.cos(angle) * 78;
        const y1 = 210 + Math.sin(angle) * 78;
        const x2 = 210 + Math.cos(angle) * 160;
        const y2 = 210 + Math.sin(angle) * 160;
        return <path key={index} d={`M${x1} ${y1} L${x2} ${y2}`} stroke="#8aa59a" strokeWidth="12" strokeLinecap="round" />;
      })}
    </svg>
  );
}

type RelicBounds = Pick<OnCenterCallbackProps, "width" | "height" | "depth">;

function FittedCamera({ bounds }: { bounds: RelicBounds | null }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  useLayoutEffect(() => {
    camera.position.set(0, 3.2, 8);
    camera.lookAt(0, 0, 0);

    if ("zoom" in camera && bounds) {
      const pitch = Math.atan2(camera.position.y, camera.position.z);
      const projectedHeight = bounds.height * Math.cos(pitch) + bounds.depth * Math.sin(pitch);
      const targetWidth = size.width * 0.58;
      const targetHeight = size.height * 0.68;
      camera.zoom = Math.min(targetWidth / bounds.width, targetHeight / projectedHeight);
    }

    camera.updateProjectionMatrix();
  }, [bounds, camera, size.height, size.width]);

  return null;
}

export function RelicStage({ mode, podStates, hoveredPlatform, onPlatformHover, className }: RelicStageProps) {
  const reduced = useReducedMotion();
  const [bounds, setBounds] = useState<RelicBounds | null>(null);
  const fitRelic = useCallback(({ width, height, depth }: OnCenterCallbackProps) => {
    setBounds({ width, height, depth });
  }, []);

  if (reduced) {
    return (
      <div className={clsx("flex items-center justify-center", className)}>
        <StaticRelic />
      </div>
    );
  }

  return (
    <div className={clsx("isolate", className)}>
      <Canvas
        orthographic
        dpr={[1, 2]}
        shadows
        camera={{ position: [0, 3.2, 8], zoom: 120, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      >
        <Suspense fallback={null}>
          <FittedCamera bounds={bounds} />
          <Center onCentered={fitRelic}>
            <group scale={1}>
              <PosterractRelic
                mode={mode}
                podStates={podStates}
                hoveredPlatform={hoveredPlatform}
                onPlatformHover={onPlatformHover}
              />
            </group>
          </Center>
          <ambientLight intensity={0.42} />
          <directionalLight position={[4, 7, 4]} intensity={1.75} color="#eafff3" />
          <directionalLight position={[-5, 2, -4]} intensity={1.05} color="#7cf7ff" />
          <spotLight position={[0, 8, 1]} angle={0.45} penumbra={0.8} intensity={3.2} color="#65ff9a" castShadow />
          <ContactShadows position={[0, -1.4, 0]} opacity={0.42} scale={9} blur={2.8} far={5} color="#163c29" />
          <Environment resolution={96} frames={1}>
            <Lightformer intensity={1.1} position={[0, 6, -8]} scale={[12, 8, 1]} color="#eafff3" />
            <Lightformer intensity={1.4} position={[-7, 1, 1]} rotation-y={Math.PI / 2} scale={[12, 1, 1]} color="#65ff9a" />
            <Lightformer intensity={0.9} position={[7, -1, 2]} rotation-y={-Math.PI / 2} scale={[12, 1, 1]} color="#7cf7ff" />
          </Environment>
        </Suspense>
      </Canvas>
      <div className="hk-scanlines pointer-events-none absolute inset-0 opacity-30" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{ background: "radial-gradient(circle at 50% 50%, transparent 36%, rgba(5,8,11,0.42) 100%)" }}
      />
    </div>
  );
}
