---
name: posterract
description: Build, inspect, validate, capture, and export local Posterract TSX video compositions through the official Posterract MCP canvas connection. Use when an agent works in a Posterract project, edits @posterract/composition source, analyzes local media, or prepares an explicitly requested local export.
---

# Posterract

Work from the local project folder. Treat the project entry module as canonical — `index.tsx` at the project root (`src/index.tsx` in legacy projects; `posterract_read_source` with the default `"auto"` path resolves it) — and the active project's `.posterract/docs` as authoritative for the installed SDK version.

## File-first rule

The TSX file is the document. Edit it with your own file tools — read a range, search, replace a string — the way you edit any code. Desktop watches the file and shows the change on the canvas:

- A change to values or text shows in place, as one step of the user's undo history. They can take it back with Cmd+Z.
- Adding, removing or moving elements reloads the canvas. The user keeps their own undo steps; your change is kept in Version History rather than as an undo step. `posterract_create_element`, `posterract_move` and `posterract_delete` do the same without a reload and as an undo step.

Give every element you add an `id`. The editor addresses an element with no id by its position in the file, which your next edit moves.

Before you write, call `posterract_changes` with the `revisionId` you last saw. It lists what the user changed since, element by element. Work around their changes, not over them.

You are told what your edit broke without asking. Whenever the source has changed, the next Posterract tool or CLI command you run — any of them — comes back with what is newly wrong attached: props the editor does not know, text off the frame, elements nobody can see, each with its fix. It works for every agent, because it is Posterract that checks, not your client. Each problem is said once, so fix it when you hear it; `posterract_inspect` lists everything still open.

## Scene skills

A scene may carry `skill="<name>"`, the skill folder it is made with (chosen from the editor's Skill Deck or written in the source). `posterract_get_context` reports each scene's skill and its folder path. Read that folder's SKILL.md before editing the scene and follow its workflow; if the folder is missing on this machine, say so instead of guessing.

## Required workflow

1. Call `posterract_connection_status`. If unavailable, read `references/installation.md` and diagnose the connection; do not pretend the canvas is connected.
2. Call `posterract_look`: the scene the user is in, where their playhead is parked, what they have selected, and any `@agent …` markers — notes they left you on the timeline. "This" in a request means that selection at that playhead.
3. Call `posterract_outline` for the shape of the source: one line per element with the lines it spans, keyframes folded to counts. Never read a large source whole. Use `posterract_get_context` with `tree: true` and a `scene` only when you need runtime detail.
4. Read `AGENTS.md`, `README.md`, `package.json`, `assets.yml`, and the relevant `.posterract/docs` pages. When you need to know what an element accepts, call `posterract_describe` (with an `element` for its props) rather than guessing a name.
5. Call `posterract_read_source` with `id` or `lines` for the part you will change, and retain its `revisionId` (it is the whole file's).
6. Probe source media with `posterract_media_probe`.
7. Generate MCP filmstrips, waveforms, or representative frame grabs when they clarify the edit.
8. For nontrivial work, write a short creative brief before editing.
9. Assemble primary footage first, then secondary footage, captions, audio, overlays, effects, and transitions.
   - Place by intent, not by arithmetic: `place="lower-third"`, `place="bottom-right" inset={48}` (see `.posterract/docs/elements.md`). Work out `x`/`y` only when no placement says it.
   - Anything that keeps moving is a few keyframes and a `loop` (`loop="pingpong"` for there and back), never a keyframe per change of direction.
   - An entrance that is not the preset's default is still one `<animation>`: `distance`, `amount` and `easing` tune it (see `.posterract/docs/keyframes-animations-transitions.md`). Hand-written keyframes are for motion no preset describes.
10. Put words on screen with `<text>`, or `<captions>` with `<cue>` children — never as pre-rendered images. The user has to be able to change a word on the canvas.
11. Organize timed material into `<sequence>` elements. One top-level `<scene>` is one independently exportable video.
12. Hoist important creative controls into documented inspector variables.
13. Edit the TSX with your file tools (see the file-first rule). The semantic MCP canvas tools do the same for one element and answer with the `revisionId` they produced and anything the source would not take. `posterract_write_source` replaces a whole file and needs the exact revision previously read: keep it for agents that have no file tools.
14. Call `posterract_inspect` after every meaningful edit. It visits the whole duration and reports facts, then ranked problems with the element, the numbers and the fix: text off the frame, elements never visible, things on screen too briefly, text overlapping or hidden, spans where nothing draws. Fix every `✗`; judge every `⚠`.
15. Call `posterract_validate` (it compiles, and lints props and values against the vocabulary).
16. Call `posterract_capture` at representative times once `inspect` is clean, and look at every returned image: captures are for judging taste, not for finding layout bugs.
17. Call `posterract_show` on what you changed, so the user sees it rather than reads about it.
18. Export only after the user explicitly requests an export. `posterract render -o exports/<name>.mp4` works with the app closed; `--from`/`--to`/`--scale` render a short, small version when a look is all that is needed.
19. Post or schedule only after a separate explicit user instruction.

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
- Motion design — beat timing, motion blur, knobs, repeaters, recipes: `references/motion-design.md`
- Efficient video/audio inspection: `references/media-analysis.md`
- Easing guidance: `references/easings.md`
- Recovery steps: `references/troubleshooting.md`
- Export-to-publish boundary: `references/posting-api.md`

Load only the references needed for the current task. Use the examples as patterns, then verify actual supported properties against the project's local SDK docs.

## What the editor shows the user

The timeline is an index of the document, at one of three detail levels
(*Clips*, *Animation*, *Everything*). Every keyframe track, preset animation,
effect, paint, stroke and shadow you write becomes a row the user can see and
edit. `posterract_get_context` with `tree: true` summarises an element's motion
in one line (keyframes per property, animation presets); with `motion: true` it
lists the same structure in full: `keyframe-track` nodes carry the `property`
they drive, `keyframe` nodes carry `time` (seconds), `value` and `easing`, and
`animation` nodes carry `type`, `duration` and `phase`. Read those rather than
re-parsing the TSX when you need to adjust motion you or the user already
created.

Where the user is looking — their selection, the active scene, the camera — is
not in the source. It lives in `.posterract/view.json` beside the project, and
`posterract_look` reports it. Never write `selected`, `active` or `camera` into
the TSX; the editor lifts them back out.

Two props are protections, not decoration:

- `locked` — the user has asked that this element not be moved, trimmed or
  deleted. Do not edit it without being asked to.
- `workarea` on a `<scene>` — the range that exports. Changing it changes what
  the user's render will contain.

The user's work is snapshotted before every write and deleted scenes are kept
in `.posterract/trash/`, so a mistake is recoverable — but that is a safety
net, not a licence. Check `posterract_changes` before you write.
