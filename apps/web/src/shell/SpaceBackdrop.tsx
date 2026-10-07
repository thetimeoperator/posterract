import { Starfield } from "@posterract/hyperkit";

/**
 * The still space behind every page: a gradient, a nebula, a field of stars,
 * a faint grid, a grade and noise. Nothing in it moves, so the glass panels
 * above it never have to be redrawn just because the background changed.
 */
export function SpaceBackdrop() {
  return (
    <div className="space-backdrop" aria-hidden>
      <div className="space-backdrop__nebula" />
      <div className="space-backdrop__stars">
        <Starfield />
      </div>
      <div className="space-backdrop__grid chamber-grid" />
      <div className="space-backdrop__grade" />
      <div className="space-backdrop__noise" />
    </div>
  );
}
