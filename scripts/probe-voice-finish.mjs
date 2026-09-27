#!/usr/bin/env node
// End-to-end probe of the voice bar's finish (Phase 4), on a live isolated
// instance, against local stand-ins for OpenRouter and Groq:
//
//   again          "again" repeats an exact command, as a step of its own
//   again, read    "again" repeats a command in your own words on the canvas as
//                  it is now: a step bigger than the last time
//   the journal    what was typed goes into the journal beside the write, and
//                  `posterract changes` shows it
//   history        ↑ walks back through what was typed, kept per project in
//                  .posterract/view.json across a reload
//   settings       with "apply right away" off, a sure reading waits for Enter;
//                  the talk key can be G, and then Q no longer listens; the
//                  speech provider is kept in api-keys.json
//   the hint       "Hold Q and say 'split' — or press ⌘K" shows once
//
// THIS PROBE EDITS THE PROJECT, its api-keys.json and its view.json. It runs
// only against an isolated instance started with POSTERRACT_FAKE_MIC=1, and a
// scratch project, and it puts the source and the keys back as it found them:
//
//   POSTERRACT_PROFILE=agenttest node scripts/probe-voice-finish.mjs <scratch-project-dir> [cdp-port]
//
// The project needs one scene with a text "Wild storm" (id "title") and a
// shape (id "card"). Exits 0 pass, 1 fail, 2 cannot run.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
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
      "  POSTERRACT_PROFILE=<profile> node scripts/probe-voice-finish.mjs <scratch-project-dir> [cdp-port]\n" +
      "Start the instance with POSTERRACT_FAKE_MIC=1 so the system is never asked for the microphone.\n",
  );
  process.exit(2);
}
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// `posterract changes` as the CLI computes it: its offline module, built as the CLI builds it (CommonJS).
const esbuild = createRequire(join(REPO, "apps/desktop/package.json"))("esbuild");
const bundle = mkdtempSync(join(tmpdir(), "posterract-offline-"));
await esbuild.build({
  entryPoints: [join(REPO, "packages/posterract-cli/src/offline.ts")],
  bundle: true, platform: "node", format: "cjs", outfile: join(bundle, "offline.cjs"), logLevel: "error",
});
const offline = createRequire(import.meta.url)(join(bundle, "offline.cjs"));
rmSync(bundle, { recursive: true, force: true });

// ---- the stand-ins ------------------------------------------------------------

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
const script = (command, answers) => fetch(`${decisionsUrl}/script`, { method: "POST", body: JSON.stringify({ command, answers }) });


const KEYS_FILE = join(dir, "api-keys.json");
const KEYS_BEFORE = existsSync(KEYS_FILE) ? readFileSync(KEYS_FILE, "utf8") : null;
writeFileSync(KEYS_FILE, `${JSON.stringify({
  openrouter: "stub-key-not-real", decisionsUrl: `${decisionsUrl}/api/alpha/decisions`,
  transcribe: "stub-key-not-real", transcribeUrl: speechUrl, transcribeModel: "whisper-large-v3-turbo",
}, null, 2)}\n`);
function cleanUp() {
  if (KEYS_BEFORE === null) rmSync(KEYS_FILE, { force: true });
  else writeFileSync(KEYS_FILE, KEYS_BEFORE);
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
async function until(test, ms = 8_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(80)) { await frame(); if (await test()) return true; }
  return false;
}

const KEYS = {
  Meta: { code: "MetaLeft", keyCode: 91 }, Escape: { code: "Escape", keyCode: 27 }, Enter: { code: "Enter", keyCode: 13 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 }, k: { code: "KeyK", keyCode: 75 }, q: { code: "KeyQ", keyCode: 81 }, g: { code: "KeyG", keyCode: 71 },
};
async function key(name, { down = true, up = true, modifiers = 0, text } = {}) {
  const { code, keyCode } = KEYS[name];
  if (down) await cdp("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: name, code, windowsVirtualKeyCode: keyCode, modifiers, ...(text ? { text } : {}) });
  if (up) await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: keyCode, modifiers });
}
async function command(name) {
  await key("Meta", { up: false, modifiers: 4 });
  await key(name, { modifiers: 4 });
  await frame();
  await key("Meta", { down: false });
  await frame();
}
const mode = () => evaluate("document.querySelector('.posterract-voice')?.dataset.mode ?? null");
const note = () => evaluate("document.querySelector('.posterract-voice-note')?.textContent ?? ''");
const inputValue = () => evaluate("document.querySelector('.posterract-voice-input')?.value ?? null");

