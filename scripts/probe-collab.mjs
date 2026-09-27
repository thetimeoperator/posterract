#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// End-to-end probe of the two-way link between the canvas and the file, and of
// both being edited at once. One document, two editors: the person on the
// canvas, an agent in the file. Everything here has to hold for that to work:
//
//   canvas -> file   a move, a resize, a reworded text, an insert and a delete
//                    all reach the file; undoing them returns it byte for byte
//   file -> canvas   a small edit shows in place as one undo step, and undo puts
//                    the file back; an added element shows after a reload that
//                    keeps the person's undo history
//   at once          the person and the agent change different elements, and the
//                    same element, in the same moment: both changes survive, and
//                    the canvas and the file end up saying the same thing
//   the view         selecting is not a change of the document
//
// THIS PROBE EDITS THE PROJECT. It runs only against an isolated instance
// (POSTERRACT_PROFILE set) and a project folder named on the command line, and
// it writes the source back as it found it when it is done:
//
//   POSTERRACT_PROFILE=agenttest node scripts/probe-collab.mjs <scratch-project-dir>
//
// The project needs two <text> elements with ids, literal x/y, in one scene.
// Exits 0 when everything passed, 1 when a probe failed, 2 when it cannot run.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const profile = process.env.POSTERRACT_PROFILE;
const dir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!profile || !dir) {
  process.stdout.write(
    "This probe edits the project it runs on, so it only runs against an isolated instance and a scratch copy:\n" +
      "  POSTERRACT_PROFILE=<profile> node scripts/probe-collab.mjs <scratch-project-dir>\n",
  );
  process.exit(2);
}

