import { useEffect, useRef, type CSSProperties, type PointerEvent } from "react";
import clsx from "clsx";
import { CARD_H, CARD_W, drawCardBack, drawCardFace, SETTLED, type CardAssets, type FaceState } from "./drawCard";
import type { CardModel } from "./cardModel";

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const outCubic = (u: number) => 1 - (1 - clamp(u)) ** 3;

/** Draws a card face onto a canvas at its on-screen size, sharp on any display. */
function paint(canvas: HTMLCanvasElement, width: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const pixels = Math.round(width * ratio);
  const height = Math.round((pixels * CARD_H) / CARD_W);
  if (canvas.width !== pixels || canvas.height !== height) {
    canvas.width = pixels;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pixels, height);
  ctx.setTransform(pixels / CARD_W, 0, 0, pixels / CARD_W, 0, 0);
  draw(ctx);
}

/**
 * The big card on the profile: it turns over as it arrives (CSS, so the
 * compositor does the work), counts its numbers up once, then rests. It
 * tilts toward the pointer like a card held in the hand, with a highlight
 * that follows; transforms and opacity only.
 */
export function RankCardView({ model, assets, width }: { model: CardModel; assets?: CardAssets; width: number }) {
  const tiltRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLCanvasElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const flipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const face = faceRef.current;
    const back = backRef.current;
    if (!face || !back || !assets) return;
    paint(back, width, (ctx) => drawCardBack(ctx, model));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      paint(face, width, (ctx) => drawCardFace(ctx, model, assets, SETTLED));
      return;
    }
    // Turn the card over, then count up once it faces front again.
    const flip = flipRef.current;
    flip?.classList.remove("rc-flip--turn");
    void flip?.offsetWidth;
    flip?.classList.add("rc-flip--turn");
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      // The front comes round about a third of the way through the turn; it lands at one second.
      const seconds = (now - started) / 1000;
      const u = (seconds - 0.3) / 1.05;
      const state: FaceState = {
        count: outCubic(u),
        gauge: outCubic(u),
        pips: clamp(u * 1.15),
        flash: seconds < 0.95 ? 0 : Math.max(0, 1 - (seconds - 0.95) / 0.45),
        pulse: clamp((seconds - 0.95) / 0.3),
        turn: 0,
      };
      paint(face, width, (ctx) => drawCardFace(ctx, model, assets, state));
      if (seconds < 1.7) frame = requestAnimationFrame(tick);
      else paint(face, width, (ctx) => drawCardFace(ctx, model, assets, SETTLED));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [model, assets, width]);

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const element = tiltRef.current;
    if (!element || event.pointerType === "touch") return;
    const box = element.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    element.style.setProperty("--rx", `${((0.5 - y) * 14).toFixed(2)}deg`);
    element.style.setProperty("--ry", `${((x - 0.5) * 16).toFixed(2)}deg`);
    element.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
    element.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
    element.dataset.tilt = "on";
  };
  const onLeave = () => {
    const element = tiltRef.current;
    if (!element) return;
    element.style.setProperty("--rx", "0deg");
    element.style.setProperty("--ry", "0deg");
    delete element.dataset.tilt;
  };

  return (
    <div
      ref={tiltRef}
      className="rc-tilt"
      style={{ width, height: (width * CARD_H) / CARD_W } as CSSProperties}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      <div ref={flipRef} className="rc-flip">
        <canvas ref={faceRef} className="rc-side rc-side--face" role="img" aria-label={`${model.kicker}: ${model.caption}`} />
        <canvas ref={backRef} className="rc-side rc-side--back" aria-hidden />
        <span className="rc-glare" aria-hidden />
      </div>
      {!assets && <span className={clsx("rc-loading")}>Loading card</span>}
    </div>
  );
}
