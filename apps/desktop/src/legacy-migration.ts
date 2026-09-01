import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import { compileVirtualProject } from "@posterract/video-compiler";

type LegacyPackage = Record<string, unknown> & {
  main?: string;
  scripts?: Record<string, unknown>;
  posterract?: unknown;
  diffusion?: unknown;
};

export type MigrationResult = {
  migrated: boolean;
  backupDir?: string;
  files?: string[];
};

const SOURCE_FILE = /\.[cm]?[jt]sx?$/i;
const IGNORED = new Set(["node_modules", ".git", ".posterract", "exports"]);
const LEGACY_IMPORT = /@diffusionstudio\/jsx/g;
const LEGACY_JSX_DIRECTIVE = /@jsxImportSource\s+@diffusionstudio\/jsx/g;
const LEGACY_CLI = /\bdapi\b/g;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.posterract-migrate-${randomUUID()}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, path);
}

async function collectSources(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const visit = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || IGNORED.has(entry.name)) continue;
      const absolute = join(folder, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (SOURCE_FILE.test(entry.name) || extname(entry.name) === ".json") {
        files[relative(dir, absolute).split(sep).join("/")] = await readFile(absolute, "utf8");
      }
    }
  };
  await visit(dir);
  return files;
}

function migratedPackage(pkg: LegacyPackage, entry: string, sdkVersion: string): LegacyPackage {
  const next: LegacyPackage = { ...pkg };
  const inherited = typeof pkg.diffusion === "object" && pkg.diffusion !== null
    ? pkg.diffusion as Record<string, unknown>
    : {};
  delete next.diffusion;
  next.posterract = {
    ...inherited,
    ...(typeof pkg.posterract === "object" && pkg.posterract !== null ? pkg.posterract : {}),
    schemaVersion: 1,
    entry,
    sdkVersion,
  };
  if (pkg.scripts) {
    next.scripts = Object.fromEntries(
      Object.entries(pkg.scripts).map(([name, value]) => [
        name,
        typeof value === "string" ? value.replace(LEGACY_CLI, "posterract") : value,
      ]),
    );
  }
  return next;
}

function migrateSource(content: string): string {
  return content
    .replace(LEGACY_JSX_DIRECTIVE, "@jsxImportSource @posterract/composition")
    .replace(LEGACY_IMPORT, "@posterract/composition");
}

/**
 * Migrates only known generated imports/configuration. Every changed file is
 * backed up first, the resulting project is compiled, and any failure restores
 * the original source before returning an error. Running it again is a no-op.
 */
export async function migrateLegacyProject(options: {
  dir: string;
  entry: string;
  sdkVersion: string;
  stageEnvironment: (dir: string) => Promise<void>;
}): Promise<MigrationResult> {
  const packagePath = join(options.dir, "package.json");
  const rawPackage = await readFile(packagePath, "utf8");
  const pkg = JSON.parse(rawPackage) as LegacyPackage;
  const sources = await collectSources(options.dir);
  const changed = new Map<string, string>();

  for (const [path, content] of Object.entries(sources)) {
    if (!SOURCE_FILE.test(path)) continue;
    const next = migrateSource(content);
    if (next !== content) changed.set(path, next);
  }
  const needsPackage = "diffusion" in pkg
    || Object.values(pkg.scripts ?? {}).some((value) => typeof value === "string" && /\bdapi\b/.test(value));
  if (!changed.size && !needsPackage) return { migrated: false };

  const stamp = new Date().toISOString().replaceAll(":", "-");
  const backupDir = join(options.dir, ".posterract", "migrations", `${stamp}-legacy-backup`);
  await mkdir(backupDir, { recursive: true });
  const originalHashes: Record<string, string> = { "package.json": hash(rawPackage) };
  await cp(packagePath, join(backupDir, "package.json"));
  for (const path of changed.keys()) {
    const content = sources[path]!;
    originalHashes[path] = hash(content);
    await mkdir(dirname(join(backupDir, path)), { recursive: true });
    await cp(join(options.dir, path), join(backupDir, path));
  }

  const recordPath = join(backupDir, "migration.json");
  await atomicWrite(recordPath, `${JSON.stringify({
    schemaVersion: 1,
    status: "running",
    startedAt: new Date().toISOString(),
    files: ["package.json", ...changed.keys()],
    originalHashes,
  }, null, 2)}\n`);

  try {
    for (const [path, content] of changed) await atomicWrite(join(options.dir, path), content);
    await atomicWrite(
      packagePath,
      `${JSON.stringify(migratedPackage(pkg, options.entry, options.sdkVersion), null, 2)}\n`,
    );
    await options.stageEnvironment(options.dir);
    const migratedSources = await collectSources(options.dir);
    const compiled = await compileVirtualProject(
      Object.entries(migratedSources).map(([path, content]) => ({ path, content })),
      options.entry,
    );
    if (!compiled.ok) {
      throw new Error(compiled.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    }
    await atomicWrite(recordPath, `${JSON.stringify({
      schemaVersion: 1,
      status: "complete",
      completedAt: new Date().toISOString(),
      files: ["package.json", ...changed.keys()],
      originalHashes,
    }, null, 2)}\n`);
    return { migrated: true, backupDir, files: ["package.json", ...changed.keys()] };
  } catch (error) {
    await cp(join(backupDir, "package.json"), packagePath, { force: true });
    for (const path of changed.keys()) {
      await mkdir(dirname(join(options.dir, path)), { recursive: true });
      await cp(join(backupDir, path), join(options.dir, path), { force: true });
    }
    await rm(join(options.dir, ".posterract", "sdk"), { recursive: true, force: true }).catch(() => undefined);
    await atomicWrite(recordPath, `${JSON.stringify({
      schemaVersion: 1,
      status: "rolled-back",
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      files: ["package.json", ...changed.keys()],
      originalHashes,
    }, null, 2)}\n`);
    throw new Error(`Legacy project migration was rolled back: ${error instanceof Error ? error.message : String(error)}`);
  }
}
