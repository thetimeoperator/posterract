/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What the CLI can answer from the project folder alone, with no app running.
 *
 * Everything else in the CLI is a remote control: it asks the desktop app and
 * fails when the app is closed. But a project is a folder of text, and a good
 * deal of what an agent needs to know about it is a reading of that text. These
 * commands do that reading themselves, so they answer the same whether or not
 * the editor is open — the way `ffprobe` does not need a player running.
 *
 * Built as a bundle of its own (`dist/offline.cjs`) and loaded on demand: it
 * carries a TypeScript parser, which no command that talks to the app should
 * have to pay the start-up cost of.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { formatSource } from "@posterract/composition/source";
import { diffSources, formatDiff, readElements } from "@posterract/video-compiler/diff";
import { formatLint, hiddenMotionRefusal, introducedHiddenMotion, lintSource } from "@posterract/video-compiler/lint";
import { formatOutline, outlineSource } from "@posterract/video-compiler/outline";
import { checkProps, checkTree, describeVocabulary, vocabulary } from "@posterract/video-compiler/vocabulary";

import { INSTANCE_PROFILE } from "./cli-socket-path";

import { applyEdits } from "@posterract/video-compiler/writer";

import type { LintDiagnostic } from "@posterract/video-compiler/lint";
import type { SourceEdit } from "@posterract/video-compiler/writer";
import type { OutlineEntry } from "@posterract/video-compiler/outline";

/** The same resolution the desktop app uses for a project's entry file. */
const ENTRY_FILES = ["src/index.tsx", "src/index.ts", "index.tsx", "index.ts", "index.jsx", "index.js"];
const SOURCE_FILE = /\.[cm]?[jt]sx?$/i;

export function resolveEntry(projectDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8")) as { main?: unknown };
    if (typeof pkg.main === "string" && SOURCE_FILE.test(pkg.main) && existsSync(join(projectDir, pkg.main))) {
      return pkg.main.split(sep).join("/");
    }
  } catch {
    // No manifest, or not one we can read: the conventional names decide.
  }
  return ENTRY_FILES.find((entry) => existsSync(join(projectDir, entry))) ?? null;
}

export type OutlineReport = {
  /** The file that was read, relative to the project when it is inside one. */
  path: string;
  totalLines: number;
  totalChars: number;
  entries: OutlineEntry[];
  lines: string[];
};

/**
 * The source `target` names — a source file, or a project folder's entry
 * file — read, with the path it is known by (relative to the project when it
 * is inside one). Throws with a message fit to print when there is nothing to
 * read.
 */
function readTarget(target: string, projectDir?: string): { path: string; content: string } {
  let file = isAbsolute(target) ? target : resolve(projectDir ?? process.cwd(), target);
  if (!existsSync(file)) throw new Error(`No such file or folder: ${target}`);

  let root = projectDir;
  if (statSync(file).isDirectory()) {
    const entry = resolveEntry(file);
    if (!entry) throw new Error(`${target} has no composition entry file (looked for ${ENTRY_FILES.join(", ")}).`);
    root = file;
    file = join(file, entry);
  }
  if (!SOURCE_FILE.test(file)) throw new Error(`${target} is not a composition source file.`);

  const content = readFileSync(file, "utf8");
  const inside = root !== undefined && !relative(root, file).startsWith("..");
  return { path: inside ? relative(root!, file).split(sep).join("/") : file, content };
}

/** Every element and prop, or one element's props (see the compiler's vocabulary). */
export function describe(tag?: string): { lines: string[]; data: unknown } {
  const lines = describeVocabulary(tag);
  if (tag === undefined) return { lines, data: vocabulary };
  const entry = vocabulary.tags[tag]!;
  return {
    lines,
    data: {
      tag,
      ...entry,
      props: Object.fromEntries(
        entry.props.map((name) => [name, vocabulary.props[name]!.find((variant) => variant.tags.includes(tag))]),
      ),
    },
  };
}

export type LintReport = { path: string; diagnostics: LintDiagnostic[]; lines: string[] };

