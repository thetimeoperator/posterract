import { useMemo, useState, type CSSProperties } from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";

/**
 * A label whose letters swap out on hover: each letter slides away and a
 * copy slides in from the other side, in a random order, staggered. Give it
 * `hovered` to drive it from a parent (a button whose whole surface should
 * trigger it); leave it out and it watches its own hover.
 */
export type RandomLetterSwapProps = {
  label: string;
  className?: string;
  style?: CSSProperties;
  /** Seconds between one letter starting and the next. */
  staggerDuration?: number;
  transition?: Transition;
  /** Letters leave downward and arrive from above instead. */
  reverse?: boolean;
  /** Drive the swap from outside; when omitted the label reacts to its own hover. */
  hovered?: boolean;
};

const DEFAULT_TRANSITION: Transition = { type: "spring", duration: 0.6, bounce: 0.2 };

function shuffled(count: number): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

export function RandomLetterSwap({
  label,
  className,
  style,
  staggerDuration = 0.025,
  transition = DEFAULT_TRANSITION,
  reverse = false,
  hovered,
}: RandomLetterSwapProps) {
  const reduceMotion = useReducedMotion();
  const [ownHover, setOwnHover] = useState(false);
  const active = hovered ?? ownHover;
  const letters = useMemo(() => Array.from(label), [label]);
  /** The order the letters move in: random, but fixed for the life of the label. */
  const delays = useMemo(() => {
    const order = shuffled(letters.length);
    const delay = new Array<number>(letters.length);
    order.forEach((letterIndex, position) => {
      delay[letterIndex] = position * staggerDuration;
    });
    return delay;
  }, [letters.length, staggerDuration]);

  const away = reverse ? "100%" : "-100%";
  const from = reverse ? "-100%" : "100%";

  return (
    <span
      className={className}
      style={{ display: "inline-flex", overflow: "hidden", verticalAlign: "bottom", ...style }}
      onMouseEnter={hovered === undefined ? () => setOwnHover(true) : undefined}
      onMouseLeave={hovered === undefined ? () => setOwnHover(false) : undefined}
      aria-label={label}
      role="text"
    >
      {letters.map((letter, index) => {
        // Arriving is staggered and springy; leaving is quick and all at once, so a
        // label the pointer merely crossed is back at rest before the next one moves.
        const letterTransition: Transition = reduceMotion
          ? { duration: 0 }
          : active
            ? { ...transition, delay: delays[index] ?? 0 }
            : { type: "tween", duration: 0.22, ease: "easeOut" };
        return (
          <span key={`${letter}-${index}`} style={{ position: "relative", display: "inline-block", overflow: "hidden", whiteSpace: "pre" }} aria-hidden="true">
            <motion.span style={{ display: "inline-block" }} animate={{ y: active ? away : "0%" }} transition={letterTransition}>
              {letter}
            </motion.span>
            <motion.span
              style={{ position: "absolute", top: 0, left: 0, display: "inline-block" }}
              initial={{ y: from }}
              animate={{ y: active ? "0%" : from }}
              transition={letterTransition}
            >
              {letter}
            </motion.span>
          </span>
        );
      })}
    </span>
  );
}
