# HTML and surfaces

`<html>` embeds DOM content in a composition-controlled box. `<surface>` hosts Canvas, WebGL, Three.js, or WebGPU rendering.

Both are driven by **knobs**: named numbers the timeline keyframes and the code reads. A `<surface>` is drawn by `draw(context, knobs, info)` whenever a knob or its box changes, never on a clock; an `<html>` gets its knobs as CSS custom properties (`--name`) on its root every frame. Keyframe a knob with `<keyframeTrack property="knob.<name>">`, and it shows on the timeline as a row like any other animated property. See [motion-design.md](motion-design.md#knobs--code-draws-the-timeline-drives).

Drawing through a `ref` with `useTicker`, or any animation library running on its own clock, moves the picture with nothing on the timeline to see or edit, and `lint` reports it as `hidden-motion`. When a library must be used, drive it from a knob: seek it to the knob's value inside `draw`.

Everything must stay deterministic at a supplied state: the same knobs draw the same pixels in the preview, a capture and an export.
