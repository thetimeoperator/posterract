#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// End-to-end probe of what a composition can say without pixel arithmetic or a
// keyframe per wobble, measured on a live canvas:
//
//   place / inset     a placement is the same pixels an author would have worked
//                     out by hand — for a box, an auto-sized text, and a child of
//                     a moved group
//   the drag rule     giving a placed element a position replaces the placement
//                     with x/y in the file; undo puts the placement back; giving
//                     a positioned element a placement takes its x/y out
//   file → canvas     a placement written into the file shows in place
//   loop              a two-keyframe ping-pong keeps going for the whole clip
//   animation params  distance / amount / easing change the preset; unset, the
//                     preset plays as it always has
//
// It writes its own project into the folder it is given (which it empties), so
// it needs no project of yours. Like the other probes it only talks to an
// isolated instance:
//
//   POSTERRACT_PROFILE=agenttest node scripts/probe-expressive.mjs <empty-scratch-dir>
//
// Exits 0 when everything passed, 1 when a probe failed, 2 when it cannot run.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const profile = process.env.POSTERRACT_PROFILE;
const dir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!profile || !dir) {
  process.stdout.write("POSTERRACT_PROFILE=<profile> node scripts/probe-expressive.mjs <empty-scratch-dir>\n");
  process.exit(2);
}

const SOURCE = `export default () => (
  <stage id="stage">
    <scene id="main" width={1080} height={1920} workarea={[0, 10]}>
      <rect id="bg" width={1080} height={1920} fill="#101010" start={0} end={10} />
      <rect id="placed-br" width={200} height={100} fill="#65ff9a" place="bottom-right" inset={[48, 32]} start={0} end={10} />
      <rect id="pixels-br" x={832} y={1788} width={200} height={100} fill="#ff6565" start={0} end={10} />
      <rect id="placed-lt" width={600} height={100} fill="#6595ff" place="lower-third" start={0} end={10} />
      <text id="placed-text" place="center" fontSize={72} color="#FFFFFF" start={0} end={10}>Centered by intent</text>
      <group id="moved" x={300} y={400}>
        <rect id="placed-in-group" width={100} height={100} fill="#ffe600" place="top-left" inset={10} start={0} end={10} />
      </group>
      <rect id="bobber" x={100} y={100} width={80} height={80} fill="#ffffff" start={0} end={10}>
        <keyframeTrack id="bob" property="offsetY" loop="pingpong">
          <keyframe id="bob-0" time={0} value={0} />
          <keyframe id="bob-1" time={1} value={-100} />
        </keyframeTrack>
      </rect>
      <rect id="sweeper" x={0} y={300} width={80} height={80} fill="#ffffff" start={0} end={10}>
        <keyframeTrack id="sweep" property="offsetX" loop>
          <keyframe id="sweep-0" time={0} value={0} />
          <keyframe id="sweep-1" time={2} value={200} />
        </keyframeTrack>
      </rect>
      <rect id="riser" x={500} y={900} width={80} height={80} fill="#ffffff" start={0} end={10}>
        <animation id="rise" type="slideUp" distance={159} amount={0} easing="linear" duration={1} />
      </rect>
      <rect id="riser-default" x={700} y={900} width={80} height={80} fill="#ffffff" start={0} end={10}>
        <animation id="rise-default" type="slideUp" duration={1} />
      </rect>
    </scene>
  </stage>
);
`;

rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, "src"), { recursive: true });
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "probe-expressive", displayName: "Expressive probe", main: "src/index.tsx", posterract: { projectId: "probe-expressive-0001" } }, null, 2));
const FILE = join(dir, "src", "index.tsx");
writeFileSync(FILE, SOURCE);

