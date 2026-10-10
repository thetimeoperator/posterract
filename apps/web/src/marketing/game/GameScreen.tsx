import { useEffect, useRef, type CSSProperties } from "react";

/**
 * The game screen as a 3D object in the hero, the way the old hero showed the
 * editor: the Points tab's screenshot stacked in depth layers, each clipped to
 * one panel, so the career card, the rank ladder and the dock float over the
 * screen. On load it rises and lies back (rotateX 90° → 55°, rotateZ 0 →
 * −25°, from the "Halide" reference), then turns with the mouse,
 * spring-smoothed as before (stiffness 90, damping 22, mass 0.6). No
 * animation library: one rAF loop writes three custom properties and CSS does
 * the rest, and only while the hero is on screen and something is moving.
 */

type Layer = { clip?: string; depth: number; shadow?: boolean };

/** The demo account's Points tab, 2000 × 1250. Regions are percentages of the image. */
const SCREEN = {
  src: "/brand/game/points-screen.webp",
  aspect: 2000 / 1250,
  layers: [
    { depth: 0 },
    { clip: "inset(0 0 92.8% 0)", depth: 30, shadow: true },
    { clip: "inset(10% 4.65% 73.6% 4.65%)", depth: 40 },
    { clip: "inset(27.8% 4.65% 36.6% 4.65%)", depth: 80, shadow: true },
    { clip: "inset(18.2% 6.7% 75.4% 79.7%)", depth: 115, shadow: true },
    { clip: "inset(64.8% 4.65% 15.2% 4.65%)", depth: 55, shadow: true },
    { clip: "inset(92.4% 43.8% 0.4% 43.8%)", depth: 140, shadow: true },
  ] satisfies Layer[],
};

const RISE_MS = 1100;
const SPRING = { stiffness: 90, damping: 22, mass: 0.6 };

const easeOut = (value: number) => 1 - (1 - value) ** 3;

export function GameScreen() {
  const stage = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const aim = { x: 0, y: 0 };
    const at = { x: 0, y: 0 };
    const speed = { x: 0, y: 0 };
    let riseFrom = still ? -Infinity : Number.NaN;
    let rise = still ? 1 : 0;
    let frame = 0;
    let last = 0;
    let onScreen = true;

    const paint = () => {
      node.style.setProperty("--rise", easeOut(rise).toFixed(4));
      node.style.setProperty("--px", at.x.toFixed(4));
      node.style.setProperty("--py", at.y.toFixed(4));
    };

    const tick = (time: number) => {
      const dt = Math.min(0.05, last ? (time - last) / 1000 : 1 / 60);
      last = time;
      let moving = false;
      if (!Number.isNaN(riseFrom) && rise < 1) {
        rise = Math.min(1, (time - riseFrom) / RISE_MS);
        moving = rise < 1;
      }
      for (const axis of ["x", "y"] as const) {
        const force = -SPRING.stiffness * (at[axis] - aim[axis]) - SPRING.damping * speed[axis];
        speed[axis] += (force / SPRING.mass) * dt;
        at[axis] += speed[axis] * dt;
        if (Math.abs(speed[axis]) > 0.0005 || Math.abs(at[axis] - aim[axis]) > 0.0005) moving = true;
      }
      paint();
      frame = moving && onScreen ? window.requestAnimationFrame(tick) : 0;
      if (!frame) last = 0;
    };

    const wake = () => {
      if (!frame && onScreen) frame = window.requestAnimationFrame(tick);
    };

    // The card rises once its picture is in, so it never lifts an empty frame.
    const start = () => {
      if (!Number.isNaN(riseFrom)) return;
      riseFrom = performance.now();
      wake();
    };
    const image = base.current;
    if (still) paint();
    else if (!image || image.complete) start();
    else image.addEventListener("load", start, { once: true });

    const onMove = (event: PointerEvent) => {
      aim.x = (event.clientX / window.innerWidth) * 2 - 1;
      aim.y = (event.clientY / window.innerHeight) * 2 - 1;
      wake();
    };
    const onLeave = () => {
      aim.x = 0;
      aim.y = 0;
      wake();
    };

    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? false;
      if (onScreen) wake();
    });
    observer.observe(node);
    paint();
    if (!still && !touch) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave);
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      image?.removeEventListener("load", start);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div className="gd-stage" ref={stage}>
      <div className="gd-screen-card" style={{ "--aspect": `${SCREEN.aspect}` } as CSSProperties}>
        {SCREEN.layers.map((layer, index) => (
          <div key={index} className="gd-screen-layer" data-shadow={layer.shadow ?? false} style={{ "--d": layer.depth } as CSSProperties}>
            <div className="gd-screen-clip" style={{ clipPath: layer.clip }}>
              <img
                ref={index === 0 ? base : undefined}
                src={SCREEN.src}
                alt={index === 0 ? "The Posterract Points screen: your rank, level, points, the rank ladder, your top posts and your streak" : ""}
                draggable={false}
                decoding="async"
                fetchPriority={index === 0 ? "high" : undefined}
              />
            </div>
          </div>
        ))}
        <div className="gd-screen-grid" aria-hidden="true" />
      </div>
    </div>
  );
}
