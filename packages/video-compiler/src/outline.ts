/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A composition source, one line per element.
 *
 * A real project is a few hundred elements and a few thousand keyframes, and
 * read whole it does not fit in the head of whoever has to edit it — a person
 * scrolling, or an agent with a context window. What they need first is the
 * shape: which scenes, which elements, when each plays, where it is written.
 * So the outline keeps what places an element (id, name, span, source, size)
 * and folds away what only elaborates it: keyframes become a count per
 * property, animations a list of names, strokes and effects a `+stroke`.
 * Every entry says which lines it spans, so the next read is of those lines
 * and nothing else.
 *
 * It is a reading of the text and nothing more — no compile, no runtime, no
 * app — so it answers the same whether or not the editor is open.
 */

import { SyntaxKind } from "ts-morph";

import { ID_ATTR, isCompositionTag } from "@posterract/composition/source";

import { parseSourceFile, type Locate } from "./parse.ts";

import type { JsxAttribute, JsxElement, JsxOpeningElement, JsxSelfClosingElement, Node } from "ts-morph";

type JsxTag = JsxOpeningElement | JsxSelfClosingElement;

/** A literal as the source spells it, or `"{…}"` for anything the code computes. */
export type OutlineValue = string | number | boolean | number[];

export interface OutlineEntry {
  /** Nesting below the file's outermost element, 0 for that one. */
  depth: number;
  tag: string;
  id?: string;
  name?: string;
  /** 1-based lines the element spans in the file, children included. */
  line: number;
  endLine: number;
  /** The props that place the element, literals only (see `PLACING_PROPS`). */
  props: Record<string, OutlineValue>;
  /** Props the code computes rather than spells. */
  computed?: string[];
  /** What a `<text>` says, shortened. */
  text?: string;
  /** Keyframes per animated property. */
  keyframes?: Record<string, number>;
  /** The tracks among them that loop, and how. */
  loops?: Record<string, "repeat" | "pingpong">;
  /** Animation presets as `type phase`. */
  animations?: string[];
  /** Parts that elaborate the element without being elements of their own: `stroke`, `shadow`, … with a count. */
  parts?: Record<string, number>;
  /** Set when the element sits in the body of a loop: it is written once and rendered many times. */
  looped?: boolean;
  /** Set for a project component (`<Panel>`), which compiles away. */
  component?: boolean;
}

/** What places an element: enough to find it in time and space, and to know what it shows. */
const PLACING_PROPS = [
  "x", "y", "place", "inset", "width", "height", "start", "end", "after", "time", "src", "workarea",
  "fontSize", "color", "fill", "opacity", "rotation", "scale", "hidden", "skill", "preset", "volume",
] as const;

/** Folded into the element they move. */
const MOTION_TAGS = new Set(["keyframeTrack", "keyframe", "animation"]);

/** Folded into the element they elaborate, as a count. */
const PART_TAGS = new Set([
  "stroke", "shadow", "effect", "solidPaint", "linearGradientPaint", "radialGradientPaint", "imagePaint",
  "videoPaint", "shaderPaint", "surfacePaint", "htmlPaint", "colorStop", "textRange", "cue", "duck", "lottieSlot",
]);

const LOOP_TAGS = new Set(["For", "Index"]);
const TEXT_LIMIT = 60;

const tagName = (tag: JsxTag): string => tag.getTagNameNode().getText();

/**
 * The whole element a tag opens: the `JsxElement` around an opening tag, the
 * tag itself when it closes itself. (A self-closing tag's parent is whatever
 * element it sits inside, which is somebody else's.)
 */
const elementOf = (tag: JsxTag): JsxElement | JsxSelfClosingElement =>
  tag.isKind(SyntaxKind.JsxOpeningElement) ? tag.getParentIfKindOrThrow(SyntaxKind.JsxElement) : tag;

const attributeOf = (tag: JsxTag, name: string): JsxAttribute | undefined =>
  tag.getAttribute(name)?.asKind(SyntaxKind.JsxAttribute);

