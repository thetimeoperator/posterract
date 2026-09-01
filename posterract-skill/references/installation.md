# Installation

## Desktop and agent connection

1. Install and launch Posterract Desktop.
2. Open a creative project.
3. On the API page, choose Codex, Claude Code, Cursor, VS Code, or Terminal/other.
4. Press **Connect**. Desktop installs the matching local runtime, registers the project-pinned stdio MCP server, and opens the selected client in the project.
5. In the agent, verify that `posterract_connection_status` is available and succeeds.

No prompt needs to be copied and no terminal command is required for ordinary setup. Use the CLI installer and `posterract doctor --json` only to diagnose a failed MCP registration.

## Agent skill

- Codex: use the in-app skill installer; restart/reload skills if the client requests it.
- Claude Code: place the folder where the project or user-level Claude skills configuration can read it.
- Cursor: add the skill folder to the agent rules/skills location used by the workspace.
- Generic coding agent: provide `SKILL.md` as the entry instructions and preserve the relative `references/` and `examples/` folders.

Verify the ZIP checksum before extracting. The `manifest.json` version ranges must include the installed desktop, CLI, SDK, and protocol versions.

Project-local `.posterract/docs` always overrides copied skill summaries when APIs differ. MCP client trust or tool-approval prompts remain controlled by the selected agent application.
