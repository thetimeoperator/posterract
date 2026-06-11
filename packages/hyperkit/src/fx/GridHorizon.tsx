/**
 * Faint perspective grid fading into the void — used at the bottom of
 * the Bridge and the Gate. Pure SVG, no animation (the stillness reads
 * as "vast").
 */
export function GridHorizon({ className, height = 220 }: { className?: string; height?: number }) {
  const lines = 12;
  const verticals = 24;
  return (
    <div
      aria-hidden
      className={className}
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height,
        maskImage: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
        WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
        pointerEvents: "none",
      }}
    >
      <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 1000 220">
        {Array.from({ length: lines }, (_, i) => {
          const t = i / (lines - 1);
          const y = 220 - 220 * t * t;
          return (
            <line key={`h${i}`} x1="0" x2="1000" y1={y} y2={y} stroke="rgba(155,255,197,0.14)" strokeWidth="1" />
          );
        })}
        {Array.from({ length: verticals }, (_, i) => {
          const t = i / (verticals - 1);
          const xTop = 500 + (t - 0.5) * 2400;
          const xBottom = 500 + (t - 0.5) * 1000;
          return (
            <line
              key={`v${i}`}
              x1={xBottom}
              y1="220"
              x2={xTop}
              y2="0"
              stroke="rgba(155,255,197,0.1)"
              strokeWidth="1"
            />
          );
        })}
      </svg>
    </div>
  );
}
