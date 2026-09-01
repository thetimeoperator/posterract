# Stage

`<stage>` is the project workspace and parent of top-level scenes. It may store editor workspace state such as background, camera, active selection, and children. It is not itself exportable.

Keep each independently exportable video in one top-level `<scene>`. Do not construct a scene-connection graph.
