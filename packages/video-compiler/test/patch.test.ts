import assert from "node:assert/strict";
import test from "node:test";

import { patchSources } from "../src/patch.ts";

const source = (body: string, head = ""): string => `${head}export default () => (
  <stage id="stage">
    <scene id="main" width={1080} height={1920}>
${body}
    </scene>
  </stage>
);`;

const BASE = source(`      <video id="bg" src="a.mp4" start={0} end={10} muted />
      <text id="hook" x={90} y={1480} color="#FFFFFF" fontSize={72} start={0} end={3}>Nobody talks about this</text>
      <image id="photo" src="p.png" x={60} start={0} end={4} transition={{ type: "dissolve", duration: 0.5 }}>
        <keyframeTrack id="photo-x" property="x">
          <keyframe id="k1" time={0} value={60} />
          <keyframe id="k2" time={1} value={63} easing="easeOut" />
        </keyframeTrack>
      </image>`);

const ops = (after: string) => {
  const patch = patchSources("src/index.tsx", BASE, after);
  assert.equal(patch.ok, true, patch.ok ? "" : patch.reason);
  return patch.ok ? patch.ops : [];
};
const refused = (after: string): string => {
  const patch = patchSources("src/index.tsx", BASE, after);
  assert.equal(patch.ok, false);
  return patch.ok ? "" : patch.reason;
};

test("small literal edits are carried as they are: props set and unset, words, keyframes, typed values", () => {
  const after = BASE
    .replace("y={1480}", "y={1200}")
    .replace(' color="#FFFFFF"', "")
    .replace("Nobody talks about this", "Everybody talks about this")
    .replace('<keyframe id="k2" time={1} value={63} easing="easeOut" />', '<keyframe id="k2" time={1.5} value={-70} easing="easeOut" />')
    .replace(' muted />', ' volume={-6} />')
    .replace('duration: 0.5 }}', 'duration: 1 }}');
  assert.deepEqual(ops(after), [
    { kind: "prop", source: "src/index.tsx:bg", name: "muted", value: false },
    { kind: "prop", source: "src/index.tsx:bg", name: "volume", value: -6 },
    { kind: "prop", source: "src/index.tsx:hook", name: "y", value: 1200 },
    { kind: "prop", source: "src/index.tsx:hook", name: "color", value: false },
    { kind: "text", source: "src/index.tsx:hook", value: "Everybody talks about this" },
    { kind: "prop", source: "src/index.tsx:photo", name: "transition", value: { type: "dissolve", duration: 1 } },
    { kind: "prop", source: "src/index.tsx:k2", name: "time", value: 1.5 },
    { kind: "prop", source: "src/index.tsx:k2", name: "value", value: -70 },
  ]);
});

test("formatting, respelling and a click are no change at all", () => {
  assert.deepEqual(ops(BASE.replace("y={1480}", "y={1480.0}").replace('<video id="bg"', '<video   id="bg"   selected')), []);
  assert.deepEqual(ops(BASE), []);
});

test("anything not certain is refused, with the reason — the caller remounts", () => {
  assert.match(refused(BASE.replace('<video id="bg"', '<rect id="new" width={1} height={1} />\n      <video id="bg"')), /added or removed/);
  assert.match(refused(BASE.replace('<image id="photo" src="p.png" x={60} start={0} end={4} transition={{ type: "dissolve", duration: 0.5 }}>', '<image id="photo" src="q.png" x={60} start={0} end={4} transition={{ type: "dissolve", duration: 0.5 }}>')), /`src` of photo changed, which needs a remount/);
  assert.match(refused(BASE.replace("y={1480}", "y={offset() + 10}")), /`y` of hook is now computed by code/);
  assert.match(refused(BASE.replace("Nobody talks about this", "{headline()}")), /what hook says is computed by code/);
  assert.match(refused(`const n = 1;\n${BASE}`), /code around the elements changed/);
  assert.match(refused(BASE.replace("</scene>", "</scene")), /does not parse/);

  // Draw order is document order: a swap is a change of what is on top.
  const swapped = source(`      <text id="hook" x={90} y={1480} color="#FFFFFF" fontSize={72} start={0} end={3}>Nobody talks about this</text>
      <video id="bg" src="a.mp4" start={0} end={10} muted />
      <image id="photo" src="p.png" x={60} start={0} end={4} transition={{ type: "dissolve", duration: 0.5 }}>
        <keyframeTrack id="photo-x" property="x">
          <keyframe id="k1" time={0} value={60} />
          <keyframe id="k2" time={1} value={63} easing="easeOut" />
        </keyframeTrack>
      </image>`);
  assert.match(refused(swapped), /moved or reordered/);
});

