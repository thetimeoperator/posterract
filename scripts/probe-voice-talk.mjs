#!/usr/bin/env node
// End-to-end probe of the voice bar's voice in (Phase 2), on a live isolated
// instance, with a synthetic microphone and a local stand-in for Groq — no
// real microphone, no real key, no real call:
//
//   the wave      rises with the voice and settles within 400 ms of silence
//   the request   carries model, language, prompt and a non-empty file
//   silence       a hold with nothing said sends nothing
//   split         a spoken "split" splits the clip at the playhead; "undo" puts it back
//   restack       a spoken "bring to front" restacks the selection
//   delete        a spoken "delete" asks first, and Escape leaves the file be
//   focus         a hold the window loses focus in the middle of sends nothing
//   latency       key-up to words in the bar, against the stand-in
//
// THIS PROBE EDITS THE PROJECT and writes its api-keys.json (a dummy key
// pointing at the stand-in). It runs only against an isolated instance started
// with POSTERRACT_FAKE_MIC=1 (so macOS is never asked for the microphone) and
// a scratch project, and it puts the source back as it found it:
//
//   POSTERRACT_PROFILE=agenttest node scripts/probe-voice-talk.mjs <scratch-project-dir> [cdp-port]
//
// The project needs one scene with a text element (id "title") and a second
// element (id "card"), both starting at 0. Exits 0 pass, 1 fail, 2 cannot run.

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
    "This probe edits the project it runs on, so it only runs against an isolated instance and a scratch copy:\n" +
      "  POSTERRACT_PROFILE=<profile> node scripts/probe-voice-talk.mjs <scratch-project-dir> [cdp-port]\n" +
      "Start the instance with POSTERRACT_FAKE_MIC=1 so the system is never asked for the microphone.\n",
  );
  process.exit(2);
}
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- the stand-in -----------------------------------------------------------

const stub = spawn(process.execPath, [join(REPO, "scripts/stub-transcribe.mjs"), "0"], { stdio: ["ignore", "pipe", "inherit"] });
const stubUrl = await new Promise((done, fail) => {
  stub.stdout.on("data", (chunk) => {
    const match = /listening on (http:\/\/[^\s]+)/.exec(String(chunk));
    if (match) done(match[1]);
  });
  stub.on("exit", () => fail(new Error("the stand-in did not start")));
});
const stubCall = async (path, payload) => (await fetch(`${stubUrl}${path}`, payload ? { method: "POST", body: JSON.stringify(payload) } : undefined)).json();
const say = (text) => stubCall("/next", { text });

const KEYS_FILE = join(dir, "api-keys.json");
const KEYS_BEFORE = existsSync(KEYS_FILE) ? readFileSync(KEYS_FILE, "utf8") : null;
writeFileSync(KEYS_FILE, `${JSON.stringify({ transcribe: "stub-key-not-real", transcribeUrl: stubUrl, transcribeModel: "whisper-large-v3-turbo" }, null, 2)}\n`);

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
/** The editor reads keys and the meter once a frame; a hidden window draws one when captured. */
const frame = () => cdp("Page.captureScreenshot", { format: "jpeg", quality: 1, clip: { x: 0, y: 0, width: 4, height: 4, scale: 1 } });
async function pump(ms, every = 50, each) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(every)) { await frame(); await each?.(); }
}
async function until(test, ms = 8_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(80)) { await frame(); if (await test()) return true; }
  return false;
}
const KEY = { q: { code: "KeyQ", keyCode: 81 }, Escape: { code: "Escape", keyCode: 27 } };
const keyDown = (name) => cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code: KEY[name].code, windowsVirtualKeyCode: KEY[name].keyCode });
const keyUp = (name) => cdp("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: KEY[name].code, windowsVirtualKeyCode: KEY[name].keyCode });
const mode = () => evaluate("document.querySelector('.posterract-voice')?.dataset.mode ?? null");
const barText = () => evaluate("document.querySelector('.posterract-voice-line')?.textContent ?? ''");
const wave = () => evaluate("(() => { const c = [...document.querySelectorAll('.posterract-voice-bar canvas')].find(x => x.siriWave); return c ? { ...c.siriWave } : null; })()");
const speak = (on) => evaluate(`window.__fakeMic.speak(${on})`);

/**
 * Holds the talk key: speech for `speechMs` (or silence), then `silenceMs` of
 * quiet with the key still down, then lets go. Returns the loudest the wave
 * got while speaking and how long it took to settle after.
 */
async function hold({ speechMs = 900, silenceMs = 500, loud = true, beforeRelease } = {}) {
  await evaluate("document.activeElement?.blur?.()");
  await keyDown("q");
  const listening = await until(async () => (await mode()) === "listening", 5_000);
  let peak = 0;
  let settledAfter = null;
  if (listening) {
    await speak(loud);
    await pump(speechMs, 40, async () => { const w = await wave(); if (w) peak = Math.max(peak, w.amp); });
    await speak(false);
    const quietFrom = Date.now();
    await pump(silenceMs, 40, async () => {
      const w = await wave();
      if (w && settledAfter === null && w.amp < 0.1) settledAfter = Date.now() - quietFrom;
    });
    await beforeRelease?.();
  }
  const releasedAt = Date.now();
  await keyUp("q");
  await frame();
  return { listening, peak, settledAfter, releasedAt };
}

// ---- results ----------------------------------------------------------------

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
}
async function probe(name, run) {
  try { record(name, true, (await run()) ?? ""); } catch (error) { record(name, false, error.message); }
}
function expect(condition, message) { if (!condition) throw new Error(message); }

