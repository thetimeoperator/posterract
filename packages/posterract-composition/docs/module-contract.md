# Module contract

The project entry module — `index.tsx` at the project root (legacy projects may still use `src/index.tsx`) — must default-export a component and use `/** @jsxImportSource @posterract/composition */`.

The desktop stamps missing stable `id` values, compiles the module, evaluates it in an isolated project environment, mounts a complete candidate document, and only then replaces the last valid document. Project code cannot import Electron, Node internals, desktop authentication, or social credentials.

Use normal local modules for reusable components. Imports unavailable in the staged project environment fail with a source-mapped diagnostic. Source, canvas, inspector, layers, timeline, capture, and export all address elements by stable source ID.

## What the editor keeps outside the project

Three things travel with a project without being part of the document. An
agent should know they exist, and should not try to manage them:

- **Version history.** Every write to a source file snapshots the previous
  content into the app's own storage — outside the project folder, so deleting
  or `rm -rf`-ing the folder cannot take the history with it. Reachable from
  the inspector's *Version history* section when nothing is selected.
- **Trash.** A deleted scene's exact source is kept in
  `.posterract/trash/`, restorable from the same panel. Deleting a scene with
  content asks first, and the copy is taken before the removal.
- **The exports library.** Every completed render is indexed with its
  provenance — project, scene, and the source revision it came from. Export is
  local: nothing is uploaded by rendering, only by an explicit schedule or
  post.

Undo is also persisted, keyed to the source revision it was recorded against.
An edit made outside the editor — by an agent writing the file directly —
invalidates that stack rather than replaying onto source that has moved.

## Generated sources in code

`generate.image`, `generate.video` and `generate.voice` return an `AssetRef`
that can be used wherever a `src` is expected. A declaration is a value, not a
call: nothing is generated until a mounted element actually uses it.

```tsx
import { generate } from "@posterract/composition";

const hero = generate.image({ prompt: "a lone figure on a ridge at dawn", aspectRatio: "9:16" });

export default function Film() {
  return (
    <stage id="workspace">
      <scene id="main" width={1080} height={1920} active>
        <image id="opening" src={hero} width={1080} height={1920} />
        <video id="pan" src={generate.video({ prompt: "slow push in", startFrame: hero, duration: 5 })} />
      </scene>
    </stage>
  );
}
```

**It is generated once, ever.** The hash of a declaration's fully-resolved
options is the asset's identity, so reopening the project uses the file that is
already in `assets/generated/` — no provider call, no network, same frames.
Changing the prompt, or the `seed`, is a different declaration and asks for a
new asset; the old one stays where it is.

Options hash order-independently, so writing them in a different order is the
same declaration. A declaration built on another (`startFrame: hero`) resolves
the inner one first and folds its identity into the outer one's, so the whole
chain is reproducible.

Generation runs on the user's own provider keys from the project's
`api-keys.json`, read only by the desktop app's main process. Without a key,
the element carries a source error that `posterract_check` reports — it does
not fail the render.
