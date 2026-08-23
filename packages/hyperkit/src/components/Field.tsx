import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

const WELL_CLASSES =
  "w-full rounded-[10px] border border-white/[0.09] bg-void-2 px-3.5 text-[13px] text-starlight placeholder:text-starlight-faint transition-[border-color,background-color] duration-150 focus:border-white/[0.2] focus:outline-none disabled:opacity-45";

export type FieldShellProps = {
  label?: string;
  hint?: string;
  error?: string;
  /** Current/max character counter (mono; turns redshift over limit). */
  count?: { current: number; max: number };
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
};

export function FieldShell({ label, hint, error, count, children, className }: FieldShellProps) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  const over = count ? count.current > count.max : false;

  return (
    <div className={clsx("flex flex-col gap-1.5", className, error && "hk-shake")}>
      {(label || count) && (
        <div className="flex items-baseline justify-between gap-2">
          {label && (
            <label htmlFor={id} className="kicker cursor-pointer">
              {label}
            </label>
          )}
          {count && (
            <span
              className={clsx("telemetry text-[11px]", over ? "text-redshift" : "text-starlight-faint")}
              aria-live="polite"
            >
              {count.current}/{count.max}
            </span>
          )}
        </div>
      )}
      {children(id, describedBy)}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-[12px] text-redshift">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12px] text-starlight-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, ...rest },
  ref,
) {
  return (
    <FieldShell label={label} hint={hint} error={error} className={className}>
      {(id, describedBy) => (
        <input
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={clsx(WELL_CLASSES, "h-10", error && "border-[rgba(255,113,143,0.5)]")}
          {...rest}
        />
      )}
    </FieldShell>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  error?: string;
  maxChars?: number;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, maxChars, className, value, ...rest },
  ref,
) {
  const current = typeof value === "string" ? value.length : 0;
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      count={maxChars ? { current, max: maxChars } : undefined}
      className={className}
    >
      {(id, describedBy) => (
        <textarea
          ref={ref}
          id={id}
          value={value}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={clsx(WELL_CLASSES, "min-h-24 resize-y py-2.5 leading-relaxed", error && "border-[rgba(255,113,143,0.5)]")}
          {...rest}
        />
      )}
    </FieldShell>
  );
});
