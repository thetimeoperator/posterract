#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// End-to-end probe of the engine without the app: with nothing running, the CLI
// has to start the engine for itself, answer, and leave nothing behind.
//
//   inspect / validate / geometry / capture   answered with no app open
//   render                                     a whole video, and a part of one
//                                              at a smaller size, as real files
//   the boundaries                             what needs a person at the editor
//                                              still says so; an edit by id still
//                                              goes straight to the file
//   clean-up                                   the engine quits by itself
//
// It cannot reach — or be confused by — an app you have open: it runs the CLI
// with a socket directory of its own, where nothing else listens. It writes its
// own project into the folder it is given (which it empties).
//
//   node scripts/probe-headless.mjs <empty-scratch-dir>
//
// From a source checkout the engine is this repo's Electron and apps/desktop
// (build it first: `pnpm --filter @posterract/desktop build`). To probe an
// installed or packaged app instead, point POSTERRACT_CLI at its
// `Contents/Resources/app/cli/bin/posterract`.
//
// Exits 0 when everything passed, 1 when a probe failed, 2 when it cannot run.

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!dir) {
  process.stdout.write("node scripts/probe-headless.mjs <empty-scratch-dir>\n");
  process.exit(2);
}

const repo = fileURLToPath(new URL("..", import.meta.url));
const desktop = join(repo, "apps", "desktop");
const packagedCli = process.env.POSTERRACT_CLI;
const cli = packagedCli ? [packagedCli] : ["node", join(desktop, "cli", "posterract.cjs")];
if (!packagedCli && !existsSync(cli[1])) {
  process.stdout.write("apps/desktop/cli/posterract.cjs is missing: run `pnpm --filter @posterract/desktop build` first.\n");
  process.exit(2);
}

// A unix socket path is capped at 104 bytes, so the directory has to be a short one.
const sockets = mkdtempSync(join(tmpdir(), "pe-"));
const IDLE_MS = 8_000;
const env = {
  ...process.env,
  TMPDIR: sockets,
  POSTERRACT_ENGINE_IDLE_MS: String(IDLE_MS),
  ...(packagedCli ? {} : { POSTERRACT_ENGINE_COMMAND: JSON.stringify([join(desktop, "node_modules", ".bin", "electron"), desktop]) }),
};
delete env.POSTERRACT_PROFILE;
delete env.POSTERRACT_PROJECT_DIR;

rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, "src"), { recursive: true });
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "probe-headless", main: "src/index.tsx", posterract: { projectId: "probe-headless-0001" } }, null, 2));
writeFileSync(join(dir, "src", "index.tsx"), `export default () => (
  <stage id="stage">
    <scene id="main" width={1080} height={1920} workarea={[0, 4]}>
      <rect id="bg" width={1080} height={1920} fill="#101010" start={0} end={4} />
      <text id="title" place="lower-third" fontSize={72} color="#FFFFFF" start={0} end={4}>Rendered with no app open</text>
    </scene>
  </stage>
);
`);

