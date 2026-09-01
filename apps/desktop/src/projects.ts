import { createHash, randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import {
  cp,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { app, dialog, shell, type BrowserWindow } from "electron";
import { nanoid } from "nanoid";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  POSTERRACT_STARTER_SOURCE,
  applyEdits,
  compileVirtualProject,
  stampProject,
  type CompileDiagnostic,
  type SourceEdit,
  type WriteResult,
} from "@posterract/video-compiler";
import { MAIN_CHANNELS } from "./channels.ts";
import { emit } from "./ipc.ts";
import { migrateLegacyProject } from "./legacy-migration.ts";
import { listRevisions, readRevision, recordDeletion, snapshotBeforeWrite } from "./revisions.ts";

export type ProjectInfo = {
  id: string;
  name: string;
  displayName: string;
  dir: string;
  entry: string;
  modifiedAt: string;
  createdAt: string;
};

export type CompileResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

export type FsEntry = {
  name: string;
  kind: "file" | "directory";
  size: number;
  mtime: number;
  link?: boolean;
};

type ProjectPackage = {
  name?: string;
  projectId?: string;
  displayName?: string;
  main?: string;
  posterract?: unknown;
  diffusion?: unknown;
} & Record<string, unknown>;

type SourceWriteRequest = {
  dir: string;
  path: string;
  content: string;
  expectedRevisionId: string;
};

const SDK_VERSION = "0.201.0";
const ENTRY_FILES = ["src/index.tsx", "src/index.ts", "index.tsx", "index.ts", "index.jsx", "index.js"];
const SOURCE_FILE = /\.[cm]?[jt]sx?$/i;
const WATCH_IGNORES = new Set(["node_modules", ".git", ".posterract", "exports"]);
const ATOMIC_WRITE_TEMP = /\.posterract-[0-9a-f-]+\.tmp$/i;
const SELF_WRITE_GRACE_MS = 500;
const approvedRoots = new Set<string>();
const approvedExternalFiles = new Set<string>();
const watchers = new Map<string, { watcher: FSWatcher; windows: Set<BrowserWindow> }>();
const selfWrites = new Map<string, { writtenAt: number; revisionId: string }>();
const APPROVED_ROOTS_FILE = "projects-roots.json";

function markSelfWrite(path: string, content: string | Uint8Array, writtenAt: number): void {
  // Keep the last content hash for each destination. FSEvents can deliver a
  // coalesced rename after the short timing grace has elapsed; comparing the
  // file we read prevents that delayed self-event from becoming a reload,
  // while a genuinely different outside edit still passes through.
  selfWrites.set(path, { writtenAt, revisionId: revision(content) });
}

function approvedRootsPath(): string {
  return join(app.getPath("userData"), APPROVED_ROOTS_FILE);
}

async function persistApprovedRoots(): Promise<void> {
  const path = approvedRootsPath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, roots: [...approvedRoots] }, null, 2)}\n`);
  await rename(temporary, path);
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function canonicalExisting(path: string): Promise<string> {
  return realpath(resolve(path));
}

async function approveRoot(path: string, persist = true): Promise<string> {
  await mkdir(path, { recursive: true });
  const root = await canonicalExisting(path);
  approvedRoots.add(root);
  if (persist) await persistApprovedRoots();
  return root;
}

/**
 * Restores folder-picker approvals before the renderer can request a project
 * operation. The renderer remembers which root was last used, but it is not
 * trusted to grant filesystem access to an arbitrary path after a restart;
 * the allowlist is owned and restored by Electron's main process instead.
 */
export async function restoreApprovedRoots(): Promise<void> {
  const remembered = new Set<string>();
  try {
    const stored = JSON.parse(await readFile(approvedRootsPath(), "utf8")) as { roots?: unknown };
    if (Array.isArray(stored.roots)) {
      for (const root of stored.roots) if (typeof root === "string") remembered.add(root);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[projects] could not restore approved roots", error);
    }
  }

  // The built-in Movies/Posterract Projects location is always safe to
  // restore and also migrates installs created before the main-process
  // allowlist was persisted.
  remembered.add(join(app.getPath("videos"), "Posterract Projects"));

  for (const root of remembered) {
    try {
      await approveRoot(root, false);
    } catch (error) {
      console.warn(`[projects] could not approve ${root}`, error);
    }
  }

  await persistApprovedRoots();
}

async function requireProjectDir(path: string): Promise<string> {
  const candidate = await canonicalExisting(path);
  if (![...approvedRoots].some((root) => isInside(root, candidate))) {
    throw new Error("Project folder is outside an approved Posterract root");
  }
  return candidate;
}

async function requireApprovedRoot(path: string): Promise<string> {
  const candidate = await canonicalExisting(path);
  if (!approvedRoots.has(candidate)) {
    throw new Error("Projects root has not been approved by the user");
  }
  return candidate;
}

async function requireProjectPath(dir: string, projectPath: string, mustExist = true): Promise<string> {
  const root = await requireProjectDir(dir);
  if (isAbsolute(projectPath)) throw new Error("Project writes require a project-relative path");
  const candidate = resolve(root, projectPath);
  if (!isInside(root, candidate)) throw new Error("Project path escapes the project folder");

  if (mustExist) {
    const real = await canonicalExisting(candidate);
    if (!isInside(root, real)) throw new Error("Project path resolves outside the project folder");
    return real;
  }

  let ancestor = dirname(candidate);
  while (ancestor !== dirname(ancestor)) {
    try {
      const realAncestor = await canonicalExisting(ancestor);
      if (!isInside(root, realAncestor)) throw new Error("Project path resolves outside the project folder");
      break;
    } catch (error) {
      if (error instanceof Error && error.message.includes("outside")) throw error;
      ancestor = dirname(ancestor);
    }
  }
  return candidate;
}

function safeFolderName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 64) || "untitled-video"
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function freeProjectDir(root: string, displayName: string): Promise<string> {
  const base = safeFolderName(displayName);
  let name = base;
  for (let suffix = 2; await exists(join(root, name)); suffix += 1) name = `${base}-${suffix}`;
  return join(root, name);
}

function projectPackage(name: string, displayName: string): ProjectPackage {
  return {
    name,
    projectId: nanoid(),
    displayName,
    private: true,
    type: "module",
    main: "src/index.tsx",
    scripts: {
      open: "posterract open .",
      validate: "posterract validate",
      context: "posterract context --json",
      capture: "posterract capture main",
      export: "posterract export main --output exports/main.mp4",
    },
    posterract: {
      schemaVersion: 1,
      entry: "src/index.tsx",
      sdkVersion: SDK_VERSION,
    },
  };
}

function projectManifest(id: string, displayName: string): string {
  const now = new Date().toISOString();
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      projectId: id,
      displayName,
      entry: "src/index.tsx",
      sdkVersion: SDK_VERSION,
      createdAt: now,
      updatedAt: now,
      defaultExport: {
        width: 1080,
        height: 1920,
        frameRate: 30,
        container: "mp4",
      },
    },
    null,
    2,
  )}\n`;
}

