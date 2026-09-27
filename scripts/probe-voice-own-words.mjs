#!/usr/bin/env node
// End-to-end probe of the voice bar's own-words commands (Phase 3), on a live
// isolated instance, against local stand-ins for OpenRouter's decisions
// endpoint and for Groq — no real key, no real call:
//
//   the example    "put the title in the lower third and fade it in", typed with
//                  nothing selected: read while typing (never applied from
//                  there), applied on Enter as one undo step, the receipt says
//                  what it did, and the request is what the plan says
//   confirm        a reading that is not sure shows its chips and a dashed
//                  outline, and asks; Escape leaves the file, Enter applies
//   choose         a reading too unsure to guess offers numbered choices, drawn
//                  on the canvas too; pressing 2 picks the second
//   delete         asks first, however sure the reading
//   a note         a sentence that needs writing becomes an @agent marker at the
//                  playhead
//   live           typing on calls off the reading in flight
//   spoken         the example, said: the same one undo step
//   no key         exact commands still run; own words ask for the key
//
// THIS PROBE EDITS THE PROJECT and writes its api-keys.json (dummy keys that
// point at the stand-ins). It runs only against an isolated instance started
// with POSTERRACT_FAKE_MIC=1, and a scratch project, and it puts the source and
// the keys file back as it found them:
//
//   POSTERRACT_PROFILE=agenttest node scripts/probe-voice-own-words.mjs <scratch-project-dir> [cdp-port]
//
// The project needs one scene with a text "Wild storm" (id "title") and a
// shape (id "card"), both on screen for the first seconds. Exits 0 pass, 1
// fail, 2 cannot run.

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
      "  POSTERRACT_PROFILE=<profile> node scripts/probe-voice-own-words.mjs <scratch-project-dir> [cdp-port]\n" +
      "Start the instance with POSTERRACT_FAKE_MIC=1 so the system is never asked for the microphone.\n",
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
const get = (base, path) => fetch(`${base}${path}`).then((reply) => reply.json());
const script = (command, answers, delayMs) => post(decisionsUrl, "/script", { command, answers, ...(delayMs ? { delayMs } : {}) });

const KEYS_FILE = join(dir, "api-keys.json");
const KEYS_BEFORE = existsSync(KEYS_FILE) ? readFileSync(KEYS_FILE, "utf8") : null;
const writeKeys = (keys) => writeFileSync(KEYS_FILE, `${JSON.stringify(keys, null, 2)}\n`);
const STUB_KEYS = {
  openrouter: "stub-key-not-real",
  decisionsUrl: `${decisionsUrl}/api/alpha/decisions`,
  transcribe: "stub-key-not-real",
  transcribeUrl: speechUrl,
  transcribeModel: "whisper-large-v3-turbo",
};
writeKeys(STUB_KEYS);

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
/** The editor reads keys once a frame; a hidden window draws one when captured. */
const frame = () => cdp("Page.captureScreenshot", { format: "jpeg", quality: 1, clip: { x: 0, y: 0, width: 4, height: 4, scale: 1 } });
async function pump(ms, every = 50, each) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(every)) { await frame(); await each?.(); }
}
async function until(test, ms = 8_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(80)) { await frame(); if (await test()) return true; }
  return false;
}

const KEYS = {
  Meta: { code: "MetaLeft", keyCode: 91 }, Escape: { code: "Escape", keyCode: 27 }, Enter: { code: "Enter", keyCode: 13 },
  k: { code: "KeyK", keyCode: 75 }, q: { code: "KeyQ", keyCode: 81 }, 2: { code: "Digit2", keyCode: 50 },
};
async function key(name, { down = true, up = true, modifiers = 0, text } = {}) {
  const { code, keyCode } = KEYS[name];
  if (down) await cdp("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: String(name), code, windowsVirtualKeyCode: keyCode, modifiers, ...(text ? { text } : {}) });
  if (up) await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: String(name), code, windowsVirtualKeyCode: keyCode, modifiers });
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
const line = () => evaluate("document.querySelector('.posterract-voice-line')?.textContent ?? ''");
const chips = () => evaluate("[...document.querySelectorAll('.posterract-voice-chip')].map((chip) => ({ text: chip.textContent, unsure: chip.classList.contains('is-unsure') }))");
const outlines = () => evaluate("document.querySelectorAll('.posterract-voice-ghost').length");
const numbers = () => evaluate("document.querySelectorAll('.posterract-voice-ghost-number').length");
const choices = () => evaluate("[...document.querySelectorAll('.posterract-voice-choice')].map((row) => row.textContent)");

