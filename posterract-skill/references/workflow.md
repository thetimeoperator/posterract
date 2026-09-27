# Editing workflow

## Orient

Call `posterract_connection_status`, then `posterract_look`: the scene the user is in, their playhead, their selection, and any `@agent` notes on the timeline. Call `posterract_outline` for the shape of the source, then read only the part you will change with `posterract_read_source` by `id` or `lines`. Keep the `revisionId` it returns.

Read the project instructions, manifest, and relevant local SDK docs. Identify the active scene ID, dimensions, FPS, duration/work area, source media, and deliverable. Ask `posterract_describe` what an element accepts instead of guessing.

## Inspect source media

Use `posterract_media_probe`, `posterract_media_filmstrip`, `posterract_media_waveform`, and `posterract_media_grab`. Inspect the returned MCP images directly.

Inspect the resulting images. Use `media extract` only to create a small local segment for the connected agent's own transcription or listening capabilities.

For speech, `posterract_media_transcribe` returns word-level timestamps for a project asset. It uploads through the signed-in workspace and spends AI credits (1 per started minute), so ask the user before transcribing, and extract an audio-only file first when the media is over 25 MB.

## Edit incrementally

- One `<stage>` owns the project workspace.
- Each top-level `<scene>` is one independently exportable video.
- Use `<sequence>` for timed chapters or clip groups inside a scene.
- Preserve stable IDs.
- Keep each change small enough to diagnose.

Before each write, call `posterract_changes` with the `revisionId` you last saw. If the user changed something since, keep their change.

Edit the TSX with your file tools. Desktop shows the change on the canvas.

After every meaningful change:

1. `posterract_inspect`: facts, then ranked problems with the fix. Fix every `✗`; judge every `⚠`.
2. `posterract_validate`: compiles, and lints props and values.
3. `posterract_capture` at representative times, once `inspect` is clean. Open every capture: `inspect` finds layout bugs, a capture is for judging how it looks.
4. `posterract_show` the element you changed, so the user sees it.

## Finish

Only after explicit instruction:

Call `posterract_export` with an explicit local output path.

Export remains local. Posting and scheduling are separate authenticated Posterract cloud actions.
