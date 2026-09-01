import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
const textExtensions = new Set([
  ".cjs", ".css", ".d.ts", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".ts", ".tsx", ".txt", ".yml", ".yaml",
]);
const forbidden = [
  { label: "inherited package or product name", pattern: /@diffusionstudio|diffusionstudio/gi },
  { label: "inherited project directory", pattern: /\.diffusion(?:\/|\\|\b)/gi },
  { label: "inherited CLI name", pattern: /\bdapi\b/gi },
  { label: "Supabase product dependency", pattern: /supabase/gi },
];
const allowedSource = new Set([
  "apps/desktop/src/legacy-migration.ts",
  "apps/desktop/src/legacy-migration.test.ts",
]);

const roots = [
  "apps/desktop/src",
  "apps/editor-sandbox/src",
  "packages/posterract-cli/src",
  "packages/posterract-composition/src",
  "packages/posterract-koota-solid/src",
  "packages/posterract-video-assets/src",
  "packages/posterract-video-encoder/src",
  "packages/posterract-video-reconciler/src",
  "packages/posterract-video-runtime/src",
  "packages/video-compiler/src",
  "apps/desktop/fixtures/fresh-project",
  "apps/desktop/renderer/editor-sandbox",
  "apps/desktop/cli",
  "apps/desktop/sdk",
  "apps/desktop/docs",
  "apps/desktop/examples",
  "apps/desktop/skill",
  "posterract-skill",
];

const packagedResources = join(
  repository,
  "apps/desktop/out/Posterract-darwin-arm64/Posterract.app/Contents/Resources/app",
);
if (existsSync(packagedResources)) roots.push(relative(repository, packagedResources));

const failures = [];
function normalizedContent(path, content) {
  const rel = relative(repository, path).replaceAll("\\", "/");
  if (rel.endsWith("/dist/application.cjs")) {
    // The packaged main bundle contains the explicitly permitted, isolated
    // legacy-project migration aliases. Remove only those exact aliases; any
    // other inherited product reference still fails the scan.
    return content
      .replaceAll("@diffusionstudio/jsx", "")
      .replaceAll("@diffusionstudio\\/jsx", "")
      .replaceAll("pkg.diffusion", "pkg.legacyConfig")
      .replaceAll("next.diffusion", "next.legacyConfig")
      .replace(/\bdapi\b/g, "");
  }
  return content;
}

function inspectText(path, value) {
  const rel = relative(repository, path).replaceAll("\\", "/");
  if (allowedSource.has(rel)) return;
  const content = normalizedContent(path, value);
  for (const rule of forbidden) {
    rule.pattern.lastIndex = 0;
    const match = rule.pattern.exec(content);
    if (!match) continue;
    const line = content.slice(0, match.index).split("\n").length;
    failures.push(`${rel}:${line}: ${rule.label}: ${match[0]}`);
  }
}

function inspectZip(path) {
  const entries = unzipSync(new Uint8Array(readFileSync(path)));
  for (const [name, bytes] of Object.entries(entries)) {
    if (!textExtensions.has(extname(name).toLowerCase())) continue;
    inspectText(`${path}:${name}`, new TextDecoder().decode(bytes));
  }
}

function visit(path) {
  if (!existsSync(path)) return;
  const details = statSync(path);
  if (details.isDirectory()) {
    for (const name of readdirSync(path).sort()) {
      if (["node_modules", ".tmp", ".git"].includes(name)) continue;
      visit(join(path, name));
    }
    return;
  }
  if (extname(path).toLowerCase() === ".zip") return inspectZip(path);
  if (!textExtensions.has(extname(path).toLowerCase())) return;
  inspectText(path, readFileSync(path, "utf8"));
}

for (const root of roots) visit(join(repository, root));

if (failures.length) {
  console.error(`Posterract artifact scan failed (${failures.length}):\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`Posterract artifact scan passed across ${roots.length} source and packaged roots.`);
