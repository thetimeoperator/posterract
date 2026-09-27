# Motion design

What makes motion read as smooth, and the elements built for it. Everything
here is an element or a prop, so everything that moves is a row on the
timeline — nothing runs on a clock of its own.

## Motion blur

```tsx
<scene id="main" width={1920} height={1080} motionBlur>            {/* 180°, 8 samples */}
<scene id="main" width={1920} height={1080} motionBlur={270}>       {/* shutter angle */}
<scene id="main" width={1920} height={1080} motionBlur={{ shutter: 180, samples: 12 }}>
```

Each frame is the average of `samples` moments spread across the shutter,
centred on the frame. Anything that moves during the shutter smears along its
path; anything still stays exactly as it was. Transforms, keyframes, presets,
knobs, shapes and Lottie are resampled; a video's own frame is not (it carries
its camera's blur already).

`motionBlur={false}` on any element keeps it — and everything under it — sharp
while the scene blurs: a HUD, a counter, a logo.

The editor shows the blur while paused and scrubbing (and while playing, when
the viewer turns that on). Exports and captures always blur, and take about
`samples` times as long.

## Tempo and musical time

```tsx
<scene id="main" width={1080} height={1920} bpm={128} meter={4}>
  <rect id="hit" start="4b" end="2bar" />
  <text id="title">…<keyframeTrack property="scale"><keyframe time="0b" value={0.8} /><keyframe time="1b" value={1} /></keyframeTrack></text>
</scene>
```

With a `bpm`, the ruler shows bars and beats, clips and keyframes snap to
beats, and every `Time` prop takes musical units: `"4b"` is four beats, `"2bar"`
two bars (`meter` beats each), fractions allowed (`"0.5b"`). Musical time is a
length: `start="4b"` is four beats into the parent's timeline, a keyframe at
`time="1b"` one beat into its clip.

Measure the music with `posterract media beats <file>` (MCP
`posterract_media_beats`): it reports `bpm` and `downbeat`, the seconds into
the file where beat 1 of a bar falls. Trim the song by that much
(`sourceIn={downbeat}`) and the song's bars are the timeline's bars.

## Knobs — code draws, the timeline drives

```tsx
<surface id="bars" width={560} height={280} knobs={{ phase: 0, count: 12 }}
  draw={(ctx, knobs, { width, height }) => {
    const count = Number(knobs.count);
    for (let i = 0; i < count; i++) {
      const h = (Math.sin(Number(knobs.phase) + i * 0.6) * 0.5 + 0.5) * height;
      ctx.fillRect(i * (width / count), height - h, width / count - 6, h);
    }
  }}>
  <keyframeTrack property="knob.phase">
    <keyframe time={0} value={0} />
    <keyframe time={2} value={6.28} />
  </keyframeTrack>
</surface>
```

A `<surface>` is drawn by its `draw` from its `knobs`. The renderer calls
`draw` whenever a knob or the box changes, with a cleared context (`context`
picks "2d", "webgl" or "webgl2"), and never with the time. Each knob is a
timeline row and an inspector slider; keyframe it with
`<keyframeTrack property="knob.<name>">`. Continuous motion is a knob with a
linear track (or a `loop`).

`<html knobs={{ tilt: 0 }}>` sets each knob as a CSS custom property on its
root (`--tilt`) every frame, so the DOM can move with
`transform: rotate(calc(var(--tilt) * 1deg))`.

A `<shaderPaint>`'s numeric `uniforms` are knobs too: keyframe one with
`<keyframeTrack property="uniform.<name>">`.

Drawing through a surface's `ref`, reading `useTicker()`, or setting runtime
traits from code moves the picture with nothing on the timeline to show for it.
`lint` reports each as `hidden-motion`, and agents' edits that add it are
refused.

## Finishing effects

`<effect>` takes five effects that work on the rendered layer. One on the
`<scene>` finishes everything in it.

| `type` | `value` | `size` | `angle` |
| --- | --- | --- | --- |
| `grain` | strength 0–1 | grain px (1.5) | — |
| `vignette` | strength 0–1 | reach 0–1 (0.5) | — |
| `glow` | strength 0–2 | radius px (24) | — |
| `chromaticAberration` | offset px | — | — |
| `directionalBlur` | length px | — | degrees (0 = across) |

`value`, `size` and `angle` are keyframeable. Grain is seeded by the frame:
the same frame always has the same grain.

## Transitions

Set on the outgoing clip of a `<sequence>` (clips need their own `start`/`end`
or `after`): `iris` (a circle opening from the middle), `shapeWipe` (the same
through `shape`, path data in a 100×100 box), `wipeLeft|Right|Up|Down`,
`zoomThrough`, `whipLeft|Right|Up|Down` (a whip pan, smeared along the move),
plus `dissolve`, `slideFromLeft|Right`, `fadeToBlack|White`.

```tsx
<rect id="a" start={0} end={1} transition={{ type: "whipLeft", duration: 0.6 }} />
<rect id="b" start={1} end={2} transition={{ type: "shapeWipe", duration: 0.8, shape: "M50 0 L61 35 L98 35 L68 57 L79 91 L50 70 L21 91 L32 57 L2 35 L39 35 Z" }} />
```

