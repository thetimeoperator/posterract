import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button3D } from "@/components/ui/button-3d";
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import { StackSpread, type StackCard } from "@/components/ui/stack-spread";
import { TiltCard, type TiltLayer } from "@/components/ui/tilt-card";

/**
 * The product hero: one sticky viewport that lasts 420vh of scroll.
 *
 * The headline sits compact at the top left, the way Diffusion Studio's
 * does, with the mode switch at the top right; that header stays pinned.
 * Around and below it the stage plays to the scroll, smoothed with a spring
 * so it glides: a cluster of videos made in the editor fans out across the
 * whole screen (the "stack spread"), drifts off, and the editor itself rises
 * in as a tilted card that keeps moving with the mouse (the "Halide" card),
 * with a title over it. The green world stays behind all of it, with its
 * own parallax.
 */

const SPREAD: [number, number] = [0, 0.42];
const EXIT: [number, number] = [0.42, 0.6];
const ENTER: [number, number] = [0.42, 0.66];

/** Eight clips made in the editor: the founder's own exports, five seconds each, looping. Positions in vw/vh from the stage anchor. */
const CARDS: StackCard[] = [
  { src: "/brand/hero/postmortem-1.mp4", poster: "/brand/hero/postmortem-1.jpg", alt: "Post Mortem 01", stackOffset: { x: -8, y: -6 }, stackRotate: -18, target: { x: -35, y: -4, w: 11, scale: 0.94 }, targetSm: { x: -22, y: -8 }, z: 2 },
  { src: "/brand/hero/multiplier.mp4", poster: "/brand/hero/multiplier.jpg", alt: "EP01, The Multiplier", stackOffset: { x: 14, y: -6 }, stackRotate: 20, target: { x: 35, y: -2, w: 11, scale: 0.94 }, targetSm: { x: 22, y: -8 }, z: 3 },
  { src: "/brand/hero/quantum.mp4", poster: "/brand/hero/quantum.jpg", alt: "Quantum AI God", stackOffset: { x: -16, y: 0 }, stackRotate: -4, target: { x: -19, y: 19, w: 12, scale: 1 }, targetSm: { x: -22, y: 12 }, z: 4 },
  { src: "/brand/hero/hyperspell.mp4", poster: "/brand/hero/hyperspell.jpg", alt: "HyperSpell", stackOffset: { x: 1, y: -8 }, stackRotate: -2, target: { x: 4, y: -25, w: 10, scale: 0.9 }, targetSm: { x: 22, y: 12 }, z: 5 },
  { src: "/brand/hero/postmortem-2.mp4", poster: "/brand/hero/postmortem-2.jpg", alt: "Post Mortem 02", stackOffset: { x: 18, y: 1 }, stackRotate: 6, target: { x: 19, y: -14, w: 12, scale: 1 }, targetSm: { x: -22, y: 52 }, z: 6 },
  { src: "/brand/hero/pons.mp4", poster: "/brand/hero/pons.jpg", alt: "PONS", stackOffset: { x: -6, y: 8 }, stackRotate: 6, target: { x: -5, y: 23, w: 12.5, scale: 1 }, targetSm: { x: 22, y: 52 }, z: 7 },
  { src: "/brand/hero/implanted.mp4", poster: "/brand/hero/implanted.jpg", alt: "Implanted Thoughts", stackOffset: { x: 8, y: 6 }, stackRotate: 3, target: { x: 13, y: 26, w: 11, scale: 0.94 }, targetSm: { x: -22, y: 32 }, z: 8 },
  { src: "/brand/hero/fomo.mp4", poster: "/brand/hero/fomo.jpg", alt: "iPhone FOMO", stackOffset: { x: 20, y: 10 }, stackRotate: -7, target: { x: 31, y: 20, w: 11.5, scale: 0.96 }, targetSm: { x: 22, y: 32 }, z: 9 },
];

/**
 * The editor screenshot in depth: the ground, the scenes on the canvas, then
 * the floating instruments. Regions are percentages of the image: the assets
 * panel, the inspector, the timeline and the command bar each get their own
 * layer, so they float over the canvas as the card tilts.
 */
