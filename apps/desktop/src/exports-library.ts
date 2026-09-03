/**
 * The user's library of finished renders.
 *
 * Export is local: a render lands on the machine and nothing leaves it until
 * the user chooses to schedule or post. That promise is only meaningful if the
 * result is findable afterwards, so every completed export is indexed here,
 * with the provenance needed to answer "which project, which scene, which
 * revision of the source produced this file".
 *
 * The index lives in userData rather than the project, so a render survives
 * the project folder being moved, renamed, or deleted.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, shell } from "electron";

const INDEX_FILE = "exports.json";
const MAX_ENTRIES = 500;

export type ExportEntry = {
  id: string;
  projectId: string | null;
  projectDir: string | null;
  sceneId: string | null;
  /** The source revision this render was produced from, for provenance. */
  sourceRevision: string | null;
  path: string;
  fileName: string;
  contentType: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  createdAt: number;
};

/** What a listed export looks like once the file itself has been checked. */
export type ListedExport = ExportEntry & { bytes: number | null; missing: boolean };

function indexPath(): string {
  return join(app.getPath("userData"), INDEX_FILE);
}

async function readIndex(): Promise<ExportEntry[]> {
  try {
    const value = JSON.parse(await readFile(indexPath(), "utf8")) as unknown;
    return Array.isArray(value) ? (value as ExportEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(entries: ExportEntry[]): Promise<void> {
  const target = indexPath();
  const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(entries.slice(-MAX_ENTRIES), null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

export async function recordExport(entry: Omit<ExportEntry, "id" | "createdAt">): Promise<ExportEntry> {
  const entries = await readIndex();
  const record: ExportEntry = { ...entry, id: randomUUID(), createdAt: Date.now() };
  // One row per file: re-exporting over the same path replaces its entry
  // rather than stacking duplicates the user has to tell apart.
  await writeIndex([...entries.filter((existing) => existing.path !== entry.path), record]);
  return record;
}

export async function listExports(): Promise<ListedExport[]> {
  const entries = await readIndex();
  const listed = await Promise.all(
    entries.map(async (entry) => {
      const details = await stat(entry.path).catch(() => null);
      return { ...entry, bytes: details?.size ?? null, missing: details === null };
    }),
  );
  return listed.sort((a, b) => b.createdAt - a.createdAt);
}

export async function revealExport(id: string): Promise<void> {
  const entry = (await readIndex()).find((candidate) => candidate.id === id);
  if (!entry) throw new Error("That export is no longer in the library");
  shell.showItemInFolder(entry.path);
}

/**
 * Forget an export, and optionally send the file itself to the OS trash.
 * Deleting the file is `shell.trashItem` rather than an unlink so a mistake
 * is recoverable outside Posterract too.
 */
export async function deleteExport(id: string, removeFile: boolean): Promise<void> {
  const entries = await readIndex();
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) return;
  if (removeFile) await shell.trashItem(entry.path).catch(() => undefined);
  await writeIndex(entries.filter((candidate) => candidate.id !== id));
}

export async function renameExport(id: string, name: string): Promise<ExportEntry | null> {
  const entries = await readIndex();
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) return null;
  const safe = name.replace(/[/\\:*?"<>|]/g, "").trim();
  if (!safe) throw new Error("That name cannot be used for a file");
  const target = join(entry.path.slice(0, entry.path.lastIndexOf("/")), safe);
  await rename(entry.path, target);
  const next: ExportEntry = { ...entry, path: target, fileName: safe };
  await writeIndex(entries.map((candidate) => (candidate.id === id ? next : candidate)));
  return next;
}
