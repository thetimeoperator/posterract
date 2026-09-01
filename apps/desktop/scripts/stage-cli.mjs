/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = join(desktopDir, "..", "..", "packages", "posterract-cli");
const stageDir = join(desktopDir, "cli");
const cliPackage = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8"));

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, "bin"), { recursive: true });
cpSync(join(cliDir, "dist", "index.cjs"), join(stageDir, "posterract.cjs"));

const unixWrapper = `#!/bin/sh
SELF="$0"
while [ -L "$SELF" ]; do
  LINK="$(readlink "$SELF")"
  case "$LINK" in
    /*) SELF="$LINK" ;;
    *) SELF="$(dirname "$SELF")/$LINK" ;;
  esac
done
DIR="$(cd "$(dirname "$SELF")" && pwd)"
export POSTERRACT_APP_PATH="$(cd "$DIR/../../../.." && pwd)"
if [ "$(uname -s)" = "Darwin" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$DIR/../../../../MacOS/Posterract" "$DIR/../posterract.cjs" "$@"
fi
ELECTRON_RUN_AS_NODE=1 exec "$DIR/../../../../posterract" "$DIR/../posterract.cjs" "$@"
`;
writeFileSync(join(stageDir, "bin", "posterract"), unixWrapper);
chmodSync(join(stageDir, "bin", "posterract"), 0o755);

const windowsWrapper = `@echo off\r\nset POSTERRACT_APP_PATH=%~dp0..\\..\\..\\..\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0..\\..\\..\\..\\Posterract.exe" "%~dp0..\\posterract.cjs" %*\r\n`;
writeFileSync(join(stageDir, "bin", "posterract.cmd"), windowsWrapper);
writeFileSync(
  join(stageDir, "manifest.json"),
  `${JSON.stringify({ version: cliPackage.version, protocolVersion: 2 }, null, 2)}\n`,
);

console.log(`stage-cli: staged Posterract CLI at ${stageDir}`);
