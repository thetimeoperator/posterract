import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";

export type LiquidSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  preset?: "dock" | "control" | "modal" | "hero";
  interactive?: boolean;
  enabled?: boolean;
};

/**
 * Lightweight project glass. This adapter deliberately uses CSS compositing
 * only: no SVG displacement filters, resize observers, or pointer shaders.
 */
export const LiquidSurface = forwardRef<HTMLDivElement, LiquidSurfaceProps>(function LiquidSurface(
  { children, className, preset = "control", interactive = true, enabled = true, style, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={clsx(
        "liquid-surface",
        `liquid-surface--${preset}`,
        interactive && "liquid-surface--interactive",
        !enabled && "liquid-surface--quiet",
        className,
      )}
      style={style}
      {...rest}
    >
      <div className="liquid-surface__content">{children}</div>
    </div>
  );
});