/** Checks a source against the vocabulary: props an element does not take, values an enumeration does not name. */
export function lint(target: string, projectDir?: string): LintReport {
  const { path, content } = readTarget(target, projectDir);
  const diagnostics = lintSource(path, content);
  return { path, diagnostics, lines: formatLint(diagnostics) };
}

// ---------------------------------------------------------------------------
// What changed, and who changed it

/** Where the desktop app keeps its own data — the source history lives there, outside any project. */
function userDataDir(): string {
  const name = INSTANCE_PROFILE ? `Posterract-${INSTANCE_PROFILE}` : "Posterract";
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", name);
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), name);
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), name);
}

/** The key a project's history is stored under: the same resolution the desktop's revisions.ts uses. */
function projectKey(projectDir: string): string {
  for (const file of ["posterract.json", "package.json"]) {
    try {
      const value = JSON.parse(readFileSync(join(projectDir, file), "utf8")) as { projectId?: unknown; posterract?: { projectId?: unknown } };
      const id = typeof value.projectId === "string" ? value.projectId : value.posterract?.projectId;
      if (typeof id === "string" && id) return id.replace(/[^A-Za-z0-9_-]/g, "");
    } catch {
      // No manifest here; try the next, then the index.
    }
  }
  try {
    const index = JSON.parse(readFileSync(join(userDataDir(), "revisions", "projects.json"), "utf8")) as Record<string, string>;
    const remembered = index[resolve(projectDir)];
    if (remembered) return remembered;
  } catch {
    // No index: the path-derived key below is what the app would have used.
  }
  return `dir-${createHash("sha256").update(resolve(projectDir)).digest("hex").slice(0, 24)}`;
}

const revisionOf = (content: string): string => createHash("sha256").update(content).digest("hex");

/** What a source said at `revisionId`, from the app's source history; undefined when it is not (or no longer) kept. */
function snapshotAt(projectDir: string, relativePath: string, revisionId: string): string | undefined {
  const dir = join(userDataDir(), "revisions", projectKey(projectDir), relativePath.replace(/[^A-Za-z0-9_.-]/g, "_"));
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  // Snapshot names carry the first 16 hex characters of the content's sha256.
  const name = names.find((entry) => entry.endsWith(`-${revisionId.slice(0, 16)}.snap`));
  return name ? readFileSync(join(dir, name), "utf8") : undefined;
}

type JournalEntry = { at: number; actor: string; path: string; from: string | null; to: string; note?: string };

function readJournal(projectDir: string): JournalEntry[] {
  let text: string;
  try {
    text = readFileSync(join(projectDir, ".posterract", "journal.jsonl"), "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    try {
      const entry = JSON.parse(line) as JournalEntry;
      return typeof entry.to === "string" && typeof entry.path === "string" ? [entry] : [];
    } catch {
      return [];
    }
  });
}

/** How each writer reads to an agent asking what happened while it was not looking. */
const WHO: Record<string, string> = { canvas: "person", agent: "agent", external: "file-edit", app: "app" };

export type ChangesReport = {
  path: string;
  /** Revision of the source as it is now. */
  revisionId: string;
  since: string | null;
  writes: Array<{ at: number; who: string; from: string | null; to: string; note?: string; lines: string[] }>;
  lines: string[];
};

/**
 * What changed in a project's source since `since` (a revision id an earlier
 * tool call handed out), element by element, with who made each write: the
 * person on the canvas, an agent's tool, a direct edit of the file, or the
 * app's own housekeeping. Without `since`, the last few writes.
 *
 * Read from the project's journal and the app's source history, so it answers
 * with the app closed. A revision the history no longer keeps is said to be
 * gone rather than guessed at.
 */
