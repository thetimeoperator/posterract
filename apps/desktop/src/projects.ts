import { execFile } from "node:child_process";
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
  formatOutline,
  diffSources,
  hasViewState,
  lintProject,
  lintSource,
  outlineSource,
  patchSources,
  prepareProject,
  stampProject,
  type CompileDiagnostic,
  type LintDiagnostic,
  type SourcePatch,
  type SourceEdit,
  type WriteResult,
} from "@posterract/video-compiler";
import { MAIN_CHANNELS } from "./channels.ts";
import { emit } from "./ipc.ts";
import { extractElementSource, locateElement } from "./element-source.ts";
import { migrateLegacyProject } from "./legacy-migration.ts";
import { appendJournal, type JournalActor } from "./journal.ts";
import { listRevisions, readRevision, readRevisionByHash, recordDeletion, snapshotBeforeWrite, snapshotContent } from "./revisions.ts";
import { readViewStateFile, seedViewStateFile, writeViewStateFile, type ViewState } from "./view-state.ts";

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
  /** `revisions`: what each source said when this was compiled — what a canvas mounting `code` is showing. */
  | { ok: true; code: string; revisions?: Record<string, string> }
  | { ok: false; error: string };

/** The revision of every source file in a project's file map. */
const sourceRevisions = (files: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(files).filter(([path]) => SOURCE_FILE.test(path)).map(([path, content]) => [path, revision(content)]));

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
  /** Who is writing, for the journal (see ./journal.ts). The person, unless said otherwise. */
  actor?: JournalActor;
};

/**
 * What each source said when the app last read or wrote it, by absolute path.
 * A write the app makes snapshots the file just before replacing it; a write
 * made behind its back — an agent's file tools, an IDE — leaves no such
 * moment, and this is what lets the version it replaced reach the history
 * anyway (see the watcher).
 */
const lastSeen = new Map<string, string>();
/**
 * What the latest outside write to each source replaced: the version a canvas
 * was showing when the file changed under it, kept at hand so a patch can be
 * made from it without waiting on the history store (see `projectSourcePatch`).
 */
const lastSeenBefore = new Map<string, string>();

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
/** A second look at a path whose change arrived too close to one of the app's own writes to call (see the watcher). */
const rechecks = new Map<string, ReturnType<typeof setTimeout>>();
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

