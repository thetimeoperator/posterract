import { useEffect, useRef } from "react";

/**
 * Two-layer starfield on a canvas: ~200 dim stars and 60 brighter ones. Drawn
 * once, and again when the canvas changes size. It used to drift and twinkle
 * every frame, which kept the whole screen behind every page repainting.
 */
export function Starfield({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    type Star = { x: number; y: number; r: number; a: number };
    const seed = (count: number, rMax: number, aMax: number): Star[] =>
      Array.from({ length: count }, () => ({
        x: Math.random(),
        y: Math.random(),
        r: 0.4 + Math.random() * rMax,
        a: 0.15 + Math.random() * aMax,
      }));
    const dim = seed(200, 0.7, 0.25);
    const bright = seed(60, 1.1, 0.5);

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const [stars, color] of [[dim, "#9ccbb0"], [bright, "#eafff3"]] as const) {
        ctx.fillStyle = color;
        for (const s of stars) {
          ctx.globalAlpha = s.a;
          ctx.beginPath();
          ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (Math.round(rect.width) === Math.round(w) && Math.round(rect.height) === Math.round(h)) return;
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(canvas);
    return () => obs.disconnect();
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={className}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: "var(--z-starfield)" }}
    />
  );
}
