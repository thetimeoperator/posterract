import assert from "node:assert/strict";
import test from "node:test";

import { applyEdits, compileVirtualProject } from "../src/index.ts";
import { POSTERRACT_STARTER_SOURCE } from "../src/starter.ts";

test("the Posterract starter compiles into a mountable Posterract bundle", async () => {
  const result = await compileVirtualProject([
    { path: "index.tsx", content: POSTERRACT_STARTER_SOURCE },
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.code.length > 1_000);
  assert.deepEqual(result.diagnostics, []);
});

test("inspector variables compile as live Posterract controls", async () => {
  const source = `/** @jsxImportSource @posterract/composition */
/** @inspect number path="Typography/Size" min=12 max=180 step=1 */
const titleSize = 72;

export default function Project() {
  return <stage width={1080} height={1920}><scene id="video"><text id="title" fontSize={titleSize}>Hello</text></scene></stage>;
}`;

  const result = await compileVirtualProject([{ path: "index.tsx", content: source }]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.code, /__inspect/);
  assert.match(result.code, /Typography/);
});

test("invalid inspector variables produce a source diagnostic", async () => {
  const source = `/** @jsxImportSource @posterract/composition */
/** @inspect select options="short,long" */
const format = "square";

export default function Project() {
  return <stage width={1080} height={1920}><scene id="video"><text id="title">{format}</text></scene></stage>;
}`;

  const result = await compileVirtualProject([{ path: "index.tsx", content: source }]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"), /not one of short, long/);
});

test("an inspector edit updates only an annotated literal", async () => {
  const files = {
    "index.tsx": `/** @inspect color path="Brand/Accent" */
const accent = "#59f58b";
const computed = makeColor();\n`,
  };

  const write = await applyEdits(
    { files },
    [{ kind: "variable", file: "index.tsx", name: "accent", value: "#12cc77" }],
  );

  assert.deepEqual(write.skipped, []);
  assert.match(files["index.tsx"], /const accent = "#12cc77"/);

  const refused = await applyEdits(
    { files },
    [{ kind: "variable", file: "index.tsx", name: "computed", value: "#ffffff" }],
  );
  assert.deepEqual(refused.skipped, ["index.tsx:computed (variable)"]);
});

test("a canvas edit writes back to TSX and the new revision still compiles", async () => {
  const files = { "index.tsx": POSTERRACT_STARTER_SOURCE };
  const write = await applyEdits(
    { files },
    [
      {
        kind: "set",
        source: "index.tsx:headline",
        props: { x: 180 },
        text: "Canvas and code stay in sync.",
      },
    ],
  );

  assert.deepEqual(write.skipped, []);
  assert.match(files["index.tsx"], /x=\{180\}/);
  assert.match(files["index.tsx"], /Canvas and code stay in sync\./);

  const result = await compileVirtualProject(
    Object.entries(files).map(([path, content]) => ({ path, content })),
  );
  assert.equal(result.ok, true);
});

test("diagram primitives compile and remain source-addressable", async () => {
  const files = {
    "index.tsx": `/** @jsxImportSource @posterract/composition */
export default function Diagram() {
  return <stage id="workspace"><scene id="main" width={1280} height={720} active>
    <diagramNode id="input" x={80} y={100} width={280} height={120} label="Input" fill="#0B2118" />
    <diagramArrow id="flow" x={360} y={160} width={240} height={0} route="curve" label="transform" />
    <diagramEquation id="formula" x={600} y={95} width={420} height={120} expression="y = x^2" />
    <diagramAxis id="axis" x={180} y={300} width={700} height={300} domain={[0, 4]} range={[0, 16]} grid />
    <diagramPlot id="plot" x={180} y={300} width={700} height={300} points={[[0, 0], [1, 1], [2, 4], [3, 9], [4, 16]]} domain={[0, 4]} range={[0, 16]} smooth />
  </scene></stage>;
}`,
  };

  const compiled = await compileVirtualProject([{ path: "index.tsx", content: files["index.tsx"] }]);
  assert.equal(compiled.ok, true);

  const write = await applyEdits(
    { files },
    [{ kind: "set", source: "index.tsx:input", props: { label: "Source data", x: 120 } }],
  );
  assert.deepEqual(write.skipped, []);
  assert.match(files["index.tsx"], /label="Source data"/);
  assert.match(files["index.tsx"], /x=\{120\}/);

  const recompiled = await compileVirtualProject([{ path: "index.tsx", content: files["index.tsx"] }]);
  assert.equal(recompiled.ok, true);
});