export function changes(projectDir: string, options: { since?: string; limit?: number } = {}): ChangesReport {
  const entry = resolveEntry(projectDir);
  if (!entry) throw new Error(`${projectDir} has no composition entry file.`);
  const current = readFileSync(join(projectDir, entry), "utf8");
  const revisionId = revisionOf(current);
  const contentAt = (revision: string | null): string | undefined =>
    revision === null ? "" : revision === revisionId ? current : snapshotAt(projectDir, entry, revision);

  const journal = readJournal(projectDir).filter((item) => item.path === entry);
  let selected = journal;
  const since = options.since ?? null;
  if (since !== null) {
    if (since === revisionId || revisionId.startsWith(since)) {
      return { path: entry, revisionId, since, writes: [], lines: ["no changes: the source is still at that revision"] };
    }
    // Everything written after the source last stood at `since`.
    const at = journal.map((item) => item.to.startsWith(since) || item.from?.startsWith(since) === true).lastIndexOf(true);
    if (at === -1) {
      const base = snapshotAt(projectDir, entry, since);
      if (base === undefined) throw new Error(`Revision ${since.slice(0, 12)}… is not in this project's journal or history; read the source again.`);
      const lines = formatDiff(diffSources(entry, base, current));
      return { path: entry, revisionId, since, writes: [], lines: ["(the journal does not cover this span, so who wrote what is not known)", ...lines] };
    }
    selected = journal.slice(journal[at]!.to.startsWith(since) ? at + 1 : at);
  } else {
    selected = journal.slice(-(options.limit ?? 8));
  }

  const writes = selected.map((item) => {
    const before = contentAt(item.from);
    const after = contentAt(item.to);
    const lines = before === undefined || after === undefined
      ? ["(that version is no longer in the history)"]
      : formatDiff(diffSources(entry, before, after));
    return { at: item.at, who: WHO[item.actor] ?? item.actor, from: item.from, to: item.to, ...(item.note ? { note: item.note } : {}), lines };
  });

  const width = Math.max(0, ...writes.map((write) => write.who.length));
  const lines = writes.flatMap((write) => [
    // What the person typed or said to the voice bar, above what it changed.
    ...(write.note && write.who === WHO.canvas ? [`${write.who.padEnd(width)}  ${write.note}`] : []),
    ...write.lines
      .filter((line) => !/^no element changed|^no changes$/.test(line) || write.note === undefined)
      .map((line) => `${write.who.padEnd(width)}  ${line}`),
  ]);
  const tally = new Map<string, number>();
  for (const write of writes) tally.set(write.who, (tally.get(write.who) ?? 0) + 1);
  const header = `${writes.length} write${writes.length === 1 ? "" : "s"}${since ? ` since ${since.slice(0, 12)}…` : ""}` +
    (writes.length ? ` (${[...tally].map(([who, count]) => `${who} ×${count}`).join(" · ")})` : "") + ` · now at ${revisionId.slice(0, 12)}…`;
  return { path: entry, revisionId, since, writes, lines: [header, ...(lines.length ? lines : ["nothing about the video changed"])] };
}

/** The element-level difference between two source files. */
export function diffFiles(before: string, after: string): { lines: string[] } {
  const a = readTarget(before);
  const b = readTarget(after);
  return { lines: formatDiff(diffSources(b.path, a.content, b.content)) };
}

/** The outline of `target` — a source file, or a project folder whose entry file is outlined. */
export function outline(target: string, projectDir?: string): OutlineReport {
  const { path, content } = readTarget(target, projectDir);
  const entries = outlineSource(path, content);
  return {
    path,
    totalLines: content.split("\n").length,
    totalChars: content.length,
    entries,
    lines: formatOutline(entries),
  };
}

// ---------------------------------------------------------------------------
// Reading one part of a source

export type ReadReport = { path: string; revisionId: string; totalLines: number; from: number; to: number; lines: string[] };

/**
 * One element of a source by its id (children included), or a range of lines —
 * with line numbers, the way a file tool shows a file, so what is read can be
 * handed straight to an edit.
 */
