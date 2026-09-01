/**
 * Source history for local projects.
 *
 * A project's TSX file is the whole video, and an agent connected to that
 * project has shell access to the folder it lives in. So the history is kept
 * in the app's own user-data directory rather than under `.posterract/`:
 * deleting, emptying, or `rm -rf`-ing the project folder must not be able to
 * take the history with it.
 *
 * Snapshots are written before a file is overwritten, so the newest snapshot
 * is always the last content that was on disk, and a destructive write is
 * recoverable without the writer having to cooperate.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { app } from "electron";

/** Enough to survive an agent session that goes wrong without unbounded growth. */
const MAX_REVISIONS_PER_FILE = 50;
const MAX_SNAPSHOT_BYTES = 5_000_000;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/i;

export type RevisionEntry = {
  id: string;
  path: string;
  savedAt: number;
  bytes: number;
  /** Set when this snapshot was taken because the file vanished from disk. */
  deleted: boolean;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Walk up to the folder whose package.json marks it as a Posterract project. */
async function findProjectRoot(from: string): Promise<string | null> {
  let current = dirname(resolve(from));
  while (true) {
    try {
      const pkg = JSON.parse(await readFile(join(current, "package.json"), "utf8")) as { posterract?: unknown };
      if (pkg.posterract !== undefined) return current;
    } catch {
      // Not a project folder; keep walking.
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Maps a project folder to the key its history is stored under. */
function indexPath(): string {
  return join(storeRoot(), "projects.json");
}

async function readIndex(): Promise<Record<string, string>> {
  try {
    const value = JSON.parse(await readFile(indexPath(), "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function rememberKey(projectDir: string, key: string): Promise<void> {
  const index = await readIndex();
  if (index[resolve(projectDir)] === key) return;
  index[resolve(projectDir)] = key;
  await mkdir(storeRoot(), { recursive: true });
  const temporary = `${indexPath()}.tmp`;
  await writeFile(temporary, JSON.stringify(index, null, 2), { mode: 0o600 });
  await rename(temporary, indexPath());
}

/**
 * A stable per-project key. `projectId` survives renaming and moving the
 * folder, but it lives in the project's own manifest — which is exactly what
 * a destructive agent may have removed. So every key that gets used is also
 * recorded against the folder path, and lookups fall back to that index when
 * the manifest can no longer be read. Without it, deleting a project would
 * also make its history unfindable.
 */
async function projectKey(projectDir: string): Promise<string> {
  for (const file of ["posterract.json", "package.json"] as const) {
    try {
      const value = JSON.parse(await readFile(join(projectDir, file), "utf8")) as {
        projectId?: unknown;
        posterract?: { projectId?: unknown };
      };
      const id = typeof value.projectId === "string" ? value.projectId : value.posterract?.projectId;
      if (typeof id === "string" && id) {
        const key = id.replace(/[^A-Za-z0-9_-]/g, "");
        await rememberKey(projectDir, key);
        return key;
      }
    } catch {
      // The manifest is gone or unreadable; the index below is the answer.
    }
  }
  const remembered = (await readIndex())[resolve(projectDir)];
  if (remembered) return remembered;
  const key = `dir-${sha256(resolve(projectDir)).slice(0, 24)}`;
  await rememberKey(projectDir, key);
  return key;
}

/** One directory per file, so a project with several sources keeps them apart. */
function fileKey(relativePath: string): string {
  return relativePath.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function storeRoot(): string {
  return join(app.getPath("userData"), "revisions");
}

async function storeDir(projectDir: string, relativePath: string): Promise<string> {
  return join(storeRoot(), await projectKey(projectDir), fileKey(relativePath));
}

function relativeTo(projectDir: string, absolutePath: string): string {
  return resolve(absolutePath).slice(resolve(projectDir).length + 1).split(sep).join("/");
}

async function writeSnapshot(dir: string, content: string, deleted: boolean): Promise<void> {
  await mkdir(dir, { recursive: true });
  const digest = sha256(content).slice(0, 16);
  const existing = await readdir(dir).catch(() => [] as string[]);
  // The editor writes on a debounce and an agent may re-send an unchanged
  // file; identical consecutive content is not a new revision.
  if (existing.some((name) => name.endsWith(`-${digest}${deleted ? ".deleted" : ""}.snap`))) return;
  const name = `${Date.now().toString().padStart(14, "0")}-${digest}${deleted ? ".deleted" : ""}.snap`;
  const target = join(dir, name);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, target);
  await prune(dir);
}

async function prune(dir: string): Promise<void> {
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((name) => name.endsWith(".snap"))
    .sort();
  for (const name of names.slice(0, Math.max(0, names.length - MAX_REVISIONS_PER_FILE))) {
    await rm(join(dir, name), { force: true }).catch(() => undefined);
  }
}

/**
 * Preserve what is currently on disk before it is replaced. Called for every
 * source write, from both the agent path and the visual editor, so the newest
 * snapshot always holds the content the next write is about to destroy.
 */
export async function snapshotBeforeWrite(absolutePath: string): Promise<void> {
  if (!SOURCE_FILE.test(absolutePath)) return;
  let current: string;
  try {
    const details = await stat(absolutePath);
    if (!details.isFile() || details.size > MAX_SNAPSHOT_BYTES) return;
    current = await readFile(absolutePath, "utf8");
  } catch {
    return; // Nothing on disk yet: a new file has no prior version to keep.
  }
  if (!current) return;
  const projectDir = await findProjectRoot(absolutePath);
  if (!projectDir) return;
  await writeSnapshot(
    await storeDir(projectDir, relativeTo(projectDir, absolutePath)),
    current,
    false,
  ).catch(() => undefined);
}

/**
 * Mark that a source file disappeared. The content itself is already held by
 * the snapshot taken before the last write; this records that the working copy
 * is gone so the app can offer a restore rather than only reporting a missing
 * entry file.
 */
export async function recordDeletion(projectDir: string, relativePath: string): Promise<void> {
  if (!SOURCE_FILE.test(relativePath)) return;
  const dir = await storeDir(projectDir, relativePath);
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".snap")).sort();
  const latest = names.at(-1);
  if (!latest || latest.endsWith(".deleted.snap")) return;
  await writeSnapshot(dir, await readFile(join(dir, latest), "utf8"), true).catch(() => undefined);
}

export async function listRevisions(projectDir: string, relativePath: string): Promise<RevisionEntry[]> {
  const dir = await storeDir(projectDir, relativePath);
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".snap"));
  const entries = await Promise.all(
    names.map(async (name) => {
      const details = await stat(join(dir, name)).catch(() => null);
      const [savedAt] = name.split("-");
      return {
        id: name,
        path: relativePath,
        savedAt: Number(savedAt) || 0,
        bytes: details?.size ?? 0,
        deleted: name.endsWith(".deleted.snap"),
      };
    }),
  );
  return entries.sort((a, b) => b.savedAt - a.savedAt);
}

export async function readRevision(projectDir: string, relativePath: string, id: string): Promise<string> {
  if (!/^[0-9]{14}-[0-9a-f]{16}(\.deleted)?\.snap$/.test(id)) throw new Error("Unknown revision");
  const dir = await storeDir(projectDir, relativePath);
  return readFile(join(dir, id), "utf8");
}
