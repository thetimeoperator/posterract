import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { MoveRight } from "lucide-react";

const TITLES = ["everywhere.", "on schedule.", "with agents.", "with insight."] as const;

type HeroProps = {
  onLaunch: () => void;
};

export function Hero({ onLaunch }: HeroProps) {
  const reduceMotion = useReducedMotion();
  const [titleNumber, setTitleNumber] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const timeoutId = window.setTimeout(() => {
      setTitleNumber((current) => (current + 1) % TITLES.length);
    }, 2300);
    return () => window.clearTimeout(timeoutId);
  }, [reduceMotion, titleNumber]);

  return (
    <div className="site-hero-copy site-hero-copy-centered">
      <a className="site-hero-pill" href="#workflow">
        <span>One upload. Every channel.</span>
        <MoveRight aria-hidden="true" size={14} strokeWidth={1.8} />
      </a>

      <div className="site-hero-message">
        <p className="site-kicker">SOCIAL PUBLISHING // ONE COMMAND CENTER</p>
        <h1 id="site-title" aria-label="One video. Publish everywhere.">
          <span className="site-hero-title-line">One video. Publish</span>
          <span className="site-hero-rotator" aria-hidden="true">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={TITLES[titleNumber]}
                initial={reduceMotion ? false : { opacity: 0, y: "85%", filter: "blur(10px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={reduceMotion ? undefined : { opacity: 0, y: "-85%", filter: "blur(10px)" }}
                transition={{ duration: 0.52, ease: [0.22, 1, 0.36, 1] }}
              >
                {TITLES[titleNumber]}
              </motion.span>
            </AnimatePresence>
          </span>
        </h1>

        <p className="site-hero-lede">
          Upload one finished video, tailor each destination, and let Posterract schedule,
          publish, and measure the launch from one command center.
        </p>
      </div>

      <div className="site-actions site-actions-centered">
        <button className="site-primary" type="button" onClick={onLaunch}>
          Launch Posterract
          <MoveRight aria-hidden="true" size={15} strokeWidth={1.8} />
        </button>
        <a className="site-secondary" href="#workflow">
          See the workflow
        </a>
      </div>

      <p className="site-live site-live-centered">
        <span /> Publishing live on YouTube, TikTok, and Instagram.
      </p>
    </div>
  );
}
