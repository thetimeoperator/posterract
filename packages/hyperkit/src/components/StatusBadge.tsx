import clsx from "clsx";
import type { TransmissionStatus, ProjectionStatus } from "@posterract/contract";

export type BadgeStatus = TransmissionStatus | ProjectionStatus;

type StatusSpec = {
  label: string;
  glyph: string;
  className: string;
  pulse?: boolean;
  flicker?: boolean;
};

const SPECS: Record<BadgeStatus, StatusSpec> = {
  draft: { label: "Draft", glyph: "◌", className: "text-starlight-dim border-[var(--glass-border)]" },
  pending: { label: "Pending", glyph: "◌", className: "text-starlight-dim border-[var(--glass-border)]" },
  scheduled: {
    label: "Scheduled",
    glyph: "◷",
    className: "text-hyper-cyan border-[rgba(94,242,255,0.35)] bg-[rgba(94,242,255,0.06)]",
  },
  transmitting: {
    label: "Transmitting",
    glyph: "⇶",
    className: "text-hyper-cyan border-[rgba(94,242,255,0.45)] bg-[rgba(94,242,255,0.08)]",
    pulse: true,
  },
  uploading: {
    label: "Uploading",
    glyph: "⇡",
    className: "text-hyper-cyan border-[rgba(94,242,255,0.45)] bg-[rgba(94,242,255,0.08)]",
    pulse: true,
  },
  publishing: {
    label: "Publishing",
    glyph: "⇶",
    className: "text-hyper-cyan border-[rgba(94,242,255,0.45)] bg-[rgba(94,242,255,0.08)]",
    pulse: true,
  },
  processing: {
    label: "Processing",
    glyph: "◍",
    className: "text-ultraviolet-soft border-[rgba(167,139,250,0.4)] bg-[rgba(139,92,246,0.08)]",
    pulse: true,
  },
  live: {
    label: "Live",
    glyph: "●",
    className: "text-auroral border-[rgba(70,245,177,0.4)] bg-[rgba(70,245,177,0.07)]",
  },
  partial: {
    label: "Partially live",
    glyph: "◐",
    className: "text-solar border-[rgba(255,200,87,0.4)] bg-[rgba(255,200,87,0.07)]",
  },
  failed: {
    label: "Failed",
    glyph: "✕",
    className: "text-redshift border-[rgba(255,92,122,0.4)] bg-[rgba(255,92,122,0.07)]",
    flicker: true,
  },
  retrying: {
    label: "Retrying",
    glyph: "↻",
    className: "text-solar border-[rgba(255,200,87,0.4)] bg-[rgba(255,200,87,0.07)]",
    pulse: true,
  },
  needs_reauth: {
    label: "Needs re-auth",
    glyph: "⚠",
    className: "text-solar border-[rgba(255,200,87,0.4)] bg-[rgba(255,200,87,0.07)]",
  },
  blocked: {
    label: "Blocked",
    glyph: "⊘",
    className: "text-redshift border-[rgba(255,92,122,0.4)] bg-[rgba(255,92,122,0.07)]",
  },
  canceled: { label: "Canceled", glyph: "○", className: "text-starlight-faint border-[var(--glass-border)]" },
};

export function StatusBadge({
  status,
  size = "md",
  className,
}: {
  status: BadgeStatus;
  size?: "sm" | "md";
  className?: string;
}) {
  const spec = SPECS[status];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border font-display font-medium",
        size === "sm" ? "h-5 px-2 text-[10px]" : "h-6 px-2.5 text-[11px]",
        "tracking-[0.08em] uppercase",
        spec.className,
        spec.pulse && "hk-pulse-aura",
        spec.flicker && "hk-flicker",
        className,
      )}
    >
      <span aria-hidden className="text-[0.9em] leading-none">
        {spec.glyph}
      </span>
      {spec.label}
    </span>
  );
}
