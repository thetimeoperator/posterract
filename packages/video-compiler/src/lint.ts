/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The check a composition source never had: is what it says something the
 * editor understands?
 *
 * The compile step only transpiles — no type-checker runs — and the runtime
 * ignores any prop name it does not know. So `<rect wdth={100}>` or
 * `<video speed={2}>` compiles, mounts, validates as `ok`, and does nothing:
 * the mistake costs nothing to make and nothing ever mentions it. An author
 * who cannot see the canvas — an agent — has no way to learn it happened.
 *
 * This reads the source against the generated vocabulary and says so, and it
 * is careful to say only what is true. The runtime applies props by name
 * alone, so it is more forgiving than the types: `fill` on a `<text>` colors
 * it exactly as `color` does — while `speed`, a name it knows from `<lottie>`,
 * is skipped on a `<video>`. Whether an undocumented name acts on a given
 * element cannot be told from the text, so it is a warning that names the
 * documented prop, never a claim either way. An error is kept for what
 * definitely does nothing: a name nothing in the runtime reads, a value an
 * enumeration does not name.
 *
 * It is a reading of the text and nothing more, so it answers the same with or
 * without the app, and it never blocks a mount: a project with a typo still
 * renders what it can.
 *
 * TypeScript alone could not do this even if it ran: `text`, `rect`, `image`,
 * `path`, `ellipse` and `polygon` are typed as the composition element *or* the
 * SVG one, and SVG's `<text>` takes `fill`. Which reading applies is lexical —
 * under an `<svg>` it is SVG — and that rule is followed here as the compiler
 * follows it.
 */

import { SyntaxKind } from "ts-morph";

import { isLoopTag } from "@posterract/composition/source";

import { parseSourceFile } from "./parse.ts";
import { isRuntimeProp, isVocabularyTag, nearest, propDefinition, suggestProp, tagsWithProp, vocabulary } from "./vocabulary.ts";

import type { CompileDiagnostic } from "./compiler.ts";
import type { JsxAttribute, JsxOpeningElement, JsxSelfClosingElement, Node } from "ts-morph";

type JsxTag = JsxOpeningElement | JsxSelfClosingElement;

/** The same containers the compile step treats as "this is SVG now" (see ./source). */
const SVG_CONTAINERS: ReadonlySet<string> = new Set([
  "svg", "g", "defs", "symbol", "marker", "mask", "clipPath", "pattern",
  "filter", "linearGradient", "radialGradient", "textPath", "tspan", "switch",
]);

/** Attributes that wire an element up rather than describe it. */
const WIRING = new Set(["ref", "key", "children"]);

export type LintCode =
  | "syntax"
  | "unknown-prop"
  | "undeclared-prop"
  | "unknown-value"
  | "missing-prop"
  | "view-state"
  | "deprecated-prop"
  | "literal-type"
  | "placed-and-positioned"
  | "map-loop"
  | "hidden-motion";

export interface LintDiagnostic extends CompileDiagnostic {
  code: LintCode;
  /** The element the finding is about, by id when it has one. */
  element?: string;
}

const tagName = (tag: JsxTag): string => tag.getTagNameNode().getText();

/** camelCase, however the author cased it: `<Text>` is the same element as `<text>`. */
const canonical = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

function underSvg(tag: JsxTag): boolean {
  return tag.getAncestors().some((ancestor) => {
    const element = ancestor.asKind(SyntaxKind.JsxElement);
    return element !== undefined && SVG_CONTAINERS.has(tagName(element.getOpeningElement()));
  });
}

function stringLiteral(attribute: JsxAttribute): string | undefined {
  const initializer = attribute.getInitializer();
  if (!initializer) return undefined;
  if (initializer.isKind(SyntaxKind.StringLiteral)) return initializer.getLiteralValue();
  const expression = initializer.asKind(SyntaxKind.JsxExpression)?.getExpression();
  if (expression?.isKind(SyntaxKind.StringLiteral) || expression?.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    return expression.getLiteralValue();
  }
  return undefined;
}

