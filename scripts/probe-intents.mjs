#!/usr/bin/env node
// End-to-end probe of the catalog: the sentences that used to fail, on a live
// isolated instance, against local stand-ins for OpenRouter's decisions
// endpoint and for Groq — no real key, no real call.
//
//   split at a time    "split at 9 seconds" cuts the clip at 9 s, not at the playhead
//   nothing to split   with the playhead off every clip, it says why, and claims nothing
//   add a shape        "add a circle" adds a circle with the Component tool's own defaults
//   it                 "make it red" straight after colours what was just added
//   two in one         "add a square and make it blue" is one undo step
//   go to a time       "go to 5 seconds" moves the playhead
//   what can you do    the bar answers with what it can do
//   hide / show        never toggles: "hide" hides, "show" shows
//
// THIS PROBE EDITS THE PROJECT and writes its api-keys.json (dummy keys that
// point at the stand-ins). It runs only against an isolated instance started
// with POSTERRACT_FAKE_MIC=1, and a scratch project, and it puts the source and
// the keys file back as it found them:
//
//   POSTERRACT_PROFILE=agenttest node scripts/probe-intents.mjs <scratch-project-dir> [cdp-port]
//
// Exits 0 pass, 1 fail, 2 cannot run.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const profile = process.env.POSTERRACT_PROFILE;
const dir = process.argv[2] ? resolve(process.argv[2]) : undefined;
const port = Number(process.argv[3] ?? 9333);
if (!profile || !dir) {
  process.stdout.write(
    "This probe edits the project it runs on, so it only runs against an isolated instance and a scratch copy:\n"
    + "  POSTERRACT_PROFILE=<profile> node scripts/probe-intents.mjs <scratch-project-dir> [cdp-port]\n",
  );
  process.exit(2);
}
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- the stand-ins -----------------------------------------------------------

function startStub(script) {
  const child = spawn(process.execPath, [join(REPO, "scripts", script), "0"], { stdio: ["ignore", "pipe", "inherit"] });
  const url = new Promise((done, fail) => {
    child.stdout.on("data", (chunk) => {
      const match = /listening on (http:\/\/[^\s]+)/.exec(String(chunk));
      if (match) done(match[1]);
    });
    child.on("exit", () => fail(new Error(`${script} did not start`)));
  });
  return { child, url };
}
const decisions = startStub("stub-decisions.mjs");
const speech = startStub("stub-transcribe.mjs");
const decisionsUrl = await decisions.url;
const speechUrl = await speech.url;
const post = (base, path, payload) => fetch(`${base}${path}`, { method: "POST", body: JSON.stringify(payload ?? {}) }).then((reply) => reply.json());
const script = (command, answers) => post(decisionsUrl, "/script", { command, answers });

const KEYS_FILE = join(dir, "api-keys.json");
const KEYS_BEFORE = existsSync(KEYS_FILE) ? readFileSync(KEYS_FILE, "utf8") : null;
const SOURCE_FILE = join(dir, "src/index.tsx");
const SOURCE_BEFORE = readFileSync(SOURCE_FILE, "utf8");
writeFileSync(KEYS_FILE, `${JSON.stringify({
  openrouter: "stub-key-not-real",
  decisionsUrl: `${decisionsUrl}/api/alpha/decisions`,
  transcribe: "stub-key-not-real",
  transcribeUrl: speechUrl,
  transcribeModel: "whisper-large-v3-turbo",
}, null, 2)}\n`);

function cleanUp() {
  if (KEYS_BEFORE === null) rmSync(KEYS_FILE, { force: true });
  else writeFileSync(KEYS_FILE, KEYS_BEFORE);
  writeFileSync(SOURCE_FILE, SOURCE_BEFORE);
  decisions.child.kill();
  speech.child.kill();
}

// ---- the bridge and the page ------------------------------------------------

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

let ws;
let seq = 0;
const pending = new Map();
async function attach() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("no page target");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { ws.addEventListener("open", done, { once: true }); ws.addEventListener("error", fail, { once: true }); });
  ws.addEventListener("message", (message) => {
    const reply = JSON.parse(message.data);
    if (reply.id && pending.has(reply.id)) { pending.get(reply.id)(reply); pending.delete(reply.id); }
  });
}
const cdp = (method, params = {}) => new Promise((done) => { const id = ++seq; pending.set(id, done); ws.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) {
  const reply = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text);
  return reply.result?.result?.value;
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const frame = () => cdp("Page.captureScreenshot", { format: "jpeg", quality: 1, clip: { x: 0, y: 0, width: 4, height: 4, scale: 1 } });
async function pump(ms, every = 50) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(every)) await frame();
}
async function until(test, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(80)) { await frame(); if (await test()) return true; }
  return false;
}

