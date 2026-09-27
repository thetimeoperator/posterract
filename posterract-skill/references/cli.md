# CLI

The CLI is the main interface: every capability is a command, and the MCP tools mirror them for clients that have no terminal. If you have a shell, use the CLI. Output is text by default and `--json` where a script needs it; a failed check exits nonzero.

The document is the TSX file. Edit it with your own file tools; the commands below are for reading, checking, and the edits that are easier by id.

**The app does not have to be open.** Reading and linting never needed it. For what only a renderer can do — `inspect`, `geometry`, `check`, `validate`, `capture`, `export` / `render`, `media …` — the CLI uses the app when it is open and otherwise starts the engine for itself: the app with no window, no Dock icon and no sign-in. It says so once on stderr, the engine is shared by the commands that follow, and it quits by itself a couple of minutes after the last one. Only what is about the person at the editor (`look`, `show`, `undo`, `screenshot`) needs the app open.

## Reading a project (works with the app closed)

These read the project folder themselves, the way `ffprobe` needs no player running.

```text
posterract outline [file-or-project] [--json]      # one line per element, with the lines it spans
posterract read [file-or-project] --id <id>        # one element's source, with line numbers
posterract read [file-or-project] --lines 120-180
posterract describe [element] [--json]             # every element and prop; never guess a name
posterract lint [file-or-project] [--json]         # exits 1 on an error
posterract changes [--since <revisionId>]          # who changed what, element by element
posterract diff <before.tsx> <after.tsx>
```

## Checking the video (app open or not)

```text
posterract inspect [scene-id] [--all] [--problems] # facts + ranked problems with fixes; exits 1 on an error
posterract geometry [ids...] [--at <time>]         # measured boxes, text, overlaps
posterract validate [--json]                       # does it compile, and does the editor understand it
posterract check <scene-id> [--json]               # timing and visibility problems of one subtree
```

## Working with the person in the editor (app open)

```text
posterract look [--json]                           # their scene, playhead, selection, @agent notes
posterract show <id> [--at <time>]                 # bring the editor to an element
```

## Editing by id

With the app open these go through the canvas: shown at once, one step of the person's undo history. With the app closed they edit the file directly with the same writer. A wrong prop or value is refused before anything changes.

```text
posterract set <id> <prop=value...>                # posterract set hook y=1200 color=#ffe600
posterract text <id> "<new text>"
posterract create <parentId> --element '<json>'    # {tag, props?, text?, children?}; give it an id
posterract move <id> <parentId> [--before <id>]
posterract delete <ids...>
posterract duplicate <ids...>                      # app only
posterract apply [edits.json]                      # several edits: one undo step, all or nothing
posterract undo | redo                             # app only
```

`--since <revisionId>` on `set`, `text`, `move`, `delete` and `apply` refuses the edit only if someone changed those elements since that revision, and says what they changed. A change elsewhere in the file is no conflict.

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
posterract render [scene-id] -o <file> [--from <time>] [--to <time>] [--scale <0-1>]
posterract export <scene-id> -o <file> [--format <format>] [--from …] [--to …] [--scale …]
posterract capture <scene-id> [--time <time...>] [--separate]
                   [--per-sheet <1-12>] [--output <directory>]
posterract screenshot [--output <directory>]           # app only
```

`render` is `export` with the scene optional (a project with one video needs no id) and the project taken from the folder it is run in. It is the same renderer as the app's Export, so the file is the same file. `--from` / `--to` render a stretch of the scene and `--scale 0.5` renders it at half size: three seconds at half size is how to look at a change without paying for the whole video. Progress goes to stderr (a line every ten percent when piped), and the exit code is nonzero when the render failed. Output has to be inside the project's `exports/` folder, or Downloads, Videos or Documents. Render only when the user asks for one.

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
