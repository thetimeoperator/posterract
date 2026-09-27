import assert from "node:assert/strict";
import test from "node:test";

import {
  POSTERRACT_STARTER_SOURCE,
  describeVocabulary,
  isRuntimeProp,
  lintSource,
  propDefinition,
  suggestProp,
  introducedHiddenMotion,
  hiddenMotionRefusal,
} from "../src/index.ts";

const wrap = (body: string): string => `export default () => (
  <stage id="stage">
    <scene id="main" width={1080} height={1920}>
${body}
    </scene>
  </stage>
);`;

const messages = (body: string) => lintSource("index.tsx", wrap(body)).map((entry) => `${entry.severity} ${entry.code}: ${entry.message}`);

test("a name nothing reads is an error, with what was meant", () => {
  const found = lintSource("index.tsx", wrap(`      <text id="title" size={72} wdth={400}>Hi</text>`));
  assert.equal(found.length, 2);
  // `size` is a name the runtime reads (an effect's second number), so on a
  // <text> it is a warning — still pointing at the prop that was meant.
  assert.deepEqual(found.map((entry) => [entry.severity, entry.code, entry.element, entry.line]), [
    ["warning", "undeclared-prop", "title", 4],
    ["error", "unknown-prop", "title", 4],
  ]);
  assert.match(found[0]!.message, /`size` is not a documented prop of <text#title>.*Use `fontSize`\./);
  assert.match(found[1]!.message, /no prop `wdth`.*Did you mean `width`\?/);

  assert.match(messages(`      <rect id="box" banana={5} width={10} height={10} />`)[0]!, /^error unknown-prop: .*so it is ignored\.$/);
  // A CSS habit gets an instruction, not a rename.
  assert.match(messages(`      <rect id="box" stroke="#000" width={10} height={10} />`)[0]!, /^error .*Did you mean a `<stroke color=… width=… \/>` child element\?/);
  assert.match(messages(`      <video id="bg" src="a.mp4" source="b.mp4" />`)[0]!, /^error .*no prop `source`.*Did you mean `src`\?/);
});

test("a name the runtime knows but the element does not document is a warning, never a claim", () => {
  // `fill` on a <text> colors it at runtime exactly as `color` does; `speed` is
  // a <lottie> name the runtime skips on a <video>. The text cannot tell which,
  // so neither is called ignored and neither fails anyone.
  assert.equal(isRuntimeProp("fill"), true);
  const [fill] = messages(`      <text id="title" fill="#fff">Hi</text>`);
  assert.match(fill!, /^warning undeclared-prop: `fill` is not a documented prop of <text#title>\. The runtime knows the name and may or may not act on it here; do not rely on it\. Use `color`\.$/);

  const [speed] = messages(`      <video id="bg" src="a.mp4" speed={2} />`);
  assert.match(speed!, /^warning undeclared-prop: `speed`.*Use `playbackRate`\.$/);

  const [stray] = messages(`      <rect id="box" fontSize={20} width={10} height={10} />`);
  assert.match(stray!, /^warning undeclared-prop: .*It is a prop of <text>/);
});

test("an enumeration says what it names", () => {
  const [message] = messages(`      <text id="t" textAlign="centre">Hi</text>`);
  assert.match(message!, /error unknown-value: `textAlign="centre"` on <text#t> is not one of "left", "center", "right"\. Did you mean "center"\?/);
  assert.match(messages(`      <image id="i" src="a.png"><animation type="fadeIn" /></image>`)[0]!, /`type="fadeIn"`.*Did you mean "fade"\?/);
});

test("documented-as-needed props, number strings and second-strings are warnings", () => {
  assert.match(messages(`      <image id="i" src="a.png"><animation phase="in" /></image>`)[0]!, /^warning missing-prop: <animation> has no `type`/);
  assert.match(messages(`      <rect id="r" x="120" width={10} height={10} />`)[0]!, /^warning literal-type: `x` on <rect#r> is a number: write `x=\{120\}`/);
  assert.match(messages(`      <rect id="r" start="2s" width={10} height={10} />`)[0]!, /^warning literal-type: `start="2s"`.*write `start=\{2\}`/);
  assert.deepEqual(messages(`      <rect id="r" start="45f" end="01:30" width={10} height={10} />`), []);
});

test("what the types now declare is clean: a lock, and a lottie's position", () => {
  assert.deepEqual(messages(`      <rect id="r" locked width={10} height={10} />`), []);
  assert.deepEqual(messages(`      <lottie id="badge" src="badge.json" x={40} y={60} loop />`), []);
});

test("view state is called what it is", () => {
  assert.match(messages(`      <rect id="r" selected width={10} height={10} />`)[0]!, /^warning view-state: `selected` on <rect#r> is editor view state/);
});

test("the SVG reading of a shared name is left to SVG", () => {
  const body = `      <html id="h" width={200} height={100}><svg viewBox="0 0 10 10"><text fill="red" x="1" dy="2">svg text</text><rect fill="blue" rx="2" /></svg></html>
      <text id="real" dy="2">composition text</text>`;
  const found = lintSource("index.tsx", wrap(body));
  assert.equal(found.length, 1);
  assert.equal(found[0]!.element, "real");
});

test("computed props, spreads, components and loops are not second-guessed", () => {
  const body = `      <Panel title="x" whatever={1} />
      <rect id="r" {...rest} />
      <text id="t" color={accent()} textAlign={align}>Hi</text>
      <For each={items}>{(item) => <rect id="dot" x={item.x} width={4} height={4} />}</For>`;
  assert.deepEqual(messages(body), []);
});

test("`.map()` over composition elements is flagged, `.map()` over data is not", () => {
  const found = messages(`      {items.map((item) => <rect id="dot" x={item.x} width={4} height={4} />)}`);
  assert.equal(found.length, 1);
  assert.match(found[0]!, /warning map-loop: .*Use `<For each=/);
  assert.deepEqual(messages(`      <text id="t">{names.map((n) => n.toUpperCase()).join(", ")}</text>`), []);
});

test("the starter the app scaffolds is clean", () => {
  assert.deepEqual(lintSource("index.tsx", POSTERRACT_STARTER_SOURCE), []);
});

test("the vocabulary answers what describe and the tools ask of it", () => {
  assert.equal(propDefinition("text", "fill"), undefined);
  assert.equal(propDefinition("text", "color")?.type, "string");
  assert.deepEqual(propDefinition("text", "textAlign")?.values, ["left", "center", "right"]);
  assert.equal(suggestProp("text", "fill"), "`color`");
  assert.equal(suggestProp("rect", "color"), "`fill`");
  assert.equal(suggestProp("rect", "zzzzzz"), undefined);

  const overview = describeVocabulary().join("\n");
  assert.match(overview, /HOW DO I…/);
  assert.match(overview, /captions from speech/);
  assert.ok(overview.length < 8000, `overview is ${overview.length} chars`);

  const text = describeVocabulary("text").join("\n");
  assert.match(text, /ITS OWN/);
  assert.match(text, /color\s+string/);
  assert.match(text, /textAlign\s+"left" \| "center" \| "right"/);
  assert.doesNotMatch(text, /selected/);
  assert.match(describeVocabulary("keyframe").join("\n"), /easing\s+"linear" \| "easeIn"/);
  assert.throws(() => describeVocabulary("txt"), /Did you mean <text>\?/);
});

test("a source the parser cannot read is an error, not a clean bill of health", () => {
  // The one answer that is never true about a broken file is that it is fine.
  const broken = `export default () => (
  <stage id="stage">
    <scene id="main" width={1080} height={1920}>
      <text id="hook" x={90} y={100}>Hello</text>
    </scene>
);`;
  const found = lintSource("src/index.tsx", broken);
  assert.ok(found.length > 0, "a file that will not compile was reported as understood");
  assert.equal(found[0]!.severity, "error");
  assert.equal(found[0]!.code, "syntax");
  assert.match(found[0]!.message, /cannot compile/);
  assert.ok((found[0]!.line ?? 0) > 0, "the error has no line");

  // And a file that does parse is still judged on what it says, not on this.
  assert.equal(lintSource("src/index.tsx", broken.replace("    </scene>\n);", "    </scene>\n  </stage>\n);")).some((entry) => entry.code === "syntax"), false);
});

test("placement, animation parameters and a looping track are vocabulary like any other", () => {
  const source = `export default () => (
  <stage id="stage">
    <scene id="main" width={1080} height={1920}>
      <text id="title" place="lower-third" inset={48} start={0} end={6}>
        Hello
        <animation id="in" type="slideUp" distance={159} amount={0} easing="bouncy" duration={0.6} />
        <keyframeTrack id="bob" property="offsetY" loop="pingpong">
          <keyframe id="b0" time={0} value={0} />
          <keyframe id="b1" time={0.8} value={-14} />
        </keyframeTrack>
      </text>
      <image id="logo" src="l.png" place="top-right" inset={[48, 64]} start={0} end={6}>
        <keyframeTrack id="spin" property="rotation" loop>
          <keyframe id="s0" time={0} value={0} />
          <keyframe id="s1" time={4} value={360} />
        </keyframeTrack>
      </image>
    </scene>
  </stage>
);`;
  assert.deepEqual(lintSource("index.tsx", source), []);
});

test("a placement that names nothing is an error, and x/y beside a placement are said to be unread", () => {
  const wrap = (element: string) => `export default () => (<stage id="s"><scene id="m" width={1080} height={1920}>${element}</scene></stage>);`;

  const unknown = lintSource("index.tsx", wrap('<text id="t" place="middle" start={0} end={2}>Hi</text>'));
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0]!.code, "unknown-value");
  assert.match(unknown[0]!.message, /"center"/);

  const both = lintSource("index.tsx", wrap('<text id="t" place="center" x={10} y={20} start={0} end={2}>Hi</text>'));
  assert.deepEqual(both.map((entry) => entry.code), ["placed-and-positioned", "placed-and-positioned"]);
  assert.equal(both[0]!.severity, "warning");
  assert.match(both[0]!.message, /offsetX/);

  // A scene is placed on the stage, not in a frame: it does not take the prop.
  const scene = lintSource("index.tsx", '<stage id="s"><scene id="m" width={1080} height={1920} place="center" /></stage>');
  assert.ok(scene.some((entry) => /place/.test(entry.message)), "a scene was let through with a placement");
});

// ── Hidden motion ─────────────────────────────────────────

const project = (body: string) => `/** @jsxImportSource @posterract/composition */
import { useTicker } from "@posterract/composition";
export default function Project() {
  ${body}
}
`;

test("motion on a clock of its own is hidden motion", () => {
  const ticker = lintSource("index.tsx", project(`const tick = useTicker();
  return <stage><scene id="s" width={100} height={100}><rect id="r" x={tick.time() * 10} /></scene></stage>;`));
  assert.ok(ticker.some((finding) => finding.code === "hidden-motion" && finding.severity === "error"));

  const referenced = lintSource("index.tsx", project(`return <stage><scene id="s" width={100} height={100}><surface id="c" ref={(node) => node} /></scene></stage>;`));
  assert.ok(referenced.some((finding) => finding.code === "hidden-motion" && finding.message.includes("draw")));

  const traits = lintSource("index.tsx", project(`return <stage><scene id="s" width={100} height={100}><rect id="r" ref={(node) => node.entity.set(null as never, {})} /></scene></stage>;`));
  assert.ok(traits.some((finding) => finding.code === "hidden-motion"));
});

test("a surface drawn from knobs is not hidden motion", () => {
  const findings = lintSource("index.tsx", project(`return <stage><scene id="s" width={100} height={100}>
    <surface id="c" width={100} height={100} knobs={{ phase: 0 }} draw={(ctx, knobs) => ctx.fillRect(0, 0, Number(knobs.phase), 10)}>
      <keyframeTrack property="knob.phase"><keyframe time={0} value={0} /><keyframe time={1} value={100} /></keyframeTrack>
    </surface>
  </scene></stage>;`));
  assert.deepEqual(findings.filter((finding) => finding.code === "hidden-motion"), []);
});

test("an edit is held to the hidden motion it adds, not what the file had", () => {
  const before = project(`const tick = useTicker();
  return <stage><scene id="s" width={100} height={100}><rect id="r" x={tick.time()} /></scene></stage>;`);
  const same = before.replace('<rect id="r"', '<rect id="r" y={4}');
  assert.deepEqual(introducedHiddenMotion("index.tsx", before, same), []);

  const more = before.replace("</scene>", '<surface id="c" ref={(node) => node} /></scene>');
  const added = introducedHiddenMotion("index.tsx", before, more);
  assert.equal(added.length, 1);
  assert.match(hiddenMotionRefusal(added), /^Refused: .*Nothing was written\.$/s);
});