## Shape keyframes

A `d` track on a `<path>` holds shapes: each keyframe's `value` is path data,
and the figure blends from one to the next — any shape into any shape. Shapes
with matching commands blend command for command; any other pair blends
through matched outlines, so a circle becomes a square becomes a triangle
without folding.

```tsx
<path id="shape" width={360} height={360} d={CIRCLE} fill="#e8453c">
  <keyframeTrack property="d">
    <keyframe time="0b" value={CIRCLE} easing="snappy" />
    <keyframe time="1b" value={SQUARE} />
  </keyframeTrack>
</path>
```

## Letters, words and lines that move on their own

```tsx
<text id="title" fontSize={190} fontWeight={900}>
  EVERY FRAME
  <textAnimator by="letter" stagger={0.035} order="forward">
    <keyframeTrack property="offsetY"><keyframe time="0b" value={150} easing="snappy" /><keyframe time="0.7b" value={0} /></keyframeTrack>
    <keyframeTrack property="opacity"><keyframe time="0b" value={0} /><keyframe time="0.2b" value={1} /></keyframeTrack>
  </textAnimator>
</text>
```

Each unit (`by`: "letter", "word", "line") plays the animator's tracks —
`offsetX`, `offsetY`, `rotation`, `scale`, `scaleX`, `scaleY`, `opacity`,
`blur` — from its own start, `stagger` after the one before, in `order`
("forward", "reverse", "center", "edges", "random").

## Text on a path

```tsx
<text id="ring" fontSize={46} fontWeight={800} path={CIRCLE_PATH} pathOffset={0} pathShift={0} pathAlign="start">
  MOTION DESIGN • ANIMATION • ART DIRECTION •
  <keyframeTrack property="pathOffset"><keyframe time={0} value={0} /><keyframe time={4} value={0.3} /></keyframeTrack>
</text>
```

Glyphs sit on the curve, turned to follow it. `pathOffset` (a fraction of the
length, wrapping on a closed path) slides the text along it; `pathShift` moves
it off the path. A `path` track holds shapes, so a straight line of text can
bend into a ring. Path coordinates are the element's own.

## Repeater

```tsx
<repeater id="field" x={960} y={540} count={432} layout="sunflower" layoutTo="grid" columns={24} spacing={11}
  rippleMode="scale" rippleFrequency={1.3} perspective={1100} colorTo="#e8453c" colorBy="wave">
  <ellipse id="dot" width={13} height={13} fill="#111214" />
  <keyframeTrack property="morph"><keyframe time="0.5b" value={0} easing="easeInOut" /><keyframe time="1.4b" value={1} /></keyframeTrack>
  <keyframeTrack property="tiltX"><keyframe time="2.8b" value={0} easing="easeInOut" /><keyframe time="4b" value={62} /></keyframeTrack>
</repeater>
```

One template drawn `count` times, centred on each copy's point. Layouts:
`line`, `grid`, `plane` (a grid lying flat), `circle`, `sunflower`, `spiral`,
`sphere`, `torus`, `cube` (dots along its edges), `random`. `layoutTo` and
`morph` blend copy for copy into a second layout. `ripple` sends a wave through
them (`rippleMode` "z" moves depth, "scale" sizes them; keyframe `ripplePhase`
to make it travel). The camera — `tiltX` (positive tips the top away, so a grid
at 60 is a floor), `tiltY`, `roll`, `zoom`, `perspective` (0 is flat), `cameraZ`
(past the copies it flies through) — views them in 3D, and `depthFade` fades
the far ones. `stagger` plays the template's own animation one copy after
another in `staggerOrder`. `colorTo` tints the fill by `colorBy` ("wave",
"index", "depth"). Every number is keyframeable by name.

To morph through more than two layouts, cut between repeaters at a frame
where they agree (same count, same layout, same camera).

## 3D tilt

```tsx
<group id="card" x={140} y={120} perspective={1600}>
  <rect id="face" width={400} height={260} fill="#e8453c" cornerRadius={28} />
  <text id="label" x={40} y={80} fontSize={84} fontWeight={900} color="#ffffff">SWING</text>
  <keyframeTrack property="rotationY">
    <keyframe time="0b" value={90} easing="easeOut" />
    <keyframe time="1b" value={0} />
  </keyframeTrack>
</group>
```

Any element turns in 3D about its middle: `rotationX` tips the top away (a
floor is about 60), `rotationY` turns the right side away (90 is edge-on).
`perspective` is how far the camera stands, in px (default 2000): nearer is a
stronger 3D look, 0 none. The element is drawn flat and turned as one
picture, so a tilted group turns as one card with everything in it, effects
included. The turn happens in the element's own frame: a card rotated in 2D
tips about its own edge. All three are keyframeable, and with motion blur a
turn smears like any other move. A `<repeater>`'s copies have depth of their
own — turn them with its camera (`tiltX`, `tiltY`) instead.
