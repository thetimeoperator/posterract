import clsx from "clsx";

/** Linear progress — a light beam in a channel. */
export function ProgressBeam({
  value,
  className,
  label,
}: {
  /** 0..1 */
  value: number;
  className?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-void-3", className)}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-neon via-neon to-pure shadow-glow-neon-sm transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Indeterminate progress — a comet crossing the channel. */
export function ProgressComet({ className, label }: { className?: string; label?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuetext="working"
      className={clsx("hk-comet h-1.5 w-full", className)}
    />
  );
}

/** Circular progress — an orbit ring filling clockwise. */
export function OrbitRing({
  value,
  size = 56,
  stroke = 3,
  className,
  children,
  label,
}: {
  /** 0..1 */
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  children?: React.ReactNode;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div
      className={clsx("relative inline-flex items-center justify-center", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--void-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#hk-orbit-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 300ms var(--ease-warp)", filter: "drop-shadow(0 0 4px rgba(101,255,154,0.5))" }}
        />
        <defs>
          <linearGradient id="hk-orbit-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#65ff9a" />
            <stop offset="1" stopColor="#7cf7ff" />
          </linearGradient>
        </defs>
      </svg>
      {children && <span className="absolute inset-0 flex items-center justify-center">{children}</span>}
    </div>
  );
}
