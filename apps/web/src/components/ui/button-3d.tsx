import { RandomLetterSwap } from "@/components/ui/random-letter-swap";
import { useHoverIntent } from "@/components/ui/use-hover-intent";

/**
 * A pushable 3D button in Posterract's colours, angled in space like the
 * reference: a black-to-green face that sits up on a deep-green edge with a
 * glow beneath, lifts on hover and presses on click.
 */
type Button3DProps = {
  label: string;
  onClick?: () => void;
  /** An arrow after the label, like the reference. */
  arrow?: boolean;
  /** "submit" makes it a form's button. */
  type?: "button" | "submit";
  disabled?: boolean;
  "aria-label"?: string;
};

export function Button3D({ label, onClick, arrow = true, type = "button", disabled, "aria-label": ariaLabel }: Button3DProps) {
  const { hovered, handlers } = useHoverIntent();
  return (
    <div className="site-b3d-scene">
      <button type={type} className="site-b3d" onClick={onClick} disabled={disabled} aria-label={ariaLabel} {...handlers}>
        <span className="site-b3d-glow" aria-hidden="true" />
        <span className="site-b3d-edge" aria-hidden="true" />
        <span className="site-b3d-front">
          <RandomLetterSwap label={label} hovered={hovered} staggerDuration={0.02} transition={{ type: "spring", duration: 0.5, bounce: 0.15 }} />
          {arrow && (
            <svg className="site-b3d-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          )}
        </span>
      </button>
    </div>
  );
}
