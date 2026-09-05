/**
 * Skill folders: the content types a scene can be made as.
 *
 * A skill is the Agent Skills folder the founder already uses — a `SKILL.md`
 * with `name` and `description` in its frontmatter, beside whatever assets,
 * references and scripts the skill needs. Posterract reads three places:
 *
 * - bundled starters shipped with the app (`<app>/skills`),
 * - the user's library (`~/Posterract/Skills`), where "Add skill folder…" copies to,
 * - the project's own `skills/` folder, listed first.
 *
 * An optional `posterract.json` in the folder adds the card's cover, format,
 * typical duration, tags, the keys it needs and the recipes it offers. A
 * folder with only a SKILL.md still gets a card; the renderer draws a sigil
 * for any skill without a cover, so no card is ever blank.
 */
import { app, dialog, shell } from "electron";
import { cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";

export type SkillSource = "bundled" | "library" | "project";

export type SkillRecipe = { label: string; prompt: string };

export type SkillCard = {
  /** Stable across scans: the source and the folder name. */
  id: string;
  /** The frontmatter `name`; what `<scene skill="…">` stores. */
  name: string;
  /** What the card shows: the manifest title, else the name made readable. */
  title: string;
  description: string;
  path: string;
  source: SkillSource;
  /** A data URL, or null when the renderer should draw a sigil. */
  cover: string | null;
  /** A small mark for chips; a data URL or null (the sigil stands in). */
  logo: string | null;
  format: "9:16" | "1:1" | "16:9" | null;
  /** Typical length in seconds, when the manifest says. */
  duration: [number, number] | null;
  tags: string[];
  /** Provider keys the skill needs, in the same vocabulary as the AI keys panel. */
  requires: string[];
  recipes: SkillRecipe[];
  hasStarter: boolean;
};

type Manifest = {
  title?: unknown;
  cover?: unknown;
  logo?: unknown;
  format?: unknown;
  duration?: unknown;
  tags?: unknown;
  requires?: unknown;
  recipes?: unknown;
  starter?: unknown;
};

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};
/** Covers ride over IPC as data URLs, so anything larger than this is skipped. */
const MAX_IMAGE_BYTES = 2_500_000;
const COVER_NAMES = ["cover", "Cover", "COVER", "thumbnail", "poster"];
const LOGO_NAMES = ["logo", "Logo", "icon", "sigil"];

export function libraryDir(): string {
  return join(homedir(), "Posterract", "Skills");
}

function bundledDir(): string {
  return join(app.getAppPath(), "skills");
}

function projectSkillsDir(projectDir: string): string {
  return join(projectDir, "skills");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** `name` and `description` from a SKILL.md frontmatter block; nothing fancier. */
function parseFrontmatter(text: string): { name: string | null; description: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return { name: null, description: "" };
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    let value = pair[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[pair[1]!] = value;
  }
  return { name: fields.name?.trim() || null, description: fields.description?.trim() ?? "" };
}

function humanize(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\bv(\d+)\b/gi, "v$1")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

async function readManifest(dir: string): Promise<Manifest> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, "posterract.json"), "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Manifest) : {};
  } catch {
    return {};
  }
}

async function imageDataUrl(path: string): Promise<string | null> {
  const type = IMAGE_TYPES[extname(path).toLowerCase()];
  if (!type) return null;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return null;
    const bytes = await readFile(path);
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/** The first existing `<dir>/<name>.<ext>` among the candidates. */
async function findNamed(dirs: string[], names: string[]): Promise<string | null> {
  for (const dir of dirs) {
    for (const name of names) {
      for (const ext of Object.keys(IMAGE_TYPES)) {
        const candidate = join(dir, `${name}${ext}`);
        if (await exists(candidate)) return candidate;
      }
    }
  }
  return null;
}

/** The largest image directly inside `dir`, for folders that have art but no named cover. */
async function largestImage(dir: string): Promise<string | null> {
  let best: { path: string; size: number } | null = null;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !IMAGE_TYPES[extname(entry.name).toLowerCase()]) continue;
    if (entry.name.toLowerCase().endsWith(".svg")) continue;
    const path = join(dir, entry.name);
    const size = (await stat(path).catch(() => null))?.size ?? 0;
    if (size > 0 && size <= MAX_IMAGE_BYTES && (!best || size > best.size)) best = { path, size };
  }
  return best?.path ?? null;
}

