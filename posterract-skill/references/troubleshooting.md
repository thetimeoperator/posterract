# Troubleshooting

## MCP or canvas unavailable

Call `posterract_connection_status`. If the MCP tool is missing entirely, reopen the API page in Posterract Desktop, select the correct agent, and press **Connect** again. If the tool exists but reports that Desktop is unavailable, open the same project in Desktop and retry.

For deeper local diagnostics only:

```sh
posterract doctor --json
posterract open /absolute/path/to/project --background
```

If protocol versions differ, update the desktop app, press **Connect** again, and rerun the MCP connection check.

## Project not open

Open the project in Posterract Desktop, then call `posterract_connection_status` and `posterract_get_context` again.

## Validation failure

Read diagnostics, the entry TSX, and `.posterract/docs/lifecycle-errors.md`. Fix the smallest source error, save, and rerun validation. The editor preserves the last successfully mounted canvas.

## Source revision conflict

Someone wrote the source after you read it. Call `posterract_changes` with the `revisionId` you hold to see what they changed, reread that part, and reapply your edit to the element by its stable ID. Never overwrite the newer file wholesale.

## Missing asset

Check `assets.yml`, probe the path, relink or replace the source, then regenerate the relevant cache artifact. Do not delete the original file.

## Structural check passes but frame looks wrong

Capture the suspicious exact times. `check` reports scheduling and visibility structure, not whether the underlying pixels are dark or aesthetically correct.

## Diagnostic bundle

```sh
posterract report --output /tmp/posterract-report.zip
```

The report is local and sanitized. It does not upload or create an issue automatically.
