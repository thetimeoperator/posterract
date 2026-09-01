# Media analysis

Use the least expensive inspection that answers the question.

1. `media probe` for duration, tracks, codec, dimensions, and FPS.
2. `media waveform` for silence, loudness shape, and edit candidates.
3. `media filmstrip` for a fast whole-track visual overview.
4. `media grab --auto --count 12` for representative visual states with near-duplicates reduced.
5. Explicit `media grab --time ...` for exact moments.
6. `capture` for final composited pixels at scene-relative times.

Decode timestamps in ascending order. Prefer contact sheets of at most 12 frames. Narrow long media with `--start` and `--end`. Use `--separate` only when full individual frames are needed.

Structural `check` cannot detect deliberately dark source footage. A successful export cannot replace visual capture inspection.

`media extract` writes a bounded local MP4 or audio-only OGG. Posterract does not expose fake transcription commands; use the connected agent's own media capabilities on the extracted file.
