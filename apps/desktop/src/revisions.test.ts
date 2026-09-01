import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// `electron` is aliased to a stub at build time; it resolves userData to
// POSTERRACT_TEST_USER_DATA, which the test runner points at a temp dir.
const store = process.env.POSTERRACT_TEST_USER_DATA!;

const { listRevisions, readRevision, recordDeletion, snapshotBeforeWrite } = await import("./revisions.ts");

async function project(): Promise<{ dir: string; entry: string }> {
  const dir = await mkdtemp(join(tmpdir(), "posterract-project-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "p", main: "index.tsx", posterract: { schemaVersion: 1, projectId: `id-${Date.now()}` } }),
  );
  return { dir, entry: join(dir, "index.tsx") };
}

test("a source file's previous content is kept before it is overwritten", async () => {
  const { dir, entry } = await project();
  await writeFile(entry, "<scene>original</scene>");

  await snapshotBeforeWrite(entry);
  await writeFile(entry, "<scene>replaced</scene>");

  const revisions = await listRevisions(dir, "index.tsx");
  assert.equal(revisions.length, 1);
  assert.equal(await readRevision(dir, "index.tsx", revisions[0]!.id), "<scene>original</scene>");
  await rm(dir, { recursive: true, force: true });
});

/* The failure that motivated this: an agent empties the composition. */
test("an emptied file is still recoverable", async () => {
  const { dir, entry } = await project();
  await writeFile(entry, "<scene>work</scene>");
  await snapshotBeforeWrite(entry);
  await writeFile(entry, "");

  const [latest] = await listRevisions(dir, "index.tsx");
  assert.equal(await readRevision(dir, "index.tsx", latest!.id), "<scene>work</scene>");
  await rm(dir, { recursive: true, force: true });
});

/* And the one that actually happened: the agent deletes the entry outright. */
test("history survives deleting the project folder itself", async () => {
  const { dir, entry } = await project();
  await writeFile(entry, "<scene>the whole video</scene>");
  await snapshotBeforeWrite(entry);
  await writeFile(entry, "<scene>edited</scene>");

  await rm(dir, { recursive: true, force: true });

  // The store lives in userData, not under the project, so it is untouched.
  const revisions = await listRevisions(dir, "index.tsx");
  assert.ok(revisions.length >= 1);
  assert.equal(await readRevision(dir, "index.tsx", revisions.at(-1)!.id), "<scene>the whole video</scene>");
});

test("identical consecutive content is not stored twice", async () => {
  const { dir, entry } = await project();
  await writeFile(entry, "<scene>same</scene>");
  await snapshotBeforeWrite(entry);
  await snapshotBeforeWrite(entry);
  await snapshotBeforeWrite(entry);
  assert.equal((await listRevisions(dir, "index.tsx")).length, 1);
  await rm(dir, { recursive: true, force: true });
});

test("a new file with no prior content records nothing", async () => {
  const { dir, entry } = await project();
  await snapshotBeforeWrite(entry);
  assert.deepEqual(await listRevisions(dir, "index.tsx"), []);
  await rm(dir, { recursive: true, force: true });
});

test("deletion is marked so the app can offer a restore", async () => {
  const { dir, entry } = await project();
  await writeFile(entry, "<scene>present</scene>");
  await snapshotBeforeWrite(entry);
  await writeFile(entry, "<scene>changed</scene>");
  await rm(entry, { force: true });

  await recordDeletion(dir, "index.tsx");
  const [latest] = await listRevisions(dir, "index.tsx");
  assert.equal(latest!.deleted, true);
  await rm(dir, { recursive: true, force: true });
});

test("an unknown revision id is refused", async () => {
  const { dir } = await project();
  await assert.rejects(() => readRevision(dir, "index.tsx", "../../etc/passwd"), /Unknown revision/);
  await rm(dir, { recursive: true, force: true });
});

test("non-source files are not versioned", async () => {
  const { dir } = await project();
  const asset = join(dir, "notes.txt");
  await writeFile(asset, "not a composition");
  await snapshotBeforeWrite(asset);
  assert.deepEqual(await listRevisions(dir, "notes.txt"), []);
  await rm(dir, { recursive: true, force: true });
});

test.after(() => rm(store, { recursive: true, force: true }));
