#!/usr/bin/env node
// The page of what can be said, written from the catalog itself, so it cannot
// go stale: every intent in apps/editor-sandbox/src/context/agent-api/intents
// is listed with how people say it, and everything deliberately left out is
// listed with the reason.
//
//   node scripts/write-voice-docs.mjs        writes apps/desktop/docs/voice-commands.md

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const esbuild = createRequire(join(REPO, "apps/desktop/package.json"))("esbuild");
const out = mkdtempSync(join(tmpdir(), "posterract-docs-"));
await esbuild.build({
  stdin: {
    contents: [
      'export * from "./apps/editor-sandbox/src/context/agent-api/intents/catalog/index.ts";',
      'export * from "./apps/editor-sandbox/src/context/agent-api/intents/not-voiceable.ts";',
    ].join("\n"),
    resolveDir: REPO,
    loader: "ts",
  },
  absWorkingDir: REPO,
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(out, "catalog.mjs"),
  alias: { "@": join(REPO, "apps/editor-sandbox/src"), "cmdk-solid": join(REPO, "apps/editor-sandbox/tests/cmdk-solid-filter.ts") },
  logLevel: "error",
});
const catalog = await import(pathToFileURL(join(out, "catalog.mjs")).href);
rmSync(out, { recursive: true, force: true });

const lines = [];
lines.push("<!-- Written by scripts/write-voice-docs.mjs from the catalog itself. Do not edit by hand. -->\n");
lines.push("# What you can say to the editor\n");
lines.push(
  "Hold the talk key (Q unless you picked another in the bar's settings) and speak, or press ⌘K and type. "
  + "A sentence can ask for two things (\"add a circle and make it red\"), and whatever it does is one ⌘Z.\n",
);
lines.push(`The bar understands ${catalog.INTENTS.length} commands, in ${catalog.FAMILIES.length} areas.\n`);

for (const family of catalog.FAMILIES) {
  lines.push(`## ${family.label}\n`);
  lines.push("| Say | What happens |");
  lines.push("|---|---|");
  for (const intent of family.intents) {
    const says = intent.text.examples.slice(0, 3).map((example) => `"${example}"`).join(" · ");
    lines.push(`| ${says} | ${intent.text.what} |`);
  }
  lines.push("");
}

lines.push("## What it will not do, and why\n");
lines.push("| What | Why |");
lines.push("|---|---|");
for (const entry of catalog.NOT_VOICEABLE_FEATURES) lines.push(`| ${entry.what} | ${entry.why} |`);
lines.push("");
lines.push(
  "Beyond these, a handful of settings are left to the panels (a diagram's own props, a shader, a stroke's corner join); "
  + "`not-voiceable.ts` has the full list with a reason for each, and a test fails if anything is in neither list.\n",
);
lines.push("## When it is not sure\n");
lines.push(
  "- **Sure**: it does it, and says what it did.\n"
  + "- **Half sure**: it shows what it understood as chips above the bar; Enter applies, Escape cancels, and any chip can be changed.\n"
  + "- **Unsure**: it offers numbered choices; press 1, 2 or 3.\n"
  + "- **Deleting, restoring, or anything that spends your provider credit**: it always asks first.\n"
  + "- **Nothing to do**: it says why, and what to say instead. It never claims something it did not do.\n",
);
lines.push("## What it keeps\n");
lines.push(
  "Every command is written to `<project>/.posterract/voice-log.jsonl` — the words, how they were read, and whether you took it back. "
  + "Words only: never audio, never a key, and it never leaves your machine. `scripts/voice-log-to-corpus.mjs` turns the ones that went wrong into test sentences.\n",
);

writeFileSync(join(REPO, "apps/desktop/docs/voice-commands.md"), `${lines.join("\n")}`);
process.stdout.write(`apps/desktop/docs/voice-commands.md — ${catalog.INTENTS.length} commands in ${catalog.FAMILIES.length} areas\n`);
