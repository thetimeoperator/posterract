import assert from "node:assert/strict";
import test from "node:test";

import { extractElementSource, locateElement } from "./element-source.ts";

const DOC = `/* @jsxImportSource @posterract/composition */
export default function P() {
  return (
    <stage id="stage">
      <scene id="main" name="Main">
        <rect id="signal" x={60} fill="#0C1A38">
          <stroke id="signal-stroke" width={3} />
        </rect>
        <text id="headline">Hello</text>
      </scene>
      <scene id="second" name="Second" />
    </stage>
  );
}
`;

test("an element's span includes its children and closing tag", () => {
  const source = extractElementSource(DOC, "main");
  assert.ok(source);
  assert.ok(source!.startsWith('<scene id="main"'));
  assert.ok(source!.endsWith("</scene>"));
  assert.ok(source!.includes('<text id="headline">Hello</text>'));
  assert.ok(!source!.includes('id="second"'), "the next sibling is not swept in");
});

test("a self-closing element is its own span", () => {
  assert.equal(extractElementSource(DOC, "second"), '<scene id="second" name="Second" />');
});

test("a nested element is found without its parent", () => {
  const source = extractElementSource(DOC, "signal");
  assert.ok(source!.startsWith('<rect id="signal"'));
  assert.ok(source!.endsWith("</rect>"));
  assert.ok(source!.includes("signal-stroke"));
});

/* Balance matters: an outer element must not close on an inner one's tag. */
test("same-tag nesting closes at the right depth", () => {
  const nested = `<stage id="stage"><scene id="outer"><scene id="inner"><rect id="r" /></scene></scene></stage>`;
  const source = extractElementSource(nested, "outer");
  assert.equal(source, '<scene id="outer"><scene id="inner"><rect id="r" /></scene></scene>');
});

test("an id is matched exactly, never as a prefix of another", () => {
  const doc = `<stage id="stage"><text id="main-title">A</text><scene id="main">B</scene></stage>`;
  assert.equal(extractElementSource(doc, "main"), '<scene id="main">B</scene>');
});

test("attribute braces and quotes do not end the opening tag early", () => {
  const doc = `<stage id="stage"><rect id="k" style={{ content: ">" }} fill="a>b" /></stage>`;
  assert.equal(extractElementSource(doc, "k"), '<rect id="k" style={{ content: ">" }} fill="a>b" />');
});

test("an unknown id is null rather than a guess", () => {
  assert.equal(extractElementSource(DOC, "nope"), null);
});

test("an unterminated element is null rather than a truncated span", () => {
  assert.equal(extractElementSource(`<stage id="s"><scene id="x">`, "x"), null);
});

test("an element's line and column locate its opening bracket", () => {
  const at = locateElement(DOC, "headline");
  assert.ok(at);
  assert.equal(DOC.split("\n")[at!.line - 1]?.trim().startsWith('<text id="headline"'), true);
  assert.equal(at!.column, 9, "columns are 1-based from the line start");
});

test("locating an unknown id is null", () => {
  assert.equal(locateElement(DOC, "nope"), null);
});
