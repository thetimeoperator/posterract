# Motion design

How to make motion that reads as smooth and deliberate, and the Posterract
elements for it. The element reference is the project's
`.posterract/docs/motion-design.md`; this page is the taste and the recipes.

## The rules

1. **Time it to the music.** Set the scene's `bpm` (measure the track with
   `posterract media beats`, then trim it with `sourceIn` so its first
   downbeat is at 0). One idea per bar; every change lands on a beat. Write
   times in beats: `start="4b"`, `time="0.5b"`.
2. **No hard cuts.** End each idea on the shape the next one starts from: a
   ring of dots becomes a red circle that fills the frame and is the next
   background; a flower comes apart into seeds; rings collapse into the dot
   that becomes the logo's full stop. One object carries the eye through the
   whole piece.
3. **Pull back, snap, overshoot, hold.** Before a move, a small anticipation
   (shrink to 0.7 for a tenth of a beat); the move itself on a spring
   (`easing="snappy"` or `"bouncy"`); then hold still long enough to read.
   Nothing moves linearly except continuous spins and scrolls.
4. **Motion blur on.** `motionBlur` on the scene: fast moves read as one
   motion instead of a string of jumps. Keep HUDs and counters sharp with
   `motionBlur={false}`.
5. **Restraint and texture.** Five colours, two or three typefaces, film
   `grain` and a light `vignette` on the scene.
6. **Rhythm of density.** Simple → complex → simple: one dot, then hundreds,
   then one line, then rings, then a wordmark.
7. **Everything on the timeline.** Never animate with `useTicker`, a surface
   `ref`, or code that sets traits — agents' edits that do are refused. A
   number that moves is a prop or a knob, keyframed.

## Easing values

| Move | Easing |
| --- | --- |
| Entrance, pop, split | `snappy` (overshoots a little) |
| Landing, logo, bounce | `bouncy` |
| Camera push, rush into the next scene | `cubicBezier(0.7,0,0.84,0)` (accelerates) |
| Reveal, draw-on | `easeOut` |
| Morph, tilt, iris | `easeInOut` or `cubicBezier(0.65,0,0.35,1)` |
| Spin, scroll, counters | linear |
| Beat-locked switch (colour per bar) | `steps(1)` |

## Recipes

Each is a pattern from a finished reel; swap the numbers.

**A dot splits into a ring on the beat.** Eight ellipses (a `<For>`), each with
`x`/`y` tracks that hold, then `snappy` to the next formation at beats 1, 2 and 3
(2, 4, then 8 positions), and a `scale` track that dips to 0.7 just before each
split.

**Iris into the next scene.** A 40 px ellipse at the centre in the next
scene's colour, `scale` 0 → 64 over 0.65 beats ending on the bar line,
`cubicBezier(0.7,0,0.84,0)`. The next bar starts with a full-frame rect of that
colour.

**Type that slams in.** `<text>` + `<textAnimator by="letter" stagger={0.035}>`
with `offsetY` 150 → 0 (`snappy`), `rotation` −14 → 0 and `opacity` 0 → 1 over
0.2 beats. For a word that swings in: `offsetX` 360 → 0, `rotation` 28 → 0
(`bouncy`), `blur` 22 → 0. Brackets are `<path>`s with `trimEnd` 0 → 1.

**Rush through the words.** Put the type in a `<group>` holding a frame-sized
empty `<rect>` (it puts the pivot at the frame's centre), `scale` 1 → 1.06
slowly, then → 9 in the last 0.8 beats with the accelerating curve.

**One shape, four shapes.** A `<path>` with a `d` track: circle → square →
triangle → flower, each change 0.3 beats on `snappy`, a `color` track changing
with it and a `rotation` track turning 90° per change. A group with the
selection box and its handles, turning with the same `rotation` track.

**Seeds, a field, a floor.** `<repeater layout="sunflower" layoutTo="grid">`
with `morph` 0 → 1 and `spacing` growing together; then `ripple` with
`rippleMode="scale"`, `ripplePhase` travelling, `colorTo` on the wave; then
`tiltX` 0 → 62 with `perspective={1100}`.

**A cloud of points.** Repeaters chained at matching frames: grid → sphere,
sphere → torus, torus → cube (same `count`, `radius`, camera at the handoff),
`tiltY` spinning, `depthFade` 0.55, and `cameraZ` rushing past the copies to
fly through.

**A line ties a knot.** One `<path>` with stacked `<stroke>`s (74/54/34/14 px,
round caps) — `trimEnd` 0 → 1 over 2.4 beats, `trimStart` following 1.2 beats
behind — and short tick `<path>`s drawing on at the crossing.

**Marquee rows bend into rings.** `<text path={line}>` with a `path` track from
the straight line to a circle, `pathOffset` scrolling the whole time
(alternating direction row to row); then the group spins and scales to 0 on the
accelerating curve into a centre dot.

**The dot becomes the full stop.** A cream iris grows around the dot; the
wordmark's letters rise (`textAnimator`); the dot arcs up and lands after the
last letter with `scaleX` 1.4 / `scaleY` 0.65 on landing (`bouncy`) and settles.

**Swing a card in.** A `<group>` holding the card and its label, with a
`rotationY` track 90 → 0 over a beat (`easeOut`) and `perspective` about 1600:
it opens like a door about its middle. A floor of tiles is a group at
`rotationX={60}`; a headline that leans back is `rotationX={-20}` with a few
degrees of `rotationY`.

**HUD and counters.** Text with `motionBlur={false}` and a `color` track with
`steps(1)` keyframes per bar (light on dark bars, dark on light). A frame
counter or beat light is a `<surface draw knobs>` whose knob is keyframed —
linear for a counter, `steps(1)` and `loop` for a beat light.

## Gotchas

- Elements without an `end` last 480 frames — 16 s at 30 fps but 8 s at 60 fps.
  Give anything that should last the whole piece an `end`.
- A `<group>` turns and scales about the middle of its children's box measured
  from the group's own origin; add a frame-sized empty `<rect>` to pivot on
  the frame's centre.
- A `<text>` centred with `textAlign="center"` needs both `width` and `height`.
- Clips in a `<sequence>` need their own `start`/`end` (or `after`) for
  transitions to have a cut to sit on.
- Check every bar with `posterract capture` at its key beats, and look at the
  images: blur, grain and 3D only show in a rendered frame.