const PROJECT_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM"],
      module: "ESNext",
      moduleResolution: "Bundler",
      jsx: "preserve",
      jsxImportSource: "@posterract/composition",
      strict: true,
      noEmit: true,
      baseUrl: ".",
      paths: {
        "@posterract/composition": [".posterract/sdk/node_modules/@posterract/composition/dist/index.d.ts"],
        "@posterract/composition/*": [".posterract/sdk/node_modules/@posterract/composition/dist/*"],
        "solid-js": [".posterract/sdk/node_modules/solid-js/types/index.d.ts"],
        "solid-js/*": [".posterract/sdk/node_modules/solid-js/types/*"],
      },
    },
    include: ["src/**/*.ts", "src/**/*.tsx", ".posterract/sdk/**/*.d.ts"],
  },
  null,
  2,
)}\n`;

const PROJECT_AGENTS = `# Posterract creative project\n\n- The canvas and timeline are generated from the local TSX source.\n- Use the registered Posterract MCP tools for live canvas context, source edits, selection, timing, captures, media inspection, and export.\n- Keep one top-level scene per independently exportable video.\n- Preserve stable element ids when editing existing elements.\n- Do not place credentials or social-network tokens in this folder.\n- Read .posterract/docs before using an unfamiliar SDK primitive.\n- For diagrams, read .posterract/docs/diagrams.md, choose the visual design from the user's meaning, and inspect captures before claiming success.\n- Begin with posterract_connection_status, posterract_get_context, and posterract_read_source.\n- Use posterract_validate and posterract_check after every meaningful edit.\n- Inspect posterract_capture image output before claiming a visual result is correct.\n- Use the posterract CLI directly only for connection diagnostics or when MCP is unavailable.\n- Export, post, or schedule only after the user explicitly asks.\n`;