const SOCKET = join(tmpdir(), `posterract-editor-${process.getuid()}-${profile}.sock`);
function call(path, input, timeoutMs = 60_000) {
  return new Promise((resolveCall, reject) => {
    const socket = connect(SOCKET);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () => { socket.destroy(); reject(new Error(`timeout: ${path}`)); });
    socket.on("connect", () => socket.end(JSON.stringify({
      protocolVersion: 2,
      request: { path, input },
      timeoutMs,
      activity: { cliVersion: "probe", command: `probe:${path}`, projectDir: dir, invokedAt: Date.now() },
    })));
    socket.on("data", (chunk) => { buffer += chunk; });
    socket.on("end", () => {
      try {
        const reply = JSON.parse(buffer);
        reply.ok ? resolveCall(reply.data) : reject(new Error(reply.error));
      } catch {
        reject(new Error(`bad reply: ${buffer.slice(0, 200)}`));
      }
    });
    socket.on("error", reject);
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sha = (text) => createHash("sha256").update(text).digest("hex");

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
}
async function probe(name, run) {
  try {
    const detail = await run();
    record(name, true, detail ?? "");
  } catch (error) {
    record(name, false, error.message);
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// ---- the project ----------------------------------------------------------

let context;
try {
  await call("open", { dir }, 120_000);
  context = await call("context", { tree: false });
} catch (error) {
  process.stdout.write(`Cannot reach the isolated instance (${error.message}). Start it with POSTERRACT_PROFILE=${profile}, then run this again.\n`);
  process.exit(2);
}
const entry = (await call("source.read", { path: "auto", lines: [1, 1] })).path;
const FILE = join(dir, entry);
const ORIGINAL = readFileSync(FILE, "utf8");
// On the canvas, not only open: an element cannot be named before the first mount.
for (let waited = 0; waited < 30_000 && (await call("context", { tree: false })).shownRevision == null; waited += 250) {
  await new Promise((done) => setTimeout(done, 250));
}

const read = () => readFileSync(FILE, "utf8");
/** A literal numeric prop of an element, as the file spells it. */
const inFile = (id, prop, text = read()) => {
  const tag = new RegExp(`<[a-zA-Z]+\\s+id="${id}"[^>]*>`).exec(text)?.[0] ?? "";
  const match = new RegExp(`\\s${prop}=\\{(-?[\\d.]+)\\}`).exec(tag);
  return match ? Number(match[1]) : undefined;
};
/** An agent's file edit: read, change, write — with the read as fresh as a file tool's. */
const fileEdit = (change) => writeFileSync(FILE, change(read()));
const setInFile = (id, prop, value) => (text) =>
  text.replace(new RegExp(`(<[a-zA-Z]+\\s+id="${id}"[^>]*?\\s${prop}=\\{)-?[\\d.]+(\\})`), `$1${value}$2`);
const box = async (id, time) => (await call("geometry", { ids: [id], ...(time === undefined ? {} : { time }) })).boxes[0];
const state = () => call("canvas.state");
/** Until the canvas says it shows what the file says. */
async function caughtUp(timeoutMs = 8000) {
  const want = sha(read());
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const now = await call("context", { tree: false });
    if (now.shownRevision === want && now.sourceRevision === want) return true;
    await sleep(150);
  }
  return false;
}

// Two texts with literal x and y, to stand for "the person's element" and "the agent's".
const candidates = [...ORIGINAL.matchAll(/<text\s+id="([^"]+)"[^>]*>/g)]
  .filter(([tag]) => /\sx=\{-?[\d.]+\}/.test(tag) && /\sy=\{-?[\d.]+\}/.test(tag) && /\sstart=\{[\d.]+\}/.test(tag))
  .map(([, id]) => id);
if (candidates.length < 2) {
  process.stdout.write("The project needs two <text> elements with ids and literal x, y and start.\n");
  process.exit(2);
}
const [A, B] = candidates;
const timeOf = (id) => inFile(id, "start", ORIGINAL) + 0.5;
/** The scene an element is written in: the last <scene> opened before it. */
const sceneOf = (id) => {
  const at = ORIGINAL.search(new RegExp(`<[a-zA-Z]+\\s+id="${id}"`));
  return [...ORIGINAL.slice(0, at).matchAll(/<scene\s+id="([^"]+)"/g)].at(-1)?.[1];
};
const sceneId = sceneOf(A);
if (!sceneId || sceneOf(B) !== sceneId) {
  process.stdout.write("The two texts have to be in the same <scene>.\n");
  process.exit(2);
}
process.stdout.write(`project ${dir}\nentry ${entry} · person's element #${A} · agent's element #${B}\n\n`);

try {
  // ---- canvas -> file -----------------------------------------------------
  const startRevision = sha(read());
  const ax = inFile(A, "x");
  let steps = 0;

  await probe("canvas -> file: a move reaches the file", async () => {
    const result = await call("canvas.setProperties", { id: A, properties: { x: ax + 25, y: inFile(A, "y") + 10 } });
    steps += 1;
    expect(inFile(A, "x") === ax + 25, `file says x=${inFile(A, "x")}, expected ${ax + 25}`);
    expect(result.revisionId === sha(read()), "the edit did not answer with the revision it produced");
  });

  await probe("canvas -> file: a resize reaches the file", async () => {
    await call("canvas.setProperties", { id: A, properties: { width: 640 } });
    steps += 1;
    expect(inFile(A, "width") === 640, `file says width=${inFile(A, "width")}`);
  });

  await probe("canvas -> file: a reworded text reaches the file", async () => {
    await call("canvas.setText", { id: A, text: "probe says hello" });
    steps += 1;
    expect(read().includes(">probe says hello</text>"), "the new words are not in the file");
  });

  await probe("canvas -> file: an insert reaches the file, under the id it was given", async () => {
    await call("canvas.create", { parentId: sceneId, element: { tag: "rect", props: { id: "probe-rect", x: 12, y: 12, width: 30, height: 30, fill: "#65ff9a", start: 0, end: 1 } } });
    steps += 1;
    expect(/<rect id="probe-rect"/.test(read()), "the element is not in the file");
  });

  await probe("canvas -> file: a delete reaches the file", async () => {
    await call("canvas.remove", { ids: ["probe-rect"] });
    steps += 1;
    expect(!/id="probe-rect"/.test(read()), "the element is still in the file");
  });

  await probe("canvas -> file: undoing it all returns the file byte for byte", async () => {
    for (let index = 0; index < steps; index += 1) await call("canvas.undo");
    expect(sha(read()) === startRevision, "the file is not what it was before the edits");
    return `${steps} steps`;
  });

  // ---- file -> canvas -----------------------------------------------------
  await probe("file -> canvas: a small file edit shows in place, as one undo step", async () => {
    await call("canvas.setProperties", { id: A, properties: { x: ax + 1 } }); // something of the person's to keep
    const by = inFile(B, "y");
    fileEdit(setInFile(B, "y", by - 40));
    expect(await caughtUp(), "the canvas never caught up with the file");
    const shown = await box(B, timeOf(B));
    expect(Math.round(shown.y) === by - 40, `canvas shows y=${shown.y}, file says ${by - 40}`);
    expect((await state()).canUndo, "the undo history did not survive the file edit");
  });

  await probe("file -> canvas: undo takes the agent's edit back, in the file too", async () => {
    const by = inFile(B, "y");
    await call("canvas.undo");
    expect(inFile(B, "y") === by + 40, `file says y=${inFile(B, "y")}, expected ${by + 40}`);
    expect(inFile(A, "x") === ax + 1, "the person's earlier edit was undone instead");
  });

  await probe("file -> canvas: an element added in the file shows after a reload that keeps the person's undo history", async () => {
    fileEdit((text) => text.replace(new RegExp(`(\\n[ \\t]*)(<text\\s+id="${A}")`), `$1<rect id="probe-added" x={8} y={8} width={20} height={20} fill="#65ff9a" start={0} end={1} />$1$2`));
    expect(await caughtUp(15_000), "the canvas never caught up with the file");
    expect(Boolean(await box("probe-added", 0.5)), "the added element is not on the canvas");
    expect((await state()).canUndo, "the person's undo history was lost in the reload");
    await call("canvas.undo");
    expect(inFile(A, "x") === ax, `undo did not take the person's own edit back (x=${inFile(A, "x")}, expected ${ax})`);
    expect(/id="probe-added"/.test(read()), "undo removed the agent's element instead");
    fileEdit((text) => text.replace(/[ \t]*<rect id="probe-added"[^\n]*\n/, ""));
    expect(await caughtUp(15_000), "the canvas never caught up after the clean-up");
  });

  // ---- at once ------------------------------------------------------------
  await probe("at once: the person and the agent change different elements in the same moment; both survive", async () => {
    const x = inFile(A, "x");
    const y = inFile(B, "y");
    await Promise.all([
      call("canvas.setProperties", { id: A, properties: { x: x + 7 } }),
      (async () => { await sleep(20); fileEdit(setInFile(B, "y", y + 9)); })(),
    ]);
    expect(await caughtUp(15_000), "the canvas and the file never agreed");
    expect(inFile(A, "x") === x + 7, `the person's change is not in the file (x=${inFile(A, "x")})`);
    expect(inFile(B, "y") === y + 9, `the agent's change is not in the file (y=${inFile(B, "y")})`);
    const [a, b] = [await box(A, timeOf(A)), await box(B, timeOf(B))];
    expect(Math.round(a.x) === x + 7 && Math.round(b.y) === y + 9, `the canvas shows x=${a.x}, y=${b.y}`);
  });

  await probe("at once: the person and the agent change different props of the same element; both survive", async () => {
    const x = inFile(A, "x");
    const y = inFile(A, "y");
    await Promise.all([
      call("canvas.setProperties", { id: A, properties: { x: x + 3 } }),
      (async () => { await sleep(20); fileEdit(setInFile(A, "y", y + 5)); })(),
    ]);
    expect(await caughtUp(15_000), "the canvas and the file never agreed");
    expect(inFile(A, "x") === x + 3 && inFile(A, "y") === y + 5, `file says x=${inFile(A, "x")} y=${inFile(A, "y")}, expected ${x + 3}, ${y + 5}`);
    const shown = await box(A, timeOf(A));
    expect(Math.round(shown.x) === x + 3 && Math.round(shown.y) === y + 5, `the canvas shows ${shown.x}, ${shown.y}`);
  });

  await probe("at once: a burst of both — ten of the person's edits against ten of the agent's — ends with canvas and file agreeing", async () => {
    const x = inFile(A, "x");
    const y = inFile(B, "y");
    const person = (async () => { for (let index = 1; index <= 10; index += 1) await call("canvas.setProperties", { id: A, properties: { x: x + index } }); })();
    const agent = (async () => { for (let index = 1; index <= 10; index += 1) { fileEdit(setInFile(B, "y", y + index)); await sleep(120); } })();
    await Promise.all([person, agent]);
    expect(await caughtUp(20_000), "the canvas and the file never agreed");
    expect(inFile(A, "x") === x + 10, `the person's last edit is not in the file (x=${inFile(A, "x")}, expected ${x + 10})`);
    expect(inFile(B, "y") === y + 10, `the agent's last edit is not in the file (y=${inFile(B, "y")}, expected ${y + 10})`);
    const [a, b] = [await box(A, timeOf(A)), await box(B, timeOf(B))];
    expect(Math.round(a.x) === x + 10 && Math.round(b.y) === y + 10, `the canvas shows x=${a.x}, y=${b.y}`);
  });

  // ---- the view -----------------------------------------------------------
  await probe("the view: selecting and seeking do not change the document", async () => {
    const before = sha(read());
    await call("canvas.select", { ids: [A] });
    await call("canvas.seek", { time: timeOf(B) });
    await call("canvas.select", { ids: [B] });
    await sleep(900);
    expect(sha(read()) === before, "a click was written into the source");
  });

  await probe("who did what: the journal tells the person from the agent from a file edit", async () => {
    const lines = readFileSync(join(dir, ".posterract", "journal.jsonl"), "utf8").trim().split("\n").slice(-60).map((line) => JSON.parse(line));
    const actors = new Set(lines.map((line) => line.actor));
    expect(actors.has("agent") && actors.has("external"), `actors seen: ${[...actors].join(", ")}`);
    return [...actors].join(", ");
  });
} finally {
  // As it was found.
  if (read() !== ORIGINAL) {
    writeFileSync(FILE, ORIGINAL);
    await caughtUp(15_000).catch(() => false);
  }
}

const failed = results.filter((row) => !row.ok).length;
process.stdout.write(`\n${results.length} probes: ${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
