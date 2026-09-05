---
name: posterract
description: Build, inspect, validate, capture, and export local Posterract TSX video compositions through the official Posterract MCP canvas connection. Use when an agent works in a Posterract project, edits @posterract/composition source, analyzes local media, or prepares an explicitly requested local export.
---

# Posterract

Work from the local project folder. Treat the project entry module as canonical — `index.tsx` at the project root (`src/index.tsx` in legacy projects; `posterract_read_source` with the default `"auto"` path resolves it) — and the active project's `.posterract/docs` as authoritative for the installed SDK version.

## Canvas-first rule

While Posterract Desktop has the project open, every composition edit goes through the MCP tools: `posterract_write_source` (with the `revisionId` from `posterract_read_source`) for TSX changes, or the semantic tools (`posterract_set_properties`, `posterract_set_text`, `posterract_create_element`, `posterract_move`, …) for targeted ones. Do not rewrite the entry TSX with your own file tools. An edit made through the tools appears on the canvas and timeline instantly and keeps undo and Version History intact; a raw file write bypasses all of that and can collide with the user's own edits.

## Scene skills

A scene may carry `skill="<name>"`, the skill folder it is made with (chosen from the editor's Skill Deck or written in the source). `posterract_get_context` reports each scene's skill and its folder path. Read that folder's SKILL.md before editing the scene and follow its workflow; if the folder is missing on this machine, say so instead of guessing.

## Required workflow

1. Call `posterract_connection_status`. If unavailable, read `references/installation.md` and diagnose the connection; do not pretend the canvas is connected.
2. Call `posterract_get_context` with `tree: true`.
3. Read `AGENTS.md`, `README.md`, `package.json`, `assets.yml`, and the relevant `.posterract/docs` pages.
4. Call `posterract_read_source` before changing the entry TSX and retain its `revisionId`.
5. Probe source media with `posterract_media_probe`.
6. Generate MCP filmstrips, waveforms, or representative frame grabs when they clarify the edit.
7. For nontrivial work, write a short creative brief before editing.
8. Assemble primary footage first, then secondary footage, captions, audio, overlays, effects, and transitions.
9. Organize timed material into `<sequence>` elements. One top-level `<scene>` is one independently exportable video.
10. Hoist important creative controls into documented inspector variables.
11. Prefer semantic MCP canvas tools for targeted edits. Use `posterract_write_source` for arbitrary TSX changes and pass the exact revision previously read.
12. Call `posterract_validate`.
13. Call `posterract_check` for the active video.
14. Call `posterract_capture` at representative times and inspect every returned image.
15. Repeat incrementally until validation, structural checks, and inspected captures agree.
16. Export only after the user explicitly requests an export.
17. Post or schedule only after a separate explicit user instruction.

## Non-negotiable safety

- Never claim visual verification without opening the capture output.
- Never post or schedule merely because an export finished.
- Never upload imported or raw project media automatically.
- Never request, print, or store social OAuth tokens, desktop session tokens, or provider secrets.
- Never overwrite a concurrent source revision; stop on a reported revision conflict.
- Never edit `.posterract/sdk` or `.posterract/docs`.
- Never delete source media without explicit authorization.
- Never hide validation, check, capture, or export failures.
- Keep generated inspection artifacts local and outside source folders unless the user asks otherwise.

## Reference routing

- Installation and compatibility: `references/installation.md`
- Full editing loop: `references/workflow.md`
- TSX model and local docs: `references/composition-sdk.md`
- MCP tool and connection map: `references/mcp.md`
- Direct CLI diagnostics and fallback: `references/cli.md`
- Agent-designed diagrams and mathematical explainers: `references/diagrams.md`
- Vector motion graphics and Lottie authoring: `references/lottie.md`
- Efficient video/audio inspection: `references/media-analysis.md`
- Easing guidance: `references/easings.md`
- Recovery steps: `references/troubleshooting.md`
- Export-to-publish boundary: `references/posting-api.md`

Load only the references needed for the current task. Use the examples as patterns, then verify actual supported properties against the project's local SDK docs.

## What the editor shows the user

The timeline is an index of the document, at one of three detail levels
(*Clips*, *Animation*, *Everything*). Every keyframe track, preset animation,
effect, paint, stroke and shadow you write becomes a row the user can see and
edit. `posterract_get_context` reports the same structure: `keyframe-track`
nodes carry the `property` they drive, `keyframe` nodes carry `time` (seconds),
`value` and `easing`, and `animation` nodes carry `type`, `duration` and
`phase`. Read those rather than re-parsing the TSX when you need to adjust
motion you or the user already created.

Two props are protections, not decoration:

- `locked` — the user has asked that this element not be moved, trimmed or
  deleted. Do not edit it without being asked to.
- `workarea` on a `<scene>` — the range that exports. Changing it changes what
  the user's render will contain.

The user's work is snapshotted before every write and deleted scenes are kept
in `.posterract/trash/`, so a mistake is recoverable — but that is a safety
net, not a licence. Read before you write, and use revision-safe writes.
