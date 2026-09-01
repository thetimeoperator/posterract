import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mcpServerConfig, upsertMcpJson } from "./mcp-client-config.ts";

test("builds the install-once stdio command", () => {
  assert.deepEqual(mcpServerConfig("/Applications/Posterract CLI"), {
    type: "stdio",
    command: "/Applications/Posterract CLI",
    args: ["mcp", "serve"],
  });
});

test("preserves unrelated client configuration and server entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "posterract-mcp-config-"));
  const file = join(root, ".cursor", "mcp.json");
  try {
    await upsertMcpJson(file, "mcpServers", "/bin/posterract");
    const first = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    assert.deepEqual(first, {
      mcpServers: {
        posterract: {
          type: "stdio",
          command: "/bin/posterract",
          args: ["mcp", "serve"],
        },
      },
    });

    await writeFile(file, `${JSON.stringify({ theme: "dark", mcpServers: { existing: { command: "other" } } }, null, 2)}\n`);
    await upsertMcpJson(file, "mcpServers", "/bin/posterract");
    const second = JSON.parse(await readFile(file, "utf8")) as {
      theme?: string;
      mcpServers?: Record<string, unknown>;
    };
    assert.equal(second.theme, "dark");
    assert.deepEqual(second.mcpServers?.existing, { command: "other" });
    assert.deepEqual(second.mcpServers?.posterract, {
      type: "stdio",
      command: "/bin/posterract",
      args: ["mcp", "serve"],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses VS Code's servers root and refuses an invalid existing root", async () => {
  const root = await mkdtemp(join(tmpdir(), "posterract-vscode-config-"));
  const file = join(root, ".vscode", "mcp.json");
  try {
    await upsertMcpJson(file, "servers", "/bin/posterract");
    const value = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    assert.ok(value.servers);

    await writeFile(file, '{"servers":"do-not-overwrite"}\n');
    await assert.rejects(
      () => upsertMcpJson(file, "servers", "/bin/posterract"),
      /invalid servers section/,
    );
    assert.equal(await readFile(file, "utf8"), '{"servers":"do-not-overwrite"}\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
