import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const requireFromEsbuild = createRequire(require.resolve("esbuild"));

const platformPackages = {
  "darwin-arm64": ["@esbuild/darwin-arm64", "bin/esbuild", "esbuild"],
  "darwin-x64": ["@esbuild/darwin-x64", "bin/esbuild", "esbuild"],
  "linux-arm64": ["@esbuild/linux-arm64", "bin/esbuild", "esbuild"],
  "linux-x64": ["@esbuild/linux-x64", "bin/esbuild", "esbuild"],
  "win32-arm64": ["@esbuild/win32-arm64", "esbuild.exe", "esbuild.exe"],
  "win32-ia32": ["@esbuild/win32-ia32", "esbuild.exe", "esbuild.exe"],
  "win32-x64": ["@esbuild/win32-x64", "esbuild.exe", "esbuild.exe"],
};

const target = platformPackages[`${process.platform}-${process.arch}`];
if (!target) {
  throw new Error(`Unsupported desktop compiler target: ${process.platform}-${process.arch}`);
}

const [packageName, subpath, outputName] = target;
const source = requireFromEsbuild.resolve(`${packageName}/${subpath}`);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(scriptDirectory, "../dist");
const destination = path.join(outputDirectory, outputName);

await mkdir(outputDirectory, { recursive: true });
// A new file, never the old one overwritten: macOS remembers the signature of
// a binary that has run, and kills it on its next launch once its bytes were
// replaced in place — the engine then dies compiling ("The service is no
// longer running"), even though the copy is byte for byte the same.
await rm(destination, { force: true });
await copyFile(source, destination);
await chmod(destination, 0o755);
