#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// End-to-end probe of the Posterract Desktop agent bridge (the project-local
// request mailbox the MCP server and CLI ride on). It locates the active
// project the way the installed MCP server does, then exercises the bridge
// with the CLI package's own request machinery:
//
//   health, context x3 (asserting an identical sourceRevision), canvas.state,
//   source.read (default entry), screenshot x3, check, and one semantic no-op
//   select cycle — then verifies the mailbox left no response files behind.
//
// Run with `pnpm probe:bridge` (or `node scripts/probe-bridge.mjs`) while
// Posterract Desktop is open on a project. Exits 0 when everything passed,
// 1 when a probe failed, 2 when Desktop is not reachable at all.

import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url);
const cliDir = new URL("packages/posterract-cli/", repoRoot);

async function loadProjectControl() {
  // Bundle the CLI package's own project-control machinery on the fly so the
  // probe always exercises the code that ships, with no extra dependencies:
  // esbuild is already a devDependency of @posterract/cli.
  const cliRequire = createRequire(new URL("package.json", cliDir));
  const esbuild = cliRequire("esbuild");
  const outDir = mkdtempSync(join(tmpdir(), "posterract-probe-"));
  const outfile = join(outDir, "project-control.mjs");
  await esbuild.build({
    entryPoints: [fileURLToPath(new URL("src/project-control.ts", cliDir))],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile));
  rmSync(outDir, { recursive: true, force: true });
  return module;
}

const results = [];
function record(name, status, detail = "") {
  results.push({ name, status, detail });
  process.stdout.write(`${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ""}\n`);
}

function printTable() {
  const width = Math.max(...results.map((row) => row.name.length));
  process.stdout.write("\n== probe-bridge results ==\n");
  for (const row of results) {
    process.stdout.write(`${row.status.padEnd(5)} ${row.name.padEnd(width + 2)}${row.detail}\n`);
  }
  const failed = results.filter((row) => row.status === "FAIL").length;
  const skipped = results.filter((row) => row.status === "SKIP").length;
  process.stdout.write(`${results.length} probes: ${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped\n`);
  return failed;
}

function bail(message) {
  process.stdout.write(`\n${message}\n`);
  process.stdout.write("Start Posterract Desktop, open a project in it, then run this probe again.\n");
  process.exit(2);
}

const control = await loadProjectControl();

let projectDir;
try {
  projectDir = control.resolveProjectDir();
} catch (error) {
  bail(`No active Posterract project could be resolved: ${error.message}`);
}
process.stdout.write(`Probing the agent bridge for ${projectDir}\n(active-project pointer: ${control.activeProjectPointerPath()})\n\n`);

let session;
try {
  session = control.readLocalControlSession(projectDir);
  record("session-preflight", "PASS", `desktop ${session.desktopVersion}${typeof session.heartbeatAt === "number" ? `, heartbeat ${Math.round((Date.now() - session.heartbeatAt) / 1000)}s ago` : ", no heartbeat (older Desktop)"}`);
} catch (error) {
  bail(`Posterract Desktop is not exposing this project: ${error.message}`);
}

const paths = control.localControlPaths(projectDir);
const listDir = (dir) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};
const responsesBefore = new Set(listDir(paths.responses));

const call = (path, input = undefined, timeoutMs = 30_000) =>
  control.requestProjectControl(projectDir, { path, input }, timeoutMs, {
    cliVersion: "probe",
    command: `probe:${path}`,
    projectDir,
    invokedAt: Date.now(),
  });

async function probe(name, run) {
  try {
    const detail = await run();
    record(name, "PASS", typeof detail === "string" ? detail : "");
    return true;
  } catch (error) {
    record(name, "FAIL", error instanceof Error ? error.message : String(error));
    return false;
  }
}

// -- health ------------------------------------------------------------------
await probe("health", async () => {
  const health = await call("health");
  if (!health || health.renderer !== true) throw new Error(`renderer not ready: ${JSON.stringify(health)}`);
  return `renderer up, desktopBridge=${health.desktopBridge}`;
});

// -- context x3: sourceRevision must be identical and non-null ---------------
let context = null;
await probe("context-x3-stable-revision", async () => {
  const reads = [];
  for (let i = 0; i < 3; i += 1) reads.push(await call("context", { tree: false }));
  context = reads[0];
  if (!context?.projectDir) {
    throw new Error("no project is mounted in the Desktop editor — open the project in Posterract Desktop, then re-run this probe");
  }
  const revisions = reads.map((read) => read?.sourceRevision ?? null);
  if (revisions.some((value) => value === null)) throw new Error(`sourceRevision was null: ${JSON.stringify(revisions)}`);
  if (new Set(revisions).size !== 1) throw new Error(`sourceRevision changed across back-to-back reads: ${JSON.stringify(revisions)}`);
  return `sourceRevision ${revisions[0].slice(0, 12)}… x3, compileState=${context.compileState}`;
});
const mounted = Boolean(context?.projectDir);

