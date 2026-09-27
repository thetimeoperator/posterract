#!/usr/bin/env node
// End-to-end probe of the voice bar (Phase 1: the wave and the bar), on a live
// isolated instance:
//
//   placement     the bar sits centred along the bottom of the canvas workspace
//   ⌘K / Escape   opens it with the input focused; Escape puts it away
//   a command     "duplicate" + Enter with an element selected adds one element,
//                 and one undo returns the file byte for byte
//   the keyboard  v, h and t typed into the bar do not change the tool
//   the sheet     the shortcut sheet lists every command the table names
//   the wave      with live=0 and amp=1 the shader draws exactly what the
//                 original draws, pixel for pixel
//
// THIS PROBE EDITS THE PROJECT. It runs only against an isolated instance
// (POSTERRACT_PROFILE set, started with --remote-debugging-port) and a scratch
// project folder, and it writes the source back as it found it:
//
//   POSTERRACT_PROFILE=agenttest node scripts/probe-voice-bar.mjs <scratch-project-dir> [cdp-port]
//
// The project needs one scene with at least one element that has an id.
// Exits 0 when everything passed, 1 when a probe failed, 2 when it cannot run.

import { readFileSync, writeFileSync } from "node:fs";
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
      "  POSTERRACT_PROFILE=<profile> node scripts/probe-voice-bar.mjs <scratch-project-dir> [cdp-port]\n",
  );
  process.exit(2);
}
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- the bridge -------------------------------------------------------------

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

// ---- the page, over the debugging port -------------------------------------

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
  const reply = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text);
  return reply.result?.result?.value;
}
const KEYS = {
  Meta: { code: "MetaLeft", keyCode: 91 }, Escape: { code: "Escape", keyCode: 27 }, Enter: { code: "Enter", keyCode: 13 },
  k: { code: "KeyK", keyCode: 75 }, v: { code: "KeyV", keyCode: 86 }, h: { code: "KeyH", keyCode: 72 }, t: { code: "KeyT", keyCode: 84 },
  "?": { code: "Slash", keyCode: 191 },
};
async function key(name, { down = true, up = true, modifiers = 0, text } = {}) {
  const { code, keyCode } = KEYS[name];
  if (down) await cdp("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: name, code, windowsVirtualKeyCode: keyCode, modifiers, ...(text ? { text } : {}) });
  if (up) await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: keyCode, modifiers });
}
/** ⌘ + a key, the way a keyboard sends it: ⌘ goes down first and comes up last. */
async function command(name) {
  await key("Meta", { up: false, modifiers: 4 });
  await key(name, { modifiers: 4 });
  await frame();
  await key("Meta", { down: false });
  await frame();
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/**
 * The editor reads the keyboard once a frame, and a hidden window draws
 * almost none on its own; a capture makes it draw one, so a press is read.
 */
const frame = () => cdp("Page.captureScreenshot", { format: "jpeg", quality: 1, clip: { x: 0, y: 0, width: 4, height: 4, scale: 1 } });
async function until(test, ms = 5_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    await frame();
    if (await test()) return true;
  }
  return false;
}
const mode = () => evaluate("document.querySelector('.posterract-voice')?.dataset.mode ?? null");