const SOCKET = join(tmpdir(), `posterract-editor-${process.getuid()}-${profile}.sock`);
function call(path, input, timeoutMs = 60_000) {
  return new Promise((resolveCall, reject) => {
    const socket = connect(SOCKET);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () => { socket.destroy(); reject(new Error(`timeout: ${path}`)); });
    socket.on("connect", () => socket.end(JSON.stringify({
      protocolVersion: 2, request: { path, input }, timeoutMs,
      activity: { cliVersion: "probe", command: `probe:${path}`, projectDir: dir, invokedAt: Date.now() },
    })));
    socket.on("data", (chunk) => { buffer += chunk; });
    socket.on("end", () => {
      try { const reply = JSON.parse(buffer); reply.ok ? resolveCall(reply.data) : reject(new Error(reply.error)); }
      catch { reject(new Error(`bad reply: ${buffer.slice(0, 200)}`)); }
    });
    socket.on("error", reject);
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const results = [];
async function probe(name, run) {
  try { const detail = await run(); results.push(true); process.stdout.write(`PASS ${name}${detail ? ` — ${detail}` : ""}\n`); }
  catch (error) { results.push(false); process.stdout.write(`FAIL ${name} — ${error.message}\n`); }
}
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const box = async (id, time) => (await call("geometry", { ids: [id], time })).boxes[0];
const at = async (id, time) => { const b = await box(id, time); return `${Math.round(b.x)},${Math.round(b.y)}`; };
const tag = (id) => new RegExp(`<[a-zA-Z]+\\s+id="${id}"[^>]*>`).exec(readFileSync(FILE, "utf8"))?.[0] ?? "";

try {
  await call("open", { dir }, 120_000);
} catch (error) {
  process.stdout.write(`Cannot reach the isolated instance (${error.message}). Start it with POSTERRACT_PROFILE=${profile}, then run this again.\n`);
  process.exit(2);
}

await probe("place: a corner with an inset is the pixels worked out by hand", async () => {
  const [placed, pixels] = [await at("placed-br", 1), await at("pixels-br", 1)];
  expect(placed === pixels, `placed ${placed} · by hand ${pixels}`);
  return placed;
});
await probe("place: lower-third centres the element on the line two thirds down", async () => {
  const where = await at("placed-lt", 1);
  expect(where === "240,1230", `${where}, expected 240,1230`);
});
await probe("place: a text with no width is centred by what it says, on its very first frame", async () => {
  const b = await box("placed-text", 0);
  expect(b.width > 100, `the text measured ${b.width} wide`);
  expect(Math.abs(b.x + b.width / 2 - 540) <= 1 && Math.abs(b.y + b.height / 2 - 960) <= 1, `centre ${b.x + b.width / 2},${b.y + b.height / 2}`);
  return `${Math.round(b.width)}×${Math.round(b.height)}`;
});
await probe("place: inside a moved group it is still the frame's corner", async () => {
  const where = await at("placed-in-group", 1);
  expect(where === "10,10", `${where}, expected 10,10`);
});

await probe("the drag rule: a position given to a placed element replaces the placement, in the file", async () => {
  await call("canvas.setProperties", { id: "placed-lt", properties: { x: 300 } });
  const written = tag("placed-lt");
  expect(!/\splace=/.test(written), `the placement is still in the file: ${written}`);
  expect(/\sx=\{300\}\s+y=\{1230\}/.test(written), `expected x={300} y={1230}, in that order: ${written}`);
  expect((await at("placed-lt", 1)) === "300,1230", "the canvas is not where the file says");
});
await probe("the drag rule: undo puts the placement back, on the canvas and in the file", async () => {
  await call("canvas.undo");
  const written = tag("placed-lt");
  expect(/\splace="lower-third"/.test(written) && !/\s[xy]=\{/.test(written), written);
  expect((await at("placed-lt", 1)) === "240,1230", "the canvas did not go back");
});
await probe("a placement given to a positioned element takes its x/y out, and undo puts them back in order", async () => {
  await call("canvas.setProperties", { id: "pixels-br", properties: { place: "top", inset: 20 } });
  expect(!/\s[xy]=\{/.test(tag("pixels-br")), `x/y still there: ${tag("pixels-br")}`);
  expect((await at("pixels-br", 1)) === "440,20", `${await at("pixels-br", 1)}, expected 440,20`);
  await call("canvas.undo");
  expect(/\sx=\{832\}\s+y=\{1788\}/.test(tag("pixels-br")) && !/\splace=/.test(tag("pixels-br")), tag("pixels-br"));
});
await probe("file → canvas: a placement written into the file shows in place, without a reload", async () => {
  const before = (await call("context", { tree: false })).shownRevision;
  writeFileSync(FILE, readFileSync(FILE, "utf8").replace('<rect id="bobber" x={100} y={100}', '<rect id="bobber" place="left" inset={25}'));
  for (let waited = 0; waited < 8000 && (await call("context", { tree: false })).shownRevision === before; waited += 150) await sleep(150);
  expect((await at("bobber", 0)) === "25,920", `${await at("bobber", 0)}, expected 25,920`);
  expect((await call("canvas.state")).canUndo, "it was not an undo step");
  await call("canvas.undo");
  expect((await at("bobber", 0)) === "100,100", "undo did not take the agent's placement back");
});

await probe("loop: a two-keyframe ping-pong goes there and back for the whole clip", async () => {
  const ys = [];
  for (const time of [0, 0.5, 1, 1.5, 2, 2.5, 7.5]) ys.push(Math.round((await box("bobber", time)).y));
  expect(JSON.stringify(ys) === JSON.stringify([100, 50, 0, 50, 100, 50, 50]), ys.join(", "));
  return ys.join(", ");
});
await probe("loop: a repeat starts over, and every cycle is the first one", async () => {
  const xs = [];
  for (const time of [0, 1, 2, 3, 4, 5, 9]) xs.push(Math.round((await box("sweeper", time)).x));
  // 0 → 200 over 2 s: a boundary shows the last keyframe, as it does the first time through.
  expect(JSON.stringify(xs) === JSON.stringify([0, 100, 200, 100, 200, 100, 100]), xs.join(", "));
  return xs.join(", ");
});

await probe("animation: distance and amount change the preset; unset, it plays as it always has", async () => {
  const [given, own] = [await box("riser", 0), await box("riser-default", 0)];
  expect(Math.round(given.y) === 1059 && Math.round(own.y) === 1000, `starts at y=${given.y} (159 asked) and y=${own.y} (the preset's 100)`);
  expect(given.opacity === 1 && own.opacity === 0, `opacity ${given.opacity} (amount 0) and ${own.opacity} (the preset's fade)`);
});
await probe("animation: a linear easing is half way at half time, and it comes to rest where it is authored", async () => {
  // 30 frames: progress runs 0..1 over frames 0..29, so frame 15 is 15/29 of the way.
  const half = await box("riser", 0.5);
  expect(Math.abs(half.y - (900 + 159 * (1 - 15 / 29))) < 1, `y=${half.y}`);
  expect(Math.round((await box("riser", 2)).y) === 900, "it did not come to rest at y=900");
});

const failed = results.filter((ok) => !ok).length;
process.stdout.write(`\n${results.length} probes: ${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
