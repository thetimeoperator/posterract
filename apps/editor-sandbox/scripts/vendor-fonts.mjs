/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Stage the composition fonts into the editor's public assets.
 *
 * The renderer's CSP allows no network at all, so a caption preset asking for
 * Figtree got a serif instead — every preset looked wrong, and silently. The
 * faces have to be served from the app itself.
 *
 * Vendoring rather than relaxing the CSP is also what makes an export
 * reproducible: the same project renders the same type next year, on a
 * machine with no network, whatever Google's CDN is serving by then.
 *
 * Downloaded at build time rather than committed: they are someone else's
 * files, and a fetch that fails leaves the previous copy in place.
 */
import { mkdirSync, existsSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "public", "fonts");

/**
 * The faces the composition presets use, by the file name the runtime asks
 * for. Google's are all SIL Open Font License, which permits redistribution
 * inside an application.
 */
const FONTS = {
  "inter.woff2": "https://fonts.gstatic.com/s/inter/v20/UcCo3FwrK3iLTcviYwYZ8UA3.woff2",
  "geologica.woff2":
    "https://fonts.gstatic.com/s/geologica/v1/oY1l8evIr7j9P3TN9YwNAdyjzUyDKkKdAGOJh1UlCDUIhAIdhCZOn1fLsig7jfvCCPHZckUWE1lELWNN-w.woff2",
  "nunito.woff2": "https://fonts.gstatic.com/s/nunito/v26/XRXV3I6Li01BKofINeaBTMnFcQ.woff2",
  "figtree.woff2": "https://fonts.gstatic.com/s/figtree/v5/_Xms-HUzqDCFdgfMm4S9DaRvzig.woff2",
  "urbanist.woff2": "https://fonts.gstatic.com/s/urbanist/v15/L0x-DF02iFML4hGCyMqlbS1miXK2.woff2",
  "montserrat.woff2": "https://fonts.gstatic.com/s/montserrat/v26/JTUSjIg1_i6t8kCHKm459WlhyyTh89Y.woff2",
  "bangers.woff2": "https://fonts.gstatic.com/s/bangers/v20/FeVQS0BTqb0h60ACH55Q2J5hm24.woff2",
  "chewy.woff2": "https://fonts.gstatic.com/s/chewy/v18/uK_94ruUb-k-wn52KjI9OPec.woff2",
  "source-code-pro.woff2":
    "https://fonts.gstatic.com/s/sourcecodepro/v22/HI_SiYsKILxRpg3hIP6sJ7fM7PqlPevWnsUnxg.woff2",
  // Inherited from the upstream fork and hosted on its bucket. Kept remote:
  // their licences are not stated, and redistributing a face inside an
  // application is a licensing decision, not a build step. Presets using
  // them fall back until they are replaced or licensed.
  // "the-bold-font.ttf": "https://diffusion-studio-public.s3.eu-central-1.amazonaws.com/fonts/the-bold-font.ttf",
  // "komika-axis.ttf": "https://diffusion-studio-public.s3.eu-central-1.amazonaws.com/fonts/komika-axis.ttf",
};

mkdirSync(target, { recursive: true });

let fetched = 0;
let kept = 0;
for (const [name, url] of Object.entries(FONTS)) {
  const file = join(target, name);
  // Already staged and non-empty: fonts are versioned in their URL, so a file
  // that is there is the file that URL serves.
  if (existsSync(file) && statSync(file).size > 0) {
    kept += 1;
    continue;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status}`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    fetched += 1;
  } catch (error) {
    // A build without network still produces a working app; the faces that
    // did not arrive fall back, exactly as they did before.
    console.warn(`vendor-fonts: could not fetch ${name} (${error.message})`);
  }
}

console.log(`vendor-fonts: ${fetched} fetched, ${kept} already staged, in public/fonts`);
