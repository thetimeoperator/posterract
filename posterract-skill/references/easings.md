# Easings

Use easing intentionally and verify the installed SDK syntax in `.posterract/docs`.

- UI-like moves: short ease-out on entry, gentle ease-in on exit.
- Camera reframes: smooth in-out curves without abrupt velocity changes.
- Pops and emphasis: restrained overshoot; avoid repeated elastic motion.
- Linear: progress indicators, continuous rotations, or physically constant movement.
- Cuts: no easing; change state exactly at the cut frame.

Keep animation seek-safe. The same time sample must produce the same frame during playback, capture, and export. Do not rely on wall-clock timers or animation libraries that continue running independently of the composition clock.