test("an element a loop renders is never patched: it is written once and rendered many times", () => {
  const looped = (x: number) => source(`      <For each={items}>{(item) => <rect id="dot" x={${x}} width={4} height={4} />}</For>`, 'import { For } from "solid-js";\n');
  const patch = patchSources("src/index.tsx", looped(1), looped(2));
  assert.equal(patch.ok, false);
  assert.match(patch.ok ? "" : patch.reason, /rendered by code/);
});

test("an element with no id is addressed the way the compiler addresses it: by its position in the file", () => {
  const unnamed = (y: number) => source(`      <rect width={10} height={10} />
      <html id="card" width={400} height={300}><div class="a"><b>hi</b></div></html>
      <text x={90} y={${y}} fontSize={72}>Hello</text>`);
  const patch = patchSources("src/index.tsx", unnamed(100), unnamed(200));
  assert.equal(patch.ok, true, patch.ok ? "" : patch.reason);
  // stage 0, scene 1, rect 2, html 3, div 4, b 5, text 6: DOM tags are counted too.
  assert.deepEqual(patch.ok ? patch.ops : [], [{ kind: "prop", source: "src/index.tsx:6", name: "y", value: 200 }]);
});

test("what an element holds besides elements is not a prop: markup in an <html>, the condition around a child", () => {
  const card = (markup: string) => source(`      <html id="card" width={400} height={300}>${markup}</html>`);
  assert.match(
    (() => { const patch = patchSources("src/index.tsx", card("<div>one</div>"), card("<div>two</div>")); return patch.ok ? "" : patch.reason; })(),
    /what card holds besides elements changed/,
  );
  const shown = (condition: string) => source(`      <group id="g">{${condition} && <rect id="r" width={1} height={1} />}</group>`);
  assert.match(
    (() => { const patch = patchSources("src/index.tsx", shown("on()"), shown("!on()")); return patch.ok ? "" : patch.reason; })(),
    /what g holds besides elements changed/,
  );
});

test("a refused patch still says where the elements with no id went, so what was recorded about them can follow", () => {
  const before = source(`      <rect width={10} height={10} />
      <text x={1} y={2}>One</text>
      <text x={3} y={4}>Two</text>
      <rect width={20} height={20} />`);
  // A new element above them, the first text reworded, the last rect given a name.
  const after = source(`      <image id="logo" src="l.png" />
      <rect width={10} height={10} />
      <text x={1} y={2}>One, reworded</text>
      <text x={3} y={4}>Two</text>
      <rect id="named-now" width={20} height={20} />`);
  const patch = patchSources("src/index.tsx", before, after);
  assert.equal(patch.ok, false);
  assert.deepEqual(patch.ok ? {} : patch.renames, {
    "src/index.tsx:2": "src/index.tsx:3", // the first rect moved down one
    "src/index.tsx:3": "src/index.tsx:~gone-3", // reworded: not recognisably the same, so not guessed at
    "src/index.tsx:4": "src/index.tsx:5",
    "src/index.tsx:5": "src/index.tsx:named-now",
  });
});

test("a source that does not parse vouches for no addresses at all", () => {
  const patch = patchSources("src/index.tsx", BASE, BASE.replace("</scene>", "</scene"));
  assert.equal(patch.ok, false);
  assert.equal(patch.ok ? undefined : patch.renames, undefined);
});