const PROJECT_README = `# Posterract project\n\nThis folder is the source of truth for a local Posterract composition.\n\n- Edit \`src/index.tsx\` in your IDE or with your coding agent.\n- Connect your agent from Posterract Desktop; the app registers the local MCP server automatically.\n- Keep media under \`assets/\`, or explicitly link approved local files.\n- Use the Posterract MCP context, validation, check, and capture tools during agent work.\n- Run \`posterract doctor\` only when diagnosing the local runtime.\n- Local export never uploads automatically.\n\nThe installed SDK documentation is under \`.posterract/docs\`.\n`;

async function writeAtomic(path: string, content: string | Uint8Array): Promise<void> {
  // Preserve whatever is on disk before it is replaced. This is the single
  // choke point for both the agent's source writes and the visual editor's,
  // so every path that can destroy a composition passes through here.
  await snapshotBeforeWrite(path);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.posterract-${randomUUID()}.tmp`;
  // fs.watch reports the destination as soon as the temporary sibling is
  // created on macOS, before rename() has completed. Mark both names before
  // touching either one; marking only the destination after rename lets the
  // editor mistake its own save for an external source change and remount the
  // entire runtime document.
  const startedAt = Date.now();
  markSelfWrite(path, content, startedAt);
  await writeFile(temporary, content);
  await rename(temporary, path);
  markSelfWrite(path, content, Date.now());
}

async function stageProjectEnvironment(dir: string): Promise<void> {
  const bundledSdk = join(app.getAppPath(), "sdk");
  const sdkTarget = join(dir, ".posterract", "sdk");
  if (await exists(bundledSdk)) {
    await cp(bundledSdk, sdkTarget, { recursive: true, force: true });
  } else {
    await mkdir(sdkTarget, { recursive: true });
    await writeAtomic(
      join(sdkTarget, "README.md"),
      "The packaged desktop app stages its compatible SDK here. In a source checkout run `pnpm --filter @posterract/desktop stage:sdk`.\n",
    );
  }

  for (const folder of ["docs", "examples"] as const) {
    const bundled = join(app.getAppPath(), folder);
    if (await exists(bundled)) {
      await cp(bundled, join(dir, ".posterract", folder), { recursive: true, force: true });
    }
  }
}

async function ensureProjectGuidance(dir: string): Promise<void> {
  if (!(await exists(join(dir, "AGENTS.md")))) {
    await writeAtomic(join(dir, "AGENTS.md"), PROJECT_AGENTS);
  }
  // Some Codex workspace configurations explicitly look for this project-
  // local companion file. Keep it available so a project opened inside a
  // larger repository never falls back to unrelated parent instructions.
  if (!(await exists(join(dir, ".codex", "AGENTS.md")))) {
    await writeAtomic(join(dir, ".codex", "AGENTS.md"), PROJECT_AGENTS);
  }
  // The packaged SDK and its docs are version-matched to the desktop. Refresh
  // the app-owned project environment on every open so an existing project
  // immediately learns newly shipped primitives without touching user source.
  await stageProjectEnvironment(dir);
}

async function scaffold(dir: string, displayName: string, packageName = basename(dir)): Promise<ProjectInfo> {
  await mkdir(dir, { recursive: true });
  const pkg = projectPackage(packageName, displayName);
  await Promise.all([
    writeAtomic(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`),
    writeAtomic(join(dir, "posterract.json"), projectManifest(String(pkg.projectId), displayName)),
    writeAtomic(join(dir, "tsconfig.json"), PROJECT_TSCONFIG),
    writeAtomic(join(dir, "src", "index.tsx"), POSTERRACT_STARTER_SOURCE),
    writeAtomic(join(dir, "assets.yml"), stringifyYaml({ schemaVersion: 1, assets: [] })),
    writeAtomic(join(dir, "AGENTS.md"), PROJECT_AGENTS),
    writeAtomic(join(dir, ".codex", "AGENTS.md"), PROJECT_AGENTS),
    writeAtomic(join(dir, "README.md"), PROJECT_README),
    writeAtomic(
      join(dir, ".gitignore"),
      "node_modules/\n.posterract/cache/\n.posterract/logs/\n.posterract/runtime/\nexports/*.partial\n",
    ),
    mkdir(join(dir, "assets", "video"), { recursive: true }),
    mkdir(join(dir, "assets", "audio"), { recursive: true }),
    mkdir(join(dir, "assets", "images"), { recursive: true }),
    mkdir(join(dir, "assets", "generated"), { recursive: true }),
    mkdir(join(dir, "exports"), { recursive: true }),
    mkdir(join(dir, ".posterract", "cache"), { recursive: true }),
    mkdir(join(dir, ".posterract", "logs"), { recursive: true }),
    mkdir(join(dir, ".posterract", "migrations"), { recursive: true }),
    mkdir(join(dir, ".posterract", "docs"), { recursive: true }),
    mkdir(join(dir, ".posterract", "examples"), { recursive: true }),
  ]);
  await stageProjectEnvironment(dir);
  const project = await describe(dir);
  if (!project) throw new Error("The new Posterract project could not be initialized");
  return project;
}

