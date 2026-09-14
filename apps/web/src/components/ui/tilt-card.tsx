import type { CSSProperties, ReactNode } from "react";
import { motion, useTransform, type MotionValue } from "framer-motion";

/**
 * A screenshot as a 3D object: the same image stacked in depth layers, each
 * clipped to one region, so the panels of an editor float over its canvas
 * and the whole card answers the pointer.
 *
 * Adapted from the "Halide" topographic hero. There, the entrance was timed
 * on load; here it is scroll-driven: the card rises and tilts in over one
 * window of the progress, then holds its tilt — rotateX 55°, rotateZ –25°,
 * like the reference — and keeps moving with the mouse for as long as the
 * hero is on screen.
 */

export type TiltLayer = {
  /** A CSS clip-path for the region this layer keeps; omitted for the whole image. */
  clip?: string;
  /** Height above the ground layer, px. */
  depth: number;
  /** A soft shadow under the layer, for the floating instruments. */
  shadow?: boolean;
};

type Pointer = { x: MotionValue<number>; y: MotionValue<number> };

type TiltCardProps = {
  src: string;
  alt: string;
  /** Width / height of the image. */
  aspect: number;
  layers: TiltLayer[];
  progress: MotionValue<number>;
  /** The progress window over which the card rises in. */
  enter: [number, number];
  pointer: Pointer;
  small: boolean;
  reduce: boolean;
  /** Drawn over the card once it is up. */
  overlay?: ReactNode;
};

/** The resting tilt, from the reference. */
const TILT_X = 55;
const TILT_Z = -25;
/** How far the pointer can turn the card, degrees, from the reference's x/25 and y/25. */
const POINTER_X = 9;
const POINTER_Z = 14;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const window01 = (value: number, [from, to]: [number, number]) => clamp01((value - from) / (to - from));

export function TiltCard({ src, alt, aspect, layers, progress, enter, pointer, small, reduce, overlay }: TiltCardProps) {
  /** The pointer turns the card unless the parent says not to (touch, reduced motion). */
  const answers = !reduce;
  void small;

  const opacity = useTransform(progress, (p) => window01(p, enter));
  const y = useTransform(progress, (p) => `${(1 - window01(p, enter)) * 36}vh`);
  const rotateX = useTransform([progress, pointer.y], ([p, py]: number[]) => {
    const e = window01(p, enter);
    return 90 + (TILT_X - 90) * e + (answers ? py * POINTER_X * e : 0);
  });
  const rotateZ = useTransform([progress, pointer.x], ([p, px]: number[]) => {
    const e = window01(p, enter);
    return TILT_Z * e + (answers ? -px * POINTER_Z * e : 0);
  });
  const scale = useTransform(progress, (p) => 0.8 + 0.2 * window01(p, enter));
  const overlayOpacity = useTransform(progress, (p) => clamp01((window01(p, enter) - 0.75) / 0.25));

  return (
    <div className="site-tilt" style={{ perspective: "2000px" }}>
      <motion.div
        className="site-tilt-card"
        style={{ ...({ "--tilt-aspect": `${aspect} / 1` } as CSSProperties), opacity, y, rotateX, rotateZ, scale, transformStyle: "preserve-3d" }}
      >
        {layers.map((layer, index) => (
          <TiltLayerView key={index} src={src} alt={index === 0 ? alt : ""} layer={layer} pointer={pointer} answers={answers} />
        ))}
        <div className="site-tilt-grid" aria-hidden="true" style={{ transform: "translateZ(120px)" }} />
      </motion.div>
      {overlay && (
        <motion.div className="site-tilt-overlay" style={{ opacity: overlayOpacity }}>
          {overlay}
        </motion.div>
      )}
    </div>
  );
}

function TiltLayerView({ src, alt, layer, pointer, answers }: { src: string; alt: string; layer: TiltLayer; pointer: Pointer; answers: boolean }) {
  const transform = useTransform([pointer.x, pointer.y], ([px, py]: number[]) =>
    answers
      ? `translateZ(${layer.depth}px) translate(${-px * layer.depth * 0.2}px, ${-py * layer.depth * 0.2}px)`
      : `translateZ(${layer.depth}px)`,
  );
  return (
    <motion.div className="site-tilt-layer" data-shadow={layer.shadow ?? false} style={{ clipPath: layer.clip, transform }}>
      <img src={src} alt={alt} draggable={false} />
    </motion.div>
  );
}