function number(node: Node | undefined): number | undefined {
  if (!node) return undefined;
  if (node.isKind(SyntaxKind.NumericLiteral)) return node.getLiteralValue();
  const unary = node.asKind(SyntaxKind.PrefixUnaryExpression);
  if (!unary || unary.getOperatorToken() !== SyntaxKind.MinusToken) return undefined;
  const operand = number(unary.getOperand());
  return operand === undefined ? undefined : -operand;
}

/** A prop's value when the source spells one, `undefined` when the code computes it. */
function literal(attribute: JsxAttribute): OutlineValue | undefined {
  const initializer = attribute.getInitializer();
  if (!initializer) return true;
  if (initializer.isKind(SyntaxKind.StringLiteral)) return initializer.getLiteralValue();

  const expression = initializer.asKind(SyntaxKind.JsxExpression)?.getExpression();
  if (!expression) return undefined;
  if (expression.isKind(SyntaxKind.StringLiteral) || expression.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    return expression.getLiteralValue();
  }
  if (expression.isKind(SyntaxKind.TrueKeyword)) return true;
  if (expression.isKind(SyntaxKind.FalseKeyword)) return false;

  const value = number(expression);
  if (value !== undefined) return value;

  const list = expression.asKind(SyntaxKind.ArrayLiteralExpression);
  if (!list) return undefined;
  const values = list.getElements().map(number);
  return values.includes(undefined) ? undefined : (values as number[]);
}

