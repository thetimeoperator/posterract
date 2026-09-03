# Authoring Lottie

Read `.posterract/docs/lottie.md` first: it is authoritative for the installed
SDK and describes the `<lottie>` element itself. This file is about writing the
animation JSON.

## When to reach for it

`<lottie>` is the composition's vector escape hatch. Prefer native elements —
`<rect>`, `<text>`, `<diagramNode>` — for anything they already do: they are
inspectable, keyframeable per property, and an agent can edit one attribute
without rewriting a file. Reach for Lottie when the shot needs what the
composition has no element for:

- bezier paths and path morphing
- trim-path draw-on (a line that draws itself)
- track mattes and precomps
- a logo or badge animation supplied as a `.json`

A Lottie is opaque from the outside. The composition can place it, time it,
transform it, and set its **slots** — nothing else. If the user will want to
edit the wording or a colour later, expose it as a slot, or build it natively.

Posterract has native vectors too: `<path>`, `<ellipse>` and `<polygon>`, with
`trim` draw-on and path morphing (`.posterract/docs/vectors.md`). Prefer them
for a single stroke, a shape, or a draw-on — every property is inspectable and
keyframeable, and you can edit one without rewriting a file. Reach for Lottie
when the shot needs mattes, precomps, or an animation someone else made.

## The authoring loop

1. Write the JSON into `assets/lottie/<name>.json` with `posterract_write_source`
   or the file tools.
2. Insert the element with `posterract_create_element`:
   `{"tag": "lottie", "props": {"id": "badge", "src": "lottie/badge.json", "x": 340, "y": 800, "width": 400, "height": 400}}`
   — `src` is relative to `assets/`, like every other asset path.
3. `posterract_validate`, then `posterract_check`. A file that is not a Lottie,
   or one Skottie cannot read, shows up as a source error on the element rather
   than as a blank frame.
4. `posterract_capture` at **three or more times across the animation's span**
   and look at the images. A Lottie that renders is not a Lottie that animates;
   one still frame proves nothing.

## The file

Skottie reads the Bodymovin schema. This is the smallest file that works —
a 400×400 composition, 2 seconds at 30 fps, one shape layer:

```json
{
  "v": "5.12.1", "fr": 30, "ip": 0, "op": 60, "w": 400, "h": 400, "nm": "badge",
  "ddd": 0, "assets": [],
  "layers": [{
    "ddd": 0, "ind": 1, "ty": 4, "nm": "square", "sr": 1,
    "ip": 0, "op": 60, "st": 0, "bm": 0, "ao": 0,
    "ks": {
      "o": {"a": 0, "k": 100},
      "r": {"a": 0, "k": 0},
      "p": {"a": 0, "k": [200, 200, 0]},
      "a": {"a": 0, "k": [0, 0, 0]},
      "s": {"a": 0, "k": [100, 100, 100]}
    },
    "shapes": [{"ty": "gr", "nm": "g", "it": [
      {"ty": "rc", "d": 1, "s": {"a": 0, "k": [180, 180]}, "p": {"a": 0, "k": [0, 0]}, "r": {"a": 0, "k": 0}},
      {"ty": "fl", "c": {"a": 0, "k": [0.45, 1, 0.6, 1]}, "o": {"a": 0, "k": 100}},
      {"ty": "tr", "p": {"a": 0, "k": [0, 0]}, "a": {"a": 0, "k": [0, 0]}, "s": {"a": 0, "k": [100, 100]}, "r": {"a": 0, "k": 0}, "o": {"a": 0, "k": 100}}
    ]}]
  }]
}
```

**Spec map.** `fr` frame rate · `ip`/`op` in and out point, in frames · `w`/`h`
composition size · `nm` name. A layer's `ty` is 4 for a shape layer, 5 text,
2 image, 0 precomp; `ind` is its index and `parent` names another layer's `ind`.
`ks` is the transform: `o` opacity 0–100, `r` rotation in degrees, `p` position,
`a` anchor point, `s` scale in percent. Inside `shapes`, `gr` is a group whose
`it` list holds the drawing items and ends with its own `tr` transform: `rc`
rectangle, `el` ellipse, `sr` polystar, `sh` free path, `fl` fill, `st` stroke,
`tm` trim path. Colours are `[r, g, b, a]` **0–1**, not 0–255.

## Keyframes

Every animatable property is `{"a": 0, "k": <value>}` when static and
`{"a": 1, "k": [<keyframes>]}` when animated. A keyframe is `t` (frame), `s`
(value, always an array), and the easing handles `i`/`o`. The last keyframe
carries only `t` and `s`.

```json
"o": {"a": 1, "k": [
  {"i": {"x": [0.833], "y": [0.833]}, "o": {"x": [0.167], "y": [0.167]}, "t": 0, "s": [0]},
  {"t": 60, "s": [100]}
]}
```

Multi-dimensional properties take the same shape with longer `s` arrays, and
position also takes `to`/`ti` spatial tangents:

```json
"p": {"a": 1, "k": [
  {"i": {"x": 0.833, "y": 0.833}, "o": {"x": 0.167, "y": 0.167},
   "t": 0, "s": [90, 200, 0], "to": [0, 0, 0], "ti": [0, 0, 0]},
  {"t": 60, "s": [310, 200, 0]}
]}
```

Omitting `i`/`o` gives a hold. Getting the handles wrong is the most common way
a hand-written file loads, renders, and then does not move — which is why the
loop above insists on captures at several times.

### Draw-on

A trim path is what draws a stroke onto the screen. Add `tm` to the group and
keyframe `e` (end) from 0 to 100:

```json
{"ty": "tm", "s": {"a": 0, "k": 0}, "o": {"a": 0, "k": 0}, "m": 1,
 "e": {"a": 1, "k": [
   {"i": {"x": [0.6]}, "o": {"x": [0.4]}, "t": 0, "s": [0]},
   {"t": 45, "s": [100]}
 ]}}
```

## Slots — the part that makes it editable

A slot is a property the file marks as replaceable. Give the property a `sid`
and list a default in a top-level `slots` object:

```json
"slots": {
  "brand": {"p": {"a": 0, "k": [0.45, 1, 0.6, 1]}},
  "spin":  {"p": {"a": 0, "k": 0}}
}
```

```json
{"ty": "fl", "c": {"a": 0, "k": [0.45, 1, 0.6, 1], "sid": "brand"}, "o": {"a": 0, "k": 100}}
```

The composition then overrides it, and a numeric slot is keyframeable like any
other property:

```tsx
<lottie id="badge" src="lottie/badge.json" x={100} y={400} width={600} height={600}>
  <lottieSlot name="brand" value="#ff3355" />
  <lottieSlot name="spin" value={0}>
    <keyframeTrack property="value">
      <keyframe time={0} value={0} />
      <keyframe time="2s" value={90} />
    </keyframeTrack>
  </lottieSlot>
</lottie>
```

Slot every colour and every string the user might want to change. It is the
difference between an animation they can restyle and one they have to ask you
to rewrite. Name slots for what they mean (`brand`, `headline`), not for the
layer they happen to sit on.

## Timing

The element's own `start`/`end` say when it is on screen; the animation's `op`
says how long it runs. They are independent. `speed` multiplies the animation's
clock, and `loop` repeats it for the element's whole span instead of holding
the last frame. Posterract always **seeks** the animation to composition time —
it never plays it — so preview, scrub, and export are the same frames.
