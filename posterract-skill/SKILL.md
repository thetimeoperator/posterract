---
name: posterract
description: Build, inspect, validate, capture, and export local Posterract TSX video compositions through the official Posterract MCP canvas connection. Use when an agent works in a Posterract project, edits @posterract/composition source, analyzes local media, or prepares an explicitly requested local export.
---

# Posterract

Work from the local project folder. Treat `src/index.tsx` as canonical and the active project's `.posterract/docs` as authoritative for the installed SDK version.

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
- Efficient video/audio inspection: `references/media-analysis.md`
- Easing guidance: `references/easings.md`
- Recovery steps: `references/troubleshooting.md`
- Export-to-publish boundary: `references/posting-api.md`

Load only the references needed for the current task. Use the examples as patterns, then verify actual supported properties against the project's local SDK docs.
