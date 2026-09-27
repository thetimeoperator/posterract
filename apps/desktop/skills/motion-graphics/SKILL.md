---
name: motion-graphics
description: Type and shapes doing the talking: kinetic titles, shape morphs, dot fields, 3D point clouds, text rings, logo stings — timed to the music, blurred like a camera, every moving number on the timeline. Use when a scene should be built as this kind of video; follow the workflow below with the Posterract MCP tools.
---

# Motion Graphics

Type and shapes doing the talking. No footage required.

## Workflow

1. Read the scene with posterract_look and posterract_outline; read `references/motion-design.md` in the posterract skill and the project's `.posterract/docs/motion-design.md`.
2. If there is music, measure it with posterract_media_beats: set the scene's `bpm`, trim the song by its `downbeat`. Without music, still pick a tempo — 120 to 130 BPM — and time everything in beats.
3. Plan one idea per bar in a short brief, each bar ending on the shape the next begins with.
4. Turn on `motionBlur` on the scene, and `grain` and a light `vignette` as scene effects.
5. Build with the elements made for it: `<textAnimator>` for type, `d` shape keyframes for morphs, `<repeater>` for dots and 3D clouds, `rotationX`/`rotationY` to tilt a card, title or group in 3D, text `path` for rings, transitions (`iris`, `whip*`, `zoomThrough`) at cuts, `<surface draw knobs>` for anything drawn by code — never `useTicker`.
6. Ease every move (anticipation, `snappy`/`bouncy`, then hold); only spins and scrolls are linear.
7. posterract_inspect, posterract_validate, then posterract_capture at the key beats of every bar and look at each image before calling it done.