export async function requireProjectDir(path: string): Promise<string> {
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

export async function requireProjectPath(dir: string, projectPath: string, mustExist = true): Promise<string> {
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

/** First line of every app-written guidance file; remove it to take ownership. */
const MANAGED_MARK = "<!-- posterract-managed";

// Short on purpose: this is read into the agent's context at the start of
// every session, so it carries the one rule that matters and the order of
// operations, and points at the docs and the skill for everything else.
const PROJECT_AGENTS = `${MANAGED_MARK}: rewritten by Posterract Desktop on open; delete this line to own the file -->\n# Posterract project\n\nPosterract Desktop renders this folder's TSX as the canvas and timeline and exposes it over the \`posterract\` MCP server.\n\n**File-first.** The TSX is the document: edit it with your own file tools (read a range, search, replace a string), the way you edit any code. Desktop watches the file and shows the change on the canvas: a change to values or text in place, as one step of the user's undo history (Cmd+Z takes it back); added, removed or moved elements by reloading the canvas, which keeps the user's own undo steps. Every version you replace is kept in Version History. Give each element you add an \`id\`. Before you write, run \`posterract changes --since <revisionId>\` (or \`posterract_changes\`) to see what the user changed since you last looked, and work around it rather than over it. The semantic tools (\`posterract_set_properties\`, \`posterract_set_text\`, \`posterract_create_element\`, ...) still work and answer with the revision they produced. If the \`posterract_*\` tools are missing, the \`posterract\` CLI does the same; otherwise ask the user to restart the agent session.\n\n**Order:** \`posterract_look\` (what the author has selected, their playhead, their \`@agent\` notes) -> \`posterract_outline\` -> \`posterract_read_source\` with \`id\` or \`lines\` (never the whole file) -> edit -> \`posterract_inspect\` (facts, then problems with fixes: fix every ✗) -> repeat -> \`posterract_capture\` only at the end, to judge taste -> \`posterract_show\` what you changed. \`posterract_describe\` lists every element and prop: ask it instead of guessing a name.\n\n**Say it, do not compute it.** Put things where they belong with \`place\` (\`place=\"lower-third\"\`, \`place=\"bottom-right\" inset={48}\`) rather than working out \`x\`/\`y\`. Anything that keeps moving is a few keyframes and \`loop\` on the \`<keyframeTrack>\` (\`loop=\"pingpong\"\` for there and back), never a keyframe per change of direction. Tune a preset \`<animation>\` with \`distance\`, \`amount\` and \`easing\` before writing keyframes by hand. \`.posterract/docs/elements.md\` and \`keyframes-animations-transitions.md\` have the details.\n\n**You hear what you broke.** After the source changes, the next \`posterract\` tool or command you run — any of them, from any agent — comes back with what is newly wrong attached (a prop nothing reads, text off the frame, with the fix), each problem once. Fix it when you hear it; \`posterract inspect\` lists everything still open.\n\n**The app does not have to be open.** \`posterract inspect\`, \`geometry\`, \`validate\`, \`capture\` and \`render -o exports/<name>.mp4\` start the engine (the app with no window) for themselves when it is closed; \`render --from 2 --to 5 --scale 0.5\` is a quick look at a change.\n\n**Skills:** a scene may declare \`skill="<name>"\`, the skill folder (SKILL.md plus assets) it is made with. \`posterract_get_context\` reports it with the folder path; read that SKILL.md before editing the scene and follow its workflow.\n\n**Rules:** one top-level scene per exportable video; keep stable element ids; no credentials in this folder; export, post, or schedule only when the user asks.\n`;

/** Guidance earlier desktop versions wrote; a file still equal to one of these is app-owned and safe to refresh. */
const LEGACY_PROJECT_AGENTS_2 = `# Posterract creative project\n\n- The canvas and timeline are generated from the local TSX source.\n- Keep one top-level scene per independently exportable video.\n- Preserve stable element ids when editing existing elements.\n- Do not place credentials or social-network tokens in this folder.\n- Read .posterract/docs before using an unfamiliar SDK primitive.\n- For diagrams, read .posterract/docs/diagrams.md, choose the visual design from the user's meaning, and inspect captures before claiming success.\n- Run posterract doctor --json before beginning local agent work.\n- Run posterract context --json --tree to inspect the active project and runtime.\n- Run posterract validate and posterract check after every meaningful edit.\n- Inspect posterract capture output before claiming a visual result is correct.\n- Export, post, or schedule only after the user explicitly asks.\n`;
const LEGACY_PROJECT_AGENTS = `# Posterract creative project\n\n- The canvas and timeline are generated from the local TSX source.\n- Use the registered Posterract MCP tools for live canvas context, source edits, selection, timing, captures, media inspection, and export.\n- Keep one top-level scene per independently exportable video.\n- Preserve stable element ids when editing existing elements.\n- Do not place credentials or social-network tokens in this folder.\n- Read .posterract/docs before using an unfamiliar SDK primitive.\n- For diagrams, read .posterract/docs/diagrams.md, choose the visual design from the user's meaning, and inspect captures before claiming success.\n- Begin with posterract_connection_status, posterract_get_context, and posterract_read_source.\n- Use posterract_validate and posterract_check after every meaningful edit.\n- Inspect posterract_capture image output before claiming a visual result is correct.\n- Use the posterract CLI directly only for connection diagnostics or when MCP is unavailable.\n- Export, post, or schedule only after the user explicitly asks.\n`;

const PROJECT_CLAUDE = PROJECT_AGENTS;
const PROJECT_CURSOR_RULES = `---\ndescription: Posterract composition editing rules\nalwaysApply: true\n---\n${PROJECT_AGENTS}`;

/**
 * Project-scoped Claude Code hooks.
 *
 * The app used to *block* an agent's Edit/Write of the composition while
 * Desktop had the project open, because a change made to the file meant a
 * remount and a lost undo history. A file edit is now shown on the canvas in
 * place, as one step of that history (see the editor's hot-reload), so the
 * file is the agent's to edit — and what it needs instead of a gate is
 * feedback. After every Edit or Write of a composition source, the hook below
 * runs the vocabulary lint and, when Desktop is showing the project, `inspect`,
 * and hands back whatever is wrong: the agent hears that its caption runs 47px
 * off the frame without asking, the way a type-checker speaks up on save.
 *
 * The scripts are app-owned and refreshed on every open, like the docs. The
 * settings file is the user's once they touch it; one that still says exactly
 * what an earlier version wrote is brought up to date.
 */
const claudeSettings = (hooks: Record<string, unknown>): string => `${JSON.stringify({ hooks }, null, 2)}\n`;

const PROJECT_CLAUDE_SETTINGS = claudeSettings({
  PostToolUse: [
    {
      matcher: "Edit|Write|MultiEdit",
      hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.posterract/hooks/feedback.mjs"', timeout: 40 }],
    },
  ],
});

/** What earlier versions wrote: the blocking guard. Still equal to this means nobody made it theirs. */
const LEGACY_PROJECT_CLAUDE_SETTINGS = claudeSettings({
  PreToolUse: [
    {
      matcher: "Edit|Write|MultiEdit",
      hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.posterract/hooks/guard-source.mjs"' }],
    },
  ],
});

/**
 * A settings file the user has made their own may still name this script as a
 * PreToolUse hook. It no longer has anything to object to, so it lets every
 * edit through; the file stays so that such a settings file does not fail.
 */
const PROJECT_GUARD_HOOK = `// Posterract Desktop (app-owned; refreshed on every project open).
// This used to keep composition edits off the file while Desktop had the
// project open. File edits are now shown on the canvas in place and keep the
// user's undo history, so there is nothing left to guard: every edit is allowed.
// Feedback after an edit comes from feedback.mjs (a PostToolUse hook).
process.exit(0);
`;

const PROJECT_FEEDBACK_HOOK = `// Posterract Desktop feedback (app-owned; refreshed on every project open).
// Runs after an agent's Edit/Write of a composition source and hands back what
// is wrong with it: props the editor does not understand, text running off the
// frame, elements nobody can see. Says nothing when nothing is wrong, and never
// fails an edit over a problem of its own.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}
const filePath = payload?.tool_input?.file_path;
if (typeof filePath !== "string") process.exit(0);

const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const absolute = resolve(project, filePath);
const target = relative(project, absolute).split(sep).join("/");
const isSource = /\\.[cm]?[jt]sx$/i.test(target) && !target.startsWith("..") &&
  !target.split("/").some((part) => part.startsWith(".") || part === "node_modules");
if (!isSource || !existsSync(absolute)) process.exit(0);

const run = (args, timeout) => spawnSync("posterract", args, { encoding: "utf8", timeout, cwd: project });
const SIGN = /^\\s*[\\u2717\\u26a0]/;
/** Everything wrong right now: { key, group, text }. The key leaves out what an unrelated edit moves (line numbers). */
const items = [];

// 1. The vocabulary: works with the app closed.
const lint = run(["lint", target, "--project", project], 15000);
if (lint.error) process.exit(0); // No posterract on PATH: nothing to say.
// Only real findings: an older CLI that has no \`lint\` also exits 1, with nothing to report.
for (const line of lint.status === 1 ? (lint.stdout || "").split("\\n") : []) {
  if (!/[\\u2717\\u26a0]/.test(line)) continue;
  items.push({ key: "lint " + line.replace(/^\\S*?:\\d+:\\d+\\s+/, ""), group: "", text: line.trim() });
}

// 2. The video itself, when Desktop is showing this project. The canvas takes a
//    moment to show a change made to the file; wait until it says it has.
let live = false;
try {
  const session = JSON.parse(readFileSync(resolve(project, ".posterract", "runtime", "session.json"), "utf8"));
  live = typeof session.heartbeatAt === "number" && Date.now() - session.heartbeatAt < 60000;
} catch {
  live = false;
}
let inspected = false;
if (live) {
  const revision = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  const deadline = Date.now() + 5000;
  let caughtUp = false;
  while (Date.now() < deadline && !caughtUp) {
    const context = run(["context", "--json"], 4000);
    try {
      const state = JSON.parse(context.stdout);
      // Another write landed meanwhile: that one's hook will speak for it.
      if (state.sourceRevision && state.sourceRevision !== revision) process.exit(0);
      caughtUp = state.shownRevision === revision;
    } catch {
      break;
    }
    if (!caughtUp) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  if (caughtUp) {
    const inspect = run(["inspect", "--all", "--problems"], 30000);
    // One block per scene: its verdict, then PROBLEMS, then a line per problem with its fix under it.
    for (const block of (inspect.stdout || "").trim().split(/\\n\\s*\\n/)) {
      const lines = block.split("\\n");
      const from = lines.indexOf("PROBLEMS");
      if (from < 1) continue;
      inspected = true;
      const scene = (lines[0].match(/scene#(\\S+)/) || [])[1] || lines[0];
      for (let index = from + 1; index < lines.length; index += 1) {
        if (!SIGN.test(lines[index])) continue;
        const fix = /^\\s*fix:/.test(lines[index + 1] || "") ? "\\n" + lines[index + 1] : "";
        items.push({ key: "inspect " + scene + " " + lines[index].trim(), group: lines[0], text: lines[index] + fix });
      }
    }
  }
}

// 3. Say each thing once per agent session. A problem the agent has been told
//    about and has not touched is not news after its next edit; one it fixed
//    and brought back is.
const seenPath = resolve(project, ".posterract", "cache", "feedback-seen.json");
const agentSession = typeof payload.session_id === "string" ? payload.session_id : "";
let seen = [];
try {
  const stored = JSON.parse(readFileSync(seenPath, "utf8"));
  if (stored.session === agentSession && Array.isArray(stored.keys)) seen = stored.keys;
} catch {
  seen = [];
}
const fresh = items.filter((item) => !seen.includes(item.key));
// What was not looked at this time is still whatever it was.
const kept = inspected ? [] : seen.filter((key) => key.startsWith("inspect "));
try {
  mkdirSync(dirname(seenPath), { recursive: true });
  writeFileSync(seenPath, JSON.stringify({ session: agentSession, keys: [...new Set([...kept, ...items.map((item) => item.key)])] }));
} catch {
  // Forgetting only means saying something twice.
}

if (!fresh.length) process.exit(0);
const report = [];
for (const item of fresh) {
  if (item.group && !report.includes(item.group)) report.push("", item.group);
  report.push(item.text);
}
const old = items.length - fresh.length;
process.stderr.write(
  "Posterract checked " + target + " after your edit:\\n\\n" + report.join("\\n").trim() + "\\n" +
    (old ? "\\n(" + old + " more you were already told about " + (old === 1 ? "is" : "are") + " still open: posterract inspect --all --problems)\\n" : "") +
    "\\nFix every \\u2717 before moving on; judge every \\u26a0. Run posterract inspect again to confirm.\\n",
);
process.exit(2);
`;

const PROJECT_README = `# Posterract project\n\nThis folder is the source of truth for a local Posterract composition.\n\n- Edit \`src/index.tsx\` in your IDE or with your coding agent.\n- Connect your agent from Posterract Desktop; the app registers the local MCP server automatically.\n- Keep media under \`assets/\`, or explicitly link approved local files.\n- Use the Posterract MCP context, validation, check, and capture tools during agent work.\n- Run \`posterract doctor\` only when diagnosing the local runtime.\n- Local export never uploads automatically.\n\nThe installed SDK documentation is under \`.posterract/docs\`.\n`;

/** Thrown by `writeAtomic` when the file is no longer the revision the caller built its content on. */
class StaleWrite extends Error {}

/**
 * `expected`, when given, is the revision the new content was made from. It is
 * checked again at the last moment — with the new content already on disk under
 * its temporary name, one `rename` from landing — because a check made before
 * the write leaves room for someone else's write in between, and this one would
 * then replace theirs with content that never saw it.
 */
async function writeAtomic(path: string, content: string | Uint8Array, expected?: string): Promise<void> {
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
  if (expected !== undefined) {
    const standing = await readFile(path).then(revision, () => null);
    if (standing !== expected) {
      await rm(temporary, { force: true });
      selfWrites.delete(path);
      throw new StaleWrite(path);
    }
  }
  await rename(temporary, path);
  markSelfWrite(path, content, Date.now());
  if (typeof content === "string" && SOURCE_FILE.test(path)) lastSeen.set(path, content);
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

/**
 * Write a guidance file the app keeps current. It stays app-owned while its
 * first line is the managed marker (or while it still equals the text an
 * earlier version wrote); once the user changes it, it is theirs and is left
 * alone.
 */
async function writeManagedGuidance(path: string, content: string): Promise<void> {
  if (await exists(path)) {
    const current = await readFile(path, "utf8").catch(() => null);
    if (current === null || current === content) return;
    const legacy = current === LEGACY_PROJECT_AGENTS || current === LEGACY_PROJECT_AGENTS_2;
    if (!current.startsWith(MANAGED_MARK) && !legacy) return;
  }
  await writeAtomic(path, content);
}

async function ensureProjectGuidance(dir: string): Promise<void> {
  // One file per agent family, each in the place that agent reads on start:
  // Codex reads AGENTS.md, Claude Code reads CLAUDE.md, Cursor its rules dir.
  await writeManagedGuidance(join(dir, "AGENTS.md"), PROJECT_AGENTS);
  await writeManagedGuidance(join(dir, "CLAUDE.md"), PROJECT_CLAUDE);
  await writeManagedGuidance(join(dir, ".cursor", "rules", "posterract.mdc"), PROJECT_CURSOR_RULES);
  // Some Codex workspace configurations explicitly look for this project-
  // local companion file. Keep it available so a project opened inside a
  // larger repository never falls back to unrelated parent instructions.
  await writeManagedGuidance(join(dir, ".codex", "AGENTS.md"), PROJECT_AGENTS);
  // Claude Code settings may carry the user's own hooks and permissions, so
  // they are only ever created, never rewritten.
  const settingsPath = join(dir, ".claude", "settings.json");
  const settings = await readFile(settingsPath, "utf8").catch(() => null);
  // Created when missing; brought up to date while it still says exactly what
  // an earlier version wrote (the blocking guard); otherwise the user's.
  if (settings === null || settings === LEGACY_PROJECT_CLAUDE_SETTINGS) {
    await writeAtomic(settingsPath, PROJECT_CLAUDE_SETTINGS);
  }
  // The hook scripts are app-owned, so they follow the app version.
  await writeAtomic(join(dir, ".posterract", "hooks", "guard-source.mjs"), PROJECT_GUARD_HOOK);
  await writeAtomic(join(dir, ".posterract", "hooks", "feedback.mjs"), PROJECT_FEEDBACK_HOOK);
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
    writeAtomic(join(dir, "CLAUDE.md"), PROJECT_CLAUDE),
    writeAtomic(join(dir, ".cursor", "rules", "posterract.mdc"), PROJECT_CURSOR_RULES),
    writeAtomic(join(dir, ".claude", "settings.json"), PROJECT_CLAUDE_SETTINGS),
    writeAtomic(join(dir, ".posterract", "hooks", "guard-source.mjs"), PROJECT_GUARD_HOOK),
    writeAtomic(join(dir, ".posterract", "hooks", "feedback.mjs"), PROJECT_FEEDBACK_HOOK),
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
        if (SOURCE_FILE.test(entry.name)) lastSeen.set(absolute, files[path]!);
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
  // Ids are stamped, and in the same write any editor view state an older
  // source still carries (`selected`, `active`, `camera`, ...) is lifted out
  // of it: the view lives in the sidecar now, so a click is no longer a
  // revision of the document (see ./view-state.ts).
  const lifted = await prepareProject({ files, onWrite: (path, content) => stamped.set(path, content) });
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
        await appendJournal(project.dir, {
          at: Date.now(),
          actor: "app",
          path,
          from: original[path] ?? null,
          to: revision(content),
          note: "named elements and lifted editor view state; the video itself is unchanged",
        });
      }),
    );
    files = await sourceFiles(project.dir);
    // Carried over once: a project that already has a sidecar keeps it. Losing
    // this costs a selection and a zoom level, never the compile.
    if (hasViewState(lifted)) await seedViewStateFile(project.dir, lifted).catch(() => false);
  }
  const result = await compileVirtualProject(
    Object.entries(files).map(([path, content]) => ({ path, content })),
    project.entry,
  );
  return result.ok
    ? { ok: true, code: result.code, revisions: sourceRevisions(files) }
    : { ok: false, error: diagnosticMessage(result.diagnostics) };
}

