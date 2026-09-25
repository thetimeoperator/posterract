import assert from "node:assert/strict";
import test from "node:test";

import { transformSync } from "@babel/core";

import { readElements } from "../src/diff.ts";
import { sourcePlugin } from "../src/source.ts";

/**
 * A patch addresses an element that has no id the way the compiler does: by its
 * place among the JSX elements of the file. Two pieces of code count that place
 * — the compiler's Babel pass and the differ's TypeScript one — and a patch is
 * only as right as their agreement, so it is pinned here on a source with
 * everything that could make them disagree: DOM tags inside an <html>, a
 * component, an element in a prop, a fragment, a loop.
 */
test("the differ counts an element's position exactly as the compiler stamps it", () => {
  const source = `import { For } from "solid-js";
const Badge = (props) => <group><rect width={1} height={1} /></group>;
export default () => (
  <stage id="stage">
    <scene id="main" width={1080} height={1920}>
      <rect width={10} height={10} />
      <html width={400} height={300}><div class="a"><b>hi</b><br /></div></html>
      <Badge />
      <group mask={<ellipse width={5} height={5} />}>
        <>
          <text x={1} y={2}>One</text>
        </>
        <For each={[1, 2]}>{(n) => <rect x={n} width={2} height={2} />}</For>
      </group>
      <text id="named" x={3} y={4}>Two</text>
    </scene>
  </stage>
);`;

  const compiled = transformSync(source, {
    filename: "src/index.tsx",
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["jsx", "typescript"] },
    plugins: [[sourcePlugin, { file: "src/index.tsx" }]],
  })!.code!;
  // Every address the compiler handed out (in the order the output spells them).
  const stamped = [...compiled.matchAll(/__source="src\/index\.tsx:([^"]+)"/g)].map((match) => match[1]!);

  const { records } = readElements("src/index.tsx", source);
  const read = [...records.values()]
    .sort((a, b) => a.position - b.position)
    .map((record) => (record.named ? record.key : String(record.position)));

  // The one element the differ does not list is the one written inside a prop
  // (the mask's <ellipse>): a change to it is a change of that prop, which is
  // computed, so it is never patched. It still takes its place in the count.
  const expected = ["0", "1", "stage", "main", "4", "5", "10", "11", "12", "14", "named"];
  assert.deepEqual([...stamped].sort(), [...expected].sort());
  assert.deepEqual(read, expected.filter((address) => address !== "11"));
});