async function readPackage(dir: string): Promise<ProjectPackage | null> {
  try {
    return JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as ProjectPackage;
  } catch {
    return null;
  }
}

async function entryFor(dir: string, packageValue?: ProjectPackage | null): Promise<string | null> {
  const pkg = packageValue === undefined ? await readPackage(dir) : packageValue;
  if (typeof pkg?.main === "string" && SOURCE_FILE.test(pkg.main) && (await exists(join(dir, pkg.main)))) {
    return pkg.main.split(sep).join("/");
  }
  for (const entry of ENTRY_FILES) if (await exists(join(dir, entry))) return entry;
  return null;
}

async function describe(dir: string): Promise<ProjectInfo | null> {
  const pkg = await readPackage(dir);
  const entry = await entryFor(dir, pkg);
  if (!entry) return null;
  const [folderStat, entryStat] = await Promise.all([stat(dir), stat(join(dir, entry))]);
  return {
    id: typeof pkg?.projectId === "string" ? pkg.projectId : "",
    name: basename(dir),
    displayName: typeof pkg?.displayName === "string" ? pkg.displayName : basename(dir),
    dir,
    entry,
    modifiedAt: entryStat.mtime.toISOString(),
    createdAt: folderStat.birthtime.toISOString(),
  };
}

async function sourceFiles(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const visit = async (folder: string): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.name.startsWith(".") || WATCH_IGNORES.has(entry.name)) return;
        const absolute = join(folder, entry.name);
        if (entry.isDirectory()) return visit(absolute);
        if (!SOURCE_FILE.test(entry.name) && extname(entry.name) !== ".json") return;
        const path = relative(dir, absolute).split(sep).join("/");
        files[path] = await readFile(absolute, "utf8");
      }),
    );
  };
  await visit(dir);
  return files;
}

function diagnosticMessage(diagnostics: CompileDiagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const location = diagnostic.file
        ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column ?? 1}` : ""}: `
        : "";
      return `${location}${diagnostic.message}`;
    })
    .join("\n");
}

export async function defaultRoot(): Promise<string> {
  return approveRoot(join(app.getPath("videos"), "Posterract Projects"));
}

export async function pickRoot(window: BrowserWindow | null): Promise<string | null> {
  const result = window
    ? await dialog.showOpenDialog(window, {
        title: "Choose a Posterract projects folder",
        defaultPath: app.getPath("videos"),
        properties: ["openDirectory", "createDirectory"],
      })
    : await dialog.showOpenDialog({
        title: "Choose a Posterract projects folder",
        defaultPath: app.getPath("videos"),
        properties: ["openDirectory", "createDirectory"],
      });
  const selected = result.filePaths[0];
  return result.canceled || !selected ? null : approveRoot(selected);
}

export async function listProjects(root: string): Promise<ProjectInfo[]> {
  const approved = await requireApprovedRoot(root);
  const entries = await readdir(approved, { withFileTypes: true });
  const projects = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => describe(join(approved, entry.name))),
  );
  return projects.filter((project): project is ProjectInfo => Boolean(project));
}

export async function getProject(dir: string): Promise<ProjectInfo | null> {
  return describe(await requireProjectDir(dir));
}

export async function resolveProject(root: string, ref: string): Promise<ProjectInfo | null> {
  const effectiveRoot = root === "/posterract" ? await defaultRoot() : await requireApprovedRoot(root);
  const projects = await listProjects(effectiveRoot);
  const project = projects.find((candidate) => candidate.id === ref || candidate.name === ref) ?? null;
  return project ? ensurePosterractProject(project) : null;
}