async function type(sentence) {
  if ((await mode()) !== "typing") {
    await evaluate("document.activeElement?.blur?.()");
    await command("k");
    if (!(await until(async () => (await mode()) === "typing", 4_000))) throw new Error(`⌘K left the bar in ${await mode()}`);
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
/** Opens the bar's settings (the gear at the end of the open bar) and clicks what `selector` finds in them. */
async function inSettings(selector) {
  await type("");
  const opened = await evaluate(`(() => { const gear = document.querySelector('.posterract-voice-settings'); gear?.click(); return !!gear; })()`);
  if (!opened) throw new Error("no settings button in the open bar");
  if (!(await until(() => evaluate("!!document.querySelector('.posterract-voice-settings-menu')"), 3_000))) throw new Error("the settings did not open");
  const clicked = await evaluate(`(() => { const target = ${selector}; target?.click(); return !!target; })()`);
  if (!clicked) throw new Error(`nothing in the settings matched ${selector}`);
  await pump(300);
  await key("Escape");
  await pump(150);
  await closeBar();
}
const option = (text) => `[...document.querySelectorAll('.posterract-voice-settings-menu .posterract-voice-option')].find((button) => button.textContent.trim() === ${JSON.stringify(text)})`;

async function reopen() {
  await cdp("Page.reload", { ignoreCache: true });
  await sleep(3_000);
  await call("open", { dir }, 120_000);
  for (let waited = 0; waited < 30_000 && (await call("context", { tree: false })).shownRevision == null; waited += 250) await sleep(250);
  await until(async () => (await mode()) !== null, 10_000);
}

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

// ---- setup --------------------------------------------------------------------

try {
  await attach();
  await cdp("Runtime.enable");
  await cdp("Page.navigate", { url: "posterract-app://app/editor-sandbox/#/" });
  await sleep(3_000);
  await reopen();
} catch (error) {
  cleanUp();
  process.stdout.write(`Cannot reach the isolated instance (${error.message}). Start it with POSTERRACT_PROFILE=${profile} POSTERRACT_FAKE_MIC=1 and --remote-debugging-port=${port}.\n`);
  process.exit(2);
}

const entry = (await call("source.read", { path: "auto", lines: [1, 1] })).path;
const FILE = join(dir, entry);
const ORIGINAL = readFileSync(FILE, "utf8");
const read = () => readFileSync(FILE, "utf8");
const rects = (text = read()) => (text.match(/<rect\b/g) ?? []).length;
const journal = () => readFileSync(join(dir, ".posterract", "journal.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const viewState = () => JSON.parse(readFileSync(join(dir, ".posterract", "view.json"), "utf8"));
const scaleOf = (id, text = read()) => Number(new RegExp(`<[a-z]+\\s+id="${id}"[^>]*\\sscale=\\{([\\d.]+)\\}`).exec(text)?.[1] ?? 1);
async function undoTo(before, steps) {
  for (let step = 0; step < steps; step += 1) await call("canvas.undo");
  return until(() => read() === before, 8_000);
}

try {
  await probe("\"again\" repeats an exact command, as a step of its own", async () => {
    await call("canvas.select", { ids: ["card"] });
    const before = read();
    await type("duplicate");
    await enter();
    expect(await until(() => rects() === rects(before) + 1, 8_000), "duplicate did not run");
    const once = read();
    await type("again");
    await enter();
    expect(await until(() => rects() === rects(before) + 2, 8_000), `"again" left ${rects() - rects(before)} copies`);
    const receipt = await note();
    await closeBar();
    await call("canvas.undo");
    expect(await until(() => read() === once, 8_000), "one undo did not take back just the second copy");
    expect(await undoTo(before, 1), "the first copy did not undo");
    return `receipt: "${receipt}"`;
  });

  await probe("\"again\" repeats a command in your own words on the canvas as it is now", async () => {
    await script("make the card a little bigger", {
      action: { choice: "edit-properties", confidence: 0.93 }, target: { choice: "card", confidence: 0.95 },
      size: { choice: "bigger", confidence: 0.95 }, amount: { score: 0, confidence: 0.9 },
    });
    const before = read();
    await type("make the card a little bigger");
    await pump(500);
    await enter();
    expect(await until(() => scaleOf("card") === 1.15, 8_000), `scale is ${scaleOf("card")}`);
    await type("do that again");
    await enter();
    expect(await until(() => scaleOf("card") === 1.32, 8_000), `after "do that again" the scale is ${scaleOf("card")}`);
    await closeBar();
    expect(await undoTo(before, 2), "two undos did not take both steps back");
    return "1 → 1.15 → 1.32, each one undo step";
  });

  await probe("what was typed goes into the journal beside the write, and `posterract changes` shows it", async () => {
    await call("canvas.select", { ids: ["card"] });
    const before = read();
    await type("duplicate");
    await enter();
    expect(await until(() => rects() === rects(before) + 1, 8_000), "duplicate did not run");
    expect(await until(() => journal().at(-1)?.note === 'typed "duplicate"', 8_000), `the last journal entry says ${JSON.stringify(journal().at(-1))}`);
    const last = journal().at(-1);
    expect(last.actor === "canvas", `the write is journalled as ${last.actor}`);
    const report = offline.changes(dir, { limit: 1 });
    const lines = report.lines.join("\n");
    expect(/person\s+typed "duplicate"/.test(lines), `posterract changes says:\n${lines}`);
    await closeBar();
    expect(await undoTo(before, 1), "the duplicate did not undo");
    return report.lines.slice(1).join(" | ");
  });

  await probe("↑ walks back through what was typed, kept per project across a reload", async () => {
    await type("zoom to fit");
    await enter();
    await pump(300);
    await type("zoom out");
    await enter();
    await pump(300);
    await closeBar();
    expect(await until(() => { try { return JSON.stringify(viewState().voice?.slice(-2)) === JSON.stringify(["zoom to fit", "zoom out"]); } catch { return false; } }, 6_000), `view.json keeps ${JSON.stringify(existsSync(join(dir, ".posterract", "view.json")) ? viewState().voice : null)}`);
    await reopen();
    await type("");
    await key("ArrowUp");
    await pump(150);
    const newest = await inputValue();
    await key("ArrowUp");
    await pump(150);
    const older = await inputValue();
    expect(newest === "zoom out" && older === "zoom to fit", `after a reload ↑ gives "${newest}", then "${older}"`);
    return `↑ "${newest}", ↑ "${older}"`;
  });

  await probe("with \"apply right away\" off, a sure reading waits for Enter", async () => {
    const sentence = "put the title in the lower third and fade it in";
    await script(sentence, {
      action: { choice: "edit-properties", confidence: 0.93 }, target: { choice: "title", confidence: 0.97 },
      said_place: { noul: 0.96 }, value_place: { choice: "lower-third", confidence: 0.94 },
      said_animation: { noul: 0.95 }, anim_type: { choice: "fade", confidence: 0.92 }, anim_phase: { choice: "in", confidence: 0.97 },
    });
    await inSettings(`document.querySelector('.posterract-voice-settings-menu input[aria-label="Apply clear commands right away"]')`);
    const before = read();
    try {
      await type(sentence);
      await pump(500);
      await enter();
      expect(await until(async () => (await mode()) === "confirm", 8_000), `the mode is ${await mode()}`);
      await pump(500);
      expect(read() === before, "it was applied without Enter");
      await key("Escape");
    } finally {
      await closeBar();
      await inSettings(`document.querySelector('.posterract-voice-settings-menu input[aria-label="Apply clear commands right away"]')`);
    }
    expect(await evaluate("localStorage.getItem('posterract.voice.applyAutomatically')") === "on", "the setting did not come back on");
    return "held for Enter; the setting is back on";
  });

  await probe("the talk key can be G, and then Q no longer listens", async () => {
    await evaluate(`(() => {
      if (window.__fakeMic) return;
      const ctx = new AudioContext();
      const destination = ctx.createMediaStreamDestination();
      window.__fakeMic = { speak: () => { void ctx.resume(); } };
      navigator.mediaDevices.getUserMedia = async () => destination.stream;
    })()`);
    await inSettings(option("G"));
    try {
      expect(await evaluate("localStorage.getItem('posterract.voice.talkKey')") === "g", "G was not kept");
      await evaluate("document.activeElement?.blur?.()");
      await key("g", { up: false });
      expect(await until(async () => (await mode()) === "listening", 5_000), `holding G left the bar in ${await mode()}`);
      await key("g", { down: false });
      await until(async () => (await mode()) === "idle", 4_000);
      await key("q", { up: false });
      await pump(600);
      const withQ = await mode();
      await key("q", { down: false });
      expect(withQ === "idle", `holding Q put the bar in ${withQ}`);
      const tip = await evaluate("document.querySelector('.posterract-voice-pill')?.getAttribute('aria-label') ?? ''");
      return `G listens, Q does nothing (${tip})`;
    } finally {
      await closeBar();
      await inSettings(option("Q"));
    }
  });

  await probe("the speech provider is kept in the project's api-keys.json", async () => {
    await inSettings(option("xAI"));
    expect(await until(() => JSON.parse(readFileSync(KEYS_FILE, "utf8")).voiceProvider === "xai", 5_000), "xAI was not saved");
    await inSettings(option("Groq"));
    expect(await until(() => JSON.parse(readFileSync(KEYS_FILE, "utf8")).voiceProvider === "openai-compatible", 5_000), "Groq was not saved back");
    return "xAI, then Groq, saved";
  });

  await probe("the first-run hint shows once", async () => {
    await evaluate("localStorage.removeItem('posterract.voice.hintSeen')");
    await reopen();
    const hint = await evaluate("document.querySelector('.posterract-voice-hint')?.textContent ?? null");
    expect(hint === "Hold Q and say 'split' — or press ⌘K", `the hint says ${JSON.stringify(hint)}`);
    await type("");
    await pump(200);
    await closeBar();
    expect(await evaluate("document.querySelector('.posterract-voice-hint') === null"), "the hint is still up after the bar was used");
    await reopen();
    expect(await evaluate("document.querySelector('.posterract-voice-hint') === null"), "the hint came back after a reload");
    return `"${hint}"`;
  });
} finally {
  if (read() !== ORIGINAL) writeFileSync(FILE, ORIGINAL);
  cleanUp();
  ws?.close();
}

const failed = results.filter((result) => !result.ok).length;
process.stdout.write(`\n${results.length} probes: ${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