/** Checks one source file. Empty for a file that does not parse: the compiler says that better. */
export function lintSource(path: string, content: string): LintDiagnostic[] {
  const { sourceFile, clean, errors, locate } = parseSourceFile(path, content);
  // A file the parser could not read is not a file to have opinions about: what
  // the elements say cannot be trusted, and the one thing worth saying is that
  // it will not compile. Saying nothing here — as this used to — reported a
  // broken file as understood, which is the one answer that is never true.
  if (!clean) {
    return errors.map((error) => ({
      file: path,
      line: error.line,
      column: error.column,
      severity: "error" as const,
      code: "syntax" as const,
      message: `${error.message} The editor cannot compile this, so it is still showing the last version that worked.`,
    }));
  }

  const diagnostics: LintDiagnostic[] = [];
  const report = (node: Node, severity: "error" | "warning", code: LintCode, message: string, element?: string): void => {
    const { line, column } = locate(node.getStart());
    diagnostics.push({ file: path, line, column, severity, code, message, ...(element ? { element } : {}) });
  };

  const visit = (node: Node): void => {
    const tag = node.isKind(SyntaxKind.JsxSelfClosingElement)
      ? node
      : node.isKind(SyntaxKind.JsxElement)
        ? node.getOpeningElement()
        : undefined;
    if (tag) checkTag(tag);

    // Motion that no timeline row can show. A clock read by code, a canvas
    // drawn through a ref, a trait set from a script: each moves the picture
    // without anything on the timeline to see or grab. The fix is always the
    // same — say the moving number as a knob (or a prop) and keyframe it.
    const hiddenCall = node.asKind(SyntaxKind.CallExpression);
    if (hiddenCall) {
      const callee = hiddenCall.getExpression();
      const called = callee.getText();
      if (called === "useTicker") {
        report(
          callee,
          "error",
          "hidden-motion",
          "`useTicker()` drives motion on its own clock, which nothing on the timeline can show or edit. " +
            "Give the moving number a name instead — a knob on a `<surface draw knobs>`/`<html knobs>`, or the element's own prop — and keyframe it.",
        );
      }
      const member = callee.asKind(SyntaxKind.PropertyAccessExpression);
      if (member && (member.getName() === "set" || member.getName() === "add") && member.getExpression().getText().endsWith(".entity")) {
        report(
          callee,
          "error",
          "hidden-motion",
          "Setting a runtime trait from code changes the picture behind the timeline's back. Write the value as a prop (keyframed if it moves) instead.",
        );
      }
    }

    // Elements rendered by `.map()` share one address in the source, so
    // neither the canvas nor the edit tools can change one of them; a `<For>`
    // can be unrolled into its iterations when one is edited.
    const call = node.asKind(SyntaxKind.CallExpression);
    const callee = call?.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
    if (call && callee?.getName() === "map" && node.getParent()?.isKind(SyntaxKind.JsxExpression)) {
      const renders = call.getDescendants().some((inner) => {
        const innerTag = inner.isKind(SyntaxKind.JsxSelfClosingElement)
          ? inner
          : inner.asKind(SyntaxKind.JsxElement)?.getOpeningElement();
        return innerTag !== undefined && isVocabularyTag(canonical(tagName(innerTag))) && !underSvg(innerTag);
      });
      if (renders) {
        report(
          callee.getNameNode(),
          "warning",
          "map-loop",
          "Elements rendered with `.map()` cannot be selected, dragged or edited one at a time — they share one place in the source. " +
            "Use `<For each={…}>{(item) => …}</For>` from solid-js, which the editor can unroll when one of them is edited.",
        );
      }
    }

    node.forEachChild(visit);
  };

  const checkTag = (tag: JsxTag): void => {
    const written = tagName(tag);
    const name = canonical(written);
    if (!isVocabularyTag(name) || isLoopTag(written)) return;
    if (vocabulary.tags[name]!.svgInsideSvg && underSvg(tag)) return;

    const attributes = tag.getAttributes();
    // `{...props}` may carry anything, required props included.
    const spreads = attributes.some((attribute) => attribute.isKind(SyntaxKind.JsxSpreadAttribute));
    const idAttribute = tag.getAttribute("id")?.asKind(SyntaxKind.JsxAttribute);
    const id = idAttribute ? stringLiteral(idAttribute) : undefined;
    const label = `<${name}${id ? `#${id}` : ""}>`;
    const seen = new Set<string>();

    for (const attribute of attributes) {
      const jsx = attribute.asKind(SyntaxKind.JsxAttribute);
      if (!jsx) continue;
      const prop = jsx.getNameNode().getText();
      seen.add(prop);
      // Namespaced (`on:click`), data/aria and the compiler's own stamps are not the vocabulary's business.
      if (WIRING.has(prop) || prop.startsWith("__") || prop.includes(":") || prop.includes("-")) continue;

      const definition = propDefinition(name, prop);
      if (!definition) {
        const suggestion = suggestProp(name, prop);
        const elsewhere = tagsWithProp(prop);
        const where = !suggestion && elsewhere.length
          ? ` It is a prop of ${elsewhere.slice(0, 6).map((other) => `<${other}>`).join(", ")}${elsewhere.length > 6 ? ", …" : ""}.`
          : "";
        if (isRuntimeProp(prop)) {
          // The runtime applies props by name, so this one may well do
          // something — `fill` on a `<text>` colors it, as `color` would — or
          // may not: `speed` is a name it knows from `<lottie>` and skips on
          // a `<video>`. Which, cannot be told from here; what can be said is
          // that the element does not document it, so nothing promises it.
          report(
            jsx.getNameNode(),
            "warning",
            "undeclared-prop",
            `\`${prop}\` is not a documented prop of ${label}. The runtime knows the name and may or may not act on it here; do not rely on it.${suggestion ? ` Use ${suggestion}.` : where}`,
            id,
          );
        } else {
          report(
            jsx.getNameNode(),
            "error",
            "unknown-prop",
            `${label} has no prop \`${prop}\`, and nothing in the runtime reads it, so it is ignored.${suggestion ? ` Did you mean ${suggestion}?` : where}`,
            id,
          );
        }
        continue;
      }

      if (definition.view) {
        report(
          jsx.getNameNode(),
          "warning",
          "view-state",
          `\`${prop}\` on ${label} is editor view state, not part of the video: the editor keeps it in .posterract/view.json and removes it from the source. Do not author it.`,
          id,
        );
        continue;
      }

      if (definition.deprecated) {
        report(jsx.getNameNode(), "warning", "deprecated-prop", `\`${prop}\` on ${label} is deprecated.${typeof definition.deprecated === "string" ? ` ${definition.deprecated}` : ""}`, id);
      }

      const literal = stringLiteral(jsx);
      if (literal === undefined) continue;

      if (definition.type === "enum" && definition.values && !definition.values.includes(literal)) {
        const close = nearest(literal, definition.values);
        report(
          jsx.getInitializer() ?? jsx,
          "error",
          "unknown-value",
          `\`${prop}="${literal}"\` on ${label} is not one of ${definition.values.map((value) => `"${value}"`).join(", ")}.${close ? ` Did you mean "${close}"?` : ""}`,
          id,
        );
      } else if (definition.type === "number" && literal.trim() !== "") {
        const numeric = Number(literal);
        report(
          jsx.getInitializer() ?? jsx,
          Number.isFinite(numeric) ? "warning" : "error",
          "literal-type",
          Number.isFinite(numeric)
            ? `\`${prop}\` on ${label} is a number: write \`${prop}={${numeric}}\`, not a string.`
            : `\`${prop}\` on ${label} is a number, and "${literal}" is not one.`,
          id,
        );
      } else if (definition.type === "time" && /^\d+(\.\d+)?s$/.test(literal.trim())) {
        report(
          jsx.getInitializer() ?? jsx,
          "warning",
          "literal-type",
          `\`${prop}="${literal}"\` on ${label}: seconds are a plain number — write \`${prop}={${Number.parseFloat(literal)}}\`. Strings are for frames ("45f") and timecodes ("01:30").`,
          id,
        );
      }
    }

    // Two answers to one question. `place` decides where the element is, and
    // while it is set `x`/`y` are not read — so a source that carries both says
    // something about the video that is not true of it, and whoever reads it
    // next (a person, an agent) may believe the numbers.
    if (seen.has("place")) {
      for (const axis of ["x", "y"] as const) {
        const attribute = seen.has(axis) ? tag.getAttribute(axis)?.asKind(SyntaxKind.JsxAttribute) : undefined;
        if (!attribute) continue;
        report(
          attribute.getNameNode(),
          "warning",
          "placed-and-positioned",
          `\`${axis}\` on ${label} is not read while \`place\` is set. Remove it, or remove \`place\` to position by \`x\`/\`y\`; to nudge a placed element use \`offsetX\`/\`offsetY\`.`,
          id,
        );
      }
    }

    // A surface drawn through its ref paints on its own clock; `draw` with
    // `knobs` paints from the timeline.
    if ((name === "surface" || name === "surfacePaint") && seen.has("ref") && !seen.has("draw")) {
      report(
        tag.getTagNameNode(),
        "error",
        "hidden-motion",
        `${label} is drawn through its \`ref\`, so whatever it animates is invisible on the timeline. ` +
          "Pass `draw={(ctx, knobs) => …}` and `knobs={{ … }}` instead, and keyframe the knobs (`<keyframeTrack property=\"knob.<name>\">`).",
        id,
      );
    }

    if (spreads) return;
    // A warning, not an error: the runtime falls back to something for most of
    // these, so the element may still render — just not as anyone decided.
    for (const prop of vocabulary.tags[name]!.props) {
      if (prop === "children" || seen.has(prop)) continue;
      if (propDefinition(name, prop)?.required) {
        report(tag.getTagNameNode(), "warning", "missing-prop", `${label} has no \`${prop}\`, which it is documented to need.`, id);
      }
    }
  };

  visit(sourceFile);
  return diagnostics.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0));
}

