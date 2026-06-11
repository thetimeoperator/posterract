import { useEffect, useRef } from "react";
import clsx from "clsx";

export type MiniTesseractState = "idle" | "transmitting" | "error";

/**
 * The Posterract mark: a live 2D projection of a rotating 4D hypercube,
 * drawn on a small canvas. Doubles as the global status light —
 * idle: slow rotation · transmitting: fast + cyan pulse · error: redshift flicker.
 * Falls back to a static tesseract under prefers-reduced-motion.
 */
export function MiniTesseract({
  size = 26,
  state = "idle",
  className,
}: {
  size?: number;
  state?: MiniTesseractState;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 16 vertices of the hypercube in 4D
    const verts4: number[][] = [];
    for (let i = 0; i < 16; i++) {
      verts4.push([(i & 1 ? 1 : -1), (i & 2 ? 1 : -1), (i & 4 ? 1 : -1), (i & 8 ? 1 : -1)]);
    }
    // Edges connect vertices differing in exactly one bit
    const edges: Array<[number, number]> = [];
    for (let i = 0; i < 16; i++)
      for (let j = i + 1; j < 16; j++) {
        const d = i ^ j;
        if ((d & (d - 1)) === 0) edges.push([i, j]);
      }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;

    const draw = (t: number) => {
      const s = stateRef.current;
      const speed = s === "transmitting" ? 2.6 : 0.45;
      const a = t * speed;
      const b = t * speed * 0.7;
      const cosA = Math.cos(a), sinA = Math.sin(a);
      const cosB = Math.cos(b), sinB = Math.sin(b);

      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const scale = size * 0.21;

      const projected = verts4.map(([x, y, z, w]) => {
        // Double rotation: XW and YZ planes
        const x1 = x * cosA - w * sinA;
        const w1 = x * sinA + w * cosA;
        const y1 = y * cosB - z * sinB;
        const z1 = y * sinB + z * cosB;
        // 4D -> 3D perspective
        const k4 = 2.4 / (2.4 - w1);
        const X = x1 * k4, Y = y1 * k4, Z = z1 * k4;
        // 3D -> 2D perspective
        const k3 = 3.2 / (3.2 - Z);
        return [cx + X * k3 * scale, cy + Y * k3 * scale, w1];
      });

      const flicker = s === "error" && Math.sin(t * 24) > 0.6 ? 0.45 : 1;
      const color =
        s === "error"
          ? `rgba(255,113,143,${0.9 * flicker})`
          : s === "transmitting"
            ? "rgba(101,255,154,0.95)"
            : "rgba(156,203,176,0.9)";

      ctx.lineWidth = 1;
      ctx.lineCap = "round";
      for (const [i, j] of edges) {
        const [x1, y1, w1] = projected[i];
        const [x2, y2, w2] = projected[j];
        const depth = (w1 + w2) / 2;
        ctx.globalAlpha = (0.35 + 0.3 * (depth + 1)) * flicker;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    if (reduced) {
      draw(0.6);
      return;
    }
    let start = performance.now();
    const loop = (now: number) => {
      draw((now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={clsx("flex-none", className)}
      style={{ width: size, height: size }}
    />
  );
}
