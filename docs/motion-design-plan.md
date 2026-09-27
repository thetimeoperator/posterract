# Motion design plan

Goal: Posterract can make a video like the founder's reference reel
(`~/Downloads/gLl6GZWastLVE2fr.mp4`, "Claude Motion Reel 2026": 15 s,
1920×1080, 60 fps, 8 bars at 128 BPM, "written entirely in code"), and every
moving thing in it shows on the timeline, including anything made with code.

Status: plan only, awaiting the founder's go-ahead. Nothing here is built.

## The rule: code draws, the timeline drives

Anything that changes over time is a row on the timeline. Code may decide how
something looks; it may not move anything on its own. Concretely:

- Canvas code (`<surface>`, `<html>`) declares **knobs**. Each knob is a
  keyframeable timeline row and an inspector control. The code receives knob
  values and never the clock.
- Built-in features (motion blur, grain, beat grid, repeater, text on a path…)
  are elements and props, so they get rows automatically.
- A checker refuses agent edits that add motion without a row, and tells the
  agent how to turn it into a knob.

Limit, stated plainly: the timeline shows the knobs, not the drawing code, the
way an After Effects plugin shows its sliders.

## Baseline (verified 2026-09-25)

Has: `<path>`/`<ellipse>`/`<polygon>` with `trimStart`/`trimEnd`/`trimOffset`
and `morph`/`morphTo` (matching command sequences only, otherwise a swap at
halfway — `packages/posterract-video-runtime/src/utils/vector.ts:430`); vector
masks; easing presets plus `cubicBezier`/`spring`/`steps`; group `stagger`;
`after`; code-expression props with a "From code" row and bake; `<surface>`
(canvas/Three.js/WebGPU via `useTicker`); WGSL `shaderPaint` (uniforms parsed by
name, `media/shader.ts`); `<lottie>`; export at 24–60 fps (capture world built
at the chosen rate, `apps/editor-sandbox/src/context/render.ts:90`); timeline
detail levels clips/animation/everything
(`packages/posterract-video-runtime/src/queries/timeline-index.ts`).

Missing: motion blur (one sample per frame,
`packages/posterract-video-encoder/src/encoder.ts:284`); grain, vignette,
glow (8 CSS-filter effects only, applied via `ctx.filter` in
`systems/render.ts`); tempo/beat grid; shape transitions (5 types:
dissolve, two slides, fade to black/white); arbitrary-shape morph; per-letter
motion (`appearChar`/`appearWord` are typewriter reveals, `utils/text-motion.ts`);
repeater/instancing; text on a path; 3D transforms (renderer is Canvas 2D,
affine only). Timeline blind spots: drawing inside a `<surface>` ref, shader
uniforms (not keyframeable), code-driven text (`livePropNames` skips
`children`, `packages/video-compiler/src/source.ts:452`), script-side
`entity.set`, loop-made elements (one row each), and "From code" rows name
props but draw no curve.

Agent guidance: `posterract-skill/examples/motion-graphics.md` is a 3-line stub.

## Phase 1 — Smooth (≈4–5 days)

