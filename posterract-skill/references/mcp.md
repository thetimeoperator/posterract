# MCP connection and tools

Posterract Desktop registers a project-pinned stdio MCP server with the selected agent. The installed `posterract` executable is the server runtime; the agent launches it automatically. Users do not need to type CLI commands or paste a bootstrap prompt.

## Start and orient

- `posterract_connection_status`: prove that Desktop, the project mailbox, renderer, and compiler are live.
- `posterract_get_context`: read active video, playhead, variables, fonts, revision, and runtime tree.
- `posterract_read_source`: read TSX and its conflict-safe revision.
- `posterract_get_canvas_state`: read selection, active video, playhead, FPS, undo, and redo.

## Edit the live document

- `posterract_select`
- `posterract_activate_video`
- `posterract_seek`
- `posterract_set_properties`
- `posterract_set_text`
- `posterract_create_element`
- `posterract_set_variable`
- `posterract_group`
- `posterract_ungroup`
- `posterract_duplicate`
- `posterract_move`
- `posterract_delete`
- `posterract_undo`
- `posterract_redo`

These tools use the same source-backed document editor as the visual UI. For new elements, complex restructuring, reactive expressions, diagrams, shaders, or arbitrary SDK features, edit the TSX with `posterract_write_source`. Always supply the exact `expectedRevisionId` returned by the latest `posterract_read_source`; reread after a conflict.

## Verify and inspect

- `posterract_validate`: compile and candidate-mount while preserving the last valid canvas on failure.
- `posterract_check`: inspect structural timing and visibility problems.
- `posterract_capture`: return render-equivalent frames or contact sheets as MCP images.
- `posterract_screenshot`: return the complete live editor UI as an MCP image.
- `posterract_media_probe`, `posterract_media_grab`, `posterract_media_filmstrip`, and `posterract_media_waveform`: inspect local source media without upload.
- `posterract_media_transcribe`: the words in a local clip, with per-word timings, on the user's own transcription key. Cached in the project by the file's content hash, so asking twice costs nothing and returns the same words — which is what makes captions built from it safe to edit afterwards. Needs a `transcribe` key in `api-keys.json`; without one it says so rather than failing quietly.
- `posterract_fetch`: download a video (or `audio: true` for just the sound) from a URL into the project with yt-dlp. Local, and it needs yt-dlp on PATH.
- `posterract_media_transcribe`: transcribe the speech in a project video or audio asset into segments with word-level timestamps. Unlike the other media tools it uploads the file (25 MB ceiling) through the signed-in Posterract Desktop workspace and spends AI credits — 1 per started minute. For a larger file, cut a span or an audio-only file with `media extract` first.

## Export boundary

`posterract_export` writes only to the explicit local path. It does not upload, post, schedule, or expose social credentials. Use it only after explicit user authorization.

## `posterract_get_geometry`

Rendered layout as data. Returns each element's post-transform box, its draw
order, opacity, and — for text — what it actually renders, plus the pairs that
partially overlap and the elements that fall outside or cross the frame.
A box fully inside another is not reported: a backplate holding its own text
is the normal shape of a composition, not a collision.

```
{ ids?: string[], time?: number }   // time is scene-local seconds
```

Boxes are in scene space, the same space the source's `x` / `y` / `width` /
`height` are written in, so an overlap you find here is fixed by editing the
numbers you already have.

Use it instead of reasoning about layout from a capture: it is exact, it is
cheap, and it answers the questions a capture cannot — whether text overflows,
whether an element is off the frame, which of two elements is on top.

`posterract_capture` is still how you confirm a *visual* result. Geometry tells
you where things are; a capture tells you what they look like.

## Editing captions

`<captions>` holding `<cue start end>text</cue>` children uses those cues and
ignores its `src`. Cues are ordinary elements, so `posterract_create_element`,
`posterract_set_text` and `posterract_delete` all work on them — that is how
you fix a misheard word or retime a line.

A captions element with only a `src` cannot be edited line by line until its
cues exist. Create them from what the transcript says rather than editing the
transcript file, which the composition does not own.

Write cues with `posterract_write_source`, not `posterract_create_element`:
the create tool does not yet carry a child element's inline text, so a cue made
that way lands with its timing but no words.

## Lottie

`<lottie src width height speed? loop?>` plays a Lottie animation. Write the
JSON into the project's `assets/lottie/` and point `src` at it.

It is seeked, not played, so it scrubs and exports deterministically. Check the
result with `posterract_capture` at a few times — the animation's own content is
not visible from the source, so a capture is the only way to know it is right.