const run = (args, timeout = 180_000) => new Promise((done) => {
  execFile(cli[0], [...cli.slice(1), ...args], { cwd: dir, env, timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
    done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
  });
});
const engines = () => {
  try { return execFileSync("pgrep", ["-f", "--", "--engine"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).length; }
  catch { return 0; }
};

const results = [];
async function probe(name, body) {
  try { const detail = await body(); results.push(true); process.stdout.write(`PASS ${name}${detail ? ` — ${detail}` : ""}\n`); }
  catch (error) { results.push(false); process.stdout.write(`FAIL ${name} — ${error.message}\n`); }
}
const expect = (condition, message) => { if (!condition) throw new Error(message); };

const already = engines();
if (already) process.stdout.write(`note: ${already} engine process(es) were already running on this machine; the clean-up probe counts from there\n`);

await probe("inspect answers with no app open, by starting the engine itself", async () => {
  const started = Date.now();
  const result = await run(["inspect"]);
  expect(result.code === 0, `exit ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`);
  expect(/starting the engine/.test(result.stderr), "it did not say it was starting the engine");
  expect(/scene#main/.test(result.stdout) && /title/.test(result.stdout), result.stdout.slice(0, 200));
  return `${((Date.now() - started) / 1000).toFixed(1)}s cold`;
});
await probe("the next command shares the engine that is already up", async () => {
  const started = Date.now();
  const result = await run(["validate"]);
  expect(result.code === 0 && /"ok":true/.test(result.stdout), result.stdout + result.stderr);
  expect(!/starting the engine/.test(result.stderr), "it started a second engine");
  return `${((Date.now() - started) / 1000).toFixed(1)}s warm`;
});
await probe("geometry measures a placed text headless", async () => {
  const result = await run(["geometry", "title", "--at", "1", "--json"]);
  const box = JSON.parse(result.stdout).boxes[0];
  expect(Math.abs(box.x + box.width / 2 - 540) <= 1 && Math.abs(box.y + box.height / 2 - 1280) <= 1, JSON.stringify(box));
});
await probe("render writes the whole video, and says how it went on stderr", async () => {
  const result = await run(["render", "-o", "exports/full.mp4"]);
  expect(result.code === 0, `exit ${result.code}: ${result.stderr.trim()}`);
  expect(/rendered by the engine/.test(result.stdout), result.stdout);
  const size = statSync(join(dir, "exports", "full.mp4")).size;
  expect(size > 10_000, `the file is ${size} bytes`);
  const probed = JSON.parse((await run(["media", "probe", "exports/full.mp4"])).stdout);
  expect(Math.abs(probed.duration - 4) < 0.2, `it is ${probed.duration}s long, the work area is 4s`);
  return `${Math.round(size / 1024)} KB, ${probed.duration.toFixed(2)}s`;
});
await probe("render --from --to --scale writes just that part, smaller", async () => {
  const result = await run(["render", "main", "-o", "exports/look.mp4", "--from", "1", "--to", "2.5", "--scale", "0.5"]);
  expect(result.code === 0, `exit ${result.code}: ${result.stderr.trim()}`);
  const probed = JSON.parse((await run(["media", "probe", "exports/look.mp4"])).stdout);
  expect(Math.abs(probed.duration - 1.5) < 0.2, `it is ${probed.duration}s long, 1.5s was asked for`);
  expect(probed.width === 540 && probed.height === 960, `${probed.width}×${probed.height}, expected 540×960`);
  return `${probed.width}×${probed.height}, ${probed.duration.toFixed(2)}s`;
});
await probe("a render that cannot work exits nonzero and says why", async () => {
  const result = await run(["render", "nope", "-o", "exports/nope.mp4"]);
  expect(result.code !== 0, "it exited 0");
  expect(/nope/.test(result.stderr + result.stdout), result.stderr + result.stdout);
});
await probe("what needs a person at the editor still says so, and starts nothing", async () => {
  const result = await run(["look"]);
  expect(result.code !== 0 && /not running/.test(result.stderr), result.stderr + result.stdout);
});
await probe("an edit by id still goes straight to the file, and the engine shows it", async () => {
  const result = await run(["set", "title", "place=center"]);
  expect(result.code === 0 && /edited directly/.test(result.stdout), result.stdout + result.stderr);
  expect(/place="center"/.test(readFileSync(join(dir, "src", "index.tsx"), "utf8")), "the file does not have it");
  await new Promise((done) => setTimeout(done, 2500));
  const box = JSON.parse((await run(["geometry", "title", "--at", "1", "--json"])).stdout).boxes[0];
  expect(Math.abs(box.y + box.height / 2 - 960) <= 1, `the engine still measures it at y=${box.y}`);
});
await probe("the engine quits by itself once nobody is asking", async () => {
  const deadline = Date.now() + IDLE_MS + 15_000;
  while (engines() > already && Date.now() < deadline) await new Promise((done) => setTimeout(done, 500));
  expect(engines() <= already, "an engine is still running");
});

rmSync(sockets, { recursive: true, force: true });
const failed = results.filter((ok) => !ok).length;
process.stdout.write(`\n${results.length} probes: ${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