/**
 * What a canvas showing `fromRevision` of a source has to do to show what is
 * on disk now, when that can be said exactly (see the compiler's patch.ts) —
 * or why it cannot, in which case the caller mounts the file again as it
 * always has. This is what lets an edit made to the file, by an agent's file
 * tools or an IDE, reach the canvas as the small change it is: no remount, no
 * lost undo history.
 *
 * The base is what the canvas says it is showing, never what the app assumes:
 * it is looked up in the source history by that revision, and a revision the
 * history does not hold is a reason to remount, not to guess.
 */
export async function projectSourcePatch(
  dir: string,
  path: string,
  fromRevision: string,
): Promise<{ revisionId: string; patch: SourcePatch }> {
  const projectDir = await requireProjectDir(dir);
  const absolute = await requireProjectPath(projectDir, path);
  if (!SOURCE_FILE.test(absolute)) throw new Error("Only project source files can be patched");
  const bytes = await readFile(absolute);
  const revisionId = revision(bytes);
  if (revisionId === fromRevision) return { revisionId, patch: { ok: true, ops: [] } };

  const held = lastSeenBefore.get(absolute);
  const base = held && revision(held) === fromRevision ? held : await readRevisionByHash(projectDir, path, fromRevision);
  if (base === null || base === undefined) {
    return { revisionId, patch: { ok: false, reason: "the version the canvas is showing is no longer in the history" } };
  }
  return { revisionId, patch: patchSources(path, base, bytes.toString("utf8")) };
}

