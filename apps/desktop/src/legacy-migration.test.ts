import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateLegacyProject } from "./legacy-migration.ts";

const legacySource = `/** @jsxImportSource @diffusionstudio/jsx */
export default function Project() {
  return <stage><scene id="main" name="Main" width={1080} height={1920} duration={1} active /></stage>;
}
`;

test("migrates an inherited project once and records a recoverable backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "posterract-migration-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "index.tsx"), legacySource);
    await writeFile(join(dir, "package.json"), JSON.stringify({
      name: "legacy",
      main: "src/index.tsx",
      scripts: { open: "dapi open ." },
      diffusion: { export: { main: { format: "mp4" } } },
    }));

    const result = await migrateLegacyProject({
      dir,
      entry: "src/index.tsx",
      sdkVersion: "0.201.0",
      stageEnvironment: async (projectDir) => {
        await mkdir(join(projectDir, ".posterract", "sdk"), { recursive: true });
      },
    });
    assert.equal(result.migrated, true);
    assert.match(await readFile(join(dir, "src", "index.tsx"), "utf8"), /@posterract\/composition/);
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    assert.equal(pkg.diffusion, undefined);
    assert.equal(pkg.posterract.schemaVersion, 1);
    assert.equal(pkg.scripts.open, "posterract open .");
    assert.equal(
      (await migrateLegacyProject({
        dir,
        entry: "src/index.tsx",
        sdkVersion: "0.201.0",
        stageEnvironment: async () => undefined,
      })).migrated,
      false,
    );
    const migrations = await readdir(join(dir, ".posterract", "migrations"));
    assert.equal(migrations.length, 1);
    const record = JSON.parse(await readFile(join(dir, ".posterract", "migrations", migrations[0]!, "migration.json"), "utf8"));
    assert.equal(record.status, "complete");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restores the original project when migrated source cannot compile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "posterract-migration-rollback-"));
  const broken = `/** @jsxImportSource @diffusionstudio/jsx */\nexport default function Project( {`;
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "index.tsx"), broken);
    await writeFile(join(dir, "package.json"), JSON.stringify({
      name: "legacy-broken",
      main: "src/index.tsx",
      diffusion: {},
    }));
    await assert.rejects(() => migrateLegacyProject({
      dir,
      entry: "src/index.tsx",
      sdkVersion: "0.201.0",
      stageEnvironment: async () => undefined,
    }), /rolled back/);
    assert.equal(await readFile(join(dir, "src", "index.tsx"), "utf8"), broken);
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    assert.deepEqual(pkg.diffusion, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
