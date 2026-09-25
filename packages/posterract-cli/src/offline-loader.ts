/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The commands that read the project folder themselves (see ./offline), loaded
 * on demand from a bundle of their own: it carries a TypeScript parser, and no
 * command that only talks to the app should pay for starting one. The bundle
 * sits beside the main one (`dist/offline.cjs`, staged as `cli/offline.cjs`),
 * which is why the path is spelled as a runtime `require`.
 */
export function offline(): typeof import("./offline") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("./offline.cjs") as typeof import("./offline");
}
