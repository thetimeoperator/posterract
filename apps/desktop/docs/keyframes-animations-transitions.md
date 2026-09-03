# Keyframes, animations, and transitions

`<keyframeTrack property="x">` contains `<keyframe time value easing>` children and drives a supported property on its parent. Named easing presets and explicit cubic-bezier, spring, and stepped easing are supported by the installed types.

Keyframeable properties include transform (`x`, `y`, `offsetX`, `offsetY`, `width`, `height`, `rotation`, `scale`, `scaleX`, `scaleY`), appearance (`opacity`, `color`, `blur`, `cornerRadius` and the four per-corner radii), `volume`, a gradient stop's `offset`, an effect's `value`, and `progress` — a diagram element's 0–1 draw-on reveal, which is how `<diagramArrow>` and `<diagramPlot>` get a native line-reveal animation. A track takes precedence over the same property written as a static prop for as long as the element carries the track; outside the keyframe range the track holds its first or last value rather than falling back to the prop.

Preset in/out animations provide common fades, slides, scale, blur, text reveals, and audio gain. Clip transitions belong at cuts and include a type and duration. Always capture before, during, and after a transition.


## Motion written in code

A prop can be an expression rather than a value:

```tsx
<rect id="bar" x={progress() * 200} opacity={progress()} width={120} height={12} />
```

That moves the canvas but has no keyframes, so the timeline has nothing to
show and nothing to grab. The editor marks such an element with a **From code**
row naming those props (`x`, `opacity` above), at the *Animation* and
*Everything* detail levels — so a clip that is animating never looks static.

Clicking a prop on that row **bakes** it: the runtime samples the property over
the element's span, simplifies the result, and writes a `<keyframeTrack>`. A
track wins over the code value, so the motion becomes editable on the timeline
— and the expression is left exactly where it was, so deleting the track gives
it back.

Only props that read something are marked. `x={40 + 20}` is a value written as
arithmetic, not motion.

Agents see the same thing: `posterract_get_context` reports a `live` list on
the element, and `posterract_bake_keyframes` does the baking. Setting a live
prop through a tool is overwritten on the next tick — change the expression, or
bake first.
