#!/usr/bin/env node
// The go/no-go for the voice bar's own-words commands: every sentence of
// scripts/intent-corpus/sentences.json through the app's own two-step reading
// and — with your OpenRouter key — through Jev. It reports accuracy per area,
// the wrong-but-confident rate (the number that has to be near zero: a
// confident wrong edit is what breaks trust), and the p50/p95 time.
//
//   OPENROUTER_API_KEY=sk-or-… node scripts/run-intent-corpus.mjs
//   node scripts/run-intent-corpus.mjs --dry              no key, no call: checks the sentences and the request sizes
//   … --area time,create                                  only those areas
//   … --only 3,9                                          only those sentences, counted from 1
//   … --one-request                                       ask everything at once instead of area-then-intent
//
// The reader is apps/editor-sandbox/src/context/agent-api/intents, bundled for
// Node; the scene is scripts/intent-corpus/fixture.json. The key is never printed.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const dry = flag("dry");
const oneRequest = flag("one-request");
const onlyAreas = value("area")?.split(",");
const only = value("only") ? new Set(value("only").split(",").map(Number)) : null;

// ---- the app's reader, for Node ---------------------------------------------

const esbuild = createRequire(join(REPO, "apps/desktop/package.json"))("esbuild");
const out = mkdtempSync(join(tmpdir(), "posterract-intents-"));
await esbuild.build({
  stdin: {
    contents: [
      'export * from "./apps/editor-sandbox/src/context/agent-api/intents/read.ts";',
      'export * from "./apps/editor-sandbox/src/context/agent-api/intents/catalog/index.ts";',
      'export { compileStep } from "./apps/editor-sandbox/src/context/agent-api/intents/compile.ts";',
    ].join("\n"),
    resolveDir: REPO,
    loader: "ts",
  },
  absWorkingDir: REPO,
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(out, "reader.mjs"),
  alias: {
    "@": join(REPO, "apps/editor-sandbox/src"),
    "cmdk-solid": join(REPO, "apps/editor-sandbox/tests/cmdk-solid-filter.ts"),
  },
  logLevel: "error",
});
const reader = await import(pathToFileURL(join(out, "reader.mjs")).href);
rmSync(out, { recursive: true, force: true });

// ---- the sentences, the scene, the endpoint ---------------------------------

const fixture = JSON.parse(readFileSync(join(REPO, "scripts/intent-corpus/fixture.json"), "utf8"));
const corpus = JSON.parse(readFileSync(join(REPO, "scripts/intent-corpus/sentences.json"), "utf8"));

const source = readFileSync(join(REPO, "apps/desktop/src/ai-local.ts"), "utf8");
const constant = (name) => new RegExp(`const ${name} = "([^"]+)"`).exec(source)?.[1];
const url = constant("DECISIONS_URL") ?? "https://openrouter.ai/api/alpha/decisions";
const model = constant("DECISIONS_MODEL");

const key = process.env.OPENROUTER_API_KEY?.trim();
if (!dry && !key) {
  process.stdout.write(
    "This run calls Jev twice per sentence with your OpenRouter key:\n"
    + "  OPENROUTER_API_KEY=sk-or-… node scripts/run-intent-corpus.mjs\n"
    + "Or check the sentences without calling anything:\n"
    + "  node scripts/run-intent-corpus.mjs --dry\n",
  );
  process.exit(2);
}

