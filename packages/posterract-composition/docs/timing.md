# Timing, work areas, and audio synchronization

Time accepts seconds, frame strings such as `45f`, or clock strings such as `00:01.5`. `start` and `end` live on the parent timeline. Media source trims use source-in/source-out properties; playback rate maps source time to composition time.

The scene work area defines preview, capture-relative zero, and export range. Canvas, timeline, audio, capture, and export use the same playhead. Seek-safe code derives state from current time instead of accumulating frame-to-frame mutations.

## Work area — the range an export renders

`<scene workarea={[start, end]}>` marks the part of a scene that plays and
exports; times are seconds. Removing the prop (or writing `false`) clears it,
and the scene runs to the end of its longest child.

The editor writes this prop from `I` and `O` — marking in and out points *is*
choosing the export range, not a separate concept beside it. `Home` and `End`
jump to the range's edges when one is set. `⌥X` clears it.

```tsx
{/* Only 2s–7.5s renders, whatever else the scene holds */}
<scene id="main" workarea={[2, 7.5]}>…</scene>
```

## `locked` — protecting a layer

`locked` marks an element the editor must not move, trim or delete. It still
renders and still exports; only interaction is refused. Because it is a prop,
the protection is part of the document and an agent reading the source can see
it.

```tsx
<rect id="backplate" locked width={1080} height={1920} fill="#071126" />
```

Respect it: a tool that edits a locked element is working against a decision
the user recorded in the file.

## `<marker>` — notes on the edit

A marker is a named point on a scene's timeline. It renders nothing and
changes nothing about the output; it exists so a beat, a cut, or a place to
come back to is written down in the source rather than remembered.

```tsx
<scene id="main">
  <marker time={2.5} name="Hook lands" />
  <marker time="00:12" name="CTA" color="#73E8C0" />
  …
</scene>
```

`time` takes any `Time` format and is scene-local. `M` in the editor adds one
at the playhead, or removes the one already there. Markers show on the ruler.
