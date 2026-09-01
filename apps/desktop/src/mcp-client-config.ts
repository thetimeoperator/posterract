import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonConfig(path: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${path} does not contain a JSON object`);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Could not safely update ${path}: ${errorMessage(error)}`);
  }
}

async function writeJsonConfig(path: string, value: Record<string, unknown>): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function mcpServerConfig(cliPath: string): Record<string, unknown> {
  return {
    type: "stdio",
    command: cliPath,
    args: ["mcp", "serve"],
  };
}

/**
 * Add only Posterract's server entry while preserving every unrelated client
 * setting. Invalid existing roots are rejected instead of overwritten.
 */
export async function upsertMcpJson(
  path: string,
  rootKey: "mcpServers" | "servers",
  cliPath: string,
): Promise<void> {
  const config = await readJsonConfig(path);
  const current = config[rootKey];
  if (current !== undefined && (!current || typeof current !== "object" || Array.isArray(current))) {
    throw new Error(`${path} has an invalid ${rootKey} section and was not changed`);
  }
  config[rootKey] = {
    ...(current as Record<string, unknown> | undefined),
    posterract: mcpServerConfig(cliPath),
  };
  await writeJsonConfig(path, config);
}
