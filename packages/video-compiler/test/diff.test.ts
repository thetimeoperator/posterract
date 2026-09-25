import assert from "node:assert/strict";
import test from "node:test";

import { diffSources, formatDiff } from "../src/index.ts";

const source = (body: string, head = ""): string => `${head}export default () => (
  <stage id="stage">
    <scene id="main" width={1080} height={1920}>
${body}
    </scene>
  </stage>
);`;

const BEFORE = source(`      <video id="bg" src="a.mp4" start={0} end={10} />
      <text id="hook" x={90} y={1480} color="#FFFFFF" fontSize={72} start={0} end={3}>Nobody talks about this</text>
      <image id="clip-3" src="c.png" start={3} end={6} />
      <image id="photo" src="p.png" start={0} end={4}>
        <keyframeTrack id="photo-x" property="x">
          <keyframe id="k1" time={0} value={60} />
          <keyframe id="k2" time={1} value={63} />
        </keyframeTrack>
      </image>`);

test("what a person did on the canvas, element by element", () => {
  // They dragged the caption up, recoloured it, and deleted a clip.
  const after = source(`      <video id="bg" src="a.mp4" start={0} end={10} />
      <text id="hook" x={90} y={1200} color="#FFE600" fontSize={72} start={0} end={3}>Nobody talks about this</text>
      <image id="photo" src="p.png" start={0} end={4}>
        <keyframeTrack id="photo-x" property="x">
          <keyframe id="k1" time={0} value={60} />
          <keyframe id="k2" time={1} value={63} />
        </keyframeTrack>
      </image>`);
  const diff = diffSources("index.tsx", BEFORE, after);
  assert.equal(diff.code, false);
  assert.deepEqual(diff.motion, []);
  assert.deepEqual(
    diff.changes.map((change) => (change.kind === "prop" ? `${change.id}.${change.name} ${change.before}→${change.after}` : `${change.id} ${change.kind}`)),
    ["hook.y 1480→1200", "hook.color #FFFFFF→#FFE600", "clip-3 removed"],
  );
  assert.deepEqual(formatDiff(diff), [
    "text#hook     y        1480 → 1200",
    "text#hook     color    #FFFFFF → #FFE600",
    "image#clip-3  removed",
  ]);
});

test("words, additions, props set and unset", () => {
  const after = BEFORE
    .replace("Nobody talks about this", "Everybody talks about this")
    .replace(' fontSize={72}', "")
    .replace('<image id="clip-3" src="c.png" start={3} end={6} />', '<image id="clip-3" src="c.png" start={3} end={6} opacity={0.5} />\n      <rect id="plate" x={0} y={0} width={10} height={10} fill="#000"><stroke id="plate-stroke" color="#fff" /></rect>');
  const lines = formatDiff(diffSources("index.tsx", BEFORE, after));
  assert.ok(lines.includes('text#hook     says      "Nobody talks about this" → "Everybody talks about this"'), lines.join("\n"));
  assert.ok(lines.some((line) => /^text#hook\s+fontSize\s+72 → \(unset\)$/.test(line)), lines.join("\n"));
  assert.ok(lines.some((line) => /^image#clip-3\s+opacity\s+\(unset\) → 0\.5$/.test(line)), lines.join("\n"));
  assert.ok(lines.some((line) => /^rect#plate\s+added\s+under #main$/.test(line)), lines.join("\n"));
  // What came with an added element is not reported a second time.
  assert.equal(lines.some((line) => line.includes("plate-stroke")), false);
});

test("a retimed animation is counted against the element it moves, not listed", () => {
  const after = BEFORE
    .replace('<keyframe id="k2" time={1} value={63} />', '<keyframe id="k2" time={1.5} value={70} />\n          <keyframe id="k3" time={2} value={60} />');
  const diff = diffSources("index.tsx", BEFORE, after);
  assert.deepEqual(diff.changes, []);
  assert.deepEqual(diff.motion, [{ id: "photo", added: 1, removed: 0, changed: 1 }]);
  assert.deepEqual(formatDiff(diff), ["#photo  motion  keyframes/animations: 1 changed, 1 added"]);
});

test("draw order and nesting are changes; formatting and a click are not", () => {
  const swapped = source(`      <text id="hook" x={90} y={1480} color="#FFFFFF" fontSize={72} start={0} end={3}>Nobody talks about this</text>
      <video id="bg" src="a.mp4" start={0} end={10} />
      <image id="clip-3" src="c.png" start={3} end={6} />`);
  const plain = source(`      <video id="bg" src="a.mp4" start={0} end={10} />
      <text id="hook" x={90} y={1480} color="#FFFFFF" fontSize={72} start={0} end={3}>Nobody talks about this</text>
      <image id="clip-3" src="c.png" start={3} end={6} />`);
  assert.deepEqual(formatDiff(diffSources("index.tsx", plain, swapped)), ["video#bg  reordered  draws in a different order among its siblings"]);

  const nested = source(`      <video id="bg" src="a.mp4" start={0} end={10} />
      <group id="g"><text id="hook" x={90} y={1480} color="#FFFFFF" fontSize={72} start={0} end={3}>Nobody talks about this</text></group>
      <image id="clip-3" src="c.png" start={3} end={6} />`);
  const moved = formatDiff(diffSources("index.tsx", plain, nested));
  assert.ok(moved.some((line) => /^text#hook\s+moved\s+#main → #g$/.test(line)), moved.join("\n"));

  // Reformatting, and the view state an older editor wrote on every click.
  const clicked = plain.replace('<video id="bg"', '<video   id="bg"   selected').replace('<scene id="main"', '<scene id="main" active');
  const quiet = diffSources("index.tsx", plain, clicked);
  assert.deepEqual([quiet.changes, quiet.motion, quiet.code], [[], [], false]);
  assert.match(formatDiff(quiet)[0]!, /no element changed/);
  assert.deepEqual(formatDiff(diffSources("index.tsx", plain, plain)), ["no changes"]);
});

test("code around the elements is flagged, and a file mid-edit is not second-guessed", () => {
  const withImport = source(`      <video id="bg" src="a.mp4" start={0} end={10} />`, 'import { For } from "solid-js";\nconst accent = "#fff";\n');
  const without = source(`      <video id="bg" src="a.mp4" start={0} end={10} />`);
  const diff = diffSources("index.tsx", without, withImport);
  assert.deepEqual([diff.changes.length, diff.code], [0, true]);
  assert.deepEqual(diffSources("index.tsx", without, "export default () => <stage><scene").code, true);
});