/**
 * The hidden motion an edit brings: `hidden-motion` findings of `after` that
 * `before` did not already have. Compared by what they say, not by line —
 * an edit moves lines, not findings. What an agent's write is refused for:
 * motion the timeline cannot show is the one thing the editor will not take
 * from an agent, because nobody could see or change it afterwards.
 */
export function introducedHiddenMotion(path: string, before: string, after: string): LintDiagnostic[] {
  const had = new Map<string, number>();
  for (const finding of lintSource(path, before)) {
    if (finding.code !== "hidden-motion") continue;
    had.set(finding.message, (had.get(finding.message) ?? 0) + 1);
  }
  const added: LintDiagnostic[] = [];
  for (const finding of lintSource(path, after)) {
    if (finding.code !== "hidden-motion") continue;
    const left = had.get(finding.message) ?? 0;
    if (left > 0) had.set(finding.message, left - 1);
    else added.push(finding);
  }
  return added;
}

/** The refusal an agent's write gets when it adds hidden motion, as one message. */
export function hiddenMotionRefusal(findings: LintDiagnostic[]): string {
  return [
    "Refused: this edit adds motion the timeline cannot show, so nobody could see or change it afterwards.",
    ...findings.map((finding) => `${finding.file ?? ""}:${finding.line ?? 0}:${finding.column ?? 0} ${finding.message}`),
    "Nothing was written.",
  ].join("\n");
}

/** Lints every source file of a virtual project. */
export function lintProject(files: Record<string, string>): LintDiagnostic[] {
  return Object.entries(files)
    .filter(([path]) => /\.[cm]?[jt]sx$/i.test(path) && !path.split("/").some((part) => part.startsWith(".") || part === "node_modules"))
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([path, content]) => lintSource(path, content));
}

/** One finding per line, the way a compiler prints them: `file:line:col severity message`. */
export function formatLint(diagnostics: LintDiagnostic[]): string[] {
  return diagnostics.map((entry) =>
    `${entry.file ?? ""}:${entry.line ?? 0}:${entry.column ?? 0}  ${entry.severity === "error" ? "✗" : "⚠"} ${entry.message}`);
}
