import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

export type PanelProps = HTMLAttributes<HTMLDivElement> & {
  /** Show the four HUD corner brackets. */
  brackets?: boolean;
  /** Holo-shimmer sweep on hover. */
  shimmer?: boolean;
  /** Raised (lighter) glass background. */
  raised?: boolean;
  kicker?: string;
  title?: ReactNode;
  actions?: ReactNode;
};

/**
 * Glass panel — the basic surface of the Posterract HUD.
 */
export function Panel({
  brackets,
  shimmer,
  raised,
  kicker,
  title,
  actions,
  className,
  children,
  ...rest
}: PanelProps) {
  return (
    <section
      className={clsx(
        "glass",
        raised && "bg-[var(--glass-bg-raised)]",
        brackets && "hk-brackets",
        shimmer && "hk-shimmer",
        className,
      )}
      {...rest}
    >
      {brackets && <span className="hk-bracket-b" aria-hidden />}
      {(kicker || title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            {kicker && <p className="kicker">{kicker}</p>}
            {title && (
              <h2 className="mt-0.5 truncate font-display text-[15px] font-semibold text-starlight">
                {title}
              </h2>
            )}
          </div>
          {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(kicker || title || actions ? "px-5 pb-5 pt-3" : "p-5")}>{children}</div>
    </section>
  );
}
