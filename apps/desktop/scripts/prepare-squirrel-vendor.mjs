import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { arch, platform } from "node:os";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (platform() !== "win32") {
  console.log("prepare-squirrel-vendor: skipped outside Windows");
  process.exit(0);
}

// electron-winstaller ships 7z-x64.exe and 7z-arm64.exe, and relies on an npm
// `install` lifecycle script to copy the right one to the plain 7z.exe that
// Squirrel shells out to. pnpm does not run dependency lifecycle scripts, so
// that copy never happens and Squirrel dies inside CreateZipFromDirectory with
// "The system cannot find the file specified".
//
// Its own script is broken besides — it reads os.arch as a value rather than
// calling it — so this does the copy rather than trying to run it.
const scriptDir = dirname(fileURLToPath(import.meta.url));
const store = resolve(scriptDir, "../../..", "node_modules", ".pnpm");
const packageDirName = readdirSync(store).find((name) => name.startsWith("electron-winstaller@"));
if (!packageDirName) {
  throw new Error("electron-winstaller is missing; install the desktop packaging dependencies first");
}

const vendor = join(store, packageDirName, "node_modules", "electron-winstaller", "vendor");
// The 7-Zip binary must match the host, not the target: it is the tool doing
// the packing, not something that ends up in the app.
const host = arch();
for (const extension of ["exe", "dll"]) {
  const destination = join(vendor, `7z.${extension}`);
  if (existsSync(destination)) continue;
  const source = join(vendor, `7z-${host}.${extension}`);
  if (!existsSync(source)) {
    throw new Error(`electron-winstaller has no 7-Zip build for ${host}: ${source}`);
  }
  copyFileSync(source, destination);
  console.log(`prepare-squirrel-vendor: staged 7z.${extension} for ${host}`);
}
