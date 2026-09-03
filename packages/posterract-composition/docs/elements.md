# Elements

Core primitives are `<group>`, `<rect>`, `<text>`, `<image>`, `<video>`, `<audio>`, `<captions>`, `<html>`, `<surface>`, and `<adjustmentLayer>`.

Vector figures — `<path>`, `<ellipse>` and `<polygon>` — behave like `<rect>` and add shapes that are not boxes, `trim` draw-on, and path morphing: see [vectors.md](vectors.md). `<lottie>` plays a Lottie animation and exposes its editable slots: see [lottie.md](lottie.md).

Common properties include stable `id`, `name`, position, size, rotation, scale, opacity, visibility, blend mode, timing, layer order, crop/fit, source offsets, playback rate, volume, mute, transitions, animations, and keyframes. Consult the staged TypeScript declarations for the exact properties accepted by the installed SDK.

## `<cue>` — editable caption lines

A `<captions>` may hold `<cue start end>` children. When it does, the cues are
the captions and the element's `src` is ignored.

```tsx
<captions id="subs" preset="spotlight">
  <cue start={0.4} end={1.9}>Count the dots</cue>
  <cue start={2.0} end={4.2}>Three plus three</cue>
</captions>
```

Cues exist so captions are part of the document rather than a file the
composition points at: their wording and timing can be edited, undone,
versioned, and read by an agent, and they survive without the transcript that
produced them. Cues carry no per-word timings; each word's share of the line's
window is proportional to its length, the same approximation an imported
`.srt` gets, so both animate identically.

A captions element that still points at a transcript can be converted once —
*Unpack to editable lines* in the inspector writes what is on screen into the
document as cues.


## Text style

`fontStyle="italic"` and `textDecoration` are element props, and both resolve
per `<textRange>` like every other text style — so one word in a line can be
italic or underlined without the rest being touched.

```tsx
<text id="title" fontStyle="italic" textDecoration="underline lineThrough">
  Struck and underlined
</text>
```

`textDecoration` takes `"none"`, `"underline"`, `"lineThrough"`, or both names
separated by a space. Rules are drawn in whatever the glyphs above them were
painted with, gradients included, and their position comes from the font's own
metrics, so they sit correctly at any size.
