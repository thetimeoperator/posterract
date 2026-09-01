import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("prepare-dmg-native: skipped outside macOS");
  process.exit(0);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, "../../..");
const pnpmStore = join(workspaceRoot, "node_modules", ".pnpm");
const require = createRequire(import.meta.url);
const nodeGyp = require.resolve("node-gyp/bin/node-gyp.js");

for (const dependency of [
  { name: "macos-alias", binary: "volume.node" },
  { name: "fs-xattr", binary: "xattr.node" },
]) {
  const packageDirName = readdirSync(pnpmStore).find((name) => name.startsWith(`${dependency.name}@`));
  if (!packageDirName) {
    throw new Error(`${dependency.name} is missing; install the desktop packaging dependencies first`);
  }

  const packageDir = join(pnpmStore, packageDirName, "node_modules", dependency.name);
  const binary = join(packageDir, "build", "Release", dependency.binary);
  if (!existsSync(binary)) {
    const result = spawnSync(process.execPath, [nodeGyp, "rebuild"], {
      cwd: packageDir,
      stdio: "inherit",
    });
    if (result.status !== 0 || !existsSync(binary)) {
      throw new Error(`Could not build ${dependency.name} for the macOS DMG maker (exit ${result.status ?? "unknown"})`);
    }
  }
  console.log(`prepare-dmg-native: ready ${binary}`);
}
