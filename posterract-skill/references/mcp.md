# MCP connection and tools

Posterract Desktop registers a project-pinned stdio MCP server with the selected agent. The installed `posterract` executable is the server runtime; the agent launches it automatically. Users do not need to type CLI commands or paste a bootstrap prompt.

## Start and orient

- `posterract_connection_status`: prove that Desktop, the project mailbox, renderer, and compiler are live.
- `posterract_look`: what the user is looking at — active scene, playhead, the selection with the props an edit starts from, and their `@agent …` markers. Start a turn here.
- `posterract_show`: the same gesture the other way — bring the editor to an element (scene, playhead, selection, camera). View only.
- `posterract_outline`: one line per element of the source with the lines it spans; keyframes folded to counts. Works with Desktop closed.
- `posterract_describe`: every element and prop, generated from the SDK's types; with `element`, that element's props, types and allowed values. Works with Desktop closed.
- `posterract_read_source`: read TSX and its conflict-safe revision — by `id` (one element), `lines`, or `outline`. A very large file answers with its outline unless `full: true`.
- `posterract_get_context`: active video, playhead, variables, fonts, revision. `tree: true` adds the runtime tree (props and a motion summary per element); narrow it with `scene` and `depth`.
- `posterract_get_canvas_state`: read selection, active video, playhead, FPS, undo, and redo.

## Edit the document

The TSX file is the document. If you have file tools of your own, edit the file with them: Desktop shows the change on the canvas (see the file-first rule in SKILL.md). These tools are for a client that has only MCP, and for the edits that are easier by id.

- `posterract_edit_source`: replace one string of the source with another, like a file tool's edit. `old_string` must match the file exactly and be there once, unless `replace_all`.
- `posterract_apply_edits`: several element edits in one call — one undo step, one write, all or nothing. Ops: `set`, `text`, `create`, `move`, `delete`, `duplicate`. A later edit may name an element an earlier `create` makes. Use it whenever a change is more than one edit.
- `posterract_set_properties`, `posterract_set_text`, `posterract_create_element`, `posterract_move`, `posterract_delete`, `posterract_duplicate`: the same edits one at a time.
- `posterract_set_variable`, `posterract_group`, `posterract_ungroup`, `posterract_bake_keyframes`
- `posterract_undo`, `posterract_redo`
- `posterract_select`, `posterract_activate_video`, `posterract_seek`: the view, not the document.
- `posterract_write_source`: replace a whole file. Needs the exact `expectedRevisionId` from the latest `posterract_read_source`. Prefer `posterract_edit_source`: it costs two strings, not the file.

Each edit answers only once the change is written, with the `revisionId` it produced, anything the source would not take (`skipped`), and `warnings`. A prop nothing reads, or a value an enumeration does not name, is refused before anything changes.

`expectedRevisionId` on `set_properties`, `set_text`, `move`, `delete` and `apply_edits` is a conflict check about the elements the edit names, not about the file: the edit is refused only if someone changed those elements since that revision, and the answer says what they changed. `posterract_changes` shows the same for the whole file.

## Verify and inspect

- `posterract_inspect`: what is in a video and what is wrong with it, across its whole duration — timeline, markers, and ranked problems with the element, the numbers and the fix. The first thing to run after an edit.
- `posterract_lint`: props an element does not take, values an enumeration does not name. Works with Desktop closed.
- `posterract_validate`: compile, plus the same lint; `ok` is false when either finds an error.
- `posterract_check`: structural timing and visibility problems of one subtree (`inspect` includes these for a scene).
- `posterract_get_geometry`: boxes of what is on screen at one moment, in scene space; does not move the user's playhead.
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
