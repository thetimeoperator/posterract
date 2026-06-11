import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import clsx from "clsx";
import { Tesseract, type TesseractMode, type CellVisualState } from "./Tesseract";
import type { PlatformId } from "@posterract/contract";

export type TesseractStageProps = {
  mode: TesseractMode;
  cellStates?: Partial<Record<PlatformId, CellVisualState>>;
  className?: string;
  /** Camera distance — bigger fits the unfolded cross. */
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
 * Canvas wrapper for the Tesseract with bloom, scanline overlay, and a
 * static SVG fallback for reduced-motion or missing WebGL.
 */
export function TesseractStage({ mode, cellStates, className, scale = 0.9 }: TesseractStageProps) {
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
        camera={{ position: [0, 0, 7.2], fov: 45 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        fallback={<StaticTesseract />}
      >
        <Suspense fallback={null}>
          <Tesseract mode={mode} cellStates={cellStates} scale={scale} />
          <EffectComposer>
            <Bloom intensity={1.05} luminanceThreshold={0.18} luminanceSmoothing={0.5} mipmapBlur />
          </EffectComposer>
        </Suspense>
      </Canvas>
      {/* Scanline film over the stage only */}
      <div className="hk-scanlines pointer-events-none absolute inset-0 opacity-50" />
    </div>
  );
}

/** Static fallback — the tesseract as still line art. */
export function StaticTesseract({ size = 200 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      <g stroke="url(#static-irid)" strokeWidth="1.1" strokeLinejoin="round">
        <rect x="16" y="16" width="88" height="88" />
        <rect x="42" y="42" width="36" height="36" />
        <path d="M16 16l26 26M104 16L78 42M16 104l26-26M104 104L78 78" />
      </g>
      <defs>
        <linearGradient id="static-irid" x1="0" y1="0" x2="120" y2="120">
          <stop offset="0" stopColor="#65ff9a" />
          <stop offset="0.5" stopColor="#7cf7ff" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
      </defs>
    </svg>
  );
}
