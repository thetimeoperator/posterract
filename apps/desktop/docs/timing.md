# Timing, work areas, and audio synchronization

Time accepts seconds, frame strings such as `45f`, or clock strings such as `00:01.5`. `start` and `end` live on the parent timeline. Media source trims use source-in/source-out properties; playback rate maps source time to composition time.

The scene work area defines preview, capture-relative zero, and export range. Canvas, timeline, audio, capture, and export use the same playhead. Seek-safe code derives state from current time instead of accumulating frame-to-frame mutations.
