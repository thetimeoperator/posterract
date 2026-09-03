/**
 * Per-project trash for deleted scenes.
 *
 * Deleting a scene removes a whole branch of the composition, and until now it
 * happened silently with no way back except a source snapshot. Trash keeps the
 * removed scene's own source next to the project so restoring it is a paste
 * rather than an archaeology exercise.
 *
 * This is deliberately project-local (unlike `revisions.ts`, which lives
 * outside the project): trash is user-initiated, it should travel with the
 * folder when it is copied or moved, and the snapshot store already covers the
 * case of the folder itself being destroyed.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { extractElementSource } from "./element-source.ts";

const TRASH_DIR = ".posterract/trash";
const MAX_ENTRIES = 100;
const MAX_SOURCE_BYTES = 2_000_000;
const ENTRY_NAME = /^(\d{14})-([A-Za-z0-9_-]{1,64})\.json$/;

export type TrashEntry = {
  id: string;
  sceneId: string;
  name: string;
  deletedAt: number;
  bytes: number;
};

type StoredEntry = {
  version: 1;
  sceneId: string;
  name: string;
  deletedAt: number;
  source: string;
};

function trashDir(projectDir: string): string {
  return join(projectDir, TRASH_DIR);
}

function safeSceneId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "scene";
}

/** Keep the newest entries; trash is a safety net, not an archive. */
async function prune(dir: string): Promise<void> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => ENTRY_NAME.test(name)).sort();
  for (const name of names.slice(0, Math.max(0, names.length - MAX_ENTRIES))) {
    await rm(join(dir, name), { force: true }).catch(() => undefined);
  }
}

/**
 * Keep a scene's own source before it is removed from the document.
 *
 * The text is read out of the entry file here rather than passed in, so what
 * is stored is exactly what the file holds — the renderer has no verbatim copy
 * of a scene's source to give. A scene whose span cannot be located is
 * refused, because a trash entry that cannot restore is worse than none.
 */
export async function putTrash(
  projectDir: string,
  input: { sceneId: string; name: string; entryPath: string },
): Promise<TrashEntry> {
  const content = await readFile(join(projectDir, input.entryPath), "utf8");
  const source = extractElementSource(content, input.sceneId);
  if (!source) {
    throw new Error("That scene could not be located in the project source, so it was not deleted");
  }
  if (source.length > MAX_SOURCE_BYTES) {
    throw new Error("The deleted scene is too large to keep in trash");
  }
  const dir = trashDir(projectDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const deletedAt = Date.now();
  const id = `${deletedAt.toString().padStart(14, "0")}-${safeSceneId(input.sceneId)}.json`;
  const stored: StoredEntry = {
    version: 1,
    sceneId: input.sceneId,
    name: input.name,
    deletedAt,
    source,
  };
  const target = join(dir, id);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
  await rename(temporary, target);
  await prune(dir);
  return { id, sceneId: input.sceneId, name: input.name, deletedAt, bytes: source.length };
}

export async function listTrash(projectDir: string): Promise<TrashEntry[]> {
  const dir = trashDir(projectDir);
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => ENTRY_NAME.test(name));
  const entries = await Promise.all(
    names.map(async (id) => {
      try {
        const stored = JSON.parse(await readFile(join(dir, id), "utf8")) as StoredEntry;
        return {
          id,
          sceneId: stored.sceneId,
          name: stored.name,
          deletedAt: stored.deletedAt,
          bytes: stored.source.length,
        };
      } catch {
        return null;
      }
    }),
  );
  return entries.filter((entry): entry is TrashEntry => entry !== null).sort((a, b) => b.deletedAt - a.deletedAt);
}

/** The stored TSX for one entry, for the editor to write back into the document. */
export async function readTrash(projectDir: string, id: string): Promise<{ sceneId: string; name: string; source: string }> {
  if (!ENTRY_NAME.test(id)) throw new Error("Unknown trash entry");
  const stored = JSON.parse(await readFile(join(trashDir(projectDir), id), "utf8")) as StoredEntry;
  return { sceneId: stored.sceneId, name: stored.name, source: stored.source };
}

export async function removeTrash(projectDir: string, id: string): Promise<void> {
  if (!ENTRY_NAME.test(id)) throw new Error("Unknown trash entry");
  await rm(join(trashDir(projectDir), id), { force: true });
}
