import { useEffect, useRef } from "react";

/**
 * Two-layer parallax starfield on a canvas. Ultra-subtle: ~200 dim stars
 * drifting slowly, 60 brighter ones with occasional twinkle.
 * Honors prefers-reduced-motion (renders a static field once).
 */
export function Starfield({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    type Star = { x: number; y: number; r: number; a: number; v: number; tw: number };
    let dim: Star[] = [];
    let bright: Star[] = [];

    const seed = (count: number, rMax: number, aMax: number, vBase: number): Star[] =>
      Array.from({ length: count }, () => ({
        x: Math.random(),
        y: Math.random(),
        r: 0.4 + Math.random() * rMax,
        a: 0.15 + Math.random() * aMax,
        v: vBase * (0.5 + Math.random()),
        tw: Math.random() * Math.PI * 2,
      }));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (dim.length === 0) {
        dim = seed(200, 0.7, 0.25, 0.0035);
        bright = seed(60, 1.1, 0.5, 0.007);
      }
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const s of dim) {
        const x = ((s.x + t * s.v * 0.01) % 1) * w;
        ctx.globalAlpha = s.a;
        ctx.fillStyle = "#9ccbb0";
        ctx.beginPath();
        ctx.arc(x, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const s of bright) {
        const x = ((s.x + t * s.v * 0.01) % 1) * w;
        const twinkle = 0.75 + 0.25 * Math.sin(t * 0.8 + s.tw);
        ctx.globalAlpha = s.a * twinkle;
        ctx.fillStyle = "#eafff3";
        ctx.beginPath();
        ctx.arc(x, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(canvas);

    if (reduced) {
      draw(0);
    } else {
      let start = performance.now();
      const loop = (now: number) => {
        draw((now - start) / 1000);
        raf = requestAnimationFrame(loop);
      };
      const onVis = () => {
        cancelAnimationFrame(raf);
        if (!document.hidden) {
          start = performance.now() - start;
          raf = requestAnimationFrame(loop);
        }
      };
      raf = requestAnimationFrame(loop);
      document.addEventListener("visibilitychange", onVis);
      return () => {
        cancelAnimationFrame(raf);
        document.removeEventListener("visibilitychange", onVis);
        obs.disconnect();
      };
    }
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
