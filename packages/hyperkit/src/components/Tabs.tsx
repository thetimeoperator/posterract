import type { ReactNode } from "react";
import clsx from "clsx";
import { motion } from "framer-motion";

export type TabSpec<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Small redshift dot for error/attention. */
  alert?: boolean;
};

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  tabs: TabSpec<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={clsx("flex items-center gap-1 border-b border-[var(--glass-border)]", className)}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(tab.value)}
            className={clsx(
              "relative flex h-9 items-center gap-1.5 px-3 font-display text-[12px] font-medium transition-colors",
              active ? "text-starlight" : "text-starlight-dim hover:text-starlight",
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.alert && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-redshift" />}
            {active && (
              <motion.span
                layoutId="hk-tab-underline"
                className="absolute inset-x-1 -bottom-px h-px bg-neon shadow-glow-neon-md"
                transition={{ type: "spring", bounce: 0.18, duration: 0.45 }}
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