/**
 * Which of `ids` someone else has changed since the caller last saw the source
 * at `fromRevision` — the conflict check of an edit that is about one element.
 *
 * A whole-file revision check ("the file changed, read it again") fails an
 * agent's edit of a caption because the person nudged a clip at the other end
 * of the timeline, which is no conflict at all. What matters is whether the
 * element the edit is about is still what the agent thinks it is: if nobody
 * touched it, the edit goes ahead on top of whatever else changed; if somebody
 * did, the agent is told what they changed, so it can decide again knowing it.
 *
 * `known: false` when the revision is not one the history holds: nothing can
 * be said, and the caller must not take that for "untouched".
 */
export async function projectSourceTouched(
  dir: string,
  path: string,
  fromRevision: string,
  ids: string[],
): Promise<{ revisionId: string; known: boolean; touched: Array<{ id: string; changes: string[] }> }> {
  const projectDir = await requireProjectDir(dir);
  if (path === "auto") {
    const entry = await entryFor(projectDir);
    if (!entry) throw new Error("Project entry file is missing");
    path = entry;
  }
  const absolute = await requireProjectPath(projectDir, path);
  const bytes = await readFile(absolute);
  const revisionId = revision(bytes);
  if (revisionId === fromRevision) return { revisionId, known: true, touched: [] };

  const held = lastSeenBefore.get(absolute);
  const base = held && revision(held) === fromRevision ? held : await readRevisionByHash(projectDir, path, fromRevision);
  if (base === null || base === undefined) return { revisionId, known: false, touched: [] };

  const diff = diffSources(path, base, bytes.toString("utf8"));
  const wanted = new Set(ids);
  const touched = new Map<string, string[]>();
  const note = (id: string, what: string): void => {
    if (wanted.has(id)) touched.set(id, [...(touched.get(id) ?? []), what]);
  };
  for (const change of diff.changes) {
    if (change.kind === "prop") note(change.id, `${change.name}: ${change.before ?? "(unset)"} → ${change.after ?? "(unset)"}`);
    else if (change.kind === "text") note(change.id, `says: "${change.before}" → "${change.after}"`);
    else if (change.kind === "moved") note(change.id, `moved from #${change.from ?? "?"} to #${change.to ?? "?"}`);
    else note(change.id, change.kind);
  }
  for (const motion of diff.motion) note(motion.id, "its keyframes or animations changed");
  return { revisionId, known: true, touched: [...touched].map(([id, changes]) => ({ id, changes })) };
}

