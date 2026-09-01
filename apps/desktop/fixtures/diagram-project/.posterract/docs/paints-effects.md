# Paints, strokes, and effects

Use solid, linear-gradient, radial-gradient, image, video, HTML, shader, or surface paints as children of drawable elements. Gradient color stops are explicit children. Strokes, shadows, masks, adjustment layers, and effects are also represented structurally so the layer tree and agent can inspect them.

WebGPU/WGSL and custom surfaces must remain deterministic at a supplied time. Release GPU resources when the composition is disposed.
