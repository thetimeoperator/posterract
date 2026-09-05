import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// `electron` is aliased to a stub at build time; nothing here touches the
// user's real library because every root is a temp folder.
const { listSkills } = await import("./skills.ts");

// The smallest valid PNG: 1×1, transparent.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function skillFolder(root: string, folder: string, frontmatter: string, extras: Record<string, string | Buffer> = {}) {
  const dir = join(root, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# ${folder}\n`);
  for (const [name, content] of Object.entries(extras)) {
    await mkdir(join(dir, name, ".."), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return dir;
}

async function roots() {
  const base = await mkdtemp(join(tmpdir(), "posterract-skills-"));
  const bundled = join(base, "bundled");
  const library = join(base, "library");
  const project = join(base, "project");
  await mkdir(bundled, { recursive: true });
  await mkdir(library, { recursive: true });
  await mkdir(join(project, "skills"), { recursive: true });
  return { base, bundled, library, project };
}

test("a skill folder becomes a card from its frontmatter, manifest and cover", async () => {
  const { bundled, library, project } = await roots();
  await skillFolder(
    library,
    "lead-with-animations-clean",
    'name: lead-with-animations\ndescription: "Turn a script into a 9:16 short where animations lead."',
    {
      "posterract.json": JSON.stringify({
        cover: "assets/cover.png",
        format: "9:16",
        duration: [20, 45],
        tags: ["avatar", "captions"],
        requires: ["Fish", "heygen"],
        recipes: [{ label: "Write the script", prompt: "Write it." }, { bad: true }],
      }),
      "assets/cover.png": PNG,
    },
  );

  const cards = await listSkills(project, { bundled, library });
  assert.equal(cards.length, 1);
  const card = cards[0]!;
  assert.equal(card.name, "lead-with-animations");
  assert.equal(card.title, "Lead With Animations");
  assert.equal(card.description, "Turn a script into a 9:16 short where animations lead.");
  assert.equal(card.source, "library");
  assert.equal(card.format, "9:16");
  assert.deepEqual(card.duration, [20, 45]);
  assert.deepEqual(card.tags, ["avatar", "captions"]);
  assert.deepEqual(card.requires, ["fish", "heygen"]);
  assert.deepEqual(card.recipes, [{ label: "Write the script", prompt: "Write it." }]);
  assert.equal(card.hasStarter, false);
  assert.ok(card.cover?.startsWith("data:image/png;base64,"), "the cover rides along as a data URL");
  assert.equal(card.logo, null);
});

test("a bare SKILL.md still gets a card, without a cover, so the deck draws a sigil", async () => {
  const { bundled, library, project } = await roots();
  await skillFolder(bundled, "talking-head", "name: talking-head\ndescription: A creator speaking to camera.");
  await mkdir(join(bundled, "not-a-skill"), { recursive: true });
  await writeFile(join(bundled, "not-a-skill", "README.md"), "nothing here");

  const cards = await listSkills(project, { bundled, library });
  assert.deepEqual(
    cards.map((card) => [card.name, card.source, card.cover]),
    [["talking-head", "bundled", null]],
  );
  assert.equal(cards[0]!.title, "Talking Head");
});

test("project skills come first and a same-named copy replaces the bundled card", async () => {
  const { bundled, library, project } = await roots();
  await skillFolder(bundled, "talking-head", "name: talking-head\ndescription: bundled");
  await skillFolder(bundled, "product-demo", "name: product-demo\ndescription: bundled");
  await skillFolder(library, "ugc", "name: ugc-ad-video\ndescription: library");
  await skillFolder(join(project, "skills"), "talking-head", "name: talking-head\ndescription: the project's own");

  const cards = await listSkills(project, { bundled, library });
  assert.deepEqual(
    cards.map((card) => [card.name, card.source, card.description]),
    [
      ["talking-head", "project", "the project's own"],
      ["ugc-ad-video", "library", "library"],
      ["product-demo", "bundled", "bundled"],
    ],
  );
});

test("the largest image in assets stands in when nothing is named cover", async () => {
  const { bundled, library, project } = await roots();
  await skillFolder(library, "globe", "name: globe-video-agent\ndescription: globes", {
    "assets/frame-a.png": PNG,
    "assets/frame-b.png": Buffer.concat([PNG, Buffer.alloc(64)]),
  });

  const [card] = await listSkills(project, { bundled, library });
  assert.ok(card?.cover?.startsWith("data:image/png;base64,"));
  assert.equal(card!.title, "Globe Video Agent");
});
