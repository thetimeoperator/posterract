import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { VIEW_STATE_FILE, readViewStateFile, sanitizeViewState, seedViewStateFile, writeViewStateFile } from "./view-state.ts";

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "posterract-view-"));
}

test("a view state round-trips through the sidecar", async () => {
  const dir = await project();
  try {
    assert.equal(await readViewStateFile(dir), null);
    await writeViewStateFile(dir, {
      camera: [0.19, 0, 0, 0.19, 324.4, 168],
      active: "src/index.tsx:two",
      selected: ["src/index.tsx:hook", "src/index.tsx:hook"],
      expanded: [],
      clipHeight: { "src/index.tsx:bg": 64 },
    });
    assert.deepEqual(await readViewStateFile(dir), {
      version: 1,
      camera: [0.19, 0, 0, 0.19, 324.4, 168],
      active: "src/index.tsx:two",
      selected: ["src/index.tsx:hook"],
      expanded: [],
      clipHeight: { "src/index.tsx:bg": 64 },
    });
    // Plain, readable JSON: an agent learns what the author points at from it.
    assert.match(await readFile(join(dir, VIEW_STATE_FILE), "utf8"), /"selected": \[\n\s+"src\/index\.tsx:hook"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("what is not a view state is refused or dropped, never applied", async () => {
  assert.equal(sanitizeViewState(null), null);
  assert.equal(sanitizeViewState([1, 2]), null);
  assert.deepEqual(
    sanitizeViewState({
      camera: [1, 0, 0, "x", 0, 0],
      active: 12,
      selected: ["ok", "", 7, "x".repeat(600)],
      expanded: "all",
      clipHeight: { ok: 40, bad: -1, worse: "tall" },
    }),
    { version: 1, camera: null, active: null, selected: ["ok"], expanded: [], clipHeight: { ok: 40 } },
  );
  // The voice bar's history: words, bounded, the newest kept.
  assert.deepEqual(
    sanitizeViewState({ voice: ["split", "", 7, "x".repeat(400), ...Array.from({ length: 60 }, (_, index) => `say ${index}`)] })?.voice,
    Array.from({ length: 50 }, (_, index) => `say ${index + 10}`),
  );
  assert.equal(sanitizeViewState({ voice: "split" })?.voice, undefined);

  const dir = await project();
  try {
    await assert.rejects(writeViewStateFile(dir, "nope"));
    await mkdir(join(dir, ".posterract"), { recursive: true });
    await writeFile(join(dir, VIEW_STATE_FILE), "{ not json");
    assert.equal(await readViewStateFile(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a source's old view state seeds the sidecar once and never overwrites it", async () => {
  const dir = await project();
  try {
    const lifted = { camera: [1, 0, 0, 1, 0, 0], active: "index.tsx:a", selected: ["index.tsx:b"], expanded: [], clipHeight: {} };
    assert.equal(await seedViewStateFile(dir, lifted), true);
    assert.equal((await readViewStateFile(dir))?.active, "index.tsx:a");

    assert.equal(await seedViewStateFile(dir, { ...lifted, active: "index.tsx:stale" }), false);
    assert.equal((await readViewStateFile(dir))?.active, "index.tsx:a");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
