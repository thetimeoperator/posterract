import assert from "node:assert/strict";
import test from "node:test";

import { compileVirtualProject, hasViewState, prepareProject } from "../src/index.ts";

const LEGACY = `/** @jsxImportSource @posterract/composition */
import { For } from "solid-js";

const picked = () => true;

export default function Project() {
  return (
    <stage id="stage" background="#020604" camera={[0.19, 0, 0, 0.19, -324.4, 168]}>
      <scene
        id="one"
        name="01"
        width={1080}
        height={1920}
        workarea={[0, 33.66]}
      >
        <video id="bg" src="a.mp4" start={0} end={5} muted selected expanded clipHeight={64} />
        <image id="computed" src="a.png" selected={picked()} />
      </scene>
      <scene id="two" name="02" x={1240} width={1080} height={1920} workarea={[0, 35.5]} selected active>
        <For each={[1, 2]}>{() => <rect id="looped" selected width={10} height={10} />}</For>
        <rect selected={false} width={10} height={10} />
      </scene>
    </stage>
  );
}
`;

test("view state is lifted out of a legacy source, and only what the editor wrote", async () => {
  const files: Record<string, string> = { "src/index.tsx": LEGACY };
  const written = new Map<string, string>();
  const view = await prepareProject({ files, onWrite: (path, content) => written.set(path, content) });

  assert.deepEqual(view.camera, [0.19, 0, 0, 0.19, -324.4, 168]);
  assert.equal(view.active, "src/index.tsx:two");
  assert.deepEqual(view.selected.sort(), ["src/index.tsx:bg", "src/index.tsx:two"]);
  assert.deepEqual(view.expanded, ["src/index.tsx:bg"]);
  assert.deepEqual(view.clipHeight, { "src/index.tsx:bg": 64 });
  assert.equal(hasViewState(view), true);

  const next = written.get("src/index.tsx");
  assert.ok(next, "the file is rewritten once");
  // What the editor wrote is gone, and the tags read as if it never was there.
  assert.match(next, /<stage id="stage" background="#020604">/);
  assert.match(next, /<video id="bg" src="a\.mp4" start=\{0\} end=\{5\} muted \/>/);
  assert.match(next, /workarea=\{\[0, 35\.5\]\}>/);
  // Authored reactivity and loop bodies are not the editor's to touch.
  assert.match(next, /selected=\{picked\(\)\}/);
  assert.match(next, /<rect id="looped" selected width=\{10\}/);
  // A literal false is only noise; it goes, and the element it sat on earned an id.
  assert.doesNotMatch(next, /selected=\{false\}/);
  // The document itself is untouched.
  assert.match(next, /workarea=\{\[0, 33\.66\]\}/);
  assert.match(next, /x=\{1240\}/);

  const compiled = await compileVirtualProject([{ path: "src/index.tsx", content: next }], "src/index.tsx");
  assert.equal(compiled.ok, true);
});

test("a source with no view state and every id in place is not written to", async () => {
  const files: Record<string, string> = { "src/index.tsx": LEGACY };
  await prepareProject({ files });

  const written = new Map<string, string>();
  const view = await prepareProject({ files, onWrite: (path, content) => written.set(path, content) });
  assert.equal(written.size, 0);
  assert.equal(hasViewState(view), false);
});

const COMPUTED_IDS = `/** @jsxImportSource @posterract/composition */
function Bracket(props: { id: string }) {
  return <path id={props.id} d="M0 0 L10 0" trimEnd={0} id="bumuuv" id="maclkz" />;
}

function Corner(props: { id: string }) {
  return <rect id={props.id} width={10} height={10} />;
}

export default function Project() {
  return (
    <stage id="stage">
      <scene id="one" width={100} height={100}>
        <Bracket id="left" />
        <Bracket id="right" />
        <Corner id="corner" />
      </scene>
    </stage>
  );
}
`;

test("an id the author computes is kept, and the copies older passes appended to it go", async () => {
  const written = new Map<string, string>();
  await prepareProject({ files: { "src/index.tsx": COMPUTED_IDS }, onWrite: (path, content) => written.set(path, content) });

  const next = written.get("src/index.tsx");
  assert.ok(next, "the stacked ids are cleaned up");
  assert.match(next, /<path id=\{props\.id\} d="M0 0 L10 0" trimEnd=\{0\} \/>/);
  assert.match(next, /<rect id=\{props\.id\} width=\{10\} height=\{10\} \/>/);

  // Opening it again adds nothing.
  const again = new Map<string, string>();
  await prepareProject({ files: { "src/index.tsx": next }, onWrite: (path, content) => again.set(path, content) });
  assert.equal(again.size, 0);

  const compiled = await compileVirtualProject([{ path: "src/index.tsx", content: next }], "src/index.tsx");
  assert.equal(compiled.ok, true);
});
