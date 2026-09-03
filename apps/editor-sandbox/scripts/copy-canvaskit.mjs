/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Stage CanvasKit into the editor's public assets.
 *
 * The renderer's CSP allows no network, so the WebAssembly has to be served
 * from the app itself. Copied from node_modules at build time rather than
 * committed: it is 7 MB of someone else's build output, and the version that
 * ships should be the one the lockfile pins.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "public", "canvaskit");

let source;
try {
  // The `full` build is the one that carries Skottie, which is what plays
  // Lottie. The default build has no `MakeAnimation` at all, so it fails only
  // at the moment an animation is loaded — 900 kB more of Wasm is worth not
  // shipping a feature that cannot work.
  source = dirname(require.resolve("canvaskit-wasm/bin/full/canvaskit.js"));
} catch {
  console.error("copy-canvaskit: canvaskit-wasm is not installed; run pnpm install");
  process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const file of ["canvaskit.js", "canvaskit.wasm"]) {
  const from = join(source, file);
  if (!existsSync(from)) {
    console.error(`copy-canvaskit: ${file} is missing from canvaskit-wasm`);
    process.exit(1);
  }
  copyFileSync(from, join(target, file));
}

console.log(`copy-canvaskit: staged CanvasKit into ${target}`);
