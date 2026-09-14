import { RandomLetterSwap } from "@/components/ui/random-letter-swap";
import { useHoverIntent } from "@/components/ui/use-hover-intent";

/**
 * The shiny button, in Posterract's colours: a black body, a neon sweep
 * rising from the right over a dot texture, a ring of light that travels
 * around the edge, and a shimmer that crosses the label. The label's letters
 * swap on hover like the nav's. The light's position is `--x`, driven by a
 * CSS animation so it runs with no script at all.
 */
type ShinyButtonProps = {
  label: string;
  onClick?: () => void;
  size?: "lg" | "sm";
  className?: string;
};

export function ShinyButton({ label, onClick, size = "lg", className }: ShinyButtonProps) {
  const { hovered, handlers } = useHoverIntent();
  return (
    <button type="button" className={`site-shiny site-shiny-${size}${className ? ` ${className}` : ""}`} onClick={onClick} {...handlers}>
      <span className="site-shiny-dots" aria-hidden="true" />
      <span className="site-shiny-sweep" aria-hidden="true" />
      <span className="site-shiny-ring" aria-hidden="true" />
      <span className="site-shiny-label">
        <RandomLetterSwap label={label} hovered={hovered} staggerDuration={0.02} transition={{ type: "spring", duration: 0.5, bounce: 0.15 }} />
      </span>
    </button>
  );
}