// ---- setup --------------------------------------------------------------------

try {
  await attach();
  await cdp("Runtime.enable");
  await cdp("Page.navigate", { url: "posterract-app://app/editor-sandbox/#/" });
  await sleep(3_000);
  await cdp("Page.reload", { ignoreCache: true });
  await sleep(3_000);
  await call("open", { dir }, 120_000);
  for (let waited = 0; waited < 30_000 && (await call("context", { tree: false })).shownRevision == null; waited += 250) await sleep(250);
} catch (error) {
  stub.kill();
  if (KEYS_BEFORE === null) rmSync(KEYS_FILE, { force: true }); else writeFileSync(KEYS_FILE, KEYS_BEFORE);
  process.stdout.write(`Cannot reach the isolated instance (${error.message}). Start it with POSTERRACT_PROFILE=${profile} POSTERRACT_FAKE_MIC=1 and --remote-debugging-port=${port}.\n`);
  process.exit(2);
}

await until(async () => (await mode()) !== null, 10_000);
await evaluate(`(() => {
  if (window.__fakeMic) return;
  const ctx = new AudioContext();
  const destination = ctx.createMediaStreamDestination();
  const tone = ctx.createOscillator();
  tone.type = 'sawtooth';
  tone.frequency.value = 170;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  tone.connect(gain).connect(destination);
  tone.start();
  window.__fakeMic = { speak: (on) => { void ctx.resume(); gain.gain.setTargetAtTime(on ? 0.6 : 0, ctx.currentTime, 0.01); } };
  navigator.mediaDevices.getUserMedia = async () => destination.stream;
})()`);

const entry = (await call("source.read", { path: "auto", lines: [1, 1] })).path;
const FILE = join(dir, entry);
const ORIGINAL = readFileSync(FILE, "utf8");
const read = () => readFileSync(FILE, "utf8");
/** Clips in the source: a split leaves one more of each clip it cut, the two halves wrapped in a sequence. */
const clipCount = (text) => (text.match(/<(text|rect)\b/g) ?? []).length;

