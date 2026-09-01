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

## Export boundary

`posterract_export` writes only to the explicit local path. It does not upload, post, schedule, or expose social credentials. Use it only after explicit user authorization.
