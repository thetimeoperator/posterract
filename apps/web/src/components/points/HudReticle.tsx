import type { CSSProperties } from "react";
import clsx from "clsx";

/**
 * The instrument ring around a rank emblem, after the target reticles of the
 * Iron Man HUD: a turning ring of ticks, two sweep arcs, a counter-turning
 * dashed ring and, for your own rank, a 270° gauge open at the bottom. The
 * gauge's segments are the tier's titles, the lit arc inside them is the XP
 * to the next level. Lines are currentColor; CSS sets colour, glow and motion.
 */

const C = 100;
const GAUGE_START = -135;
const GAUGE_SWEEP = 270;
const TICKS = Array.from({ length: 72 }, (_, index) => index);

/** A point on a circle, the angle in degrees clockwise from twelve o'clock. */
function polar(r: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return [C + r * Math.sin(radians), C - r * Math.cos(radians)] as const;
}

function point(r: number, angle: number) {
  const [x, y] = polar(r, angle);
  return `${x.toFixed(2)} ${y.toFixed(2)}`;
}

function arc(r: number, from: number, to: number) {
  return `M${point(r, from)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${point(r, to)}`;
}

export function HudReticle({
  size,
  progress,
  steps,
  className,
  style,
}: {
  size: number;
  /** XP to the next level, 0 to 1: the lit inner arc. */
  progress?: number;
  /** The tier's titles: how many, and the one you hold (0-based). */
  steps?: { count: number; current: number };
  className?: string;
  style?: CSSProperties;
}) {
  // Strokes are given in screen pixels, whatever size the ring is drawn at.
  const px = 200 / size;
  const per = steps ? GAUGE_SWEEP / steps.count : 0;
  const lit = progress === undefined ? undefined : Math.min(1, Math.max(0, progress));
  const head = lit === undefined ? undefined : GAUGE_START + GAUGE_SWEEP * lit;
  const [headX, headY] = head === undefined ? [0, 0] : polar(64, head);

  return (
    <span className={clsx("hud-reticle", className)} style={{ width: size, height: size, ...style }} aria-hidden>
      <svg className="hud-reticle__layer hud-reticle__ticks" viewBox="0 0 200 200">
        {TICKS.map((index) => (
          <line
            key={index}
            className={index % 6 === 0 ? "hud-tick hud-tick--major" : "hud-tick"}
            x1={C}
            y1={3}
            x2={C}
            y2={index % 6 === 0 ? 12 : 7.5}
            strokeWidth={px}
            transform={`rotate(${index * 5} ${C} ${C})`}
          />
        ))}
      </svg>
      <svg className="hud-reticle__layer hud-reticle__sweep" viewBox="0 0 200 200">
        <path d={arc(92, 18, 50)} strokeWidth={2 * px} />
        <path d={arc(92, 198, 230)} strokeWidth={2 * px} />
      </svg>
      <svg className="hud-reticle__layer hud-reticle__dash" viewBox="0 0 200 200">
        <circle cx={C} cy={C} r={71} strokeWidth={px} strokeDasharray={`${2 * px} ${5 * px}`} />
      </svg>
      <svg className="hud-reticle__layer hud-reticle__face" viewBox="0 0 200 200">
        <circle className="hud-reticle__hair" cx={C} cy={C} r={86} strokeWidth={px} />
        {steps &&
          Array.from({ length: steps.count }, (_, index) => {
            const state = index < steps.current ? "done" : index === steps.current ? "current" : "next";
            return (
              <path
                key={index}
                className={`hud-reticle__step hud-reticle__step--${state}`}
                d={arc(78, GAUGE_START + index * per + 1.6, GAUGE_START + (index + 1) * per - 1.6)}
                strokeWidth={5 * px}
              />
            );
          })}
        {head !== undefined && lit !== undefined && (
          <>
            <path className="hud-reticle__track" d={arc(64, GAUGE_START, GAUGE_START + GAUGE_SWEEP)} strokeWidth={px} />
            {lit > 0.002 && (
              <path className="hud-reticle__xp" d={arc(64, GAUGE_START, head)} strokeWidth={2.5 * px} pathLength={1} />
            )}
            <circle className="hud-reticle__head" cx={headX} cy={headY} r={3 * px} />
          </>
        )}
      </svg>
    </span>
  );
}
