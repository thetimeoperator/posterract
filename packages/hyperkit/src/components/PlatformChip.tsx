import clsx from "clsx";
import type { CSSProperties } from "react";
import type { PlatformId } from "@posterract/contract";
import { PLATFORM_CAPABILITIES } from "@posterract/contract";

export type PlatformChipProps = {
  platform: PlatformId;
  /** Use the compact text-label variant for rows and calendars. */
  mini?: boolean;
  selected?: boolean;
  disabled?: boolean;
  error?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
};

export function PlatformChip({
  platform,
  mini,
  selected,
  disabled,
  error,
  onClick,
  className,
  title,
}: PlatformChipProps) {
  const caps = PLATFORM_CAPABILITIES[platform];
  const style = { "--pc": caps.accent } as CSSProperties;
  const Tag = onClick ? "button" : "span";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      aria-pressed={onClick ? selected : undefined}
      title={title ?? caps.label}
      style={style}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-chip)] border font-display transition-all duration-200",
        mini
          ? "h-6 min-w-[42px] px-1.5 text-[9px] font-semibold"
          : "h-7 px-2.5 text-[11px] font-medium",
        selected
          ? "border-[var(--pc)] bg-[color-mix(in_srgb,var(--pc)_12%,transparent)] text-[var(--pc)] shadow-[0_0_14px_color-mix(in_srgb,var(--pc)_30%,transparent)]"
          : "border-[var(--glass-border)] text-starlight-dim",
        onClick && !disabled && "cursor-pointer hover:border-[var(--pc)] hover:text-[var(--pc)]",
        disabled && "opacity-40 cursor-not-allowed",
        error && "border-redshift text-redshift",
        className,
      )}
    >
      {caps.label}
    </Tag>
  );
}

/** Compact row of mini platform chips with optional per-platform status dots. */
export function PlatformRuneRow({
  platforms,
  statusDots,
  className,
}: {
  platforms: PlatformId[];
  statusDots?: Partial<Record<PlatformId, "live" | "pending" | "failed" | "transmitting">>;
  className?: string;
}) {
  return (
    <span className={clsx("inline-flex items-center gap-1", className)}>
      {platforms.map((p) => {
        const caps = PLATFORM_CAPABILITIES[p];
        const dot = statusDots?.[p];
        return (
          <span
            key={p}
            title={caps.label}
            className={clsx(
              "relative inline-flex h-6 min-w-[42px] items-center justify-center rounded-[6px] border border-[var(--glass-border)] px-1.5 font-display text-[9px] font-semibold text-starlight-dim",
            )}
            style={{ color: "var(--starlight-dim)" }}
          >
            {caps.label}
            {dot && (
              <span
                aria-hidden
                className={clsx(
                  "absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full",
                  dot === "live" && "bg-auroral",
                  dot === "failed" && "bg-redshift",
                  dot === "transmitting" && "bg-neon hk-pulse-aura",
                  dot === "pending" && "bg-starlight-faint",
                )}
              />
            )}
          </span>
        );
      })}
    </span>
  );
}