let cost = 0;
let calls = 0;
async function decide(state, questions) {
  if (!Object.keys(questions).length) return { answers: {}, ms: 0 };
  const body = JSON.stringify({ model, state, questions });
  for (let attempt = 0; ; attempt += 1) {
    const started = Date.now();
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({}));
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((done) => setTimeout(done, 600 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload.error ?? payload).slice(0, 200)}`);
    if (typeof payload.usage?.cost === "number") cost += payload.usage.cost;
    calls += 1;
    return { answers: payload.answers ?? {}, ms: Date.now() - started };
  }
}

const prefix = (request, answers) =>
  Object.fromEntries(Object.entries(answers).map(([name, answer]) => [reader.keyOf(request, name), answer]));

/** One sentence, read the way the app reads it: each command in it on its own. */
async function readSentence(say) {
  const pieces = reader.piecesOf(say);
  if (pieces.length > 1 && !dry) {
    const read = await Promise.all(pieces.map((piece, index) => readPiece(piece, index > 0)));
    return { reading: reader.mergeReadings(say, read.map((each) => each.reading)), ms: Math.max(...read.map((each) => each.ms)) };
  }
  return readPiece(say, false);
}

async function readPiece(say, creating) {
  const situation = { ...fixture, command: say };
  const literals = reader.literalsOf(situation);
  let answers = {};
  let families = [];
  let ms = 0;

  if (oneRequest) {
    // Everything at once: the areas and every area's own questions together.
    const questions = { ...reader.areaQuestions() };
    const all = reader.FAMILIES.map((family) => family.id);
    for (const id of all) {
      const family = reader.FAMILY_BY_ID.get(id);
      const inner = reader.familyQuestions(family, situation, literals, { creating: true });
      for (const [name, question] of Object.entries(inner)) questions[`${id}__${name}`] = question;
    }
    if (dry) return { situation, questions, dry: true };
    const asked = await decide(reader.familyState(reader.FAMILY_BY_ID.get("arrange"), situation), questions);
    ms = asked.ms;
    answers = {};
    for (const [name, answer] of Object.entries(asked.answers)) {
      const at = name.indexOf("__");
      answers[at === -1 ? reader.keyOf("areas", name) : reader.keyOf(name.slice(0, at), name.slice(at + 2))] = answer;
    }
    families = reader.areasChosen(answers);
    return { reading: reader.readPlan({ situation, commands: [], answers, families }), ms };
  }

  const first = dry ? { answers: {}, ms: 0 } : await decide(reader.areaState(situation), reader.areaQuestions());
  ms += first.ms;
  answers = prefix("areas", first.answers);
  families = dry ? reader.FAMILIES.map((family) => family.id) : reader.areasChosen(answers);

  if (dry) {
    const questions = { areas: reader.areaQuestions() };
    for (const id of families) {
      questions[id] = reader.familyQuestions(reader.FAMILY_BY_ID.get(id), situation, literals, { creating: true });
    }
    return { situation, questions, dry: true };
  }

  if (families.length) {
    const asked = await Promise.all(families.map(async (id) => {
      const family = reader.FAMILY_BY_ID.get(id);
      const questions = reader.familyQuestions(family, situation, literals, { creating: creating || (families.includes("create") && id !== "create") });
      const answer = await decide(reader.familyState(family, situation), questions);
      return { id, ...answer };
    }));
    for (const answer of asked) {
      answers = { ...answers, ...prefix(answer.id, answer.answers) };
      ms = Math.max(ms, first.ms + answer.ms);
    }
    if (reader.wantsMembers(answers, families)) {
      const members = await decide(reader.familyState(reader.FAMILY_BY_ID.get(families[0]), situation), reader.memberQuestions(situation));
      answers = { ...answers, ...prefix("members", members.answers) };
      ms += members.ms;
    }
  }
  return { reading: reader.readPlan({ situation, commands: [], answers, families }), ms };
}

// ---- judging ------------------------------------------------------------------

/** A slot value as an expectation writes it. */
function plain(value) {
  if (!value) return undefined;
  switch (value.kind) {
    case "elements": return value.ids;
    case "choice": return value.value;
    case "onoff": return value.on;
    case "number": return value.value;
    case "amount": return value.step;
    case "words": return value.value;
    case "time": return value.seconds;
    case "color": return value.word ?? value.hex;
    case "color-step": return value.lighter ? "lighter" : "darker";
    case "color-of": return value.id;
    case "asset": return value.name;
    case "element": return value.id;
    case "marker": return value.id;
    case "scene": return value.id;
    case "variable": return value.key;
    default: return undefined;
  }
}

const sameValue = (actual, expected) => {
  if (typeof expected === "number" && typeof actual === "number") return Math.abs(actual - expected) <= Math.max(0.01, Math.abs(expected) * 0.02);
  if (typeof expected === "string" && typeof actual === "string") {
    return actual.trim().toLowerCase() === expected.trim().toLowerCase()
      // A color may be written as a name or as what it is set to.
      || actual.replace(/\s+/g, "") === expected.replace(/\s+/g, "");
  }
  if (Array.isArray(expected) && Array.isArray(actual)) return expected.length === actual.length && expected.every((id) => actual.includes(id));
  return actual === expected;
};

function stepMatches(step, expected) {
  if (step.intent !== expected.intent) return false;
  if (expected.targets && !sameValue(step.targets, expected.targets)) return false;
  for (const [name, want] of Object.entries(expected.slots ?? {})) {
    if (!sameValue(plain(step.slots[name]), want)) return false;
  }
  return true;
}

function right(reading, expect) {
  if (Array.isArray(expect.anyOf)) return expect.anyOf.some((each) => right(reading, each));
  if (expect.note) return reading.lane === "note";
  if (expect.nothing) return reading.lane === "nothing";
  const steps = [...reading.steps];
  if (!expect.steps) return false;
  if (steps.length !== expect.steps.length) return false;
  return expect.steps.every((wanted) => {
    const at = steps.findIndex((step) => stepMatches(step, wanted));
    if (at === -1) return false;
    steps.splice(at, 1);
    return true;
  });
}

/** What a reading came to, in a line. */
const said = (reading) => {
  if (reading.lane === "note") return "note for the agent";
  if (reading.lane === "nothing") return `nothing (${reading.message ?? ""})`;
  return reading.steps
    .map((step) => `${step.intent}${step.targets.length ? `[${step.targets.join(",")}]` : ""}`
      + `${Object.keys(step.slots).length ? ` {${Object.entries(step.slots).map(([name, value]) => `${name}=${JSON.stringify(plain(value))}`).join(" ")}}` : ""}`)
    .join(" + ") || "nothing";
};

// ---- the run ------------------------------------------------------------------

const sentences = corpus.sentences.filter((sentence, index) => {
  if (only && !only.has(index + 1)) return false;
  if (onlyAreas && !sentence.tags?.some((tag) => onlyAreas.includes(tag))) return false;
  return true;
});

process.stdout.write(`${dry ? "Checking" : "Running"} ${sentences.length} sentences${dry ? "" : ` against ${model}`}${oneRequest ? " (one request)" : ""}\n\n`);

const rows = [];
const times = [];
for (const [index, sentence] of sentences.entries()) {
  const label = `${String(index + 1).padStart(3)} ${sentence.say}`;
  try {
    const result = await readSentence(sentence.say);
    if (result.dry) {
      const size = JSON.stringify(result.questions).length;
      const count = Object.values(result.questions).reduce((sum, group) => sum + (group.type ? 1 : Object.keys(group).length), 0);
      process.stdout.write(`· ${String(count).padStart(3)} questions, ~${String(Math.round(size / 4)).padStart(5)} tokens   ${label}\n`);
      continue;
    }
    const { reading, ms } = result;
    times.push(ms);
    const ok = right(reading, sentence.expect);
    const confident = reading.lane === "apply";
    rows.push({ area: sentence.tags?.[0] ?? "other", ok, confident, lane: reading.lane });
    process.stdout.write(`${ok ? "✓" : "✗"} ${reading.lane.padEnd(7)} ${label}${ok ? "" : `\n      → ${said(reading)}`}\n`);
  } catch (error) {
    rows.push({ area: sentence.tags?.[0] ?? "other", ok: false, confident: false, lane: "error" });
    process.stdout.write(`✗ error   ${label}\n      → ${error.message}\n`);
  }
}

if (!dry && rows.length) {
  const areas = [...new Set(rows.map((row) => row.area))].sort();
  process.stdout.write("\n area            right   wrong-but-sure\n");
  for (const area of areas) {
    const mine = rows.filter((row) => row.area === area);
    const ok = mine.filter((row) => row.ok).length;
    const bad = mine.filter((row) => !row.ok && row.confident).length;
    process.stdout.write(`  ${area.padEnd(14)} ${String(Math.round((ok / mine.length) * 100)).padStart(3)}% (${ok}/${mine.length})   ${String(Math.round((bad / mine.length) * 100)).padStart(3)}%\n`);
  }
  const ok = rows.filter((row) => row.ok).length;
  const bad = rows.filter((row) => !row.ok && row.confident).length;
  const sorted = [...times].sort((a, b) => a - b);
  process.stdout.write(
    `\n  all            ${String(Math.round((ok / rows.length) * 100)).padStart(3)}% (${ok}/${rows.length})   ${String(Math.round((bad / rows.length) * 100)).padStart(3)}% (${bad})\n`
    + `  p50 ${sorted[Math.floor(sorted.length / 2)]} ms · p95 ${sorted[Math.floor(sorted.length * 0.95)]} ms · ${calls} calls`
    + `${cost ? ` · $${cost.toFixed(4)}` : ""}\n`,
  );
  writeFileSync(join(REPO, "scripts/intent-corpus/last-run.json"), `${JSON.stringify({ at: new Date().toISOString(), model, oneRequest, rows }, null, 1)}\n`);
}
