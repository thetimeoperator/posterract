import { motion, useReducedMotion } from "framer-motion";

/**
 * A lever switch, after the reference: a knob on an arm that swings between
 * two positions in a slot on a dark plate. Above it, two signs: the one the
 * lever points at lights up in neon, the other stays dark. Clicking a sign,
 * the arm or the plate throws the lever to the other side.
 */
export type LeverOption<T extends string> = { value: T; label: string };

type LeverSwitchProps<T extends string> = {
  options: [LeverOption<T>, LeverOption<T>];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Where the arm starts when this instance mounts; the other option's side makes it throw across on arrival. */
  from?: T;
};

const THROW = 34;

export function LeverSwitch<T extends string>({ options, value, onChange, label, from }: LeverSwitchProps<T>) {
  const reduce = useReducedMotion() === true;
  const [left, right] = options;
  const atLeft = value === left.value;
  const flip = () => onChange(atLeft ? right.value : left.value);
  const target = atLeft ? -THROW : THROW;
  const start = from === undefined ? target : from === left.value ? -THROW : THROW;

  return (
    <div className="site-lever" role="tablist" aria-label={label}>
      <div className="site-lever-signs">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            className="site-lever-sign"
            data-lit={option.value === value}
            aria-selected={option.value === value}
            onClick={() => onChange(option.value)}
          >
            <i className="site-lever-led" aria-hidden="true" />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
      <button type="button" className="site-lever-track" onClick={flip} aria-label={`Throw the lever to ${atLeft ? right.label : left.label}`}>
        <span className="site-lever-slot" aria-hidden="true" />
        <motion.span
          className="site-lever-arm"
          aria-hidden="true"
          initial={{ rotate: start }}
          animate={{ rotate: target }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 16, mass: 0.7 }}
        >
          <span className="site-lever-knob" />
        </motion.span>
        <span className="site-lever-pivot" aria-hidden="true" />
      </button>
    </div>
  );
}