export function read(target: string, projectDir: string | undefined, select: { id?: string; lines?: [number, number] }): ReadReport {
  const { path, content } = readTarget(target, projectDir);
  const all = content.split("\n");
  let from = 1;
  let to = all.length;
  if (select.id !== undefined) {
    const entry = outlineSource(path, content).find((candidate) => candidate.id === select.id);
    if (!entry) throw new Error(`No element with id "${select.id}" in ${path}. \`posterract outline\` lists the ids.`);
    from = entry.line;
    to = entry.endLine;
  } else if (select.lines) {
    from = Math.max(1, Math.min(select.lines[0], all.length));
    to = Math.max(from, Math.min(select.lines[1], all.length));
  }
  const width = String(to).length;
  return {
    path,
    revisionId: revisionOf(content),
    totalLines: all.length,
    from,
    to,
    lines: all.slice(from - 1, to).map((line, index) => `${String(from + index).padStart(width)}\t${line}`),
  };
}

// ---------------------------------------------------------------------------
// Editing with the app closed

/** Folders that hold no composition source: the same ones the desktop app skips. */
const SKIPPED_FOLDERS = new Set(["node_modules", ".git", ".posterract", "exports"]);

function sourceFiles(projectDir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIPPED_FOLDERS.has(entry.name)) continue;
      const absolute = join(folder, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (SOURCE_FILE.test(entry.name) || extname(entry.name) === ".json") {
        files[relative(projectDir, absolute).split(sep).join("/")] = readFileSync(absolute, "utf8");
      }
    }
  };
  visit(projectDir);
  return files;
}

/** Keeps what a write is about to replace, where the desktop app keeps it (see its revisions.ts): same place, same names. */
function keepSnapshot(projectDir: string, relativePath: string, content: string): void {
  if (!content) return;
  const dir = join(userDataDir(), "revisions", projectKey(projectDir), relativePath.replace(/[^A-Za-z0-9_.-]/g, "_"));
  const digest = revisionOf(content).slice(0, 16);
  mkdirSync(dir, { recursive: true });
  if (readdirSync(dir).some((name) => name.endsWith(`-${digest}.snap`))) return;
  const target = join(dir, `${Date.now().toString().padStart(14, "0")}-${digest}.snap`);
  writeFileSync(`${target}.tmp`, content, { mode: 0o600 });
  renameSync(`${target}.tmp`, target);
}

/** One edit as the CLI is given it: element ids, not the addresses the writer works in. */
export type OfflineEdit =
  | { op: "set"; id: string; properties: Record<string, unknown> }
  | { op: "text"; id: string; text: string }
  | { op: "create"; parentId: string; beforeId?: string; element: OfflineTree }
  | { op: "move"; id: string; parentId: string; beforeId?: string }
  | { op: "delete"; ids: string[] };
export type OfflineTree = { tag: string; props?: Record<string, unknown>; text?: string; children?: OfflineTree[] };

export type EditReport = { written: Array<{ path: string; revisionId: string }>; skipped: string[]; lint: string[] };

/**
 * Applies edits to the project's files directly — the same writer the desktop
 * app edits with, run here because the app is not. The result is the file the
 * app would have written; what it replaced is kept where the app keeps its
 * history, and the project's journal says an agent did it, so `changes` and
 * Version History are whole when the app next opens.
 */
