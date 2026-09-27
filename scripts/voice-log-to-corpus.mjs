#!/usr/bin/env node
// The commands that went wrong, turned into test sentences.
//
// The bar keeps a line per command in `<project>/.posterract/voice-log.jsonl`
// (words only — never audio, never a key). The ones worth learning from are
// the ones the person took back within a few seconds, the ones they corrected
// on a chip, and the ones that came to nothing: each is a sentence the reading
// got wrong, and each is a test sentence waiting to be written.
//
//   node scripts/voice-log-to-corpus.mjs <project-dir> [more-project-dirs…]
//
// It prints them in the shape scripts/intent-corpus/sentences.json takes, with
// what the bar did as a starting point for what it should have done — a person
// still has to say what the right answer is. Nothing is written to the corpus
// automatically: a wrong expectation is worse than a missing one.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dirs = process.argv.slice(2).map((dir) => resolve(dir));
if (!dirs.length) {
  process.stdout.write("node scripts/voice-log-to-corpus.mjs <project-dir> [more-project-dirs…]\n");
  process.exit(2);
}

/** Every line of a project's voice log, oldest first. */
function read(dir) {
  try {
    return readFileSync(join(dir, ".posterract/voice-log.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

const entries = dirs.flatMap(read);
if (!entries.length) {
  process.stdout.write("No voice log in those projects yet.\n");
  process.exit(0);
}

// What was taken back, what was corrected, and what came to nothing.
const undone = new Set(entries.filter((entry) => entry.undone).map((entry) => entry.said));
const corrected = new Map();
for (const entry of entries) {
  if (entry.corrected) corrected.set(entry.said, entry.corrected);
}

const worth = [];
const seen = new Set();
for (const entry of entries) {
  if (!entry.said || seen.has(entry.said)) continue;
  const why = undone.has(entry.said) ? "undone"
    : corrected.has(entry.said) ? "corrected"
      : entry.ran === false ? "did nothing"
        : entry.lane === "choose" ? "had to be picked from a list"
          : null;
  if (!why) continue;
  seen.add(entry.said);
  worth.push({ entry, why });
}

if (!worth.length) {
  process.stdout.write(`${entries.length} commands, none of them went wrong. Nothing to add.\n`);
  process.exit(0);
}

process.stdout.write(`// ${worth.length} of ${entries.length} commands are worth a test sentence.\n`);
process.stdout.write("// Say what each SHOULD have come to, then paste it into scripts/intent-corpus/sentences.json.\n\n");
for (const { entry, why } of worth) {
  const steps = (entry.steps ?? []).map((step) => ({
    intent: step.intent,
    ...(step.targets?.length ? { targets: step.targets } : {}),
  }));
  process.stdout.write(`// it ${why}${entry.said_back ? ` — the bar said: ${entry.said_back}` : ""}\n`);
  process.stdout.write(`${JSON.stringify({
    say: entry.said,
    tags: [steps[0]?.intent?.split(".")[0] ?? "other", entry.how === "spoken" ? "spoken" : "typed"],
    expect: { steps: steps.length ? steps : [{ intent: "???" }] },
  })},\n`);
}
