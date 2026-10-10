import { useEffect, useRef, type CSSProperties } from "react";

/**
 * A product screenshot as an object you can handle: it rests at a slight
 * angle, and under the pointer it turns toward it, its panels lift off at
 * their own depths, and a glare follows the light. Spring-smoothed in one
 * rAF loop that runs only while something is moving; no animation library.
 * Touch screens and reduced motion get the resting angle and nothing else.
 */

export type ShotLayer = { clip?: string; depth: number; shadow?: boolean };

export type Shot = { src: string; alt: string; aspect: number; layers: ShotLayer[] };

const SPRING = { stiffness: 120, damping: 18, mass: 0.7 };
/** Resting angle, and how far the pointer can turn it, degrees. */
const REST = { x: 0.32, y: -0.42 };
const TURN = { x: 11, y: 14 };

export function TiltShot({ shot, side = "left" }: { shot: Shot; side?: "left" | "right" }) {
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    // At rest the card turns toward the text beside it.
    const rest = { x: REST.x, y: side === "left" ? -REST.y : REST.y };
    const aim = { ...rest, hover: 0 };
    const at = { ...rest, hover: 0 };
    const speed = { x: 0, y: 0, hover: 0 };
    let loop = 0;
    let last = 0;

    const paint = () => {
      frame.style.setProperty("--tx", at.x.toFixed(4));
      frame.style.setProperty("--ty", at.y.toFixed(4));
      frame.style.setProperty("--hover", at.hover.toFixed(4));
    };

    const tick = (time: number) => {
      const dt = Math.min(0.05, last ? (time - last) / 1000 : 1 / 60);
      last = time;
      let moving = false;
      for (const axis of ["x", "y", "hover"] as const) {
        const force = -SPRING.stiffness * (at[axis] - aim[axis]) - SPRING.damping * speed[axis];
        speed[axis] += (force / SPRING.mass) * dt;
        at[axis] += speed[axis] * dt;
        if (Math.abs(speed[axis]) > 0.0005 || Math.abs(at[axis] - aim[axis]) > 0.0005) moving = true;
      }
      paint();
      loop = moving ? window.requestAnimationFrame(tick) : 0;
      if (!loop) last = 0;
    };
    const wake = () => {
      if (!loop) loop = window.requestAnimationFrame(tick);
    };

    paint();
    if (still || touch) return;

    const onMove = (event: PointerEvent) => {
      const box = frame.getBoundingClientRect();
      const x = ((event.clientX - box.left) / box.width) * 2 - 1;
      const y = ((event.clientY - box.top) / box.height) * 2 - 1;
      aim.x = Math.max(-1, Math.min(1, y));
      aim.y = Math.max(-1, Math.min(1, x));
      aim.hover = 1;
      frame.style.setProperty("--gx", `${((x + 1) / 2) * 100}%`);
      frame.style.setProperty("--gy", `${((y + 1) / 2) * 100}%`);
      wake();
    };
    const onLeave = () => {
      aim.x = rest.x;
      aim.y = rest.y;
      aim.hover = 0;
      wake();
    };
    frame.addEventListener("pointermove", onMove);
    frame.addEventListener("pointerleave", onLeave);
    return () => {
      if (loop) window.cancelAnimationFrame(loop);
      frame.removeEventListener("pointermove", onMove);
      frame.removeEventListener("pointerleave", onLeave);
    };
  }, [side]);

  return (
    <div className="gt-shot" ref={frameRef} style={{ "--aspect": `${shot.aspect}`, "--turn-x": `${TURN.x}deg`, "--turn-y": `${TURN.y}deg` } as CSSProperties}>
      <div className="gt-card">
        {shot.layers.map((layer, index) => (
          <div key={index} className="gt-layer" data-shadow={layer.shadow ?? false} style={{ "--d": layer.depth } as CSSProperties}>
            <div className="gt-clip" style={{ clipPath: layer.clip }}>
              <img src={shot.src} alt={index === 0 ? shot.alt : ""} draggable={false} loading="lazy" decoding="async" />
            </div>
          </div>
        ))}
        <div className="gt-glare" aria-hidden="true" />
      </div>
    </div>
  );
}
