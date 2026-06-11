import { useEffect, useState } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

/** Skeleton shimmer block. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={clsx("hk-skeleton", className)} {...rest} />;
}

/** Octagon-clipped avatar with optional presence dot. */
export function Avatar({
  src,
  name,
  size = 32,
  presence,
  className,
}: {
  src?: string;
  name: string;
  size?: number;
  presence?: "online" | "off";
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const octagon =
    "polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)";
  return (
    <span className={clsx("relative inline-flex flex-none", className)} style={{ width: size, height: size }}>
      <span
        className="flex h-full w-full items-center justify-center bg-void-3 font-display text-[11px] font-semibold text-starlight-dim"
        style={{ clipPath: octagon }}
      >
        {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : initials}
      </span>
      {presence && (
        <span
          aria-hidden
          className={clsx(
            "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-void-0",
            presence === "online" ? "bg-auroral" : "bg-starlight-faint",
          )}
        />
      )}
    </span>
  );
}

/** Per-page empty state with constellation-style line art. */
export function EmptyState({
  glyph,
  title,
  detail,
  action,
  className,
}: {
  glyph?: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col items-center justify-center gap-3 py-14 text-center", className)}>
      <div className="text-starlight-faint">{glyph ?? <ConstellationGlyph />}</div>
      <p className="font-display text-[15px] font-semibold text-starlight">{title}</p>
      {detail && <p className="max-w-sm text-[13px] text-starlight-dim">{detail}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ConstellationGlyph({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.7} viewBox="0 0 100 70" fill="none" aria-hidden>
      <path d="M10 55 L34 30 L58 42 L88 12" stroke="var(--starlight-faint)" strokeWidth="1" />
      {[
        [10, 55],
        [34, 30],
        [58, 42],
        [88, 12],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.5" fill="var(--ice)" opacity={0.8} />
      ))}
      <circle cx={34} cy={30} r="5.5" stroke="var(--neon)" strokeWidth="0.75" opacity={0.5} />
    </svg>
  );
}

/** T-minus countdown — mono digits, ticks every second. */
export function Countdown({ to, className, prefix = "T-" }: { to: number; className?: string; prefix?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const delta = Math.max(0, to - now);
  const s = Math.floor(delta / 1000);
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const text =
    days > 0 ? `${prefix}${days}d ${pad(h)}:${pad(m)}` : `${prefix}${pad(h)}:${pad(m)}:${pad(sec)}`;
  return (
    <span className={clsx("telemetry text-neon", className)} title={new Date(to).toLocaleString()}>
      {text}
    </span>
  );
}

/** Key-value mono telemetry block. */
export function Telemetry({
  rows,
  className,
}: {
  rows: Array<{ k: string; v: ReactNode; tone?: "default" | "good" | "warn" | "bad" }>;
  className?: string;
}) {
  return (
    <dl className={clsx("telemetry space-y-1 text-[12px]", className)}>
      {rows.map(({ k, v, tone }) => (
        <div key={k} className="flex items-baseline justify-between gap-6">
          <dt className="text-starlight-faint">{k}</dt>
          <dd
            className={clsx(
              "text-right",
              tone === "good" && "text-auroral",
              tone === "warn" && "text-solar",
              tone === "bad" && "text-redshift",
              (!tone || tone === "default") && "text-starlight-dim",
            )}
          >
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Simple instant tooltip via title-like custom element (CSS-only hover). */
export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="group/hint relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--glass-border)] bg-void-1 px-2 py-1 font-mono text-[10px] text-starlight-dim opacity-0 transition-opacity duration-150 group-hover/hint:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