// ---- results ----------------------------------------------------------------

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
}
async function probe(name, run) {
  try {
    record(name, true, (await run()) ?? "");
  } catch (error) {
    record(name, false, error.message);
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

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
  process.stdout.write(`Cannot reach the isolated instance (${error.message}). Start it with POSTERRACT_PROFILE=${profile} and --remote-debugging-port=${port}, then run this again.\n`);
  process.exit(2);
}
await until(() => mode().then((value) => value !== null), 10_000);

const entry = (await call("source.read", { path: "auto", lines: [1, 1] })).path;
const FILE = join(dir, entry);
const ORIGINAL = readFileSync(FILE, "utf8");
const read = () => readFileSync(FILE, "utf8");
const elementCount = (text) => (text.match(/<(text|rect|image|video|ellipse|polygon|path|group)\b[^>]*\sid="/g) ?? []).length;
const firstElementId = /<(?:text|rect|image|video|ellipse|polygon)\s[^>]*\bid="([^"]+)"/.exec(ORIGINAL)?.[1];

try {
  // 1. Placement.
  await probe("the bar sits centred along the bottom of the canvas workspace", async () => {
    const box = await evaluate(`(() => {
      const bar = document.querySelector('.posterract-voice-bar')?.getBoundingClientRect();
      const area = document.querySelector('.posterract-canvas-workspace')?.getBoundingClientRect();
      if (!bar || !area) return null;
      return { bar: { x: bar.x, y: bar.y, w: bar.width, h: bar.height }, area: { x: area.x, y: area.y, w: area.width, h: area.height } };
    })()`);
    expect(box, "the bar or the canvas workspace is missing");
    const offset = Math.abs(box.bar.x + box.bar.w / 2 - (box.area.x + box.area.w / 2));
    expect(offset < 2, `off centre by ${offset.toFixed(1)}px`);
    expect(box.bar.y > box.area.y + box.area.h / 2, "not in the bottom half");
    return `${Math.round(box.bar.w)}×${Math.round(box.bar.h)} at the bottom, centred`;
  });

  // 2. ⌘K and Escape.
  await probe("⌘K opens the bar for typing with the input focused; Escape puts it away", async () => {
    await evaluate("document.activeElement?.blur?.()");
    await command("k");
    expect(await until(async () => (await mode()) === "typing"), `mode is ${await mode()}`);
    expect(await until(() => evaluate("document.activeElement?.classList.contains('posterract-voice-input') ?? false")), "the input does not have focus");
    await key("Escape");
    expect(await until(async () => (await mode()) === "idle"), `after Escape the mode is ${await mode()}`);
  });

  // 3. A command, and its undo.
  await probe("\"duplicate\" + Enter adds one element; one undo returns the file byte for byte", async () => {
    expect(firstElementId, "the scratch project has no element with an id");
    await call("canvas.select", { ids: [firstElementId] });
    const before = read();
    await evaluate("document.activeElement?.blur?.()");
    await command("k");
    await until(async () => (await mode()) === "typing");
    await cdp("Input.insertText", { text: "duplicate" });
    await key("Enter", { text: "\r" });
    expect(await until(() => elementCount(read()) === elementCount(before) + 1, 8_000), `elements ${elementCount(before)} → ${elementCount(read())}`);
    const receipt = await evaluate("document.querySelector('.posterract-voice-note')?.textContent ?? ''");
    await key("Escape");
    await call("canvas.undo");
    expect(await until(() => read() === before, 8_000), "the file did not come back byte for byte");
    return `receipt: "${receipt}"`;
  });

  // 4. Letters typed into the bar stay in the bar.
  await probe("v, h and t typed into the bar do not change the tool", async () => {
    const tool = () => evaluate(`({
      move: document.querySelector('[aria-label="Select and move"]')?.className.includes('text-foreground') ?? false,
      hand: !!document.querySelector('[aria-label="Pan canvas"]'),
      text: document.querySelector('[aria-label="Add text"]')?.className.includes('text-foreground') ?? false,
    })`);
    const start = await tool();
    await evaluate("document.activeElement?.blur?.()");
    await command("k");
    await until(async () => (await mode()) === "typing");
    for (const letter of ["v", "h", "t"]) await key(letter, { text: letter });
    const typed = await evaluate("document.querySelector('.posterract-voice-input')?.value ?? ''");
    const after = await tool();
    await key("Escape");
    expect(typed.endsWith("vht"), `the input holds "${typed}"`);
    expect(JSON.stringify(after) === JSON.stringify(start), `tool changed: ${JSON.stringify(start)} → ${JSON.stringify(after)}`);
  });

  // 5. The sheet lists every named command.
  await probe("the shortcut sheet lists every command the table names", async () => {
    const table = readFileSync(join(REPO, "apps/editor-sandbox/src/engine/input/shortcuts.ts"), "utf8");
    const labels = [...table.matchAll(/id: '[^']+', label: '([^']+)'/g)].map((match) => match[1]);
    expect(labels.length > 40, `only ${labels.length} labels found in the table`);
    await evaluate("document.activeElement?.blur?.()");
    await key("?", { text: "?" });
    await until(() => evaluate("!!document.querySelector('[data-slot=dialog-content]')"));
    const sheet = await evaluate("document.querySelector('[data-slot=dialog-content]')?.textContent ?? ''");
    await key("Escape");
    const missing = labels.filter((label) => !sheet.includes(label) && !label.startsWith("Type a command"));
    expect(missing.length === 0, `missing: ${missing.join(" | ")}`);
    return `${labels.length} commands listed`;
  });

  // 6. The wave, against the original shader.
  await probe("with live=0 and amp=1 the wave draws exactly what the original draws", async () => {
    const component = readFileSync(join(REPO, "apps/editor-sandbox/src/components/ui/siri-wave.tsx"), "utf8");
    const edited = /WAVE_SHADER = `([\s\S]*?)`;\n\/\/ WAVE_SHADER:END/.exec(component)?.[1];
    expect(edited, "could not find the shader in siri-wave.tsx");
    const edits = (edited.match(/\/\/ EDIT/g) ?? []).length;
    expect(edits === 5, `${edits} edits marked, not 5`);
    // The original: the same text with the five edits taken back out.
    const original = edited
      .replace(/\nuniform float uLive;[^\n]*\n/, "\n")
      .replace(/mix\((clamp\(0\.45[^;]*?, 0\.0, 1\.0\)), uLow,\s*uLive\);[^\n]*/, "$1;")
      .replace(/mix\((clamp\(0\.40[^;]*?, 0\.0, 1\.0\)), uMid,\s*uLive\);[^\n]*/, "$1;")
      .replace(/mix\((clamp\(0\.30[^;]*?, 0\.0, 1\.0\)), uHigh,\s*uLive\);[^\n]*/, "$1;")
      .replace("AMPLITUDE*uAmp + 0.01*low*LOW_AMP; // EDIT 5: height follows the voice", "AMPLITUDE + 0.01*low*LOW_AMP;");
    expect(!/uLive|uAmp|uLow|uMid|uHigh/.test(original), "the original still mentions the new uniforms");
    const same = await evaluate(`(() => {
      const width = 320, height = 80;
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
      const vertex = 'attribute vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0); }';
      const draw = (fragment, uniforms) => {
        const program = gl.createProgram();
        for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
          const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
          gl.attachShader(program, shader);
        }
        gl.linkProgram(program); gl.useProgram(program);
        const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const at = gl.getAttribLocation(program, 'aPos'); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(gl.getUniformLocation(program, 'iResolution'), width, height);
        gl.uniform1f(gl.getUniformLocation(program, 'iTime'), 3.21);
        for (const [name, value] of Object.entries(uniforms)) gl.uniform1f(gl.getUniformLocation(program, name), value);
        gl.viewport(0, 0, width, height); gl.drawArrays(gl.TRIANGLES, 0, 3);
        const pixels = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };
      const a = draw(${JSON.stringify(original)}, {});
      const b = draw(${JSON.stringify(edited)}, { uLive: 0, uAmp: 1, uLow: 0.9, uMid: 0.1, uHigh: 0.7 });
      let differing = 0, lit = 0;
      for (let i = 0; i < a.length; i += 1) { if (a[i] !== b[i]) differing += 1; if (a[i] > 16) lit += 1; }
      return { differing, lit };
    })()`);
    expect(same.lit > 100, "the original drew nothing to compare against");
    expect(same.differing === 0, `${same.differing} channel values differ`);
    return `${same.lit} lit channel values, none differ`;
  });
} finally {
  if (read() !== ORIGINAL) writeFileSync(FILE, ORIGINAL);
  ws?.close();
}

const failed = results.filter((result) => !result.ok).length;
process.stdout.write(`\n${results.length} probes: ${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
