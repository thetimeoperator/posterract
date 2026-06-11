import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import clsx from "clsx";
import type { PlatformId } from "@posterract/contract";
import type { CellVisualState, TesseractMode } from "@/tesseract/Tesseract";
import { PosterractDevice } from "./PosterractDevice";
import { StaticTesseract } from "@/tesseract/TesseractStage";

export type DeviceStageProps = {
  mode: TesseractMode;
  cellStates?: Partial<Record<PlatformId, CellVisualState>>;
  className?: string;
  scale?: number;
};

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Stage for THE POSTERRACT device — camera slightly above, looking down at
 * the relic, with bloom and a scanline film. Static fallback under
 * reduced-motion / missing WebGL.
 */
export function DeviceStage({ mode, cellStates, className, scale = 1 }: DeviceStageProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return (
      <div className={clsx("relative flex items-center justify-center", className)}>
        <StaticTesseract />
      </div>
    );
  }

  return (
    <div className={clsx("relative", className)} aria-hidden>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 2.3, 6.6], fov: 42 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ camera }) => camera.lookAt(0, -0.1, 0)}
        fallback={<StaticTesseract />}
      >
        <Suspense fallback={null}>
          <PosterractDevice mode={mode} cellStates={cellStates} scale={scale} />
          <EffectComposer>
            <Bloom intensity={1.15} luminanceThreshold={0.2} luminanceSmoothing={0.5} mipmapBlur />
          </EffectComposer>
        </Suspense>
      </Canvas>
      <div className="hk-scanlines pointer-events-none absolute inset-0 opacity-40" />
    </div>
  );
}
