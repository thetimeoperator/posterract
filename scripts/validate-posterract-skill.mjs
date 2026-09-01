import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const repository = resolve(new URL("..", import.meta.url).pathname.replaceAll("%20", " "));
const skill = join(repository, "posterract-skill");
const cli = join(repository, "packages/posterract-cli/dist/index.cjs");
const required = [
  "SKILL.md",
  "manifest.json",
  "references/installation.md",
  "references/workflow.md",
  "references/composition-sdk.md",
  "references/cli.md",
  "references/media-analysis.md",
  "references/easings.md",
  "references/troubleshooting.md",
  "references/posting-api.md",
  "examples/talking-head.md",
  "examples/podcast-clip.md",
  "examples/short-form-video.md",
  "examples/motion-graphics.md",
  "examples/product-demo.md",
];
for (const path of required) {
  if (!existsSync(join(skill, path))) throw new Error(`Missing skill file: ${path}`);
}

const entry = readFileSync(join(skill, "SKILL.md"), "utf8");
const frontmatter = entry.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
if (!/^name:\s*posterract$/m.test(frontmatter) || !/^description:\s*.+$/m.test(frontmatter)) {
  throw new Error("SKILL.md frontmatter must declare name and description");
}
const manifest = JSON.parse(readFileSync(join(skill, "manifest.json"), "utf8"));
if (manifest.entry !== "SKILL.md" || manifest.compatibility?.protocol !== 1) {
  throw new Error("Skill manifest entry or protocol compatibility is invalid");
}

const helpCommands = [
  [], ["open"], ["context"], ["validate"], ["check"], ["capture"], ["export"],
  ["media"], ["media", "probe"], ["media", "grab"], ["media", "filmstrip"],
  ["media", "waveform"], ["media", "extract"], ["fonts"], ["fetch"],
  ["screenshot"], ["logs"], ["report"], ["doctor"], ["whoami"], ["version"],
];
for (const command of helpCommands) {
  const result = spawnSync(process.execPath, [cli, ...command, "--help"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.includes("Usage:")) {
    throw new Error(`CLI help failed for posterract ${command.join(" ")}: ${result.stderr}`);
  }
}

const rootHelp = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" }).stdout;
for (const unsupported of ["transcribe", "listen", "models", "voices"]) {
  if (new RegExp(`\\b${unsupported}\\b`).test(rootHelp)) {
    throw new Error(`Unsupported command is exposed: ${unsupported}`);
  }
}

const stagedManifest = JSON.parse(
  readFileSync(join(repository, "apps/desktop/skill/manifest.json"), "utf8"),
);
const zip = readFileSync(join(repository, "apps/desktop/skill", stagedManifest.fileName));
const checksum = createHash("sha256").update(zip).digest("hex");
if (checksum !== stagedManifest.sha256) throw new Error("Packaged skill checksum does not match");

console.log(`Posterract skill ${manifest.version} validated against ${helpCommands.length} CLI help contracts.`);
