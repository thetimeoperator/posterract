import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import LiquidGlass from "liquid-glass-react";
import clsx from "clsx";

export type LiquidSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  preset?: "dock" | "control" | "modal" | "hero";
  interactive?: boolean;
  enabled?: boolean;
};

const PRESETS = {
  dock: { displacementScale: 30, blurAmount: 0.12, saturation: 132, aberrationIntensity: 0.8, elasticity: 0.08, cornerRadius: 24 },
  control: { displacementScale: 24, blurAmount: 0.1, saturation: 128, aberrationIntensity: 0.6, elasticity: 0.1, cornerRadius: 18 },
  modal: { displacementScale: 18, blurAmount: 0.16, saturation: 120, aberrationIntensity: 0.45, elasticity: 0.04, cornerRadius: 22 },
  hero: { displacementScale: 34, blurAmount: 0.13, saturation: 138, aberrationIntensity: 0.9, elasticity: 0.12, cornerRadius: 26 },
} as const;

/**
 * The only project-facing entry point for liquid-glass-react. Browsers that
 * cannot render the SVG displacement still receive the Hyperkit glass layer.
 */
export const LiquidSurface = forwardRef<HTMLDivElement, LiquidSurfaceProps>(function LiquidSurface(
  { children, className, preset = "control", interactive = true, enabled = true, style, ...rest },
  ref,
) {
  const values = PRESETS[preset];
  return (
    <div
      ref={ref}
      className={clsx("liquid-surface glass", interactive && "liquid-surface--interactive", className)}
      style={style}
      {...rest}
    >
      {enabled && <LiquidGlass
        displacementScale={values.displacementScale}
        blurAmount={values.blurAmount}
        saturation={values.saturation}
        aberrationIntensity={values.aberrationIntensity}
        elasticity={values.elasticity}
        cornerRadius={values.cornerRadius}
        mode={preset === "hero" ? "prominent" : "standard"}
        padding="0"
        className="liquid-surface__effect pointer-events-none"
        style={{ position: "absolute", inset: "auto", top: "50%", left: "50%", width: "100%", height: "100%" } as CSSProperties}
      >
        <span aria-hidden />
      </LiquidGlass>}
      <div className="liquid-surface__content">{children}</div>
    </div>
  );
});
