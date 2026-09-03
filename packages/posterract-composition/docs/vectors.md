# Vectors

`<path>`, `<ellipse>` and `<polygon>` are free vector figures. They fill,
stroke, shadow, mask, transform and animate exactly like `<rect>` — what they
add is a shape that is not a box, and `trim`, which is what makes a line draw
itself.

```tsx
<scene id="main" width={1080} height={1920}>
  <path id="swoosh" x={80} y={200} d="M0 0 C200 0 200 300 400 300 C600 300 600 0 800 0" trimEnd={0}>
    <stroke color="#5DFF9D" width={18} cap="round" />
    <keyframeTrack property="trimEnd">
      <keyframe time={0} value={0} />
      <keyframe time="2s" value={1} />
    </keyframeTrack>
  </path>

  <ellipse id="dot" x={120} y={700} width={260} height={260} fill="#FF3355" />
  <polygon id="tri" x={120} y={1100} points="0,240 140,0 280,240" fill="#2266ff" />
</scene>
```

## The figure

| Element | What states the shape |
| --- | --- |
| `<path d="…">` | SVG path data: `M L H V C S Q T A Z`, absolute or relative |
| `<ellipse>` | The element's `width` and `height` — a circle is a square box |
| `<polygon points="x,y x,y …">` | Its own coordinates |

A `<path>` or `<polygon>` without `width`/`height` takes the box its geometry
occupies, the way an SVG bounding box does — so selection, masks and `clip`
behave without the size having to be restated. Give it a `width`/`height` on
purpose and it keeps them.

Strokes are `<stroke>` children, as on any shape; a `<path>` with no fill and
no stroke draws nothing. `fill` is the intrinsic solid fill.

## Trim — the draw-on

`trimStart` and `trimEnd` are 0–1 of the whole figure; `trimOffset` rotates
that window around it. All three are keyframeable (`trimStart`, `trimEnd`,
`trimOffset`).

A track over `trimEnd` from 0 to 1 is a line drawing itself. A short window
with `trimOffset` animated is a highlight chasing around a closed shape — the
window wraps past the end rather than stopping at the seam.

Trim treats every subpath as one continuous figure, so a `d` with several `M`
commands draws on in order rather than all at once.

## Morph

`morphTo` is a second figure; `morph` is how far toward it, 0–1 and
keyframeable.

```tsx
<path id="badge" d="M0 0 L240 0 L240 240 L0 240 Z" morphTo="M120 0 L240 120 L120 240 L0 120 Z" morph={0}>
  <keyframeTrack property="morph">
    <keyframe time={0} value={0} />
    <keyframe time="1s" value={1} />
  </keyframeTrack>
</path>
```

Only figures whose **command sequences match** can blend — same commands, same
order, same count. Any other correspondence would be a guess, and a guessed one
folds the shape through itself. When they do not match the target replaces the
source at the halfway point, which is honest and never looks broken.

## Masks

A vector takes `mask` like a rect does, and clips its parent by its own shape:

```tsx
<rect id="card" x={80} y={840} width={600} height={600} fill="#F4FFF8">
  <polygon id="cut" mask points="300,0 600,600 0,600" />
</rect>
```

## Determinism

Curves are laid down as true curves when nothing is trimmed, and from a fixed
flattening when something is — the same flattening in the preview and in an
export, never one that depends on the current zoom. So a scrub, a capture and
an encode are the same pixels.