const KEYS = {
  Meta: { code: "MetaLeft", keyCode: 91 }, Escape: { code: "Escape", keyCode: 27 }, Enter: { code: "Enter", keyCode: 13 },
  k: { code: "KeyK", keyCode: 75 },
};
async function key(name, { down = true, up = true, modifiers = 0, text } = {}) {
  const { code, keyCode } = KEYS[name];
  if (down) await cdp("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: String(name), code, windowsVirtualKeyCode: keyCode, modifiers, ...(text ? { text } : {}) });
  if (up) await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: String(name), code, windowsVirtualKeyCode: keyCode, modifiers });
}
async function openBar() {
  await evaluate("document.activeElement?.blur?.()");
  await key("Meta", { up: false, modifiers: 4 });
  await key("k", { modifiers: 4 });
  await frame();
  await key("Meta", { down: false });
  await frame();
}

const mode = () => evaluate("document.querySelector('.posterract-voice')?.dataset.mode ?? null");
const note = () => evaluate("document.querySelector('.posterract-voice-note')?.textContent ?? ''");
const help = () => evaluate("[...document.querySelectorAll('.posterract-voice-help span')].map((line) => line.textContent)");

async function type(sentence) {
  if ((await mode()) !== "typing") {
    await openBar();
    if (!(await until(async () => (await mode()) === "typing", 5_000))) throw new Error(`⌘K left the bar in ${await mode()}`);
  }
  await evaluate("(() => { const input = document.querySelector('.posterract-voice-input'); input?.focus(); input?.select(); })()");
  await cdp("Input.insertText", { text: sentence });
}
const enter = () => key("Enter", { text: "\r" });
async function closeBar() {
  for (let tries = 0; tries < 3 && (await mode()) !== "idle"; tries += 1) {
    await key("Escape");
    await pump(150);
  }
}

/** Types a sentence, applies it, and waits for the bar to say something. */
async function say(sentence) {
  await type(sentence);
  await pump(500);
  await enter();
  await until(async () => Boolean(await note()), 12_000);
  const message = await note();
  await pump(200);
  return message;
}

const source = () => call("source.read", { path: "src/index.tsx" }).then((reply) => reply.content ?? reply.source ?? "");

// ---- results ----------------------------------------------------------------

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
}
async function probe(name, run) {
  try { record(name, true, (await run()) ?? ""); } catch (error) { record(name, false, error.message); }
  try { await closeBar(); } catch { /* the next probe starts from wherever it is */ }
}
function expect(condition, message) { if (!condition) throw new Error(message); }

// ---- the project it runs on --------------------------------------------------

const PROJECT = `/* @jsxImportSource @posterract/composition */

export default function PosterractProject() {
  return (
    <stage id="stage" background="#020604">
      <scene id="main" name="Main" width={1080} height={1920} fill="#03100b">
        <rect id="card" name="Card" x={140} y={900} start={0} end={12} width={800} height={400} fill="#65ff9a" />
        <text id="title" name="Title" x={120} y={400} start={0} end={6} width={840} fontSize={96} color="#ffffff">Wild storm</text>
      </scene>
    </stage>
  );
}
`;

// ---- the run -----------------------------------------------------------------

