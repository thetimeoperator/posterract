# Lottie

`<lottie>` plays a Lottie (Bodymovin) animation as a composition element. It
brings bezier paths, trim-path draw-on, path morphing, mattes, precomps and
gradients without the composition having to describe them itself.

```tsx
<scene id="main" width={1080} height={1920}>
  <lottie id="badge" src="assets/lottie/badge.json" x={340} y={800} width={400} height={400} />
</scene>
```

## Props

| Prop | Meaning |
| --- | --- |
| `src` | Path to a Lottie JSON in the project |
| `width` / `height` | Drawing size; defaults to the animation's own |
| `speed` | Multiplies the animation's clock. `1` is real time |
| `loop` | Repeat for the element's whole span instead of holding the last frame |
| `start` / `end` | When the element plays, like any other clip |

## Slots

A Lottie is opaque from the outside — the composition cannot reach into the
file — except through **slots**: values the animation itself marks as
replaceable, by giving a property a `sid` and listing a default in a top-level
`slots` object. A `<lottieSlot>` child overrides one.

```tsx
<lottie id="badge" src="assets/lottie/badge.json" x={100} y={400} width={600} height={600}>
  <lottieSlot name="brand" value="#ff3355" />
  <lottieSlot name="spin" value={0}>
    <keyframeTrack property="value">
      <keyframe time={0} value={0} />
      <keyframe time="2s" value={90} />
    </keyframeTrack>
  </lottieSlot>
</lottie>
```

`name` is the slot's name inside the file. `value` decides which of Skottie's
setters applies: a number is a scalar, a string that reads as a colour is a
colour, and any other string is text. Scalars and colours are numbers to the
runtime, so a `<keyframeTrack property="value">` animates them like any other
property; text slots are set, not interpolated.

The inspector's Lottie section lists every slot the file declares — including
the ones the source has not overridden yet — so a slot can be adopted with one
click, which writes the `<lottieSlot>` into the source. Slots also appear as
their own timeline rows at the *Everything* detail level.

## Determinism

The animation is **seeked**, never played: on every frame Posterract asks
Skottie for the frame at the element's own local time. That is what makes a
scrub frame-accurate and an export identical to the preview — there is no
wall clock anywhere in the path.

`speed` scales the animation's clock, so a `speed={0.5}` animation runs at half
rate and still lands on exactly the same frame every time it is rendered at a
given moment.

## Loading

Lottie JSON is recognised by its shape — a `v` version string and a `layers`
array — not by its extension, so it is told apart from a transcript that
happens to be `.json` too. A file that fails to load marks the element with a
source error, which `posterract_check` reports; it never takes the composition
down.

Rendering is backed by CanvasKit (Skia compiled to WebAssembly, BSD-3-Clause).
It loads once, lazily, from the app's own assets, so a project that uses no
Lottie pays nothing for it.

## Importing

Drag a `.json` into the assets panel and it is recognised as a Lottie; drop it
on the canvas and it becomes a `<lottie>` at the animation's own size. The
assets panel's **Import animation from URL** takes a link to a Lottie JSON and
downloads it into `assets/lottie/`. The download happens in the desktop app's
main process — the editor itself has no network access at all — and the file is
parsed and shape-checked before it is written, so a link that is not an
animation fails at the import rather than as a broken element on the canvas.
