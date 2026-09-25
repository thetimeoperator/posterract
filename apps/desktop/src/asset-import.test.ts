import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AssetLibrary } from "../../../packages/posterract-video-assets/src/library.ts";
import type { ProjectFS } from "../../../packages/posterract-video-assets/src/fs.ts";
import type { Manifest } from "../../../packages/posterract-video-assets/src/manifest.ts";

const video = await readFile(new URL("../fixtures/import-video.mp4", import.meta.url));
const filename = "WhatsApp Video 2026-09-05 at 09.00.52.mp4";

function projectFiles(source: string) {
  const files = new Map<string, File>([[source, new File([video], filename, { type: "video/mp4" })]]);
  const copies: { source: string; path: string }[] = [];
  let manifest: Manifest | null = null;
  const fs: ProjectFS = {
    async readManifest() { return manifest; },
    async writeManifest(value) { manifest = value; },
    async list() { return []; },
    async stat(path) {
      const file = files.get(path);
      return file ? { size: file.size, mtime: file.lastModified } : null;
    },
    async file(path) {
      const file = files.get(path);
      assert.ok(file, `Missing file: ${path}`);
      return file;
    },
    async write(path, data) { files.set(path, new File([data], filename)); },
    async copy(source, path) {
      // A Windows drive prefix embedded in the destination caused the reported mkdir failure.
      assert.doesNotMatch(path, /[:\\]/, "The copy destination must be a portable project path");
      assert.ok(!files.has(path), "Import must not overwrite existing project footage");
      files.set(path, await fs.file(source));
      copies.push({ source, path });
    },
    async remove(path) { files.delete(path); },
  };
  return { fs, files, copies, savedManifest: () => manifest };
}

for (const [label, directory] of [
  ["Windows drive", "C:\\Users\\jessi\\Downloads\\"],
  ["Windows network share", "\\\\studio-nas\\Media\\"],
  ["mixed Windows separators", "C:\\Users\\jessi/Downloads\\"],
  ["Windows forward slashes", "C:/Users/jessi/Downloads/"],
  ["macOS/Linux", "/Users/jessi/Downloads/"],
] as const) {
  test(`import copies ${label} video using only its filename`, async (t) => {
    const source = directory + filename;
    const project = projectFiles(source);
    const library = new AssetLibrary(project.fs);
    t.after(() => library.dispose());

    const result = await library.import([source]);

    assert.deepEqual(result.failed, []);
    assert.equal(result.assets.length, 1);
    const asset = result.assets[0]!;
    assert.equal(asset.type, "VIDEO");
    assert.equal(asset.path, filename);
    assert.equal(asset.source, `assets/video/${filename}`);
    assert.deepEqual(project.copies, [{ source, path: asset.source }]);
    assert.deepEqual(await (await project.fs.file(asset.source)).arrayBuffer(), await (await project.fs.file(source)).arrayBuffer());
    await library.flush();
    assert.equal(project.savedManifest()?.assets[0]?.source, asset.source);

    const repeated = await library.import([source]);
    assert.deepEqual(repeated.failed, []);
    assert.equal(repeated.assets[0]?.id, asset.id);
    assert.equal(project.copies.length, 1, "Reimporting identical bytes is deduplicated");
  });
}

test("Windows import into a library folder preserves existing destination footage", async (t) => {
  const source = `C:\\Users\\jessi\\Downloads\\${filename}`;
  const project = projectFiles(source);
  const occupiedPath = `assets/video/Campaign/Launch/${filename}`;
  const existing = new File(["existing footage"], filename);
  project.files.set(occupiedPath, existing);
  const library = new AssetLibrary(project.fs);
  t.after(() => library.dispose());

  const result = await library.import([source], { folder: "Campaign/Launch" });

  assert.deepEqual(result.failed, []);
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0]?.path, `Campaign/Launch/${filename}`);
  assert.equal(result.assets[0]?.source, "assets/video/Campaign/Launch/WhatsApp Video 2026-09-05 at 09.00.52 2.mp4");
  assert.equal(project.files.get(occupiedPath), existing);
  assert.deepEqual(project.copies, [{ source, path: result.assets[0]!.source }]);
});