/** The literal text between a `<text>`'s tags, shortened; undefined when it is computed or empty. */
function spokenText(tag: JsxTag): string | undefined {
  const element = elementOf(tag).asKind(SyntaxKind.JsxElement);
  if (!element) return undefined;
  const parts = element.getJsxChildren().flatMap((child) => {
    if (child.isKind(SyntaxKind.JsxText)) return [child.getText()];
    const inner = child.asKind(SyntaxKind.JsxExpression)?.getExpression();
    return inner?.isKind(SyntaxKind.StringLiteral) ? [inner.getLiteralValue()] : [];
  });
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT - 1)}…` : text;
}

/** The JSX elements directly under `node`, through fragments, expressions and loop callbacks. */
function childTags(node: Node): Array<{ tag: JsxTag; looped: boolean }> {
  const found: Array<{ tag: JsxTag; looped: boolean }> = [];
  const visit = (candidate: Node, looped: boolean): void => {
    if (candidate.isKind(SyntaxKind.JsxSelfClosingElement)) {
      found.push({ tag: candidate, looped });
      return;
    }
    if (candidate.isKind(SyntaxKind.JsxElement)) {
      const opening = candidate.getOpeningElement();
      // A loop is not an element of the composition: what it renders is.
      if (LOOP_TAGS.has(tagName(opening))) {
        candidate.forEachChild((child) => visit(child, true));
        return;
      }
      found.push({ tag: opening, looped });
      return;
    }
    // Opening/closing tags hold attributes, not children.
    if (candidate.isKind(SyntaxKind.JsxOpeningElement) || candidate.isKind(SyntaxKind.JsxClosingElement)) return;
    candidate.forEachChild((child) => visit(child, looped));
  };
  node.forEachChild((child) => visit(child, false));
  return found;
}

function describe(locate: Locate, tag: JsxTag, depth: number, looped: boolean, entries: OutlineEntry[]): void {
  const name = tagName(tag);
  const element = elementOf(tag);
  const composition = isCompositionTag(name);
  // Lowercase and not ours: DOM or SVG inside an `<html>`/`<svg>`. It is the
  // content of the element above, not part of the composition's shape.
  if (!composition && !/^[A-Z]/.test(name)) return;

  const entry: OutlineEntry = {
    depth,
    tag: name,
    line: locate(element.getStart()).line,
    endLine: locate(element.getEnd()).line,
    props: {},
    ...(looped ? { looped: true } : {}),
    ...(composition ? {} : { component: true }),
  };

  const id = attributeOf(tag, ID_ATTR);
  const idValue = id ? literal(id) : undefined;
  if (typeof idValue === "string") entry.id = idValue;
  const label = attributeOf(tag, "name");
  const labelValue = label ? literal(label) : undefined;
  if (typeof labelValue === "string") entry.name = labelValue;

  const computed: string[] = [];
  for (const prop of PLACING_PROPS) {
    const attribute = attributeOf(tag, prop);
    if (!attribute) continue;
    const value = literal(attribute);
    if (value === undefined) computed.push(prop);
    else entry.props[prop] = value;
  }
  if (computed.length) entry.computed = computed;

  if (name === "text") {
    const text = spokenText(tag);
    if (text) entry.text = text;
  }

  entries.push(entry);
  if (element === tag) return;

  for (const child of childTags(element)) {
    const childName = tagName(child.tag);
    if (childName === "keyframeTrack") {
      const property = attributeOf(child.tag, "property");
      const propertyValue = property ? literal(property) : undefined;
      const key = typeof propertyValue === "string" ? propertyValue : "?";
      const count = childTags(elementOf(child.tag)).filter((kf) => tagName(kf.tag) === "keyframe").length;
      entry.keyframes = { ...entry.keyframes, [key]: (entry.keyframes?.[key] ?? 0) + count };
      // A looping track is a different thing from the same keyframes played once.
      const loop = attributeOf(child.tag, "loop");
      if (loop) {
        const mode = literal(loop);
        if (mode !== false) entry.loops = { ...entry.loops, [key]: mode === "pingpong" ? "pingpong" : "repeat" };
      }
    } else if (childName === "animation") {
      const type = attributeOf(child.tag, "type");
      const phase = attributeOf(child.tag, "phase");
      const typeValue = type ? literal(type) : undefined;
      const phaseValue = phase ? literal(phase) : undefined;
      (entry.animations ??= []).push(`${typeof typeValue === "string" ? typeValue : "?"} ${phaseValue === "out" ? "out" : "in"}`);
    } else if (MOTION_TAGS.has(childName)) {
      // A keyframe outside a track: nothing to fold it into.
    } else if (PART_TAGS.has(childName)) {
      entry.parts = { ...entry.parts, [childName]: (entry.parts?.[childName] ?? 0) + 1 };
    } else {
      describe(locate, child.tag, depth + 1, looped || child.looped, entries);
    }
  }
}

/** The outline of one source file. Empty when the file does not parse or holds no composition. */
export function outlineSource(path: string, content: string): OutlineEntry[] {
  const { sourceFile, locate } = parseSourceFile(path, content);

  const entries: OutlineEntry[] = [];
  // Every outermost JSX element in the file: the default export's tree, and
  // the trees of the components it is assembled from.
  const roots: JsxTag[] = [];
  const find = (node: Node): void => {
    if (node.isKind(SyntaxKind.JsxSelfClosingElement)) {
      roots.push(node);
      return;
    }
    if (node.isKind(SyntaxKind.JsxElement)) {
      roots.push(node.getOpeningElement());
      return;
    }
    node.forEachChild(find);
  };
  sourceFile.forEachChild(find);

  for (const root of roots) describe(locate, root, 0, false, entries);
  return entries;
}

const seconds = (value: number): string => value.toFixed(2);

function placement(entry: OutlineEntry): string {
  const { props } = entry;
  const parts: string[] = [];

  const { start, end, time, workarea, width, height, x, y } = props;
  if (typeof start === "number" || typeof end === "number") {
    parts.push(`${typeof start === "number" ? seconds(start) : "…"}–${typeof end === "number" ? seconds(end) : "…"}s`);
  } else if (typeof time === "number") {
    parts.push(`@${seconds(time)}s`);
  }
  if (typeof props.after === "string") parts.push(`after ${props.after}`);
  if (Array.isArray(workarea) && workarea.length === 2) parts.push(`plays ${seconds(workarea[0]!)}–${seconds(workarea[1]!)}s`);
  // Where it sits: a placement where there is one (while it is set `x`/`y`
  // are not read), the numbers otherwise.
  const { place, inset } = props;
  const where = typeof place === "string"
    ? `placed ${place}${inset === undefined ? "" : ` inset ${Array.isArray(inset) ? inset.join(",") : inset}`}`
    : typeof x === "number" || typeof y === "number" ? `at ${x ?? 0},${y ?? 0}` : "";
  if (typeof width === "number" && typeof height === "number") {
    parts.push(where ? `${width}×${height} ${where}` : `${width}×${height}`);
  } else if (where) {
    parts.push(where);
  }
  for (const prop of ["fontSize", "color", "fill", "opacity", "rotation", "scale", "volume", "preset", "skill"] as const) {
    const value = props[prop];
    if (value !== undefined) parts.push(`${prop}=${Array.isArray(value) ? `[${value.join(",")}]` : value}`);
  }
  if (props.hidden === true) parts.push("hidden");
  if (typeof props.src === "string") parts.push(`src=${props.src}`);
  return parts.join(" · ");
}

/**
 * The outline as text, one element per line, indented by nesting:
 *
 *     L24-27    video#qai-b01-bg "Beat 01" 0.00–5.05s · 1080×1920 at 0,0 · src=… | fade in, fade out
 *
 * A run of siblings that differ only in when they play — forty caption cards —
 * is one line saying so, because forty lines of it say nothing more.
 */
export function formatOutline(entries: OutlineEntry[], options: { collapseRuns?: number } = {}): string[] {
  const collapseRuns = options.collapseRuns ?? 6;
  const width = String(entries.reduce((max, entry) => Math.max(max, entry.endLine), 0)).length;

  const line = (entry: OutlineEntry): string => {
    const span = entry.line === entry.endLine
      ? `L${String(entry.line).padStart(width)}`
      : `L${String(entry.line).padStart(width)}-${entry.endLine}`;
    const head = `${entry.component ? `<${entry.tag}>` : entry.tag}${entry.id ? `#${entry.id}` : ""}`;
    const motion = [
      ...(entry.keyframes
        ? [`keys ${Object.entries(entry.keyframes).map(([prop, count]) => `${prop}×${count}${entry.loops?.[prop] ? ` ${entry.loops[prop] === "pingpong" ? "⇄" : "↻"}` : ""}`).join(" ")}`]
        : []),
      ...(entry.animations ?? []),
      ...Object.entries(entry.parts ?? {}).map(([part, count]) => (count > 1 ? `+${part}×${count}` : `+${part}`)),
    ];
    return [
      span.padEnd(width * 2 + 3),
      "  ".repeat(entry.depth),
      head,
      entry.name ? ` "${entry.name}"` : "",
      entry.text ? ` says "${entry.text}"` : "",
      placement(entry) ? ` ${placement(entry)}` : "",
      entry.computed?.length ? ` · computed: ${entry.computed.join(", ")}` : "",
      entry.looped ? " · in a loop" : "",
      motion.length ? ` | ${motion.join(", ")}` : "",
    ].join("");
  };

  /** What makes two siblings "the same kind of thing": tag, depth, and whether they have children. */
  const shape = (entry: OutlineEntry, next: OutlineEntry | undefined): string =>
    `${entry.depth}:${entry.tag}:${next !== undefined && next.depth > entry.depth ? "parent" : "leaf"}`;

  const lines: string[] = [];
  for (let index = 0; index < entries.length; ) {
    const entry = entries[index]!;
    const kind = shape(entry, entries[index + 1]);
    let end = index;
    if (kind.endsWith(":leaf")) {
      while (end + 1 < entries.length && shape(entries[end + 1]!, entries[end + 2]) === kind) end += 1;
    }

    const run = end - index + 1;
    if (run < collapseRuns) {
      lines.push(line(entry));
      index += 1;
      continue;
    }

    const last = entries[end]!;
    const starts = entries.slice(index, end + 1).flatMap((item) => (typeof item.props.start === "number" ? [item.props.start] : []));
    const ends = entries.slice(index, end + 1).flatMap((item) => (typeof item.props.end === "number" ? [item.props.end] : []));
    const spanText = starts.length && ends.length ? ` ${seconds(Math.min(...starts))}–${seconds(Math.max(...ends))}s` : "";
    lines.push(line(entry));
    lines.push(
      `${" ".repeat(width * 2 + 3)}${"  ".repeat(entry.depth)}… ${run - 2} more ${entry.tag} (L${entries[index + 1]!.line}–L${entries[end - 1]!.endLine})${spanText}`,
    );
    lines.push(line(last));
    index = end + 1;
  }
  return lines;
}
