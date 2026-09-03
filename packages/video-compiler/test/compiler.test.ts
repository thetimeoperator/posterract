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

/**
 * An agent naming the element it creates is the normal case — `id` is how it
 * addresses the thing afterwards. Writing that id as an ordinary prop renamed
 * the element out from under the lookup the remaining props were found by, so
 * the insert was dropped: the tool reported success, the element appeared on
 * the canvas, and it was gone on the next reload.
 */
test("an inserted element keeps the id the caller asked for", async () => {
  const files = {
    "index.tsx": `/** @jsxImportSource @posterract/composition */
export default function Project() {
  return <stage id="stage"><scene id="main" width={1080} height={1920} /></stage>;
}
`,
  };

  const write = await applyEdits({ files }, [
    {
      kind: "insert",
      source: "pending#1",
      parent: "index.tsx:main",
      tag: "rect",
      props: { id: "hero", x: 10, width: 50, height: 50 },
    },
  ]);

  assert.deepEqual(write.skipped, []);
  assert.match(files["index.tsx"], /<rect id="hero"/);
  assert.match(files["index.tsx"], /x=\{10\}/);
  assert.match(files["index.tsx"], /width=\{50\}/);
  assert.equal(write.ids?.["pending#1"], "index.tsx:hero");

  const compiled = await compileVirtualProject([
    { path: "index.tsx", content: files["index.tsx"] },
  ]);
  assert.equal(compiled.ok, true);
});

test("an id already in the file does not collide; the element is still written", async () => {
  const files = {
    "index.tsx": `/** @jsxImportSource @posterract/composition */
export default function Project() {
  return <stage id="stage"><scene id="main"><rect id="hero" /></scene></stage>;
}
`,
  };

  const write = await applyEdits({ files }, [
    { kind: "insert", source: "pending#1", parent: "index.tsx:main", tag: "rect", props: { id: "hero", x: 7 } },
  ]);

  assert.deepEqual(write.skipped, []);
  // Two elements sharing an id would make both unaddressable, so the
  // generated name wins and the caller is told what it actually got.
  const assigned = write.ids?.["pending#1"];
  assert.ok(assigned && assigned !== "index.tsx:hero", "a colliding id is not reused");
  assert.match(files["index.tsx"], /x=\{7\}/);
});

/**
 * `path`, `ellipse` and `polygon` are composition elements *and* SVG tags. A
 * fragment under an SVG container is DOM content; the same tag anywhere else
 * is the vector element, and must reach the renderer as a PascalCase import
 * rather than as a DOM node the runtime has no meaning for.
 */
test("vector elements compile as composition tags, and as SVG under an svg", async () => {
  const source = `/** @jsxImportSource @posterract/composition */
export default function Vectors() {
  return <stage id="workspace"><scene id="main" width={1280} height={720} active>
    <path id="stroke" d="M0 0 C120 0 120 200 240 200" stroke="#5DFF9D" trimEnd={0.5} />
    <ellipse id="ring" x={400} y={100} width={200} height={200} fill="#5DFF9D" />
    <polygon id="tri" points="0,0 100,0 50,90" fill="#2266ff" />
    <htmlPaint>
      <svg viewBox="0 0 10 10"><path d="M0 0 L10 10" /><ellipse cx="5" cy="5" rx="4" ry="3" /></svg>
    </htmlPaint>
  </scene></stage>;
}`;

  const compiled = await compileVirtualProject([{ path: "index.tsx", content: source }]);
  assert.equal(compiled.ok, true);
  // The composition ones are aliased imports; the SVG ones stay strings.
  assert.match(compiled.code ?? "", /Path/);
  assert.match(compiled.code ?? "", /Ellipse/);
  assert.match(compiled.code ?? "", /Polygon/);

  const files = { "index.tsx": source };
  const write = await applyEdits(
    { files },
    [{ kind: "set", source: "index.tsx:stroke", props: { trimEnd: 1 } }],
  );
  assert.deepEqual(write.skipped, []);
  assert.match(files["index.tsx"], /trimEnd=\{1\}/);
  assert.equal((await compileVirtualProject([{ path: "index.tsx", content: files["index.tsx"] }])).ok, true);
});

/**
 * A component compiles away: `<Panel>` becomes the rects and texts it returns,
 * and the timeline would show the pieces and never the thing that was written.
 * The stamp is what lets them be gathered back under the name — but only for
 * the project's own components. The default export is the composition, so
 * stamping it would put every element in the file into one group.
 */
test("elements written inside a component carry that component's name", async () => {
  const source = `/** @jsxImportSource @posterract/composition */
function Panel(props: { y: number }) {
  return <group id={\`panel-\${props.y}\`} x={40} y={props.y} width={400} height={200}>
    <rect id={\`panel-bg-\${props.y}\`} width={400} height={200} fill="#101010" />
  </group>;
}

const Flash = () => <rect id="flash" x={0} y={0} width={80} height={80} fill="#5DFF9D" />;

export default function Composition() {
  return <stage id="workspace"><scene id="main" width={1080} height={1920} active>
    <rect id="plain" x={0} y={0} width={100} height={100} fill="#2266ff" />
    <Panel y={100} />
    <Flash />
  </scene></stage>;
}`;

  const compiled = await compileVirtualProject([{ path: "index.tsx", content: source }]);
  assert.equal(compiled.ok, true);

  const code = compiled.code ?? "";
  // The two components' elements are stamped with their names.
  assert.match(code, /__component:\s*"Panel"/);
  assert.match(code, /__component:\s*"Flash"/);
  // The composition itself is not a component, so `plain` carries no stamp:
  // exactly one element per component body, and none from the default export.
  assert.equal((code.match(/__component:\s*"Panel"/g) ?? []).length, 2);
  assert.equal((code.match(/__component:\s*"Composition"/g) ?? []).length, 0);
});

/**
 * Motion written as code has nothing on the timeline: a clip driven by
 * `x={progress() * 200}` looks static while the canvas plainly is not. The
 * stamp is what lets the editor say so and offer to bake it — but only for
 * props that actually read something. `x={40 + 20}` is a literal written as
 * arithmetic, and reporting it as motion would put a row on every clip.
 */
test("props written as code are stamped; props written as values are not", async () => {
  const source = `/** @jsxImportSource @posterract/composition */
import { createSignal } from "solid-js";

export default function Composition() {
  const [progress] = createSignal(0);
  return <stage id="workspace"><scene id="main" width={1080} height={1920} active>
    <rect id="still" x={40} y={80} width={100} height={100} fill="#101010" />
    <rect id="folded" x={40 + 20} y={-80} width={100} height={100} fill="#101010" />
    <rect id="moving" x={progress() * 200} y={80} width={100} height={100} opacity={progress()} fill="#5DFF9D" />
  </scene></stage>;
}`;

  const compiled = await compileVirtualProject([{ path: "index.tsx", content: source }]);
  assert.equal(compiled.ok, true);

  const code = compiled.code ?? "";
  // Exactly one element is live, and it names both of its code-driven props.
  const stamps = code.match(/__live:\s*"([^"]*)"/g) ?? [];
  assert.equal(stamps.length, 1, `expected one live stamp, got ${stamps.join(" | ")}`);
  assert.match(stamps[0]!, /x/);
  assert.match(stamps[0]!, /opacity/);
  // Neither the literal nor the arithmetic-as-literal is reported as motion.
  assert.equal(stamps[0]!.includes("width"), false);
});
