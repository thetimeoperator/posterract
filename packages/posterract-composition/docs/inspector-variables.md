# Inspector variables

Annotate one top-level literal `const` to expose it in the Variables inspector:

```tsx
/** @inspect number path="Typography/Title size" min=24 max=180 step=1 */
const titleSize = 84;

/** @inspect select path="Layout/Format" options="portrait,square,landscape" */
const format = "portrait";
```

Supported controls are `text`, `number`, `boolean`, `color`, `font`, and `select`. The inspector writes the literal initializer back to TSX. Removing the annotation or replacing the initializer with a computed expression makes it intentionally non-writable.