function insideSkill(dir: string, relative: unknown): string | null {
  if (typeof relative !== "string" || !relative) return null;
  const target = resolve(dir, relative);
  return target === dir || target.startsWith(`${dir}${sep}`) ? target : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

async function readSkill(dir: string, source: SkillSource): Promise<SkillCard | null> {
  const skillPath = join(dir, "SKILL.md");
  if (!(await exists(skillPath))) return null;

  const frontmatter = parseFrontmatter(await readFile(skillPath, "utf8").catch(() => ""));
  const folderName = basename(dir);
  const name = frontmatter.name ?? folderName;
  const manifest = await readManifest(dir);

  const coverPath =
    insideSkill(dir, manifest.cover) ??
    (await findNamed([dir, join(dir, "assets")], COVER_NAMES)) ??
    (await largestImage(join(dir, "assets"))) ??
    (await largestImage(dir));
  const logoPath = insideSkill(dir, manifest.logo) ?? (await findNamed([dir, join(dir, "assets")], LOGO_NAMES));

  const format = manifest.format === "9:16" || manifest.format === "1:1" || manifest.format === "16:9" ? manifest.format : null;
  const duration =
    Array.isArray(manifest.duration) && manifest.duration.length === 2 && manifest.duration.every((n) => typeof n === "number")
      ? ([manifest.duration[0], manifest.duration[1]] as [number, number])
      : null;
  const recipes = Array.isArray(manifest.recipes)
    ? manifest.recipes
        .filter((r): r is SkillRecipe => !!r && typeof r === "object" && typeof (r as SkillRecipe).label === "string" && typeof (r as SkillRecipe).prompt === "string")
        .slice(0, 6)
    : [];
  const starter = insideSkill(dir, manifest.starter);

  return {
    id: `${source}:${folderName}`,
    name,
    title: typeof manifest.title === "string" && manifest.title ? manifest.title : humanize(name),
    description: frontmatter.description,
    path: dir,
    source,
    cover: coverPath ? await imageDataUrl(coverPath) : null,
    logo: logoPath ? await imageDataUrl(logoPath) : null,
    format,
    duration,
    tags: stringList(manifest.tags).slice(0, 8),
    requires: stringList(manifest.requires).map((key) => key.toLowerCase()),
    recipes,
    hasStarter: Boolean(starter && (await exists(starter))),
  };
}

async function scanRoot(root: string, source: SkillSource): Promise<SkillCard[]> {
  const cards: SkillCard[] = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const card = await readSkill(join(root, entry.name), source);
    if (card) cards.push(card);
  }
  return cards.sort((a, b) => a.title.localeCompare(b.title));
}

export type SkillRoots = { bundled?: string; library?: string };

/** Every skill the deck can offer for `projectDir`: project first, then library, then bundled. */
export async function listSkills(projectDir: string | null, roots: SkillRoots = {}): Promise<SkillCard[]> {
  const library = roots.library ?? libraryDir();
  await mkdir(library, { recursive: true }).catch(() => undefined);
  const [project, libraryCards, bundled] = await Promise.all([
    projectDir ? scanRoot(projectSkillsDir(projectDir), "project") : Promise.resolve([]),
    scanRoot(library, "library"),
    scanRoot(roots.bundled ?? bundledDir(), "bundled"),
  ]);
  // A library or project copy of a bundled skill replaces the bundled card.
  const seen = new Set<string>();
  const merged: SkillCard[] = [];
  for (const card of [...project, ...libraryCards, ...bundled]) {
    if (seen.has(card.name)) continue;
    seen.add(card.name);
    merged.push(card);
  }
  return merged;
}

/**
 * Let the user pick a skill folder anywhere on disk and copy it into the
 * library. A copy, not a link: the folder may live in a repo that moves.
 */
export async function addSkillFolder(): Promise<SkillCard | null> {
  const picked = await dialog.showOpenDialog({
    title: "Add a skill folder",
    message: "Choose a folder that contains a SKILL.md",
    properties: ["openDirectory"],
  });
  const source = picked.filePaths[0];
  if (picked.canceled || !source) return null;
  if (!(await exists(join(source, "SKILL.md")))) {
    throw new Error("That folder has no SKILL.md, so it is not a skill.");
  }

  const destination = join(libraryDir(), basename(source));
  if (await exists(destination)) {
    throw new Error(`A skill named "${basename(source)}" is already in your library.`);
  }
  await mkdir(libraryDir(), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    // Skills carry their own tooling; dependencies and outputs are not part of the skill.
    filter: (path) => !/(^|\/)(node_modules|\.git|output|\.venv|__pycache__)(\/|$)/.test(path.slice(source.length)),
  });
  return readSkill(destination, "library");
}

export function revealSkill(path: string): void {
  shell.showItemInFolder(join(path, "SKILL.md"));
}
