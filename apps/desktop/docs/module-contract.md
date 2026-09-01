# Module contract

`src/index.tsx` must default-export a component and use `/** @jsxImportSource @posterract/composition */`.

The desktop stamps missing stable `id` values, compiles the module, evaluates it in an isolated project environment, mounts a complete candidate document, and only then replaces the last valid document. Project code cannot import Electron, Node internals, desktop authentication, or social credentials.

Use normal local modules for reusable components. Imports unavailable in the staged project environment fail with a source-mapped diagnostic. Source, canvas, inspector, layers, timeline, capture, and export all address elements by stable source ID.