const EDITOR = {
  src: "/brand/hero/editor.webp",
  aspect: 2000 / 1127,
  layers: [
    { depth: 0 },
    { clip: "inset(18.5% 28.5% 40.5% 29.3%)", depth: 40 },
    { clip: "inset(8.5% 79.5% 35% 0)", depth: 80, shadow: true },
    { clip: "inset(8.5% 0 35% 79.5%)", depth: 80, shadow: true },
    { clip: "inset(66% 0 0 0)", depth: 70, shadow: true },
    { clip: "inset(0 0 92% 0)", depth: 60, shadow: true },
  ] as TiltLayer[],
};

function useMedia(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const read = () => setMatches(list.matches);
    read();
    list.addEventListener("change", read);
    return () => list.removeEventListener("change", read);
  }, [query]);
  return matches;
}

/** The pointer, –1 to 1 on each axis, spring-smoothed; still at 0 when off. */
function usePointer(enabled: boolean) {
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const x = useSpring(rawX, { stiffness: 90, damping: 22, mass: 0.6 });
  const y = useSpring(rawY, { stiffness: 90, damping: 22, mass: 0.6 });
  useEffect(() => {
    if (!enabled) {
      rawX.set(0);
      rawY.set(0);
      return;
    }
    const onMove = (event: PointerEvent) => {
      rawX.set((event.clientX / window.innerWidth) * 2 - 1);
      rawY.set((event.clientY / window.innerHeight) * 2 - 1);
    };
    const onLeave = () => {
      rawX.set(0);
      rawY.set(0);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [enabled, rawX, rawY]);
  return { x, y };
}

/** The headline block: compact, top left. The lever above the H1, the small green title under it, then the launch button. */
function Copy({ onLaunch, fork }: { onLaunch: () => void; fork: ReactNode }) {
  return (
    <div className="site-stage-copy">
      <div className="site-stage-lever">{fork}</div>
      <h1 id="site-title" aria-label="Create and Schedule Content with your AI Agent">
        <span className="site-hero-title-line">Create and Schedule Content</span>
        <span className="site-hero-title-line">with your AI Agent</span>
      </h1>
      <p className="site-kicker site-stage-kicker">THE AGENT-FIRST SOCIAL MEDIA EDITOR AND SCHEDULER</p>
      <div className="site-stage-actions">
        <Button3D label="Launch Posterract" onClick={onLaunch} />
      </div>
    </div>
  );
}

export function HeroStage({ fork, onLaunch }: { fork: ReactNode; onLaunch: () => void }) {
  const section = useRef<HTMLElement>(null);
  const reduce = useReducedMotion() === true;
  /** Touch devices: no pointer response. Narrow windows: the phone layout. A narrow window with a mouse keeps the mouse. */
  const touch = useMedia("(pointer: coarse)");
  const small = useMedia("(max-width: 900px)");
  const [onScreen, setOnScreen] = useState(true);

  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end end"] });
  // A spring between the scroll and the stage: the cards and the card glide instead of snapping to each wheel tick.
  const progress = useSpring(scrollYProgress, { stiffness: 150, damping: 28, mass: 0.3, restDelta: 0.0005 });
  // Reduced motion only stills the pointer; the scroll choreography moves only when the reader scrolls.
  const pointer = usePointer(!touch && !reduce);

  useEffect(() => {
    const node = section.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? true), { rootMargin: "10% 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const hintOpacity = useTransform(progress, [0, 0.06], [1, 0]);

  // Phones: the header scrolls away in flow, then the stage takes the whole
  // screen for the same choreography. Desktop: the header stays pinned above it.
  const head = (
    <div className="site-stage-head">
      <Copy onLaunch={onLaunch} fork={fork} />
    </div>
  );

  return (
    <section className="site-stage-section" ref={section} data-small={small} aria-labelledby="site-title">
      {small && head}
      <div className="site-stage-sticky">
        {!small && head}

        <div className="site-stage">
          <StackSpread cards={CARDS} progress={progress} spread={SPREAD} exit={EXIT} pointer={pointer} small={small} reduce={reduce || touch} playing={onScreen} radius={6} />
          <TiltCard
            src={EDITOR.src}
            alt="The Posterract editor: the canvas, the floating instruments, the timeline"
            aspect={EDITOR.aspect}
            layers={EDITOR.layers}
            progress={progress}
            enter={ENTER}
            pointer={pointer}
            small={small}
            reduce={reduce || touch}
            overlay={<h2 className="site-tilt-title">Your agent's<br />editor.</h2>}
          />
        </div>

        <motion.div className="site-stage-hint" style={{ opacity: hintOpacity }} aria-hidden="true">
          <span>Scroll</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </motion.div>
      </div>
    </section>
  );
}
