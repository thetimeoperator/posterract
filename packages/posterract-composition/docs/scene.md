# Scene / video

`<scene id name width height>` defines one video. It owns its canvas dimensions, work area, timeline, and export context. The frame rate is the project's, not the scene's. Only one scene is active in the visual editor at a time; which one is remembered in `.posterract/view.json`, not in the source.

Switching scenes changes canvas, layers, inspector, timeline, playhead, and CLI context together. A frame is a time sample inside a scene, not another scene.
