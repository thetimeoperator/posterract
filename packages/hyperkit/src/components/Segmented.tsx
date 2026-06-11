import clsx from "clsx";
import { motion } from "framer-motion";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={clsx(
        "inline-flex rounded-[10px] border border-[var(--glass-border)] bg-void-2 p-1",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={clsx(
              "relative h-8 rounded-[7px] px-3.5 font-display text-[12px] font-medium transition-colors duration-200",
              active ? "text-starlight" : "text-starlight-dim hover:text-starlight",
              opt.disabled && "cursor-not-allowed opacity-40",
            )}
          >
            {active && (
              <motion.span
                layoutId="hk-segment-glow"
                className="absolute inset-0 rounded-[7px] border border-[rgba(101,255,154,0.4)] bg-[rgba(101,255,154,0.08)] shadow-glow-neon-sm"
                transition={{ type: "spring", bounce: 0.18, duration: 0.45 }}
                aria-hidden
              />
            )}
            <span className="relative">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
