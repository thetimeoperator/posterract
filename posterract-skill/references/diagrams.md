# Diagram workflow

Read `.posterract/docs/diagrams.md` before authoring a diagram. It is authoritative for the installed SDK.

When the user describes what to explain rather than specifying a finished layout:

1. Identify the concepts, relationships, quantities, and order in which the viewer should understand them.
2. Choose a fitting visual grammar: flow, hierarchy, comparison, causal loop, coordinate plot, equation derivation, or annotated callout.
3. Set a consistent palette, node geometry, type scale, safe margins, and connector routing.
4. Author semantic `<diagramNode>`, `<diagramArrow>`, `<diagramEquation>`, `<diagramAxis>`, `<diagramPlot>`, and `<diagramCallout>` elements with stable IDs and names.
5. Use groups for semantic sections and sequences for timed chapters.
6. Validate and run a structural check.
7. Capture the opening, each major reveal, and the final state.
8. Inspect every capture. Fix overlaps, clipping, poor contrast, unreadable labels, edge crossings, and ambiguous arrow direction.

Do not make the user design every coordinate. Use the request's meaning to propose the arrangement, then verify the actual rendered result. Do not claim that a source file looks correct without inspecting captures.