### 1.1 Motion blur
- Composition: `motionBlur` on `<scene>` — `true` (180°, 8 samples) or
  `{ shutter: 0–360, samples }`; `motionBlur={false}` on an element opts it
  out (it is sampled at the frame's centre time).
- Export: build the capture world at `fps × samples`, step `samples` world
  frames per output frame across the shutter window, accumulate in float,
  encode the mean (`encoder.ts`, `image-encoder.ts`). Accumulate on the GPU
  with the device `media/shader.ts` already opens; fallback Float32 buffer.
- Preview: blurred frame rendered once when paused or scrubbing; playback is
  single-sample unless the scene's "blur while playing" switch is on.
- Captures (agent screenshots) show the blur, so the agent sees what export
  writes.
- Timeline: a "Motion blur" row on the scene (everything view); `shutter`
  keyframeable through a channel in `motion.ts` `getPropertyPaths`.
- Cost to state in the UI: export time grows roughly with the sample count.
- Tests: identical frame twice → identical pixels; a rect moving N px per
  frame at 180° blurs to N/2 px of smear.

### 1.2 Beat sync
- Composition: `bpm`, `downbeat` (seconds of beat 1), `meter` (default 4) on
  `<scene>`.
- Time units: `"9b"` (beat 9), `"3bar"`, `"3:2"` (bar:beat), parsed in
  `packages/posterract-composition/src/time.ts` as a beat token and resolved
  against the scene's tempo in the reconciler.
- Timeline: bar numbers and beat ticks in
  `apps/editor-sandbox/src/engine/timeline/render/ruler.ts`; beat frames added
  to `getSnapFrames` in `engine/timeline/snapping.ts` (today: scene start,
  playhead, clip edges).
- Detection: onset-strength envelope from the decoded audio (reuse the decode
  in `media/audio-peaks.ts`) → tempo by autocorrelation (70–180 BPM) →
  downbeat by phase fit. `posterract media beats <src>` + MCP
  `posterract_media_beats` beside the waveform handler in
  `apps/editor-sandbox/src/context/agent-api/media.ts`. Inspector "Detect
  beats" on an audio clip writes `bpm`/`downbeat`, with ×2 / ÷2 correction.
- Agent: `get_context` reports the tempo.

### 1.3 Motion rules for the agent (v1)
- New `posterract-skill/references/motion-design.md`: hit the beat; no hard
  cuts (end each scene on the shape the next starts with); anticipation →
  snap → small overshoot → hold; exact easing values per move type; density
  rhythm (simple → complex → simple); limited palette and type; motion blur on.
- Replace the stub `examples/motion-graphics.md`; extend `references/easings.md`.

Proof: reel bar 1 (dot splits 1→2→4→8 into a ring) rebuilt, exported without
and with blur, side by side.

## Phase 2 — Everything on the timeline (≈6–8 days)

### 2.1 Knobs
- Composition: `knobs?: Record<string, number | string>` on `<surface>` and
  `<html>`; `<surface draw={(ctx, { knobs, width, height }) => …}>` — a pure
  draw the runtime calls per frame, with no clock. Tracks target
  `property="knob.<name>"`.
- Runtime: `Knobs` trait (authored + computed values); `motion.ts` resolves
  `knob.*` tracks through a dynamic channel beside `getPropertyPaths`; render
  calls `draw` only when the computed knobs changed.
- Timeline: `knob` row kind in `timeline-index.ts` (animation and everything
  views). Inspector: slider per number knob, colour picker per colour knob.
- Agent: `set_properties` accepts `knob.<name>`; vocabulary regenerated
  (`packages/posterract-composition/scripts/vocabulary.mjs`).

### 2.2 Shader settings as rows
- `media/shader.ts` already parses `@group(1)` uniforms (`UNIFORM_RE`); expose
  each as a knob of its `shaderPaint`, keyframeable as `uniform.<name>`.

### 2.3 "From code" rows draw their curve
- Sample each live prop over the element's span without decoder seeks (the
  `placeInTime` path `inspect` uses, in ≤10 ms bursts) and draw a sparkline on
  the row; click still bakes.

### 2.4 Code-driven text gets a row
- `livePropNames` marks expression `children` of `<text>` as live `text`.

### 2.5 Code-made copies as one row
- Siblings sharing a `Loop` trait group into one expandable row
  "N × <tag> (made by code)".

### 2.6 No-hidden-motion checker
- Static (`packages/video-compiler/src/lint.ts`): `useTicker()`, `time()`,
  `frame()` read inside a surface/html ref or `createEffect`, and script-side
  `entity.set` → `hidden-motion` with the fix ("declare a knob, keyframe it").
- Runtime (`inspect`): render each surface/html at two times with identical
  knobs; pixels differ → `hidden-motion`.
- Enforcement per the founder's decision (recommended: refuse agent edits via
  MCP/CLI, exit 2 through the feedback hook; human code listed, not blocked).
  `posterract inspect --all --problems` lists existing hidden motion.

Proof: a project with canvas code, timeline on "everything": every moving
thing has a row that can be grabbed.

## Phase 3 — Finish and transitions (≈4–5 days)