export async function edit(projectDir: string, edits: OfflineEdit[]): Promise<EditReport> {
  const files = sourceFiles(projectDir);
  // Which file names each id: an edit addresses an element as `file:id`.
  const home = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    if (!SOURCE_FILE.test(path)) continue;
    for (const record of readElements(path, content).records.values()) {
      if (record.named && !home.has(record.key)) home.set(record.key, path);
    }
  }
  const tags = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    if (!SOURCE_FILE.test(path)) continue;
    for (const record of readElements(path, content).records.values()) if (record.named && !tags.has(record.key)) tags.set(record.key, record.tag);
  }
  const address = (id: string): string => {
    const path = home.get(id);
    if (!path) throw new Error(`No element with id "${id}" in this project. \`posterract outline\` lists the ids.`);
    return formatSource(path, id);
  };

  // Everything is checked before anything is written, as the app does: a prop
  // nothing reads would otherwise go into the file and be reported as done.
  const problems: string[] = [];
  const warnings: string[] = [];
  const coming = new Map<string, string>();
  const noteTree = (tree: OfflineTree): void => {
    if (typeof tree.props?.id === "string") coming.set(tree.props.id, tree.tag);
    for (const child of tree.children ?? []) noteTree(child);
  };
  for (const entry of edits) {
    const found = entry.op === "set" ? checkProps(tags.get(entry.id) ?? coming.get(entry.id) ?? "", entry.id, entry.properties)
      : entry.op === "create" ? checkTree(entry.element)
        : { problems: [], warnings: [] };
    if (entry.op === "create") noteTree(entry.element);
    problems.push(...found.problems);
    warnings.push(...found.warnings);
  }
  if (problems.length) throw new Error(`${problems.join(" ")} Nothing was changed. \`posterract describe <element>\` lists what an element takes.`);

  let pending = 0;
  const sourceEdits: SourceEdit[] = [];
  /** Elements an earlier edit of this call creates, by the id it gives them: addressed by their pending name until written. */
  const made = new Map<string, string>();
  const where = (id: string): string => made.get(id) ?? address(id);
  const insert = (tree: OfflineTree, parent: string, before?: string): void => {
    const source = `pending#cli-${++pending}`;
    const { id, ...props } = (tree.props ?? {}) as Record<string, unknown>;
    if (typeof id === "string") made.set(id, source);
    sourceEdits.push({
      kind: "insert",
      source,
      parent,
      tag: tree.tag,
      props: { ...(typeof id === "string" ? { id } : {}), ...props } as never,
      ...(before ? { before } : {}),
      ...(tree.text === undefined ? {} : { text: tree.text }),
    });
    for (const child of tree.children ?? []) insert(child, source);
  };
  for (const entry of edits) {
    if (entry.op === "set") sourceEdits.push({ kind: "set", source: where(entry.id), props: entry.properties as never });
    else if (entry.op === "text") sourceEdits.push({ kind: "set", source: where(entry.id), props: {}, text: entry.text });
    else if (entry.op === "create") insert(entry.element, where(entry.parentId), entry.beforeId ? where(entry.beforeId) : undefined);
    else if (entry.op === "move") {
      sourceEdits.push({ kind: "move", source: where(entry.id), parent: where(entry.parentId), ...(entry.beforeId ? { before: where(entry.beforeId) } : {}) });
    } else for (const id of entry.ids) sourceEdits.push({ kind: "remove", source: where(id) });
  }

  // The writer updates the map it is handed, so what was there is kept apart.
  const originals = { ...files };
  const changed = new Map<string, string>();
  const result = await applyEdits({ files, onWrite: (file, content) => void changed.set(file, content) }, sourceEdits);
  if (result.error) throw new Error(result.error);

  const written: EditReport["written"] = [];
  const lint: string[] = [];
  for (const [path, content] of changed) {
    const before = originals[path] ?? "";
    if (before === content) continue;
    // An agent may not add motion the timeline cannot show (see lint.ts).
    const hidden = introducedHiddenMotion(path, before, content);
    if (hidden.length) throw new Error(hiddenMotionRefusal(hidden));
    keepSnapshot(projectDir, path, before);
    const absolute = join(projectDir, path);
    writeFileSync(`${absolute}.posterract-cli.tmp`, content);
    renameSync(`${absolute}.posterract-cli.tmp`, absolute);
    mkdirSync(join(projectDir, ".posterract"), { recursive: true });
    appendFileSync(
      join(projectDir, ".posterract", "journal.jsonl"),
      `${JSON.stringify({ at: Date.now(), actor: "agent", path, from: before ? revisionOf(before) : null, to: revisionOf(content), note: "cli, app closed" })}\n`,
    );
    written.push({ path, revisionId: revisionOf(content) });
    // What this edit brought, not what the file already had: line numbers move, the finding does not.
    const finding = (line: string): string => line.replace(/^\S*?:\d+:\d+\s+/, "");
    const had = new Set(formatLint(lintSource(path, before)).map(finding));
    lint.push(...formatLint(lintSource(path, content)).filter((line) => !had.has(finding(line))));
  }
  // A warning the edit was let through with is a lint finding of the file it produced: said once, with its line.
  return { written, skipped: result.skipped, lint: lint.length ? lint : warnings.map((warning) => `⚠ ${warning}`) };
}
