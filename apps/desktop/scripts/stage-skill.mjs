import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(desktopDir, "../..");
const source = join(repository, "posterract-skill");
const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
const fileName = `posterract-skill-${manifest.version}.zip`;
const stage = join(desktopDir, "skill");
const webDownloads = join(repository, "apps", "web", "public", "downloads");

const files = {};
function collect(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collect(path);
    else files[join("posterract-skill", relative(source, path)).replaceAll("\\", "/")] = readFileSync(path);
  }
}
collect(source);

const zip = zipSync(files, { level: 9, mtime: new Date("1980-06-01T00:00:00.000Z") });
const checksum = createHash("sha256").update(zip).digest("hex");

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(webDownloads, { recursive: true });
writeFileSync(join(stage, fileName), zip);
writeFileSync(join(stage, `${fileName}.sha256`), `${checksum}  ${fileName}\n`);
cpSync(join(stage, fileName), join(webDownloads, fileName));
cpSync(join(stage, `${fileName}.sha256`), join(webDownloads, `${fileName}.sha256`));
writeFileSync(
  join(stage, "manifest.json"),
  JSON.stringify({ version: manifest.version, fileName, sha256: checksum }, null, 2) + "\n",
);
console.log(`stage-skill: ${fileName} ${checksum}`);