/** Where the author is looking in this project, or null before anything was remembered. */
export async function readProjectViewState(dir: string): Promise<ViewState | null> {
  return readViewStateFile(await requireProjectDir(dir));
}

/**
 * Remembers where the author is looking. Pinned to one fixed path, like the
 * undo cache, so this cannot become a general write primitive for the
 * renderer; the folder it lives in is ignored by the project watcher, so
 * writing it never reloads the canvas.
 */
export async function writeProjectViewState(dir: string, value: unknown): Promise<void> {
  await writeViewStateFile(await requireProjectDir(dir), value);
}

/**
 * Compiles the project exactly as `compileProject` would — the stable-ID
 * stamping pass included — but entirely in memory: nothing is written to
 * disk and the mounted canvas is untouched. This is the read-only path
 * behind the `validate` endpoint (the `posterract_validate` MCP tool is
 * annotated `readOnlyHint`); the editor's own loads keep `compileProject`,
 * which persists freshly minted IDs so element identity survives reloads.
 */
export async function validateProject(dir: string): Promise<CompileResult & { lint: LintDiagnostic[] }> {
  const project = await getProject(dir);
  if (!project) return { ok: false, error: "Project entry file is missing", lint: [] };
  const files = await sourceFiles(project.dir);
  // Compiling proves the source is a program; it says nothing about whether
  // the editor understands it, because no type-checker runs and the runtime
  // ignores a prop it does not know. The lint is that second half (see the
  // compiler's lint.ts). Read before stamping, so its line numbers are the
  // file's own.
  const lint = lintProject(files);
  // `stampProject` updates the virtual `files` map in place (see the
  // writer's `save()`), so the compile below sees the stamped sources.
  await stampProject({ files });
  const result = await compileVirtualProject(
    Object.entries(files).map(([path, content]) => ({ path, content })),
    project.entry,
  );
  return result.ok
    ? { ok: true, code: result.code, lint }
    : { ok: false, error: diagnosticMessage(result.diagnostics), lint };
}

/** What a write came to, plus which revision each file stood at before and after it (see `writeProject`). */
export type ProjectWriteResult = WriteResult & { revisions?: Record<string, string>; bases?: Record<string, string> };

/**
 * How often a canvas write starts over when the file changes underneath it.
 *
 * The edits are addressed by element id, so applying them to whatever the file
 * says now is always right: a retry is a rebase, never a guess. What has to be
 * avoided is giving up, because a write that gives up leaves the person's edit
 * on the canvas and out of the file. With an agent editing the same file that
 * is no corner case — each attempt takes as long as parsing the source, and an
 * agent's burst of edits can land inside two of them in a row, which is all the
 * old limit of two allowed. Eight, spaced out, outlasts any burst a tool makes.
 */
const WRITE_ATTEMPTS = 8;

