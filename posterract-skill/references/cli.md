# CLI

The CLI is the packaged runtime underneath the MCP server. Agents should use MCP tools for normal canvas work. Use these commands directly only for diagnostics, scripting environments without MCP, or explicit fallback work.

## MCP runtime

```text
posterract mcp serve [--project <dir>]
```

Agent clients launch this command automatically after Posterract Desktop registers the connection. It is a stdio protocol endpoint, not an interactive user command.

## Project and health

```text
posterract open [project-path] [--background]
posterract context [--json] [--tree]
posterract validate [--json]
posterract check <scene-id> [--json]
posterract doctor [--json]
posterract whoami [--json]
posterract version
```

## Composition output

```text
posterract capture <scene-id> [--time <time...>] [--separate]
                   [--per-sheet <1-12>] [--output <directory>]
posterract export <scene-id> --output <file> [--format <format>]
posterract screenshot [--output <directory>]
```

## Media

```text
posterract media probe <asset-or-path>
posterract media grab <asset-or-path> [--time <time...>] [--count <number>]
                       [--start <time>] [--end <time>] [--auto]
                       [--quality <small|medium|large|fullres>]
                       [--separate] [--per-sheet <1-12>]
                       [--output <directory>]
posterract media filmstrip <asset-or-path> [--start <time>] [--end <time>]
                            [--scale <number>] [--output <file>]
posterract media waveform <asset-or-path> [--start <time>] [--end <time>]
                           [--scale <number>] [--output <file>]
posterract media extract <asset-or-path> [--start <time>] [--end <time>]
                          [--audio-only] --output <file>
```

## Diagnostics and utilities

```text
posterract fonts [--family <pattern>] [--names-only] [--json]
posterract fetch <url> --output <path>
posterract logs [--tail <n>] [--level <level>] [--follow]
posterract report [--output <zip>]
```

Machine-readable commands print JSON or JSON Lines to stdout. Progress and recovery guidance belong on stderr. A nonzero exit indicates the operation failed or `check` found an error-severity issue.

## `posterract batch` — one video per row

```
posterract batch <sceneId> --data rows.csv --output "out/{name}.mp4"
```

A project is code with named `@inspect` variables, so a spreadsheet is already
a list of takes. Each row sets every variable whose name matches a column, then
exports. Columns the project does not declare are reported once and ignored —
data files usually carry other things too.

`--output` is a template: `{column}` inserts a cell, `{n}` the row number.
Without a placeholder the row number is appended, so rows cannot overwrite each
other. Cells are sanitised to a plain filename, so a stray `/` in a spreadsheet
cannot redirect the write.

Rows render one at a time — the encoder owns the GPU — and a failed row is
reported without stopping the rest. The command exits non-zero if any row
failed.

JSON works too: an array of objects with the same shape as the CSV rows.
