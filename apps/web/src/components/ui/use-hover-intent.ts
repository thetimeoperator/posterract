import { useEffect, useRef, useState, type FocusEvent } from "react";

/**
 * Hover with intent: the hovered flag turns on only once the pointer has
 * rested on the element, so passing over it on the way to another does
 * nothing; it turns off at once on leave. Keyboard focus counts, but only
 * real keyboard focus, so a click doesn't leave the element stuck on.
 */
export function useHoverIntent(delay = 70) {
  const [hovered, setHovered] = useState(false);
  const timer = useRef(0);
  const enter = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHovered(true), delay);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    setHovered(false);
  };
  const focus = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.matches(":focus-visible")) setHovered(true);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { hovered, handlers: { onMouseEnter: enter, onMouseLeave: leave, onFocus: focus, onBlur: leave } };
}
