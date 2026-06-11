import { Button, MiniTesseract } from "@posterract/hyperkit";

/** Error boundary fallback — "Hull breach contained." */
export function HullBreach({ error, reset }: { error: Error; reset?: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-void-0 px-6 text-center">
      <MiniTesseract size={42} state="error" />
      <p className="kicker">System fault</p>
      <h1 className="font-display text-2xl font-semibold text-starlight">Hull breach contained.</h1>
      <p className="max-w-md text-[13px] text-starlight-dim">
        Something failed while rendering this dimension. The rest of the ship is unaffected.
      </p>
      <pre className="telemetry max-w-lg overflow-x-auto rounded-[10px] border border-[rgba(255,113,143,0.25)] bg-void-1 px-4 py-2 text-left text-[11px] text-redshift">
        {error.message}
      </pre>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => (reset ? reset() : window.location.reload())}>
          Re-stabilize
        </Button>
        <Button variant="tertiary" onClick={() => (window.location.href = "/")}>
          Return to the Bridge
        </Button>
      </div>
    </main>
  );
}

/** Route pending fallback — the tesseract draws itself in. */
export function WarpingIn() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-void-0">
      <svg width="72" height="72" viewBox="0 0 120 120" fill="none" aria-hidden>
        <g stroke="url(#warp-irid)" strokeWidth="1.5" strokeLinejoin="round">
          <rect x="18" y="18" width="84" height="84" pathLength={1} className="warp-stroke" />
          <rect x="42" y="42" width="36" height="36" pathLength={1} className="warp-stroke" style={{ animationDelay: "0.2s" }} />
          <path d="M18 18l24 24M102 18L78 42M18 102l24-24M102 102L78 78" pathLength={1} className="warp-stroke" style={{ animationDelay: "0.4s" }} />
        </g>
        <defs>
          <linearGradient id="warp-irid" x1="0" y1="0" x2="120" y2="120">
            <stop offset="0" stopColor="#65ff9a" />
            <stop offset="0.5" stopColor="#7cf7ff" />
            <stop offset="1" stopColor="#ffffff" />
          </linearGradient>
        </defs>
      </svg>
      <p className="kicker" aria-live="polite">
        Crossing dimensions…
      </p>
      <style>{`
        .warp-stroke { stroke-dasharray: 1; stroke-dashoffset: 1; animation: warp-draw 1.1s var(--ease-warp) forwards; }
        @keyframes warp-draw { to { stroke-dashoffset: 0; } }
      `}</style>
    </main>
  );
}
