# Scene / video

`<scene id name width height active>` defines one video. It owns its canvas dimensions, frame rate, work area, timeline, and export context. Only one scene is active in the visual editor at a time.

Switching scenes changes canvas, layers, inspector, timeline, playhead, and CLI context together. A frame is a time sample inside a scene, not another scene.
