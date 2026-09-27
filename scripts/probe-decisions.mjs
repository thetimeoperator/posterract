#!/usr/bin/env node
// One real call to Jev through OpenRouter, to confirm the decisions request
// shape before the voice bar relies on it (docs/voice-command-bar-plan.md
// §3.0). What is known of that shape comes from launch-day integrations, not
// from an OpenRouter docs page; this settles it.
//
//   OPENROUTER_API_KEY=sk-or-… node scripts/probe-decisions.mjs
//   node scripts/probe-decisions.mjs --dry      (prints the request; sends nothing)
//
// It makes exactly one request, of two tiny questions — one yes/no, one
// choice — so both answer shapes the voice bar reads are seen. It prints the
// HTTP status, the response's top-level fields, each answer's fields, and
// `usage`. It never prints the key.
//
// The URL and the model are read from apps/desktop/src/ai-local.ts, the one
// place they are kept: if the path has moved, change it there.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(REPO, "apps/desktop/src/ai-local.ts"), "utf8");
const constant = (name) => new RegExp(`const ${name} = "([^"]+)"`).exec(source)?.[1];
const url = constant("DECISIONS_URL");
const model = constant("DECISIONS_MODEL");
if (!url || !model) {
  process.stdout.write("Could not find DECISIONS_URL and DECISIONS_MODEL in apps/desktop/src/ai-local.ts.\n");
  process.exit(2);
}

const body = {
  model,
  state: {
    command: "make the title red",
    elements: [
      { id: "title", kind: "text", text: "Wild storm" },
      { id: "card", kind: "rect", name: "Card" },
    ],
  },
  questions: {
    said_color: { type: "noul", instructions: "Does the command ask to change the color of something?" },
    target: {
      type: "choice",
      instructions: "Which element is the command about?",
      criteria: { title: "the text \"Wild storm\"", card: "a shape named \"Card\"", none: "no element" },
    },
  },
};

if (process.argv.includes("--dry")) {
  process.stdout.write(`POST ${url}\n${JSON.stringify(body, null, 2)}\n`);
  process.exit(0);
}

const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) {
  process.stdout.write("Set OPENROUTER_API_KEY to your OpenRouter key for this one call:\n  OPENROUTER_API_KEY=sk-or-… node scripts/probe-decisions.mjs\n");
  process.exit(2);
}

const started = Date.now();
let response;
try {
  response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
} catch (error) {
  process.stdout.write(`The request did not go through: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
const ms = Date.now() - started;
const text = await response.text();
process.stdout.write(`POST ${url}\nmodel ${model}\nHTTP ${response.status} in ${ms} ms\n`);

let payload;
try {
  payload = JSON.parse(text);
} catch {
  process.stdout.write(`Not JSON (first 300 characters):\n${text.slice(0, 300)}\n`);
  process.exit(1);
}

const shape = (value) => (Array.isArray(value) ? "array" : value === null ? "null" : typeof value);
process.stdout.write(`top-level fields: ${Object.keys(payload).map((field) => `${field} (${shape(payload[field])})`).join(", ")}\n`);
if (payload.error) process.stdout.write(`error: ${JSON.stringify(payload.error).slice(0, 400)}\n`);
for (const [id, answer] of Object.entries(payload.answers ?? {})) {
  process.stdout.write(`answer ${id}: ${JSON.stringify(answer)}\n`);
}
if (payload.usage !== undefined) process.stdout.write(`usage: ${JSON.stringify(payload.usage)}\n`);
if (payload.provider !== undefined) process.stdout.write(`provider: ${JSON.stringify(payload.provider)}\n`);

// What the voice bar reads: a choice answer's `choice`, `probabilities` and
// `confidence`; a yes/no answer's `noul`.
const target = payload.answers?.target;
const color = payload.answers?.said_color;
const fits = response.ok
  && typeof target?.choice === "string" && typeof target?.confidence === "number" && typeof target?.probabilities === "object"
  && typeof color?.noul === "number";
process.stdout.write(fits
  ? "\nThe shape is the one the voice bar reads.\n"
  : "\nThe shape differs from what the voice bar reads: send this output back, and only the call in apps/desktop/src/ai-local.ts (decide) needs adjusting.\n");
process.exit(fits ? 0 : 1);
