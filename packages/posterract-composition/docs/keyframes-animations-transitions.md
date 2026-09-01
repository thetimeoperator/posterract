# Keyframes, animations, and transitions

`<keyframeTrack property="x">` contains `<keyframe time value easing>` children and drives a supported property on its parent. Named easing presets and explicit cubic-bezier, spring, and stepped easing are supported by the installed types.

Keyframeable properties include transform (`x`, `y`, `offsetX`, `offsetY`, `width`, `height`, `rotation`, `scale`, `scaleX`, `scaleY`), appearance (`opacity`, `color`, `blur`, `cornerRadius` and the four per-corner radii), `volume`, a gradient stop's `offset`, an effect's `value`, and `progress` — a diagram element's 0–1 draw-on reveal, which is how `<diagramArrow>` and `<diagramPlot>` get a native line-reveal animation. A track takes precedence over the same property written as a static prop for as long as the element carries the track; outside the keyframe range the track holds its first or last value rather than falling back to the prop.

Preset in/out animations provide common fades, slides, scale, blur, text reveals, and audio gain. Clip transitions belong at cuts and include a type and duration. Always capture before, during, and after a transition.
