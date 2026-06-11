import clsx from "clsx";
import { useId } from "react";

export type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
};

/** Orbit switch — the dot orbits from null (left) to lit (right). */
export function Toggle({ checked, onChange, label, description, disabled, className }: ToggleProps) {
  const id = useId();
  return (
    <div className={clsx("flex items-center justify-between gap-4", className)}>
      {(label || description) && (
        <span className="min-w-0">
          {label && (
            <label htmlFor={id} className="block cursor-pointer text-[13px] font-medium text-starlight">
              {label}
            </label>
          )}
          {description && <span className="block text-[12px] text-starlight-faint">{description}</span>}
        </span>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx("hk-switch", disabled && "cursor-not-allowed opacity-45")}
      />
    </div>
  );
}
