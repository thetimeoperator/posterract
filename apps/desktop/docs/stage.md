# Stage

`<stage>` is the project workspace and parent of top-level scenes. It takes a `background` and its scene children. It is not itself exportable.

Where the author is looking — the selection, the active scene, the camera, which timeline rows are open — is not part of the source. The editor remembers it in `.posterract/view.json` beside the project: read that file to learn what the author is pointing at, and never write `selected`, `active`, `camera`, `expanded` or `clipHeight` into the TSX (the editor lifts them back out).

Keep each independently exportable video in one top-level `<scene>`. Do not construct a scene-connection graph.