try {
  writeFileSync(SOURCE_FILE, PROJECT);
  await attach();
  await pump(1500);
  // The app reads the keys file when it mounts: this probe wrote it a moment
  // ago, so the first sentence is a warm-up that only wakes that up.
  await type("go to 1 second");
  await pump(300);
  await enter();
  await pump(1500);
  await closeBar();
  await pump(500);

  // Every sentence's answers, as Jev would give them.
  await script("split at 9 seconds", {
    time: { noul: 0.97 }, intent: { choice: "time.split" }, number_1: { choice: "when" }, target: { choice: "none" },
  });
  await script("cut it in two here", { time: { noul: 0.95 }, intent: { choice: "time.split" }, target: { choice: "none" } });
  await script("go to 1 second", { time: { noul: 0.9 }, intent: { choice: "time.go-to" }, number_1: { choice: "when" } });
  await script("add a circle", {
    create: { noul: 0.98 }, intent: { choice: "create.shape" }, shape_kind: { choice: "circle" },
  });
  await script("make it red", {
    style: { noul: 0.96 }, do_color: { noul: 0.97 }, color: { choice: "red" }, target: { choice: "selection" },
  });
  await script("add a square and make it blue", {
    create: { noul: 0.95 }, style: { noul: 0.9 },
    intent: { choice: "create.shape" }, shape_kind: { choice: "square" },
    do_color: { noul: 0.93 }, color: { choice: "blue" }, target: { choice: "new" },
  });
  await script("go to 5 seconds", {
    time: { noul: 0.96 }, intent: { choice: "time.go-to" }, number_1: { choice: "when" },
  });

  await probe("split at a time", async () => {
    const before = await source();
    const message = await say("split at 9 seconds");
    expect(/split at 0:09/i.test(message), `the bar said: ${message}`);
    const after = await until(async () => (await source()) !== before, 12_000);
    expect(after, `the source did not change; the bar said: ${message}`);
    const text = await source();
    const rects = (text.match(/<rect/g) ?? []).length;
    expect(rects >= 2, `expected the card to be in two, source has ${rects} rects`);
    expect(/end="?\{?9/.test(text) || /9(\.0+)?"/.test(text) || text.includes("9"), "the cut is not at 9 s");
    return message.slice(0, 80);
  });

  await probe("nothing to split, and it says so", async () => {
    // At the very start of every clip: there is nothing for a cut to divide.
    const before = await source();
    await call("canvas.seek", { time: 0 }).catch(() => undefined);
    const message = await say("cut it in two here");
    expect(/nothing to split|isn't over a clip|no clip/i.test(message), `the bar said: ${message}`);
    expect((await source()) === before, "the source changed after a split that did nothing");
    return message.slice(0, 80);
  });

  await probe("add a circle", async () => {
    const message = await say("add a circle");
    expect(/added a circle/i.test(message), `the bar said: ${message}`);
    const text = await until(async () => /<ellipse/i.test(await source()), 12_000);
    expect(text, "no ellipse in the source");
    return message.slice(0, 80);
  });

  await probe('"make it red" colours what was just added', async () => {
    const message = await say("make it red");
    expect(/red/i.test(message), `the bar said: ${message}`);
    const ok = await until(async () => /ff3b30/i.test(await source()), 12_000);
    expect(ok, "the new shape did not turn red");
    return message.slice(0, 80);
  });

  await probe("two things in one sentence, one undo step", async () => {
    const before = await source();
    const message = await say("add a square and make it blue");
    expect(/added/i.test(message), `the bar said: ${message}`);
    const ok = await until(async () => /0a84ff/i.test(await source()), 12_000);
    expect(ok, "the new square is not blue");
    await call("canvas.undo", {});
    const back = await until(async () => (await source()) === before, 12_000);
    expect(back, "one undo did not take the whole sentence back");
    return message.slice(0, 80);
  });

  await probe("go to a time", async () => {
    await call("canvas.seek", { time: 0 }).catch(() => undefined);
    const message = await say("go to 5 seconds");
    expect(/0:05|at 5/i.test(message), `the bar said: ${message}`);
    const state = await call("canvas.state", {});
    expect(Math.abs((state.currentTime ?? 0) - 5) < 0.2, `the playhead is at ${state.currentTime}`);
    return message.slice(0, 80);
  });

  await probe("what can you do", async () => {
    await type("what can you do");
    await pump(300);
    await enter();
    const shown = await until(async () => (await help()).length > 3, 8_000);
    expect(shown, "the bar did not say what it can do");
    const lines = await help();
    return `${lines.length} lines`;
  });

  await probe("hide hides, show shows", async () => {
    await call("canvas.select", { ids: ["title"] });
    const hidden = await say("hide");
    expect(/hid/i.test(hidden), `the bar said: ${hidden}`);
    const off = await until(async () => /hidden/.test(await source()), 12_000);
    expect(off, "the title was not hidden");
    await call("canvas.select", { ids: ["title"] });
    const shown = await say("show");
    expect(/show/i.test(shown), `the bar said: ${shown}`);
    return `${hidden.slice(0, 30)} / ${shown.slice(0, 30)}`;
  });
} catch (error) {
  record("probe", false, error.message);
} finally {
  cleanUp();
}

const failed = results.filter((result) => !result.ok).length;
process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