export async function createProject(root: string, displayName: string): Promise<ProjectInfo> {
  const approved = await requireApprovedRoot(root);
  const cleanName = displayName.trim().slice(0, 100) || "Untitled Video";
  const target = await freeProjectDir(approved, cleanName);
  const temporary = join(approved, `.posterract-create-${randomUUID()}`);
  try {
    await scaffold(temporary, cleanName, basename(target));
    await rename(temporary, target);
    const project = await describe(target);
    if (!project) throw new Error("The new Posterract project could not be initialized");
    return project;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function ensureDefaultProject(): Promise<ProjectInfo> {
  const root = await defaultRoot();
  const projects = await listProjects(root);
  return projects[0] ?? createProject(root, "My First Video");
}

export async function initProject(dir: string): Promise<ProjectInfo> {
  const requested = resolve(dir);
  await mkdir(requested, { recursive: true });
  let approvedDir: string;
  try {
    approvedDir = await requireProjectDir(requested);
  } catch {
    // `posterract open <path>` is an explicit same-user local action. Grant
    // only the selected project directory, never its parent or the home tree.
    approvedDir = await approveRoot(requested);
  }
  const existing = await describe(approvedDir);
  return existing ? ensurePosterractProject(existing) : scaffold(approvedDir, basename(approvedDir));
}

async function ensurePosterractProject(project: ProjectInfo): Promise<ProjectInfo> {
  await migrateLegacyProject({
    dir: project.dir,
    entry: project.entry,
    sdkVersion: SDK_VERSION,
    stageEnvironment: stageProjectEnvironment,
  });
  await ensureProjectGuidance(project.dir);
  return (await describe(project.dir)) ?? project;
}

export async function renameProject(dir: string, displayName: string): Promise<ProjectInfo> {
  const current = await requireProjectDir(dir);
  const root = dirname(current);
  const nextDisplayName = displayName.trim().slice(0, 100);
  if (!nextDisplayName) throw new Error("Project name is required");
  const next = await freeProjectDir(root, nextDisplayName);
  const pkg = (await readPackage(current)) ?? projectPackage(basename(current), nextDisplayName);
  pkg.name = basename(next);
  pkg.displayName = nextDisplayName;
  await writeAtomic(join(current, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  unwatchProject(current);
  await rename(current, next);
  return (await describe(next))!;
}

export async function duplicateProject(dir: string): Promise<ProjectInfo> {
  const source = await requireProjectDir(dir);
  const current = await describe(source);
  if (!current) throw new Error("Project not found");
  const target = await freeProjectDir(dirname(source), `${current.displayName} Copy`);
  await cp(source, target, { recursive: true, errorOnExist: true });
  const pkg = (await readPackage(target)) ?? projectPackage(basename(target), `${current.displayName} Copy`);
  pkg.projectId = nanoid();
  pkg.name = basename(target);
  pkg.displayName = `${current.displayName} Copy`;
  await writeAtomic(join(target, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  return (await describe(target))!;
}

export async function deleteProject(dir: string): Promise<void> {
  const project = await requireProjectDir(dir);
  unwatchProject(project);
  await shell.trashItem(project);
}

export async function compileProject(dir: string): Promise<CompileResult> {
  const project = await getProject(dir);
  if (!project) return { ok: false, error: "Project entry file is missing" };
  let files = await sourceFiles(project.dir);
  const original = Object.fromEntries(Object.entries(files).map(([path, content]) => [path, revision(content)]));
  const stamped = new Map<string, string>();
  await stampProject({ files, onWrite: (path, content) => stamped.set(path, content) });
  if (stamped.size) {
    for (const path of stamped.keys()) {
      const absolute = await requireProjectPath(project.dir, path);
      const current = await readFile(absolute, "utf8");
      if (revision(current) !== original[path]) {
        return { ok: false, error: `${path}: source changed while stable IDs were being stamped; retry the compile` };
      }
    }
    await Promise.all(
      [...stamped].map(async ([path, content]) => {
        const destination = await requireProjectPath(project.dir, path, false);
        await writeAtomic(destination, content);
      }),
    );
    files = await sourceFiles(project.dir);
  }
  const result = await compileVirtualProject(
    Object.entries(files).map(([path, content]) => ({ path, content })),
    project.entry,
  );
  return result.ok ? { ok: true, code: result.code } : { ok: false, error: diagnosticMessage(result.diagnostics) };
}

/**
 * Compiles the project exactly as `compileProject` would — the stable-ID
 * stamping pass included — but entirely in memory: nothing is written to
 * disk and the mounted canvas is untouched. This is the read-only path
 * behind the `validate` endpoint (the `posterract_validate` MCP tool is
 * annotated `readOnlyHint`); the editor's own loads keep `compileProject`,
 * which persists freshly minted IDs so element identity survives reloads.
 */
export async function validateProject(dir: string): Promise<CompileResult> {
  const project = await getProject(dir);
  if (!project) return { ok: false, error: "Project entry file is missing" };
  const files = await sourceFiles(project.dir);
  // `stampProject` updates the virtual `files` map in place (see the
  // writer's `save()`), so the compile below sees the stamped sources.
  await stampProject({ files });
  const result = await compileVirtualProject(
    Object.entries(files).map(([path, content]) => ({ path, content })),
    project.entry,
  );
  return result.ok ? { ok: true, code: result.code } : { ok: false, error: diagnosticMessage(result.diagnostics) };
}

export async function writeProject(dir: string, edits: SourceEdit[]): Promise<WriteResult> {
  const projectDir = await requireProjectDir(dir);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const files = await sourceFiles(projectDir);
    const original = Object.fromEntries(Object.entries(files).map(([path, content]) => [path, revision(content)]));
    const changed = new Map<string, string>();
    const result = await applyEdits({ files, onWrite: (path, content) => changed.set(path, content) }, edits);

    let conflict: string | null = null;
    for (const path of changed.keys()) {
      const destination = await requireProjectPath(projectDir, path);
      const current = await readFile(destination, "utf8");
      if (revision(current) !== original[path]) {
        conflict = path;
        break;
      }
    }
    if (conflict) {
      if (attempt === 0) continue;
      return {
        ...result,
        skipped: [...new Set([...result.skipped, ...edits.map((edit) => edit.kind === "variable" ? `${edit.file}:${edit.name}` : edit.source)])],
        error: `${conflict} changed in another editor; the visual edit was not written`,
      };
    }

    await Promise.all(
      [...changed].map(async ([path, content]) => {
        const destination = await requireProjectPath(projectDir, path, false);
        await writeAtomic(destination, content);
      }),
    );
    return result;
  }
  return { skipped: edits.map((edit) => edit.kind === "variable" ? `${edit.file}:${edit.name}` : edit.source), error: "Concurrent source edit" };
}

/**
 * Put a stored revision back on disk. The write goes through `writeAtomic`,
 * which snapshots the current content first, so restoring is itself undoable
 * and a restore of the wrong version is never a second loss.
 */
export async function restoreProjectRevision(
  dir: string,
  path: string,
  id: string,
): Promise<{ path: string; revisionId: string; diagnostics: CompileDiagnostic[] }> {
  const projectDir = await requireProjectDir(dir);
  const content = await readRevision(projectDir, path, id);
  const absolute = await requireProjectPath(projectDir, path, false);
  if (!SOURCE_FILE.test(absolute)) throw new Error("Only project source files have revisions");
  await writeAtomic(absolute, content);
  const project = await getProject(projectDir);
  if (!project) throw new Error("Project not found");
  const files = await sourceFiles(project.dir);
  const compiled = await compileVirtualProject(
    Object.entries(files).map(([file, value]) => ({ path: file, content: value })),
    project.entry,
  );
  emitProjectEvent(project.dir, path, revision(content));
  return { path, revisionId: revision(content), diagnostics: compiled.diagnostics };
}

export async function projectRevisions(dir: string, path: string) {
  return listRevisions(await requireProjectDir(dir), path);
}

export async function projectRevisionContent(dir: string, path: string, id: string): Promise<string> {
  return readRevision(await requireProjectDir(dir), path, id);
}

function revision(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Reads a project source file. `path` "auto" resolves the project's actual
 * entry file through the same `ENTRY_FILES` resolution the rest of the app
 * uses (migrated projects can keep the entry at the project root, not under
 * `src/`); the result reports the resolved path. The revision is exactly
 * sha256 of the on-disk bytes — the one revision namespace shared with
 * `context.sourceRevision`, which goes through this same function.
 */
export async function readProjectSource(dir: string, path: string): Promise<{ path: string; content: string; revisionId: string }> {
  let relativePath = path;
  if (path === "auto") {
    const entry = await entryFor(await requireProjectDir(dir));
    if (!entry) throw new Error("Project entry file is missing");
    relativePath = entry;
  }
  const absolute = await requireProjectPath(dir, relativePath);
  if (!SOURCE_FILE.test(absolute)) throw new Error("Only project source files may be opened in the source editor");
  const bytes = await readFile(absolute);
  return { path: relativePath, content: bytes.toString("utf8"), revisionId: revision(bytes) };
}

export async function writeProjectSource(request: SourceWriteRequest): Promise<{
  revisionId: string;
  content: string;
  diagnostics: CompileDiagnostic[];
}> {
  if (typeof request.content !== "string" || request.content.length > 5_000_000) {
    throw new Error("Source file is too large");
  }
  const absolute = await requireProjectPath(request.dir, request.path);
  // Compare in the same namespace `readProjectSource` hands out: sha256 of
  // the raw on-disk bytes.
  const current = await readFile(absolute);
  if (revision(current) !== request.expectedRevisionId) {
    throw new Error("This source changed on disk. Reload it before saving your edit.");
  }
  await writeAtomic(absolute, request.content);
  const project = await getProject(request.dir);
  if (!project) throw new Error("Project not found");
  const files = await sourceFiles(project.dir);
  const compiled = await compileVirtualProject(
    Object.entries(files).map(([path, content]) => ({ path, content })),
    project.entry,
  );
  emitProjectEvent(project.dir, request.path, revision(request.content));
  return {
    revisionId: revision(request.content),
    content: request.content,
    diagnostics: compiled.diagnostics,
  };
}

function emitProjectEvent(dir: string, path: string, revisionId?: string): void {
  const active = watchers.get(dir);
  if (!active) return;
  for (const window of active.windows) {
    emit(window, MAIN_CHANNELS.PROJECTS_CHANGED, { dir, path });
    if (revisionId) emit(window, MAIN_CHANNELS.PROJECTS_SOURCE_CHANGED, { dir, path, revisionId });
  }
}

export async function watchProject(window: BrowserWindow | null, dir: string): Promise<void> {
  if (!window) throw new Error("Project watcher requires an application window");
  const projectDir = await requireProjectDir(dir);
  const current = watchers.get(projectDir);
  if (current) {
    current.windows.add(window);
    return;
  }
  const windows = new Set([window]);
  const watcher = watch(projectDir, { recursive: true }, (_event, filename) => {
    const path = typeof filename === "string" ? filename.split(sep).join("/") : "";
    if (!path || path.split("/").some((part) => WATCH_IGNORES.has(part))) return;
    // Atomic-save siblings are an implementation detail, never project
    // source. macOS also emits the watched folder's own basename as a child
    // path for a root metadata change; it is not a real entry under the root.
    if (ATOMIC_WRITE_TEMP.test(path) || path === basename(projectDir)) return;
    const absolute = join(projectDir, path);
    const selfWrite = selfWrites.get(absolute);
    if (selfWrite && Date.now() - selfWrite.writtenAt < SELF_WRITE_GRACE_MS) return;
    void (async () => {
      try {
        // Recursive fs.watch also reports ancestor directories (for example
        // `src`) during an atomic child write. A directory has no project
        // content to compile, and treating EISDIR as deletion causes the same
        // false reload as the temporary file did.
        if ((await stat(absolute)).isDirectory()) return;
        const content = await readFile(absolute, "utf8");
        const revisionId = revision(content);
        const latestSelfWrite = selfWrites.get(absolute);
        if (latestSelfWrite?.revisionId === revisionId) return;
        if (latestSelfWrite) selfWrites.delete(absolute);
        emitProjectEvent(projectDir, path, SOURCE_FILE.test(path) ? revisionId : undefined);
      } catch {
        // Recheck after the awaits: a self-write can have started while this
        // event was being inspected.
        const latestWrite = selfWrites.get(absolute);
        if (
          (latestWrite && Date.now() - latestWrite.writtenAt < SELF_WRITE_GRACE_MS)
          || ATOMIC_WRITE_TEMP.test(path)
        ) return;
        if (latestWrite) selfWrites.delete(absolute);
        // Unreadable almost always means removed. The content is already held
        // by the snapshot taken before the last write; mark it so the app can
        // offer a restore instead of only reporting a missing entry file.
        void recordDeletion(projectDir, path).catch(() => undefined);
        emitProjectEvent(projectDir, path);
      }
    })();
  });
  watchers.set(projectDir, { watcher, windows });
}

export function unwatchProject(dir: string): void {
  const current = watchers.get(dir);
  current?.watcher.close();
  watchers.delete(dir);
}

export function unwatchAll(): void {
  for (const current of watchers.values()) current.watcher.close();
  watchers.clear();
}

export function grantExternalFile(path: string): void {
  if (isAbsolute(path)) approvedExternalFiles.add(resolve(path));
}

export async function isApprovedReadableFile(path: string): Promise<boolean> {
  if (!isAbsolute(path)) return false;
  try {
    const candidate = await canonicalExisting(path);
    if (approvedExternalFiles.has(resolve(path)) || approvedExternalFiles.has(candidate)) return true;
    return [...approvedRoots].some((root) => isInside(root, candidate));
  } catch {
    return false;
  }
}

async function readableAssetPath(dir: string, source: string): Promise<string> {
  if (!isAbsolute(source)) return requireProjectPath(dir, source);
  const resolved = resolve(source);
  const candidate = await canonicalExisting(resolved);
  const projectDir = await requireProjectDir(dir);
  if (!isInside(projectDir, candidate) && !approvedExternalFiles.has(resolved) && !approvedExternalFiles.has(candidate)) {
    throw new Error("External media has not been approved by the user");
  }
  return candidate;
}

export async function listEntries(dir: string, source: string): Promise<FsEntry[]> {
  const folder = await readableAssetPath(dir, source || ".");
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ProjectFS.list is also used to distinguish a normal file from an image
    // sequence directory. A file (or a path that disappeared during a scan)
    // is therefore an empty listing, not a fatal directory-read error.
    if (code === "ENOTDIR" || code === "ENOENT") return [];
    throw error;
  }
  return Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map(async (entry) => {
        const details = await stat(join(folder, entry.name));
        return {
          name: entry.name,
          kind: details.isDirectory() ? "directory" : "file",
          size: details.size,
          mtime: details.mtimeMs,
          ...(entry.isSymbolicLink() ? { link: true } : {}),
        } satisfies FsEntry;
      }),
  );
}

export async function statEntry(dir: string, source: string): Promise<{ size: number; mtime: number } | null> {
  try {
    const details = await stat(await readableAssetPath(dir, source));
    return { size: details.size, mtime: details.mtimeMs };
  } catch {
    return null;
  }
}

export async function removeEntry(dir: string, path: string): Promise<void> {
  const absolute = await requireProjectPath(dir, path);
  await rm(absolute, { recursive: true, force: false });
}

export async function realPathEntry(dir: string, source: string): Promise<string | null> {
  try {
    return await readableAssetPath(dir, source);
  } catch {
    return null;
  }
}

export async function readManifest(dir: string): Promise<unknown> {
  try {
    return parseYaml(await readFile(await requireProjectPath(dir, "assets.yml"), "utf8"));
  } catch {
    return null;
  }
}

export async function writeManifest(dir: string, manifest: unknown): Promise<void> {
  const path = await requireProjectPath(dir, "assets.yml", false);
  await writeAtomic(path, stringifyYaml(manifest));
}

export async function readConfig(dir: string): Promise<unknown> {
  const pkg = await readPackage(await requireProjectDir(dir));
  return pkg?.posterract ?? null;
}

export async function writeConfig(dir: string, config: unknown): Promise<void> {
  const projectDir = await requireProjectDir(dir);
  const pkg = (await readPackage(projectDir)) ?? {};
  if (config === null) delete pkg.posterract;
  else pkg.posterract = config;
  await writeAtomic(join(projectDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
}

export async function writeProjectAsset(dir: string, path: string, bytes: Uint8Array): Promise<void> {
  const absolute = await requireProjectPath(dir, path, false);
  await writeAtomic(absolute, bytes);
}

/**
 * Copies approved local media into a project without routing the complete
 * file through Electron's renderer process. The temporary sibling prevents a
 * failed copy from leaving a partial asset at the final path.
 */
export async function copyProjectAsset(dir: string, source: string, path: string): Promise<void> {
  const input = await readableAssetPath(dir, source);
  const output = await requireProjectPath(dir, path, false);
  const temporary = `${output}.${randomUUID()}.import`;
  await mkdir(dirname(output), { recursive: true });
  try {
    await copyFile(input, temporary);
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function assetFile(dir: string, source: string): Promise<{ path: string; name: string; mimeType: string; mtime: number }> {
  const path = await readableAssetPath(dir, source);
  const details = await stat(path);
  if (!details.isFile()) throw new Error("Asset is not a file");
  return { path, name: basename(path), mimeType: mimeType(path), mtime: details.mtimeMs };
}

function mimeType(path: string): string {
  const extension = extname(path).toLowerCase();
  return (
    {
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".webm": "video/webm",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".m4a": "audio/mp4",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".json": "application/json",
      ".txt": "text/plain",
    }[extension] ?? "application/octet-stream"
  );
}
