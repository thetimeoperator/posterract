# Agent-authored diagrams

Diagram elements are first-class Posterract composition entities. They are selectable on the canvas, appear as timeline layers, expose diagram controls in the inspector, and preserve their stable source IDs when the visual editor writes changes back to TSX.

Use them when the user asks for an explanation, process map, system diagram, mathematical animation, chart, causal model, comparison, or Manim-style visual. The agent chooses the visual hierarchy and coordinates, then verifies the result with `posterract capture`.

## Vocabulary

- `<diagramNode>` — labeled rounded, pill, circular, diamond, or hexagonal concept node.
- `<diagramArrow>` — straight, elbow, or curved connector with optional label and arrowheads.
- `<diagramEquation>` — mathematical statement with a compact LaTeX-like text vocabulary.
- `<diagramAxis>` — coordinate axes, ticks, optional grid, and axis labels.
- `<diagramPlot>` — explicit numeric points mapped through a domain and range.
- `<diagramCallout>` — labeled panel with an optional pointer.

All diagram elements accept normal composition geometry and timing props including `x`, `y`, `width`, `height`, `rotation`, `opacity`, `start`, `end`, `name`, and `id`. They can contain animations and keyframe tracks for the standard animatable properties, plus `progress` — their own 0–1 draw-on reveal:

```tsx
<diagramArrow id="data-to-model" x={400} y={325} width={220} height={0} route="straight">
  <keyframeTrack property="progress">
    <keyframe time={0} value={0} />
    <keyframe time={0.8} value={1} easing="easeOut" />
  </keyframeTrack>
</diagramArrow>
```

## Example

```tsx
<group id="diagram" name="Training loop">
  <diagramNode id="data" name="Training data" x={100} y={260} width={300} height={130}
    label="Training data" subtitle="Examples + labels" fill="#0B2118" />
  <diagramArrow id="data-to-model" name="Data to model" x={400} y={325} width={220} height={0}
    route="straight" label="optimize" />
  <diagramNode id="model" name="Model" x={620} y={260} width={300} height={130}
    label="Model" subtitle="Learns parameters" shape="hexagon" fill="#10291F" />
  <diagramEquation id="loss" name="Loss function" x={380} y={480} width={360} height={100}
    expression="L = \\frac{1}{n} \\sum (y - ŷ)^2" label="Loss function" />
</group>
```

## Diagram planning rules for agents

1. Translate the request into a small hierarchy of concepts, relationships, and timed reveals.
2. Choose the scene's safe area and reserve margins before placing elements.
3. Keep important labels short; use `subtitle` for secondary meaning.
4. Use stable, semantic IDs and names.
5. Prefer a consistent node size, stroke width, type scale, and palette.
6. Avoid crossing connectors. Use `route="elbow"` or `route="curve"` when it improves legibility.
7. Use groups for semantic sections and sequences for timed chapters.
8. Use normal keyframes or animations for entrances. `progress` is a 0–1 draw-on reveal for arrows and plots: keyframe it (`<keyframeTrack property="progress">`) or drive it reactively. Values outside 0–1 are clamped.
9. Run `posterract validate`, `posterract check <scene-id>`, and capture representative timestamps.
10. Inspect the captures and correct overlaps, clipping, weak contrast, illegible labels, and ambiguous arrows before claiming completion.

## Equations

`<diagramEquation>` supports Unicode directly and a compact LaTeX-like conversion for common commands including `\\frac`, `\\sqrt`, superscripts, subscripts, Greek letters, arrows, sums, and integrals. It intentionally remains deterministic and local. For specialized typesetting beyond that vocabulary, use a custom `<html>` or `<surface>` element and verify export parity.

## Plots

Plots consume explicit points so source, capture, and export are deterministic:

```tsx
<diagramAxis id="axes" x={130} y={300} width={800} height={500}
  domain={[0, 10]} range={[-1, 1]} tickCount={5} grid xLabel="time" yLabel="signal" />
<diagramPlot id="signal" x={130} y={300} width={800} height={500}
  points={[[0, 0], [2, 0.8], [4, -0.4], [6, 1], [8, 0.2], [10, 0]]}
  domain={[0, 10]} range={[-1, 1]} smooth markers strokeColor="#71F7C4" />
```

The agent may calculate points in TypeScript before rendering them. Do not put an unevaluated expression string into a plot and expect the runtime to execute it.
