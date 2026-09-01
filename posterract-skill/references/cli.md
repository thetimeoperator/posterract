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
