import { type PropsWithChildren, useEffect, useRef } from "react";
import { ShaderBackground, type ShaderColor } from "@/components/ui/blue-noise";

/**
 * One persistent visual world for the public landing-page introduction.
 * The existing Hero shader stays mounted once while Hero, Network, and Roadmap
 * move over it. Scroll values are written directly to CSS variables so the
 * parallax never causes React renders.
 */
/** The world's colours in work mode: the greens of the shader turned cyan-blue (see scripts/cyan-theme.mjs). */
const CYAN_WORLD: ShaderColor[] = [
  [0, 0, 0],
  [0, 0.8549, 0.9922],
  [0.3725, 0.8627, 1],
  [0.6588, 0.9647, 1],
];

export function LandingIntroWorld({ children, palette = "green" }: PropsWithChildren<{ palette?: "green" | "cyan" }>) {
  const worldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    const render = () => {
      frame = 0;
      if (reducedMotion.matches) {
        world.style.setProperty("--site-intro-shift", "0px");
        world.style.setProperty("--site-intro-stars-shift", "0px");
        world.style.setProperty("--site-intro-grid-shift", "0px");
        world.style.setProperty("--site-intro-aurora-shift", "0px");
        return;
      }

      const rect = world.getBoundingClientRect();
      const travel = Math.max(world.offsetHeight - window.innerHeight, 1);
      const scrollThrough = Math.min(travel, Math.max(0, -rect.top));
      world.style.setProperty("--site-intro-shift", `${scrollThrough * 0.055}px`);
      world.style.setProperty("--site-intro-stars-shift", `${scrollThrough * -0.028}px`);
      world.style.setProperty("--site-intro-grid-shift", `${scrollThrough * -0.052}px`);
      world.style.setProperty("--site-intro-aurora-shift", `${scrollThrough * 0.038}px`);
    };

    const schedule = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(render);
    };

    render();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    reducedMotion.addEventListener("change", schedule);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      reducedMotion.removeEventListener("change", schedule);
    };
  }, []);

  return (
    <div className="site-intro-world" ref={worldRef}>
      <div className="site-intro-background" aria-hidden="true">
        <div className="site-intro-background-sticky">
          <ShaderBackground className="site-aether-canvas" colors={palette === "cyan" ? CYAN_WORLD : undefined} />
          <div className="site-intro-stars" />
          <div className="site-intro-grid" />
          <div className="site-intro-aurora" />
          <div className="site-intro-vignette" />
        </div>
      </div>
      <div className="site-intro-content">{children}</div>
    </div>
  );
}
