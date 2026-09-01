# Composition SDK

The project entry must default-export a component and use:

```tsx
/** @jsxImportSource @posterract/composition */
```

Canonical hierarchy:

```tsx
<stage id="workspace">
  <scene id="main" name="Main video" width={1080} height={1920} active>
    <sequence id="hook" start={0} end={3}>
      {/* timed visual and audio elements */}
    </sequence>
  </scene>
</stage>
```

Use stable source IDs for every composition element. One scene is one video; do not model video cuts as several connected scenes. Use sequences, groups, media elements, text, shapes, paints, effects, keyframes, and transitions inside the scene.

Read these project-local pages before using detailed properties:

- `.posterract/docs/module-contract.md`
- `.posterract/docs/stage.md`
- `.posterract/docs/scene.md`
- `.posterract/docs/sequences.md`
- `.posterract/docs/elements.md`
- `.posterract/docs/diagrams.md`
- `.posterract/docs/timing.md`
- `.posterract/docs/paints-effects.md`
- `.posterract/docs/keyframes-animations-transitions.md`
- `.posterract/docs/html-surfaces.md`
- `.posterract/docs/inspector-variables.md`
- `.posterract/docs/assets-fonts.md`
- `.posterract/docs/lifecycle-errors.md`

Do not guess APIs from another video framework. Run TypeScript and `posterract validate --json` after source changes.
