import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEditFeedback, fileStore, memoryStore } from "./edit-feedback";

import type { InspectResult } from "./format";

const project = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "posterract-feedback-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "index.tsx"), "v1");
  return dir;
};
let tick = 0;
/** An edit: the content and, since two writes can land in one millisecond, the size too. */
const edit = (dir: string): void => writeFileSync(join(dir, "src", "index.tsx"), `v${"+".repeat(++tick)}`);
const scene = (problems: InspectResult["problems"]): InspectResult =>
  ({ scene: { id: "main", width: 1080, height: 1920, fps: 30, duration: 10 }, elements: [], markers: [], problems, samples: 0, ms: 0 });

test("nothing is said until the source changes, and then each finding is said once", async () => {
  const dir = project();
  let lint: string[] = [];
  let problems: InspectResult["problems"] = [];
  const feedback = createEditFeedback({ projectDir: () => dir, store: memoryStore(), lint: () => lint, inspect: async () => [scene(problems)] });
  feedback.baseline();

  lint = ["src/index.tsx:9:3  ✗ <text#a> has no prop `banana`"];
  assert.equal(await feedback.since(), undefined, "what was wrong before the session started is not news");

  edit(dir);
  problems = [{ code: "text-cut-off", severity: "error", message: 'text#hook "Hi" runs off the frame: 150px past the right edge', at: 11, fix: "x 700 → 550" }];
  const first = await feedback.since();
  assert.match(first ?? "", /2 new problems \(2 ✗\)/);
  assert.match(first ?? "", /banana/);
  assert.match(first ?? "", /runs off the frame.*@11\.00s\n {4}fix: x 700 → 550/);

  assert.equal(await feedback.since(), undefined, "the same sources are not checked twice");

  // The file grew above the finding — its line number moved — and a warning arrived.
  edit(dir);
  lint = ["src/index.tsx:14:3  ✗ <text#a> has no prop `banana`", "src/index.tsx:2:1  ⚠ `fill` is not a documented prop of <text#b>"];
  const second = await feedback.since();
  assert.match(second ?? "", /1 new problem:/);
  assert.doesNotMatch(second ?? "", /banana/, "a finding is the same finding on another line");
  assert.doesNotMatch(second ?? "", /runs off the frame/);

  // Fixed, then broken again: that is news.
  edit(dir);
  problems = [];
  assert.equal(await feedback.since(), undefined);
  edit(dir);
  problems = [{ code: "text-cut-off", severity: "error", message: 'text#hook "Hi" runs off the frame: 150px past the right edge', at: 11 }];
  assert.match((await feedback.since()) ?? "", /runs off the frame/);
});

test("what a check of the agent's own asking just said is not said again", async () => {
  const dir = project();
  const feedback = createEditFeedback({
    projectDir: () => dir,
    store: memoryStore(),
    lint: () => ["src/index.tsx:3:1  ✗ <rect#r> has no prop `wdth`"],
    inspect: async () => [scene([{ code: "too-short", severity: "warning", message: "text#t is on screen for 0.20s, too briefly to read", at: 1 }])],
  });
  feedback.baseline();
  edit(dir);
  // The agent ran `inspect` itself, and read this:
  feedback.heard(["PROBLEMS", "  ⚠ text#t is on screen for 0.20s, too briefly to read @1.00s", "      fix: end 1.2 → 2.5"], "inspect");
  const note = await feedback.since();
  assert.match(note ?? "", /wdth/, "the half it did not ask about is still checked");
  assert.doesNotMatch(note ?? "", /too briefly/);
});

test("when nobody can measure the layout right now, the lint half is said and the layout half waits", async () => {
  const dir = project();
  let reachable = false;
  const feedback = createEditFeedback({
    projectDir: () => dir,
    store: memoryStore(),
    lint: () => ["src/index.tsx:3:1  ✗ <rect#r> has no prop `wdth`"],
    inspect: async () => {
      if (!reachable) throw new Error("Posterract is not running");
      return [scene([{ code: "never-in-frame", severity: "error", message: "rect#r is never in frame" }])];
    },
  });
  feedback.baseline();
  edit(dir);
  assert.match((await feedback.since()) ?? "", /wdth/);
  reachable = true;
  assert.match((await feedback.since()) ?? "", /never in frame/, "the layout half was still owed");
});

test("the CLI remembers between commands, which are processes of their own", async () => {
  const dir = project();
  const make = () => createEditFeedback({ projectDir: () => dir, store: fileStore(dir), lint: () => ["src/index.tsx:3:1  ✗ <rect#r> has no prop `wdth`"] });
  assert.equal(await make().since(), undefined, "the first command in a project is where it starts from");
  edit(dir);
  assert.match((await make().since()) ?? "", /wdth/);
  assert.equal(await make().since(), undefined);
  edit(dir);
  assert.equal(await make().since(), undefined, "another process, and still said once");
});
