/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createRequire } from "node:module";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = join(desktopDir, "..", "..");
const compositionDir = join(repoDir, "packages", "posterract-composition");
const require = createRequire(join(compositionDir, "package.json"));
const stageDir = join(desktopDir, "sdk", "node_modules");
const compositionTarget = join(stageDir, "@posterract", "composition");

rmSync(join(desktopDir, "sdk"), { recursive: true, force: true });
mkdirSync(compositionTarget, { recursive: true });
cpSync(join(compositionDir, "dist"), join(compositionTarget, "dist"), { recursive: true });

const compositionPackage = JSON.parse(readFileSync(join(compositionDir, "package.json"), "utf8"));
writeFileSync(
  join(compositionTarget, "package.json"),
  JSON.stringify({
    name: compositionPackage.name,
    version: compositionPackage.version,
    type: "module",
    types: "./dist/index.d.ts",
    exports: {
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./source": { types: "./dist/source.d.ts", default: "./dist/source.js" },
      "./generate": { types: "./dist/generate.d.ts", default: "./dist/generate.js" },
      "./jsx-runtime": { types: "./dist/jsx-runtime.d.ts", default: "./dist/jsx-runtime.js" },
      "./jsx-dev-runtime": { types: "./dist/jsx-runtime.d.ts", default: "./dist/jsx-runtime.js" },
    },
  }, null, 2) + "\n",
);

const solidPackagePath = require.resolve("solid-js/package.json");
cpSync(dirname(solidPackagePath), join(stageDir, "solid-js"), { recursive: true });

const kootaEntry = require.resolve("koota");
const kootaDir = dirname(dirname(kootaEntry));
cpSync(kootaDir, join(stageDir, "koota"), { recursive: true });

for (const folder of ["docs", "examples"]) {
  const source = join(compositionDir, folder);
  const target = join(desktopDir, folder);
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
}

console.log(`stage-sdk: staged Posterract SDK at ${join(desktopDir, "sdk")}`);
