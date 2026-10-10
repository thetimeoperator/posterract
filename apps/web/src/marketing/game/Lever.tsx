import { useLayoutEffect, useRef, useState } from "react";

/**
 * The landing's lever, drawn exactly as LeverSwitch draws it: a knob on an arm
 * that swings between two positions in a slot on a dark plate, two signs above
 * it, the one it points at lit. The swing is a CSS transition whose easing
 * samples LeverSwitch's spring, so the throw and its bounce are the same
 * without the animation library.
 */
export type LeverOption<T extends string> = { value: T; label: string };

type LeverProps<T extends string> = {
  options: [LeverOption<T>, LeverOption<T>];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Where the arm starts when this instance mounts; the other option's side makes it throw across on arrival. */
  from?: T;
  /** Called when a hand reaches for the lever, before any throw: time to fetch whatever the other side needs. */
  onIntent?: () => void;
};

const THROW = 34;

export function Lever<T extends string>({ options, value, onChange, label, from, onIntent }: LeverProps<T>) {
  const [left, right] = options;
  const atLeft = value === left.value;
  const target = atLeft ? -THROW : THROW;
  const start = from === undefined ? target : from === left.value ? -THROW : THROW;
  const arm = useRef<HTMLSpanElement>(null);
  const [angle, setAngle] = useState(start);

  useLayoutEffect(() => {
    if (angle === target) return;
    // Lay the arm out on its starting side first, or the transition has nothing to run from.
    arm.current?.getBoundingClientRect();
    const frame = requestAnimationFrame(() => setAngle(target));
    return () => cancelAnimationFrame(frame);
  }, [angle, target]);

  const flip = () => onChange(atLeft ? right.value : left.value);

  return (
    <div className="site-lever" role="tablist" aria-label={label} onPointerEnter={onIntent} onFocus={onIntent} onTouchStart={onIntent}>
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
        <span className="site-lever-arm" ref={arm} aria-hidden="true" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="site-lever-knob" />
        </span>
        <span className="site-lever-pivot" aria-hidden="true" />
      </button>
    </div>
  );
}
