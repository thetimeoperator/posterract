import { useEffect, useRef } from "react";
import { motion, useTransform, type MotionValue } from "framer-motion";

/**
 * A cluster of cards that fans out as a scroll progresses, then drifts away.
 *
 * Adapted from the Hyperiux "stack spread": the cards start stacked at an
 * anchor, spread to their spots over one window of the progress value, and
 * leave over a second window. The parent owns the scroll and the pointer;
 * this only maps them to transforms, so the cards, the hero's other actors
 * and its captions all move to the same clock.
 */

export type StackCard = {
  src: string;
  poster: string;
  alt: string;
  /** Offset while clustered, in vw/vh from the anchor. */
  stackOffset: { x: number; y: number };
  /** Angle while clustered, degrees. */
  stackRotate: number;
  /** Where it spreads to: position in vw/vh from the anchor, width in vw (9:16), rest scale. */
  target: { x: number; y: number; w: number; scale?: number };
  /** Where it spreads to on touch devices (a two-column grid), in vw/vh. */
  targetSm: { x: number; y: number };
  /** Paint order, higher on top. */
  z: number;
};

export type Pointer = { x: MotionValue<number>; y: MotionValue<number> };

type StackSpreadProps = {
  cards: StackCard[];
  /** The hero's progress, 0 to 1. */
  progress: MotionValue<number>;
  /** The progress window over which the cluster spreads. */
  spread: [number, number];
  /** The progress window over which the spread cards drift off and fade. */
  exit: [number, number];
  /** Pointer position, –1 to 1 on each axis, spring-smoothed by the parent. */
  pointer: Pointer;
  /** Scale of the cards while clustered. */
  stackScale?: number;
  /** Corner radius, px. */
  radius?: number;
  /** Touch layout: cards land in a two-column grid, no pointer response. */
  small: boolean;
  /** Reduced motion: no pointer response; the scroll choreography stays, it only moves when the reader scrolls. */
  reduce: boolean;
  /** Whether the videos should be playing (the hero is on screen). */
  playing: boolean;
};

const PARALLAX_X = 2.4;
const PARALLAX_Y = 2.0;
/** How far the cards keep travelling past their spots while leaving, in vw/vh. */
const EXIT_DRIFT = 22;
const COLUMN_X = 22;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const window01 = (value: number, [from, to]: [number, number]) => clamp01((value - from) / (to - from));
const depthOf = (index: number, total: number) => (total <= 1 ? 1 : 0.55 + (index / (total - 1)) * 0.75);

function Card({
  card,
  index,
  total,
  progress,
  spread,
  exit,
  pointer,
  stackScale,
  radius,
  small,
  reduce,
  playing,
}: { card: StackCard; index: number; total: number } & Omit<StackSpreadProps, "cards">) {
  const video = useRef<HTMLVideoElement>(null);
  const depth = reduce ? 0 : depthOf(index, total);
  const restScale = card.target.scale ?? 1;
  const endX = small ? Math.sign(card.targetSm.x) * COLUMN_X : card.target.x;
  const endY = small ? card.targetSm.y : card.target.y;
  const stackRotate = card.stackRotate;
  const drift = Math.hypot(endX, endY) || 1;

  const translate = useTransform([progress, pointer.x, pointer.y], ([p, px, py]: number[]) => {
    const t = window01(p, spread);
    const e = window01(p, exit);
    const x = card.stackOffset.x + (endX - card.stackOffset.x) * t + (endX / drift) * EXIT_DRIFT * e;
    const y = card.stackOffset.y + (endY - card.stackOffset.y) * t + (endY / drift) * EXIT_DRIFT * e;
    const lean = depth * t;
    return `calc(-50% + ${x - px * PARALLAX_X * lean}vw) calc(-50% + ${y - py * PARALLAX_Y * lean}vh)`;
  });
  const rotate = useTransform(progress, (p) => stackRotate + (0 - stackRotate) * window01(p, spread));
  const scale = useTransform(progress, (p) => {
    const t = window01(p, spread);
    const e = window01(p, exit);
    return (stackScale ?? 0.82) + (restScale - (stackScale ?? 0.82)) * t - 0.1 * e;
  });
  const opacity = useTransform(progress, (p) => 1 - clamp01((window01(p, exit) - 0.25) / 0.75));

  // Autoplay needs the element muted at the moment play() runs, and React
  // sets `muted` late in some browsers; so it is set by hand, play is tried
  // now and again once the clip can play, and once more on the first
  // scroll or touch for browsers that still refuse.
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    if (!playing) {
      node.pause();
      return;
    }
    node.muted = true;
    node.defaultMuted = true;
    let done = false;
    const attempt = () => {
      if (done) return;
      void node.play().then(() => { done = true; }).catch(() => undefined);
    };
    attempt();
    node.addEventListener("canplay", attempt);
    window.addEventListener("scroll", attempt, { passive: true });
    window.addEventListener("pointerdown", attempt, { passive: true });
    return () => {
      node.removeEventListener("canplay", attempt);
      window.removeEventListener("scroll", attempt);
      window.removeEventListener("pointerdown", attempt);
    };
  }, [playing]);

  return (
    <motion.figure
      className="site-stack-card"
      style={{
        width: `${small ? 30 : card.target.w}vw`,
        aspectRatio: "9 / 16",
        zIndex: card.z,
        translate,
        rotate,
        scale,
        opacity,
        borderRadius: radius ?? 6,
      }}
    >
      <video ref={video} src={card.src} poster={card.poster} muted loop autoPlay playsInline preload="metadata" aria-label={card.alt} />
    </motion.figure>
  );
}

export function StackSpread(props: StackSpreadProps) {
  return (
    <div className="site-stack" aria-hidden="true">
      {props.cards.map((card, index) => (
        <Card key={card.src} card={card} index={index} total={props.cards.length} {...props} />
      ))}
    </div>
  );
}
