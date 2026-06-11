import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[12px] gap-1.5",
  md: "h-10 px-4 text-[13px] gap-2",
  lg: "h-12 px-6 text-[14px] gap-2.5",
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "border-aurora hk-charge text-starlight hover:shadow-glow-violet-md active:scale-[0.99]",
  secondary:
    "border border-[var(--glass-border)] bg-[var(--glass-bg)] text-starlight hover:border-[var(--glass-border-bright)] hover:shadow-glow-violet-sm",
  tertiary:
    "text-starlight-dim hover:text-neon underline-offset-4 hover:underline bg-transparent",
  destructive:
    "border border-[rgba(255,113,143,0.35)] bg-[rgba(255,113,143,0.08)] text-redshift hover:border-redshift hover:shadow-glow-redshift-md",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex select-none items-center justify-center rounded-[10px] font-display font-semibold tracking-wide transition-all duration-200",
        "disabled:cursor-not-allowed disabled:opacity-45",
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <span className="hk-orbit-dot mr-1" aria-hidden /> : icon}
      {children}
    </button>
  );
});
