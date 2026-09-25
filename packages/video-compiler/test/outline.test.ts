import assert from "node:assert/strict";
import test from "node:test";

import { formatOutline, outlineSource } from "../src/index.ts";

const SOURCE = `/** @jsxImportSource @posterract/composition */
import { For } from "solid-js";

function Badge(props: { x: number }) {
  return <rect id="badge" x={props.x} y={10} width={40} height={40} fill="#65ff9a" />;
}

export default function Project() {
  return (
    <stage id="stage">
      <scene id="main" name="Main" width={1080} height={1920} workarea={[0, 12.5]}>
        <marker id="note" time={3.1} name="@agent caption too small here" />
        <video id="bg" src="assets/bg.mp4" x={0} y={0} width={1080} height={1920} start={0} end={12.5}>
          <animation id="bg-in" type="fade" phase="in" duration={0.3} />
          <animation id="bg-out" type="fade" phase="out" duration={0.3} />
        </video>
        <text id="hook" x={90} y={-20} width={900} fontSize={88} color="#ffffff" start={0.2} end={2.4}>
          Nobody talks about this
          <stroke id="hook-stroke" color="#000000" width={6} />
          <keyframeTrack id="hook-y" property="y">
            <keyframe id="k1" time={0} value={40} />
            <keyframe id="k2" time={0.3} value={-20} />
          </keyframeTrack>
        </text>
        <Badge x={20} />
        <For each={[1, 2, 3]}>{(n) => <rect id="dot" x={n * 40} y={1800} width={20} height={20} />}</For>
        <html id="panel" x={0} y={0} width={400} height={200}><div><span>inner dom is content, not shape</span></div></html>
      </scene>
    </stage>
  );
}
`;

test("the outline lists what places each element and folds away what elaborates it", () => {
  const entries = outlineSource("src/index.tsx", SOURCE);
  const byId = new Map(entries.flatMap((entry) => (entry.id ? [[entry.id, entry] as const] : [])));

  // Motion and parts are folded into their element, never listed on their own.
  for (const folded of ["bg-in", "bg-out", "hook-stroke", "hook-y", "k1", "k2"]) assert.equal(byId.has(folded), false);

  const hook = byId.get("hook")!;
  assert.equal(hook.text, "Nobody talks about this");
  assert.deepEqual(hook.keyframes, { y: 2 });
  assert.deepEqual(hook.parts, { stroke: 1 });
  assert.equal(hook.props.y, -20);
  assert.equal(hook.line, 17);
  assert.equal(hook.endLine, 24);

  assert.deepEqual(byId.get("bg")!.animations, ["fade in", "fade out"]);
  assert.deepEqual(byId.get("main")!.props.workarea, [0, 12.5]);

  // A loop body is written once and says so; a computed prop is named, not guessed.
  const dot = byId.get("dot")!;
  assert.equal(dot.looped, true);
  assert.deepEqual(dot.computed, ["x"]);

  // A project component shows in the shape; DOM inside <html> does not.
  assert.ok(entries.some((entry) => entry.tag === "Badge" && entry.component));
  assert.equal(entries.some((entry) => entry.tag === "div" || entry.tag === "span"), false);

  const text = formatOutline(entries).join("\n");
  assert.match(text, /marker#note "@agent caption too small here" @3\.10s/);
  assert.match(text, /text#hook says "Nobody talks about this" 0\.20–2\.40s · at 90,-20 · fontSize=88 · color=#ffffff \| keys y×2, \+stroke/);
  assert.match(text, /rect#dot .*computed: x · in a loop/);
});

test("a long run of look-alike siblings is one line, not forty", () => {
  const cards = Array.from({ length: 40 }, (_, i) =>
    `<image id="cue-${i}" src="c${i}.png" x={100} y={500} width={600} height={120} start={${i}} end={${i + 1}} />`).join("\n        ");
  const source = `export default () => (
    <stage id="stage">
      <scene id="main" width={1080} height={1920}>
        ${cards}
      </scene>
    </stage>
  );`;
  const lines = formatOutline(outlineSource("index.tsx", source));
  assert.equal(lines.length, 5);
  assert.match(lines[3]!, /… 38 more image \(L5–L42\) 0\.00–40\.00s/);
});

test("a file that is not a composition has an empty outline", () => {
  assert.deepEqual(outlineSource("notes.ts", "export const a = 1;"), []);
});
