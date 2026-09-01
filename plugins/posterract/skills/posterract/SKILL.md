---
name: posterract
description: Use the Posterract MCP tools to inspect and edit the video project currently open in Posterract Desktop. Trigger when the user asks to create, modify, validate, capture, inspect, or export a Posterract composition.
---

# Posterract

Work against the project currently open in Posterract Desktop.

1. Call `posterract_connection_status` and `posterract_get_context` before editing.
2. Read the project `AGENTS.md`, local `.posterract/docs`, and current TSX source.
3. Use source-backed semantic tools or revision-safe source writes.
4. Run `posterract_validate` and `posterract_check` after meaningful changes.
5. Use `posterract_capture` and inspect the returned images before claiming visual correctness.
6. Export only when the user explicitly asks.

Never claim the canvas is connected merely because the plugin is installed. A successful Posterract tool call proves the live connection. Never post, schedule, upload, or delete source media without explicit user authorization.