### 3.1 Effects
- `EffectType` + `grain`, `vignette`, `glow`, `chromaticAberration`,
  `directionalBlur` (with an angle). `ctx.filter` cannot express these, so each
  is a built-in WGSL pass over the element's layer (offscreen → shader →
  composite) on the `shaderPaint` pipeline. Effect rows already exist in the
  everything view; `value` is keyframeable.

### 3.2 Transitions
- `TransitionType` + `iris` (circle from a point), `shapeWipe` (any `<path>`
  as the wipe), `zoomThrough`, `whip` (slide + directional blur), in
  `utils/transition.ts` and `renderTransition` (`systems/render.ts`).

Proof: the reel's scene changes rebuilt, one transition each.

## Phase 4 — New motion tools (≈12–14 days)

### 4.1 Any shape into any shape
- `morphPath`: when command sequences differ, resample both outlines to equal
  point counts by arc length, rotate the start point to minimise travel, then
  blend; the exact blend stays for matching commands.
- Shape keyframes: `<keyframeTrack property="d">` with path values; the
  sampler morphs between neighbours. Shown on the path's row.

### 4.2 Letter and word animation
- `<textAnimator by="letter|word|line" stagger order>` inside `<text>`, holding
  tracks for per-unit `offsetY`, `rotation`, `scale`, `opacity`, `blur`; the
  text renderer draws per glyph from the measured layout when an animator is
  present. One row, knobs as sub-rows.

### 4.3 Repeater
- `<repeater count layout="grid|line|circle|sunflower|sphere|torus|cube|plane"
  layoutTo morph spacing radius stagger ripple …>` with one template child.
- Per copy: position (x, y, z) from the layout (blended toward `layoutTo` by
  `morph`) → 3D camera (`tiltX`, `tiltY`, `zoom`, `cameraZ`, `perspective`) →
  projected and depth-sorted; per-copy delay samples the template's tracks at
  an offset; colour and size by index, depth or ripple.
- Drawing: simple shapes stamped directly; complex templates rendered once
  offscreen and stamped.
- One timeline row; every knob is a sub-row.

### 4.4 Text on a path
- `<text path="…" pathOffset>`: glyphs placed along the flattened path
  (`flattenPath`, arc length) and turned to its tangent; `pathOffset`
  keyframeable for a marquee; the path can morph (line → circle) via 4.1.

Proof: reel bars 3, 4, 5 and 7 rebuilt, every part adjustable on the timeline.

## Phase 5 — Prove it (≈5 days)

- Guide complete: a recipe per tool (TSX that lints clean) — dot split,
  circle wipe, type slam, shape chain, line draw-on, dot fields, text rings,
  logo reveal; a "Motion designer" skill in the Skill Deck
  (`apps/desktop/skills/`).
- Benchmark: a "Motion Reel" project, 8 bars, built by the agent from the
  guide, exported at 60 fps with blur, placed side by side with the original
  (`ffmpeg -filter_complex hstack`), compared at each bar's key frames; kept as
  a regression render for later changes.

## Later (not in this plan unless asked)

- 3D tilt for text, images and groups (`rotationX`, `rotationY`,
  `perspective`): Canvas 2D is affine only, so the layer renders offscreen and
  is drawn through a projective quad on the GPU. The repeater already covers
  the reel's 3D dot scenes. **Built 2026-09-26** (`media/tilt.ts`,
  `utils/tilt.ts`, the inspector's "3D tilt" row).

## Decisions for the founder

1. Motion blur while playing — recommended: on when paused/scrubbing and in
   export, a switch for playback.
2. Hidden motion from the agent — recommended: refuse the edit and give the fix.
3. 3D tilt for text and images — recommended: later.
4. Start with Phase 1.

## How it is built and checked

- Built locally and tested in an isolated instance
  (`POSTERRACT_PROFILE=agenttest`) on scratch projects; the founder's installed
  app and open projects are never touched.
- Each phase ends with a packaged test app (unsigned checkpoint build, separate
  from the signed app) and the proof above, seen in the real editor.
- Every new prop regenerates the vocabulary, so `describe`/`lint`/`set_properties`
  know it; every new feature ships with its timeline row, inspector control,
  agent instructions and a preview-equals-export check.
- No commits, pushes or deploys unless the founder asks.