// -- canvas.state ------------------------------------------------------------
let canvasState = null;
if (mounted) {
  await probe("canvas-state", async () => {
    canvasState = await call("canvas.state");
    if (!canvasState || typeof canvasState.frameRate !== "number") throw new Error(`unexpected canvas state: ${JSON.stringify(canvasState)}`);
    return `active=${canvasState.activeSceneId}, selected=${canvasState.selectedIds.length}, fps=${canvasState.frameRate}`;
  });
} else {
  record("canvas-state", "SKIP", "no project mounted in the Desktop editor");
}

// -- source.read with the default ("auto") entry resolution ------------------
let sourceRead = null;
if (mounted) {
  await probe("source-read-default", async () => {
    try {
      sourceRead = await call("source.read", { path: "auto" });
    } catch (error) {
      // Older Desktop builds predate "auto"; resolve the entry here the same
      // way the desktop does so the revision-namespace probe can still run.
      const fallback = await resolveEntryFallback(projectDir);
      sourceRead = await call("source.read", { path: fallback });
      throw new Error(`"auto" was rejected (${error.message}); the running Desktop predates entry-file resolution — restart Desktop on the rebuilt bundles (fallback read of ${fallback} succeeded)`);
    }
    return `entry ${sourceRead.path}, revision ${sourceRead.revisionId.slice(0, 12)}…, ${sourceRead.content.length} chars`;
  });
} else {
  record("source-read-default", "SKIP", "no project mounted in the Desktop editor");
}

async function resolveEntryFallback(dir) {
  const entries = ["src/index.tsx", "src/index.ts", "index.tsx", "index.ts", "index.jsx", "index.js"];
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    if (typeof pkg.main === "string") entries.unshift(pkg.main);
  } catch {
    // package.json is optional for the fallback list.
  }
  for (const entry of entries) {
    try {
      await readFile(join(dir, entry));
      return entry;
    } catch {
      // try the next candidate
    }
  }
  throw new Error("no entry file found");
}

// -- one revision namespace: context.sourceRevision === source.read revision -
if (mounted && sourceRead) {
  await probe("revision-namespace", async () => {
    if (context.sourceRevision !== sourceRead.revisionId) {
      throw new Error(`context.sourceRevision ${context.sourceRevision} !== source.read revisionId ${sourceRead.revisionId}`);
    }
    return "context.sourceRevision === source.read revisionId";
  });
} else {
  record("revision-namespace", "SKIP", mounted ? "source.read did not complete" : "no project mounted in the Desktop editor");
}

// -- screenshot x3 (a slow tool; the classic victim of the mailbox race) -----
for (let i = 1; i <= 3; i += 1) {
  await probe(`screenshot-${i}`, async () => {
    const shot = await call("screenshot", undefined, 120_000);
    if (!shot || typeof shot.base64 !== "string" || !shot.base64.length) throw new Error(`no image returned: ${JSON.stringify(shot).slice(0, 200)}`);
    return `${shot.width}x${shot.height}, ${Math.round(shot.base64.length / 1024)}KB base64`;
  });
}

// -- check on the active (or first) scene ------------------------------------
let checkId = canvasState?.activeSceneId ?? null;
if (!checkId && mounted) {
  try {
    const withTree = await call("context", { tree: true });
    const findScene = (node) => {
      if (!node) return null;
      if (node.kind === "scene" && node.id) return node.id;
      for (const child of node.children ?? []) {
        const found = findScene(child);
        if (found) return found;
      }
      return null;
    };
    checkId = findScene(withTree?.tree);
  } catch {
    checkId = null;
  }
}
if (checkId) {
  await probe("check", async () => {
    const result = await call("check", { id: checkId });
    if (!result || !result.stats) throw new Error(`unexpected check result: ${JSON.stringify(result).slice(0, 200)}`);
    return `${checkId}: ${result.stats.nodes} nodes, ${result.issues.length} issues`;
  });
} else {
  record("check", "SKIP", mounted ? "no scene id available to check" : "no project mounted in the Desktop editor");
}

// -- semantic no-op: re-select the current selection -------------------------
if (canvasState) {
  await probe("select-noop", async () => {
    const before = canvasState.selectedIds;
    await call("canvas.select", { ids: before, extend: false });
    const after = await call("canvas.state");
    if (JSON.stringify(after.selectedIds) !== JSON.stringify(before)) {
      throw new Error(`selection changed: ${JSON.stringify(before)} -> ${JSON.stringify(after.selectedIds)}`);
    }
    return `selection unchanged (${before.length} ids)`;
  });
} else {
  record("select-noop", "SKIP", "canvas state unavailable");
}

// -- mailbox hygiene: no response files may remain ----------------------------
await probe("responses-clean", async () => {
  // Give any straggling watcher echo time to land before judging.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const after = listDir(paths.responses);
  const leaked = after.filter((name) => !responsesBefore.has(name));
  if (leaked.length) throw new Error(`${leaked.length} new response file(s) leaked: ${leaked.join(", ")}`);
  const preexisting = after.length;
  return preexisting === 0
    ? "responses/ is empty"
    : `no new leaks; ${preexisting} pre-existing file(s) remain from before this probe (cleared on Desktop restart)`;
});

await probe("requests-clean", async () => {
  const pending = listDir(paths.requests);
  if (pending.length) throw new Error(`${pending.length} request file(s) still pending: ${pending.join(", ")}`);
  return "requests/ is empty";
});

const failed = printTable();
process.exit(failed ? 1 : 0);