/** Opens the bar (if it is not open) and types `sentence` into it, over whatever was there. */
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
  await cdp("Page.reload", { ignoreCache: true });
  await sleep(3_000);
  await call("open", { dir }, 120_000);
  for (let waited = 0; waited < 30_000 && (await call("context", { tree: false })).shownRevision == null; waited += 250) await sleep(250);
} catch (error) {
  cleanUp();
  process.stdout.write(`Cannot reach the isolated instance (${error.message}). Start it with POSTERRACT_PROFILE=${profile} POSTERRACT_FAKE_MIC=1 and --remote-debugging-port=${port}.\n`);
  process.exit(2);
}
await until(async () => (await mode()) !== null, 10_000);

const entry = (await call("source.read", { path: "auto", lines: [1, 1] })).path;
const FILE = join(dir, entry);
const ORIGINAL = readFileSync(FILE, "utf8");
const read = () => readFileSync(FILE, "utf8");
/**
 * The source as its elements say it: each tag's attributes in one order, and
 * whitespace that JSX ignores dropped. An undo puts back every value; the
 * writer may put a restored attribute at the end of its tag, or leave a
 * closing tag on its own line.
 */
const meaning = (source) => source
  .replace(/<([a-zA-Z]+)((?:\s+[a-zA-Z]+=(?:"[^"]*"|\{[^}]*\}))*)\s*(\/?)>/g, (_, tag, attributes, close) =>
    `<${tag} ${(attributes.match(/[a-zA-Z]+=(?:"[^"]*"|\{[^}]*\})/g) ?? []).sort().join(" ")}${close}>`)
  .replace(/>\s+/g, ">").replace(/\s+</g, "<");
/** One undo, and the file says what it said before: `true` byte for byte, "same" when only the order of its attributes or its line breaks moved. */
const back = async (before) => {
  await call("canvas.undo");
  if (await until(() => read() === before, 4_000)) return true;
  return (await until(() => meaning(read()) === meaning(before), 4_000)) ? "same" : false;
};
const undone = (outcome) => (outcome === true ? "one undo put it back byte for byte" : "one undo put back every value (the writer moved restored attributes to the end of the tag)");

const EXAMPLE = "put the title in the lower third and fade it in";
const SURE = {
  action: { choice: "edit-properties", confidence: 0.93 },
  target: { choice: "title", confidence: 0.97, probabilities: { title: 0.97, card: 0.02 } },
  said_place: { noul: 0.96 },
  value_place: { choice: "lower-third", confidence: 0.94, probabilities: { "lower-third": 0.94, bottom: 0.04 } },
  said_animation: { noul: 0.95 },
  anim_type: { choice: "fade", confidence: 0.92 },
  anim_phase: { choice: "in", confidence: 0.97 },
};

try {
  await probe("the example, typed with nothing selected: read while typing, applied on Enter as one undo step", async () => {
    await script(EXAMPLE, SURE);
    await call("canvas.select", { ids: [] });
    const before = read();
    await type(EXAMPLE);
    expect(await until(async () => (await chips()).length >= 3, 8_000), `no reading while typing (chips: ${JSON.stringify(await chips())})`);
    const shown = (await chips()).map((chip) => chip.text);
    await pump(400);
    expect(read() === before, "the live reading changed the file");
    await enter();
    const applied = () => /<text[^>]*id="title"[^>]*place="lower-third"/.test(read()) && /<animation[^>]*type="fade"[^>]*phase="in"/.test(read());
    expect(await until(applied, 8_000), "the title was not placed and faded in");
    const receipt = await note();
    expect(receipt === "Moved Wild storm → lower third · added fade in · ⌘Z", `the receipt says "${receipt}"`);

    const { last } = await get(decisionsUrl, "/last");
    expect(last.model === "typesafe/jev-1.13-20260917", `model: ${last.model}`);
    expect(last.state?.command === EXAMPLE, `state.command: ${last.state?.command}`);
    expect(last.state?.elements?.some((element) => element.id === "title" && element.text === "Wild storm"), "the title is not in the state");
    expect(Array.isArray(last.state?.selected) && last.state.selected.length === 0, "the selection was not empty");
    for (const [id, kind] of [["action", "choice"], ["target", "choice"], ["target_all", "noul"], ["said_place", "noul"], ["value_place", "choice"], ["anim_type", "choice"], ["amount", "score"]]) {
      expect(last.questions[id] === kind, `question ${id} is ${last.questions[id]}`);
    }
    expect(last.authorization === "present", "no key was sent");
    await closeBar();
    const outcome = await back(before);
    expect(outcome, "one undo did not take it all back");
    return `chips while typing: ${shown.join(" | ")}; receipt: "${receipt}"; ${Object.keys(last.questions).length} questions, ${Math.round(last.bytes / 1024)} KB; ${undone(outcome)}`;
  });

  await probe("a reading that is not sure shows its chips and an outline, and asks: Escape leaves the file, Enter applies", async () => {
    const sentence = "move the card down low";
    await script(sentence, {
      action: { choice: "edit-properties", confidence: 0.9 },
      target: { choice: "card", confidence: 0.9 },
      said_place: { noul: 0.9 },
      value_place: { choice: "bottom", confidence: 0.62, probabilities: { bottom: 0.62, "lower-third": 0.3 } },
    });
    const before = read();
    await type(sentence);
    await until(async () => (await chips()).length >= 2, 6_000);
    await enter();
    expect(await until(async () => (await mode()) === "confirm", 8_000), `the mode is ${await mode()}`);
    const asked = await line();
    expect(/Enter to apply/.test(asked), `the bar says "${asked}"`);
    const shown = await chips();
    expect(shown.some((chip) => chip.unsure), `no chip is marked unsure: ${JSON.stringify(shown)}`);
    expect((await outlines()) >= 1, "no outline on the canvas");
    await pump(500);
    expect(read() === before, "the file changed before the answer");
    await key("Escape");
    expect(await until(async () => (await mode()) === "typing", 3_000), `after Escape the mode is ${await mode()}`);
    await pump(300);
    expect(read() === before, "the file changed after Escape");

    await enter();
    expect(await until(async () => (await mode()) === "confirm", 8_000), `asked again, the mode is ${await mode()}`);
    await key("Enter");
    expect(await until(() => /<rect[^>]*id="card"[^>]*place="bottom"/.test(read()), 8_000), "Enter did not apply it");
    await closeBar();
    const outcome = await back(before);
    expect(outcome, "one undo did not take it all back");
    return `chips: ${shown.map((chip) => `${chip.text}${chip.unsure ? " (unsure)" : ""}`).join(" | ")}; ${undone(outcome)}`;
  });

  await probe("a reading too unsure to guess offers numbered choices, on the canvas too; 2 picks the second", async () => {
    const sentence = "make that one pop";
    await script(sentence, {
      action: { choice: "edit-properties", confidence: 0.9 },
      target: { choice: "title", confidence: 0.35, probabilities: { title: 0.35, card: 0.33 } },
      said_scale: { noul: 0.9 },
      size: { choice: "bigger", confidence: 0.9 },
      amount: { score: 0.5, confidence: 0.9 },
    });
    const before = read();
    await type(sentence);
    await pump(400);
    await enter();
    expect(await until(async () => (await mode()) === "choose", 8_000), `the mode is ${await mode()}`);
    const rows = await choices();
    expect(rows.length === 2, `choices: ${JSON.stringify(rows)}`);
    expect(await until(async () => (await numbers()) === 2, 3_000), `${await numbers()} numbers on the canvas`);
    await key(2, { text: "2" });
    expect(await until(() => /<rect[^>]*id="card"[^>]*scale=\{1\.3\}/.test(read()), 8_000), "pressing 2 did not make the card bigger");
    const receipt = await note();
    await closeBar();
    const outcome = await back(before);
    expect(outcome, "one undo did not take it all back");
    return `choices: ${rows.join(" | ")}; receipt: "${receipt}"; ${undone(outcome)}`;
  });

  await probe("a delete asks first, however sure the reading", async () => {
    const sentence = "get rid of the card";
    await script(sentence, {
      action: { choice: "edit.delete", confidence: 0.99 },
      target: { choice: "card", confidence: 0.98 },
    });
    const before = read();
    await type(sentence);
    await pump(400);
    await enter();
    expect(await until(async () => (await mode()) === "confirm", 8_000), `the mode is ${await mode()}`);
    const asked = await line();
    expect(asked === "Delete Card? Enter to confirm · Esc to cancel", `the bar says "${asked}"`);
    await pump(400);
    expect(read() === before, "the file changed before the answer");
    await key("Escape");
    await pump(300);
    expect(read() === before, "the file changed after Escape");
    return `asked: "${asked}"`;
  });

  await probe("a sentence that needs writing becomes a note for the agent at the playhead", async () => {
    const sentence = "write a punchier headline";
    await script(sentence, { action: { choice: "needs-writing", confidence: 0.92 } });
    await call("canvas.select", { ids: ["title"] });
    await call("canvas.seek", { time: 3 });
    await call("canvas.select", { ids: [] });
    await pump(300);
    const before = read();
    await type(sentence);
    await pump(400);
    await enter();
    expect(await until(() => /<marker[^>]*name="@agent write a punchier headline"/.test(read()), 8_000), "no @agent marker in the file");
    const marker = /<marker[^>]*>/.exec(read())?.[0] ?? "";
    const receipt = await note();
    expect(receipt === "Left a note for your agent at 0:03.", `the receipt says "${receipt}"`);
    await closeBar();
    const outcome = await back(before);
    expect(outcome, "one undo did not take it all back");
    return `${marker}; "${receipt}"; ${undone(outcome)}`;
  });

  await probe("typing on calls off the reading in flight", async () => {
    const slow = "make the card look calmer";
    const fast = `${slow} please`;
    await script(slow, { action: { choice: "edit-properties", confidence: 0.9 }, target: { choice: "card", confidence: 0.9 } }, 3_000);
    await script(fast, { action: { choice: "edit-properties", confidence: 0.9 }, target: { choice: "card", confidence: 0.9 } });
    const { aborted: abortedBefore } = await get(decisionsUrl, "/last");
    await type(slow);
    await pump(900);
    await evaluate("(() => { const input = document.querySelector('.posterract-voice-input'); input.focus(); input.setSelectionRange(input.value.length, input.value.length); })()");
    await cdp("Input.insertText", { text: " please" });
    expect(await until(async () => (await get(decisionsUrl, "/last")).aborted > abortedBefore, 6_000), "the slow reading was not called off");
    const { history } = await get(decisionsUrl, "/last");
    expect(await until(async () => (await get(decisionsUrl, "/last")).history.some((entry) => entry.command === fast), 4_000), "the newer sentence was not read");
    return `${history.filter((entry) => entry.command === slow).length} slow request(s) called off, then "${fast}" read`;
  });

  await probe("the example, said: the same one undo step", async () => {
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
    await post(speechUrl, "/next", { text: "Put the title in the lower third and fade it in." });
    await script("Put the title in the lower third and fade it in.", SURE);
    await call("canvas.select", { ids: [] });
    const before = read();
    await evaluate("document.activeElement?.blur?.()");
    await key("q", { up: false });
    expect(await until(async () => (await mode()) === "listening", 5_000), `the bar never listened (${await mode()})`);
    await evaluate("window.__fakeMic.speak(true)");
    await pump(900);
    await evaluate("window.__fakeMic.speak(false)");
    await pump(400);
    await key("q", { down: false });
    const applied = () => /<text[^>]*id="title"[^>]*place="lower-third"/.test(read()) && /<animation[^>]*type="fade"[^>]*phase="in"/.test(read());
    expect(await until(applied, 10_000), `the spoken example was not applied (mode ${await mode()}, bar "${await line()}", note "${await note()}")`);
    const receipt = await note();
    await pump(2_800);
    const outcome = await back(before);
    expect(outcome, "one undo did not take it all back");
    return `receipt: "${receipt}"; ${undone(outcome)}`;
  });

  await probe("with no OpenRouter key, exact commands still run and own words ask for the key", async () => {
    const { openrouter: _, decisionsUrl: __, ...rest } = STUB_KEYS;
    writeKeys(rest);
    await call("canvas.select", { ids: ["card"] });
    const before = read();
    await type("duplicate");
    await enter();
    expect(await until(() => (read().match(/<rect\b/g) ?? []).length === (before.match(/<rect\b/g) ?? []).length + 1, 8_000), "duplicate did not run");
    await closeBar();
    expect(await back(before), "the duplicate did not undo");

    await type("make the title red");
    await pump(400);
    await enter();
    expect(await until(() => evaluate("document.querySelector('.posterract-voice-key')?.textContent ?? ''").then((text) => /OpenRouter/.test(text)), 8_000), "the OpenRouter key card did not show");
    await pump(300);
    expect(read() === before, "the file changed");
    const said = await note();
    await evaluate("document.querySelector('.posterract-voice-key-close')?.click()");
    return `the bar says "${said}"`;
  });
} finally {
  if (read() !== ORIGINAL) writeFileSync(FILE, ORIGINAL);
  cleanUp();
  ws?.close();
}

const failed = results.filter((result) => !result.ok).length;
process.stdout.write(`\n${results.length} probes: ${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
