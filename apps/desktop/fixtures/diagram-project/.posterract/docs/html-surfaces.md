# HTML and surfaces

`<html>` embeds DOM content in a composition-controlled box. Pause external animation libraries and drive them from composition time so scrubbing and capture remain deterministic.

`<surface>` hosts Canvas, WebGL, Three.js, or WebGPU rendering. It receives composition time and dimensions. Do not depend on wall-clock time, network races, or an accumulating render loop during export.