export async function writeProject(dir: string, edits: SourceEdit[], actor: JournalActor = "canvas", note?: string): Promise<ProjectWriteResult> {
  const projectDir = await requireProjectDir(dir);
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    // Out of step with whoever else is writing: they rarely write twice in the same stride.
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** Math.min(attempt, 4) + Math.random() * 40));
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
      if (attempt < WRITE_ATTEMPTS - 1) continue;
      return {
        ...result,
        skipped: [...new Set([...result.skipped, ...edits.map((edit) => edit.kind === "variable" ? `${edit.file}:${edit.name}` : edit.source)])],
        error: `${conflict} changed in another editor; the visual edit was not written`,
      };
    }

    let landed = 0;
    try {
      // One file after another, so that a write found stale stops the rest.
      for (const [path, content] of changed) {
        const destination = await requireProjectPath(projectDir, path, false);
        await writeAtomic(destination, content, original[path]);
        landed += 1;
        await appendJournal(projectDir, { at: Date.now(), actor, path, from: original[path] ?? null, to: revision(content), ...(note ? { note } : {}) });
      }
    } catch (error) {
      if (!(error instanceof StaleWrite)) throw error;
      // Starting over applies every edit again, which is only right while none
      // of them is on disk yet: an insert applied twice is two elements.
      if (landed === 0 && attempt < WRITE_ATTEMPTS - 1) continue;
      return {
        ...result,
        skipped: [...new Set([...result.skipped, ...edits.map((edit) => edit.kind === "variable" ? `${edit.file}:${edit.name}` : edit.source)])],
        error: "The source kept changing in another editor; the visual edit was not written",
      };
    }
    // The canvas already shows these edits; this is how it learns which
    // revision of each file it is now showing. `bases` is what each file said
    // when the edits were applied to it: if that is not the revision the
    // canvas thought it was showing, someone else's change lies underneath
    // this write, and the canvas is still owed it.
    return {
      ...result,
      revisions: Object.fromEntries([...changed].map(([path, content]) => [path, revision(content)])),
      bases: Object.fromEntries([...changed.keys()].map((path) => [path, original[path] ?? ""])),
    };
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
  const replaced = await readFile(absolute).then(revision, () => null);
  await writeAtomic(absolute, content);
  await appendJournal(projectDir, { at: Date.now(), actor: "app", path, from: replaced, to: revision(content), note: "restored an earlier version" });
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

/**
 * The editor's undo stack, kept beside the project so undo survives a reload.
 *
 * It is cache, not document: a stack recorded against a different revision of
 * the source cannot be replayed onto it, so the caller stores the revision it
 * belongs to and discards the file when they disagree. Pinned to one fixed
 * path so this cannot become a general write primitive for the renderer.
 */
const HISTORY_CACHE = ".posterract/cache/history.json";
const MAX_HISTORY_BYTES = 4_000_000;

export async function readEditHistory(dir: string): Promise<unknown> {
  const projectDir = await requireProjectDir(dir);
  try {
    return JSON.parse(await readFile(join(projectDir, HISTORY_CACHE), "utf8")) as unknown;
  } catch {
    return null;
  }
}

export async function writeEditHistory(dir: string, value: unknown): Promise<void> {
  const projectDir = await requireProjectDir(dir);
  const target = join(projectDir, HISTORY_CACHE);
  if (value === null) {
    await rm(target, { force: true });
    return;
  }
  const serialized = JSON.stringify(value);
  // A stack this large is not worth persisting: losing it costs one undo
  // chain, keeping it would cost every project open.
  if (serialized.length > MAX_HISTORY_BYTES) {
    await rm(target, { force: true });
    return;
  }
  await writeAtomic(target, `${serialized}\n`);
}

/**
 * Where a stamped element is written in the project source.
 *
 * The timeline and the file are two views of one document, so a row has to be
 * able to say where it lives. Returns null rather than guessing when the id
 * cannot be found.
 */
export async function locateProjectElement(
  dir: string,
  id: string,
): Promise<{ path: string; line: number; column: number } | null> {
  const projectDir = await requireProjectDir(dir);
  const project = await getProject(projectDir);
  if (!project) return null;
  const content = await readFile(join(projectDir, project.entry), "utf8");
  const at = locateElement(content, id);
  return at ? { path: project.entry, ...at } : null;
}