try {
  await probe("the wave rises with the voice, settles within 400 ms of silence, and the request carries what it should", async () => {
    await say("zoom to fit");
    const before = (await stubCall("/last")).count;
    const held = await hold();
    expect(held.listening, "the bar never started listening");
    expect(held.peak > 0.5, `the wave only reached ${held.peak.toFixed(2)} while speaking`);
    expect(held.settledAfter !== null && held.settledAfter <= 400, `it settled after ${held.settledAfter ?? "more than 500"} ms`);
    expect(await until(async () => (await stubCall("/last")).count > before), "no request reached the stand-in");
    const { last } = await stubCall("/last");
    expect(last.fields.model === "whisper-large-v3-turbo", `model: ${last.fields.model}`);
    expect(last.fields.language === "en", `language: ${last.fields.language}`);
    expect((last.fields.prompt ?? "").length > 20, "no vocabulary prompt");
    expect(last.file && last.file.bytes > 0, "the file was empty");
    expect(last.authorization === "present", "no key was sent");
    return `peak ${held.peak.toFixed(2)}, settled in ${held.settledAfter} ms, file ${last.file.bytes} bytes, prompt ${last.fields.prompt.length} chars`;
  });

  await probe("a hold with nothing said sends nothing", async () => {
    await until(async () => (await mode()) === "idle", 6_000);
    const before = (await stubCall("/last")).count;
    const held = await hold({ loud: false, speechMs: 700 });
    expect(held.listening, "the bar never started listening");
    await pump(1_200);
    expect((await stubCall("/last")).count === before, "a request was sent for silence");
    expect(await until(async () => (await mode()) === "idle", 3_000), `the bar is left in ${await mode()}`);
  });

  await probe("a spoken \"split\" splits the clip at the playhead, and the latency is measured", async () => {
    await until(async () => (await mode()) === "idle", 6_000);
    // Selecting inside the scene makes it the one the playhead belongs to.
    await call("canvas.select", { ids: ["title"] });
    await call("canvas.seek", { time: 1.5 });
    await pump(300);
    await say("split");
    const before = read();
    const held = await hold();
    expect(held.listening, "the bar never started listening");
    const heard = await until(async () => (await barText()).toLowerCase().includes("split"), 6_000);
    const wordsAfter = Date.now() - held.releasedAt;
    expect(heard, "the words never reached the bar");
    expect(await until(() => clipCount(read()) > clipCount(before), 8_000), `clips ${clipCount(before)} → ${clipCount(read())}`);
    expect(/<sequence\b/.test(read()), "the halves are not wrapped in a sequence");
    const measured = await evaluate("document.querySelector('.posterract-voice')?.dataset.latency ?? null");
    await until(async () => (await mode()) === "idle", 6_000);
    await say("undo");
    expect((await hold()).listening, "the bar never started listening for \"undo\"");
    expect(await until(() => read() === before, 8_000), "a spoken \"undo\" did not put the file back");
    return `key-up to words: ${measured ?? "?"} ms in the app (${wordsAfter} ms as the probe saw it); a spoken "undo" put it back`;
  });

  await probe("a spoken \"bring to front\" restacks the selection, and a spoken \"undo\" takes it back", async () => {
    await until(async () => (await mode()) === "idle", 6_000);
    await call("canvas.select", { ids: ["title"] });
    const before = read();
    const order = (text) => ["title", "card"].sort((a, b) => text.indexOf(`id="${a}"`) - text.indexOf(`id="${b}"`)).join(" under ");
    await say("bring to front");
    expect((await hold()).listening, "the bar never started listening");
    expect(await until(() => order(read()) === "card under title", 8_000), `the order is ${order(read())}`);
    await until(async () => (await mode()) === "idle", 6_000);
    await say("undo");
    expect((await hold()).listening, "the bar never started listening for \"undo\"");
    expect(await until(() => read() === before, 8_000), "a spoken \"undo\" did not put the file back");
    return `${order(before)} → card under title → back`;
  });

  await probe("a spoken \"delete\" asks first, and Escape leaves the file as it was", async () => {
    await until(async () => (await mode()) === "idle", 6_000);
    await call("canvas.select", { ids: ["card"] });
    await say("delete");
    const before = read();
    const held = await hold();
    expect(held.listening, "the bar never started listening");
    expect(await until(async () => (await mode()) === "confirm", 8_000), `the mode is ${await mode()}`);
    const question = await barText();
    expect(/Enter to confirm/.test(question), `the bar says "${question}"`);
    await pump(600);
    expect(read() === before, "the file changed before the answer");
    await keyDown("Escape");
    await keyUp("Escape");
    expect(await until(async () => (await mode()) === "idle", 3_000), `after Escape the mode is ${await mode()}`);
    await pump(400);
    expect(read() === before, "the file changed after Escape");
    return `asked: "${question}"`;
  });

  await probe("a hold the window loses focus in the middle of sends nothing", async () => {
    await until(async () => (await mode()) === "idle", 6_000);
    await say("duplicate");
    const before = (await stubCall("/last")).count;
    const held = await hold({ speechMs: 500, silenceMs: 100, beforeRelease: async () => {
      await evaluate("window.dispatchEvent(new Event('blur'))");
      await pump(400);
    } });
    expect(held.listening, "the bar never started listening");
    await pump(1_200);
    expect((await stubCall("/last")).count === before, "a request was sent after focus was lost");
    expect(await until(async () => (await mode()) === "idle", 3_000), `the bar is left in ${await mode()}`);
  });
} finally {
  if (read() !== ORIGINAL) writeFileSync(FILE, ORIGINAL);
  if (KEYS_BEFORE === null) rmSync(KEYS_FILE, { force: true }); else writeFileSync(KEYS_FILE, KEYS_BEFORE);
  stub.kill();
  ws?.close();
}

const failed = results.filter((result) => !result.ok).length;
process.stdout.write(`\n${results.length} probes: ${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
