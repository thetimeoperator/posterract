# Editing workflow

## Orient

Call `posterract_connection_status`, then `posterract_get_context` with the runtime tree. Read the entry source with `posterract_read_source` and retain the returned revision.

Read the project instructions, manifest, entry TSX, and relevant local SDK docs. Identify the active scene ID, dimensions, FPS, duration/work area, source media, and deliverable.

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

After every meaningful change:

Call `posterract_validate`, `posterract_check`, and `posterract_capture` at representative times.

Open every capture. A passing structural check does not prove that footage pixels are visible or attractive.

## Finish

Only after explicit instruction:

Call `posterract_export` with an explicit local output path.

Export remains local. Posting and scheduling are separate authenticated Posterract cloud actions.