function revision(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Which part of a source a reader wants. A real project's entry file runs to
 * hundreds of kilobytes, most of it keyframes; handed over whole it does not
 * fit in an agent's context, and the agent is left with nothing. So a read can
 * name one element, a range of lines, or ask for the outline — and a `bounded`
 * read of a file too large to be useful whole answers with the outline and how
 * to ask for a part, instead of with everything.
 */
export type SourceSelect = {
  /** One element, children included, by its stable id. */
  id?: string;
  /** 1-based, inclusive. */
  lines?: [from: number, to: number];
  /** One line per element (see the compiler's `formatOutline`) instead of the text. */
  outline?: boolean;
  /** Answer with the outline rather than the text when the file is larger than a reader can use. */
  bounded?: boolean;
};

export type SourceRead = {
  path: string;
  content: string;
  revisionId: string;
  totalLines: number;
  totalChars: number;
  /** The lines `content` covers, when it is a part of the file. */
  range?: { from: number; to: number };
  outline?: string[];
  note?: string;
};

/** Past this a whole file is a dump rather than an answer (roughly ten thousand tokens). */
const BOUNDED_SOURCE_CHARS = 40_000;

/**
 * Reads a project source file. `path` "auto" resolves the project's actual
 * entry file through the same `ENTRY_FILES` resolution the rest of the app
 * uses (migrated projects can keep the entry at the project root, not under
 * `src/`); the result reports the resolved path. The revision is exactly
 * sha256 of the on-disk bytes — the one revision namespace shared with
 * `context.sourceRevision`, which goes through this same function — and is the
 * whole file's whatever part of it `select` asked for.
 */
export async function readProjectSource(dir: string, path: string, select: SourceSelect = {}): Promise<SourceRead> {
  let relativePath = path;
  if (path === "auto") {
    const entry = await entryFor(await requireProjectDir(dir));
    if (!entry) throw new Error("Project entry file is missing");
    relativePath = entry;
  }
  const absolute = await requireProjectPath(dir, relativePath);
  if (!SOURCE_FILE.test(absolute)) throw new Error("Only project source files may be opened in the source editor");
  const bytes = await readFile(absolute);
  const content = bytes.toString("utf8");
  const lines = content.split("\n");
  const whole = { path: relativePath, revisionId: revision(bytes), totalLines: lines.length, totalChars: content.length };

  if (select.id !== undefined) {
    const text = extractElementSource(content, select.id);
    const at = locateElement(content, select.id);
    if (text === null || !at) throw new Error(`No element with id "${select.id}" in ${relativePath}`);
    return { ...whole, content: text, range: { from: at.line, to: at.line + text.split("\n").length - 1 } };
  }

  if (select.lines) {
    const from = Math.max(1, Math.floor(select.lines[0]) || 1);
    const to = Math.min(lines.length, Math.max(from, Math.floor(select.lines[1]) || from));
    return { ...whole, content: lines.slice(from - 1, to).join("\n"), range: { from, to } };
  }

  if (select.outline || (select.bounded && content.length > BOUNDED_SOURCE_CHARS)) {
    return {
      ...whole,
      content: "",
      outline: formatOutline(outlineSource(relativePath, content)),
      ...(select.outline
        ? {}
        : {
          note:
            `${relativePath} is ${content.length.toLocaleString("en-US")} characters, too large to be useful whole, so this is its outline: ` +
            "one line per element with the lines it spans. Read a part with `id` (one element) or `lines` ([from, to]); " +
            "with file tools, read those lines of the file directly.",
        }),
    };
  }

  return { ...whole, content };
}

export async function writeProjectSource(request: SourceWriteRequest): Promise<{
  revisionId: string;
  content: string;
  diagnostics: CompileDiagnostic[];
}> {
  if (typeof request.content !== "string" || request.content.length > 5_000_000) {
    throw new Error("Source file is too large");
  }
  // "auto" names the entry file, the way it does for a read: a write that
  // follows `read_source`'s default has to land on the file that was read.
  if (request.path === "auto") {
    const entry = await entryFor(await requireProjectDir(request.dir));
    if (!entry) throw new Error("Project entry file is missing");
    request = { ...request, path: entry };
  }
  const absolute = await requireProjectPath(request.dir, request.path);
  // Compare in the same namespace `readProjectSource` hands out: sha256 of
  // the raw on-disk bytes.
  const current = await readFile(absolute);
  if (revision(current) !== request.expectedRevisionId) {
    throw new Error("This source changed on disk. Reload it before saving your edit.");
  }
  await writeAtomic(absolute, request.content);
  await appendJournal(await requireProjectDir(request.dir), {
    at: Date.now(),
    actor: request.actor ?? "canvas",
    path: request.path,
    from: revision(current),
    to: revision(request.content),
  });
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
    // What the compiler said, then what the vocabulary says: a source that
    // compiles can still ask for a prop the editor ignores (see lint.ts), and
    // the writer should hear about it with the write, not after a render.
    diagnostics: [...compiled.diagnostics, ...lintSource(request.path, request.content)],
  };
}

export interface SourceEditRequest {
  dir: string;
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
  actor?: JournalActor;
}

/**
 * Replaces one string of a source with another: the edit an agent's own file
 * tools make, for an agent that has none (a chat client with only the MCP
 * tools). It costs the agent the two strings, where `writeProjectSource` costs
 * it the whole file, and it cannot take a stale copy of the rest of the file
 * with it. `oldString` has to be there exactly once unless `replaceAll`; the
 * change then goes through the same write as any other, so it is snapshotted,
 * journalled, linted and shown on the canvas.
 */
export async function editProjectSource(request: SourceEditRequest): Promise<{
  revisionId: string;
  replaced: number;
  line: number;
  diagnostics: CompileDiagnostic[];
}> {
  if (typeof request.oldString !== "string" || !request.oldString) throw new Error("`old_string` is empty: say what to replace.");
  if (typeof request.newString !== "string") throw new Error("`new_string` must be a string.");
  if (request.oldString === request.newString) throw new Error("`old_string` and `new_string` are the same: nothing to change.");
  let path = request.path;
  if (path === "auto") {
    const entry = await entryFor(await requireProjectDir(request.dir));
    if (!entry) throw new Error("Project entry file is missing");
    path = entry;
  }
  const absolute = await requireProjectPath(request.dir, path);
  if (!SOURCE_FILE.test(absolute)) throw new Error("Only project source files can be edited this way");
  const bytes = await readFile(absolute);
  const content = bytes.toString("utf8");

  const found: number[] = [];
  for (let at = content.indexOf(request.oldString); at !== -1; at = content.indexOf(request.oldString, at + request.oldString.length)) {
    found.push(at);
  }
  const lineOf = (offset: number): number => content.slice(0, offset).split("\n").length;
  if (!found.length) {
    throw new Error(
      `\`old_string\` is not in ${path}. It has to match the file exactly, spaces and line breaks included: ` +
        "read that part again (posterract_read_source with `id` or `lines`) and copy it from there.",
    );
  }
  if (found.length > 1 && !request.replaceAll) {
    throw new Error(
      `\`old_string\` is in ${path} ${found.length} times (lines ${found.slice(0, 8).map(lineOf).join(", ")}${found.length > 8 ? ", …" : ""}). ` +
        "Include more of the text around it so that it names one place, or pass `replace_all`.",
    );
  }

  const next = request.replaceAll
    ? content.split(request.oldString).join(request.newString)
    : content.slice(0, found[0]!) + request.newString + content.slice(found[0]! + request.oldString.length);
  const written = await writeProjectSource({
    dir: request.dir,
    path,
    content: next,
    expectedRevisionId: revision(bytes),
    ...(request.actor ? { actor: request.actor } : {}),
  });
  return { revisionId: written.revisionId, replaced: request.replaceAll ? found.length : 1, line: lineOf(found[0]!), diagnostics: written.diagnostics };
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
    const sinceSelfWrite = selfWrite ? Date.now() - selfWrite.writtenAt : Number.POSITIVE_INFINITY;
    if (sinceSelfWrite < SELF_WRITE_GRACE_MS) {
      // Almost certainly the app's own write echoing back — but not certainly.
      // Someone else's write can land in the same half second (an agent that
      // sets a prop through a tool and then edits the file does exactly that),
      // and dropping the event would leave the canvas showing a file that no
      // longer exists. So look once the grace has passed: the content decides,
      // as it does for any event, and an echo of our own write is recognised
      // by its hash and ignored.
      clearTimeout(rechecks.get(absolute));
      rechecks.set(absolute, setTimeout(() => {
        rechecks.delete(absolute);
        void look();
      }, SELF_WRITE_GRACE_MS - sinceSelfWrite + 25));
      return;
    }
    void look();

    async function look(): Promise<void> {
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
        if (SOURCE_FILE.test(path)) {
          // Someone else wrote this source: an agent's file tools, an IDE. The
          // version they replaced is kept — the app never got to snapshot it
          // before the write, the way it does for its own — and the revision
          // is entered in the journal as theirs.
          const replaced = lastSeen.get(absolute);
          if (replaced !== content) {
            if (replaced !== undefined) {
              lastSeenBefore.set(absolute, replaced);
              await snapshotContent(absolute, replaced);
            }
            lastSeen.set(absolute, content);
            await appendJournal(projectDir, {
              at: Date.now(),
              actor: "external",
              path,
              from: replaced === undefined ? null : revision(replaced),
              to: revisionId,
            });
          }
        }
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
    }
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

/** How large a Lottie JSON may be before the import refuses it. */
const LOTTIE_IMPORT_LIMIT = 32 * 1024 * 1024;

/**
 * Downloads a Lottie animation into a project's `assets/lottie/`.
 *
 * The renderer cannot do this itself — its CSP allows no network at all, by
 * design — so the fetch happens here, and only for a URL the user pasted. The
 * response is parsed and shape-checked before it is written: a page that is
 * not an animation should fail at the import rather than as a broken element
 * on the canvas, and nothing but a real Lottie ever lands in the project.
 */
export async function importLottieFromUrl(
  dir: string,
  url: string,
  name?: string,
): Promise<{ path: string; width: number; height: number; duration: number }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That is not a URL");
  }
  if (parsed.protocol !== "https:") throw new Error("Only https links can be imported");

  const response = await fetch(parsed, { redirect: "follow" });
  if (!response.ok) throw new Error(`That link answered ${response.status}`);

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > LOTTIE_IMPORT_LIMIT) throw new Error("That animation is too large to import");

  const text = await response.text();
  if (text.length > LOTTIE_IMPORT_LIMIT) throw new Error("That animation is too large to import");

  let animation: Record<string, unknown>;
  try {
    animation = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("That link is not a Lottie file — it did not parse as JSON");
  }
  if (typeof animation.v !== "string" || !Array.isArray(animation.layers)) {
    throw new Error("That JSON is not a Lottie animation");
  }

  const frameRate = Number(animation.fr) || 30;
  const outPoint = Number(animation.op) || 0;
  const stem = (name ?? basename(parsed.pathname, ".json") ?? "animation")
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "animation";

  // A second import of the same name is a new file, not an overwrite: the
  // composition may already point at the first one.
  let relative = `assets/lottie/${stem}.json`;
  for (let attempt = 2; attempt < 100; attempt += 1) {
    const candidate = await requireProjectPath(dir, relative, false);
    const taken = await stat(candidate).then(() => true, () => false);
    if (!taken) break;
    relative = `assets/lottie/${stem}-${attempt}.json`;
  }

  const absolute = await requireProjectPath(dir, relative, false);
  await mkdir(dirname(absolute), { recursive: true });
  await writeAtomic(absolute, Buffer.from(text, "utf8"));

  return {
    path: relative,
    width: Number(animation.w) || 0,
    height: Number(animation.h) || 0,
    duration: outPoint / frameRate,
  };
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
    await cloneOrCopy(input, temporary);
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Copies `input` to `output` as an APFS clone where the volume can make one:
 * instant, and no second copy of the footage on disk until one of the two
 * changes. Node's copyFile cannot clone on macOS, so `cp -c` (clonefile)
 * does it; another volume, or one that cannot clone, gets a plain copy.
 */
async function cloneOrCopy(input: string, output: string): Promise<void> {
  if (process.platform === "darwin") {
    const cloned = await new Promise<boolean>((done) => {
      execFile("/bin/cp", ["-c", input, output], (error) => done(!error));
    });
    if (cloned) return;
    await rm(output, { force: true }).catch(() => undefined);
  }
  await copyFile(input, output);
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
