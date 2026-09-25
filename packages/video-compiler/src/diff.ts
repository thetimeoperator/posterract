/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What changed between two versions of a composition source, element by
 * element.
 *
 * Two authors edit one file: a person on the canvas, an agent in the text. A
 * revision id can tell one of them *that* the other changed something; it
 * cannot say *what*, and without the what the only safe move is to re-read
 * everything and the likeliest move is to write over a decision that was made
 * on purpose — the caption was dragged to the middle for a reason.
 *
 * A text diff is the wrong answer: one drag rewrites a long line, and a
 * hundred-character line that differs in `y={1200}` reads as noise. Every
 * element has a stable id, so the comparison is made where the meaning is:
 * which elements came, went or moved, and which props of which element hold
 * something else now — `text#hook  y 1480 → 1200`. Keyframes are elements too,
 * and a retimed animation is thirty of them, so motion is reported against the
 * element it moves and counted rather than listed.
 *
 * Editor view state an older source still carries (`selected`, `camera`, …) is
 * not part of the video and is left out: a click is not a change.
 */

import { SyntaxKind } from "ts-morph";

import { ID_ATTR, isCompositionTag } from "@posterract/composition/source";

import { parseSourceFile, type Locate } from "./parse.ts";
import { VIEW_STATE_ATTRS } from "./writer.ts";

import type { JsxAttribute, JsxElement, JsxOpeningElement, JsxSelfClosingElement, Node, SourceFile } from "ts-morph";

type JsxTag = JsxOpeningElement | JsxSelfClosingElement;

/** Tags that say how an element moves; their changes are reported against the element they belong to. */
const MOTION_TAGS: ReadonlySet<string> = new Set(["keyframeTrack", "keyframe", "animation"]);
const VIEW_ATTRS: ReadonlySet<string> = new Set(VIEW_STATE_ATTRS);

/** A value a source spells out rather than computes — what an edit can carry to a live canvas. */
export type LiteralValue = string | number | boolean | null | LiteralValue[] | { [key: string]: LiteralValue };

export interface ElementRecord {
  /** The id, or a positional stand-in (`rect@12`) for an element the file has not named. */
  key: string;
  named: boolean;
  tag: string;
  parent: string | null;
  /** The nearest ancestor that is not a motion node — who a keyframe's change is about. */
  owner: string | null;
  index: number;
  props: Map<string, string>;
  /** The props whose value is a literal, as the value it is; a prop missing here is computed by code. */
  literals: Map<string, LiteralValue>;
  text?: string;
  /** Whether what the element says is literal text, with no `{expression}` in it. */
  textIsLiteral: boolean;
  /**
   * Whether code stands between this element and the tree it is written in — a
   * loop's callback, a `.map()`, a conditional. Such an element is rendered by
   * running that code, so nothing about it can be changed without running it again.
   */
  viaCode: boolean;
  /**
   * What the element holds besides composition elements and what it says: the
   * markup inside an `<html>`, the condition around a child, a comment. Nothing
   * here is an element's prop, so a change to it can only be shown by running
   * the source again.
   */
  inner: string;
  /**
   * The element's place among all the JSX elements of the file, in source
   * order: the compiler addresses an element that has no id by it (`file#12`).
   */
  position: number;
  line: number;
}

export type ElementChange =
  | { kind: "added"; id: string; tag: string; parent: string | null; line: number }
  | { kind: "removed"; id: string; tag: string; parent: string | null }
  | { kind: "moved"; id: string; tag: string; from: string | null; to: string | null; line: number }
  | { kind: "reordered"; id: string; tag: string; line: number }
  | { kind: "prop"; id: string; tag: string; name: string; before?: string; after?: string; line: number }
  | { kind: "text"; id: string; tag: string; before: string; after: string; line: number };

export interface MotionChange {
  /** The element whose motion changed. */
  id: string;
  added: number;
  removed: number;
  changed: number;
}

export interface SourceDiff {
  changes: ElementChange[];
  motion: MotionChange[];
  /** Something outside the elements changed — an import, a component, a variable, an expression. */
  code: boolean;
  identical: boolean;
}

const tagName = (tag: JsxTag): string => tag.getTagNameNode().getText();
const canonical = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);
const elementOf = (tag: JsxTag): JsxElement | JsxSelfClosingElement =>
  tag.isKind(SyntaxKind.JsxOpeningElement) ? tag.getParentIfKindOrThrow(SyntaxKind.JsxElement) : tag;

/** A prop's value as an author would say it: `1480`, `#fff`, `true`, or the expression's own text. */
function valueText(tag: JsxTag, name: string): string | undefined {
  const attribute = tag.getAttribute(name)?.asKind(SyntaxKind.JsxAttribute);
  if (!attribute) return undefined;
  const initializer = attribute.getInitializer();
  if (!initializer) return "true";
  if (initializer.isKind(SyntaxKind.StringLiteral)) return initializer.getLiteralValue();
  const expression = initializer.asKind(SyntaxKind.JsxExpression)?.getExpression();
  if (!expression) return initializer.getText();
  if (expression.isKind(SyntaxKind.StringLiteral) || expression.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    return expression.getLiteralValue();
  }
  return expression.getText().replace(/\s+/g, " ");
}

/** The value of an expression that spells one out: a literal, or a list or object of them. */
function literalExpression(node: Node): LiteralValue | undefined {
  if (node.isKind(SyntaxKind.StringLiteral) || node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) return node.getLiteralValue();
  if (node.isKind(SyntaxKind.NumericLiteral)) return node.getLiteralValue();
  if (node.isKind(SyntaxKind.TrueKeyword)) return true;
  if (node.isKind(SyntaxKind.FalseKeyword)) return false;
  if (node.isKind(SyntaxKind.NullKeyword)) return null;

  const unary = node.asKind(SyntaxKind.PrefixUnaryExpression);
  if (unary) {
    const operand = literalExpression(unary.getOperand());
    if (typeof operand !== "number") return undefined;
    if (unary.getOperatorToken() === SyntaxKind.MinusToken) return -operand;
    return unary.getOperatorToken() === SyntaxKind.PlusToken ? operand : undefined;
  }

  const list = node.asKind(SyntaxKind.ArrayLiteralExpression);
  if (list) {
    const values = list.getElements().map(literalExpression);
    return values.includes(undefined) ? undefined : (values as LiteralValue[]);
  }

  const object = node.asKind(SyntaxKind.ObjectLiteralExpression);
  if (object) {
    const result: { [key: string]: LiteralValue } = {};
    for (const property of object.getProperties()) {
      const assignment = property.asKind(SyntaxKind.PropertyAssignment);
      const initializer = assignment?.getInitializer();
      if (!assignment || !initializer || assignment.getNameNode().isKind(SyntaxKind.ComputedPropertyName)) return undefined;
      const value = literalExpression(initializer);
      if (value === undefined) return undefined;
      result[assignment.getName().replace(/^["']|["']$/g, "")] = value;
    }
    return result;
  }
  return undefined;
}

/** A prop's value when the source spells it out (a bare attribute is `true`); undefined when code computes it. */
function literalOf(attribute: JsxAttribute): LiteralValue | undefined {
  const initializer = attribute.getInitializer();
  if (!initializer) return true;
  if (initializer.isKind(SyntaxKind.StringLiteral)) return initializer.getLiteralValue();
  const expression = initializer.asKind(SyntaxKind.JsxExpression)?.getExpression();
  return expression ? literalExpression(expression) : undefined;
}

/**
 * Whether code stands between an element and the tree it is written in: the
 * callback of a loop or a `.map()`, a conditional, a `&&`. The function a whole
 * tree is returned from does not count — that is just the component.
 */
function renderedByCode(tag: JsxTag): boolean {
  let code = false;
  for (const ancestor of tag.getAncestors()) {
    if (ancestor.isKind(SyntaxKind.JsxElement) || ancestor.isKind(SyntaxKind.JsxFragment)) {
      if (code) return true;
    } else if (
      ancestor.isKind(SyntaxKind.ArrowFunction) ||
      ancestor.isKind(SyntaxKind.FunctionExpression) ||
      ancestor.isKind(SyntaxKind.CallExpression) ||
      ancestor.isKind(SyntaxKind.ConditionalExpression) ||
      ancestor.isKind(SyntaxKind.BinaryExpression)
    ) {
      code = true;
    }
  }
  return false;
}

function spokenText(tag: JsxTag): string | undefined {
  const element = elementOf(tag).asKind(SyntaxKind.JsxElement);
  if (!element) return undefined;
  const parts = element.getJsxChildren().flatMap((child) => {
    if (child.isKind(SyntaxKind.JsxText)) return [child.getText()];
    const inner = child.asKind(SyntaxKind.JsxExpression)?.getExpression();
    if (!inner) return [];
    return [inner.isKind(SyntaxKind.StringLiteral) ? inner.getLiteralValue() : `{${inner.getText()}}`];
  });
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text || undefined;
}

/** Every composition element of a source, by id, with where it sits and what it says. */
function read(sourceFile: SourceFile, locate: Locate): { records: Map<string, ElementRecord>; rest: string } {
  const records = new Map<string, ElementRecord>();
  const roots: Array<{ start: number; end: number }> = [];
  let unnamed = 0;

  // The compiler counts every JSX element, components and DOM tags included,
  // in source order; a descent meets them in that order.
  const positions = new Map<number, number>();
  sourceFile.forEachDescendant((node) => {
    if (node.isKind(SyntaxKind.JsxElement) || node.isKind(SyntaxKind.JsxSelfClosingElement)) positions.set(node.getStart(), positions.size);
  });
  /** Where the composition elements directly inside each element are, to be cut out of its `inner`. */
  const held = new Map<string, Array<{ start: number; end: number }>>();

  const visit = (node: Node, parent: string | null, owner: string | null, counter: { value: number }): void => {
    const tag = node.isKind(SyntaxKind.JsxSelfClosingElement)
      ? node
      : node.isKind(SyntaxKind.JsxElement)
        ? node.getOpeningElement()
        : undefined;

    if (!tag || !isCompositionTag(tagName(tag))) {
      // Not an element of the composition (a loop, a component, a fragment,
      // DOM inside an <html>): what it holds still belongs to `parent`.
      node.forEachChild((child) => {
        if (child.isKind(SyntaxKind.JsxOpeningElement) || child.isKind(SyntaxKind.JsxClosingElement)) return;
        visit(child, parent, owner, counter);
      });
      return;
    }

    const name = canonical(tagName(tag));
    const id = valueText(tag, ID_ATTR);
    const named = id !== undefined && !records.has(id);
    unnamed += named ? 0 : 1;
    const key = named ? id! : `${name}@${unnamed}`;

    const props = new Map<string, string>();
    const literals = new Map<string, LiteralValue>();
    for (const attribute of tag.getAttributes()) {
      const jsx = attribute.asKind(SyntaxKind.JsxAttribute);
      if (!jsx) {
        props.set("{...}", attribute.getText());
        continue;
      }
      const prop = jsx.getNameNode().getText();
      if (prop === ID_ATTR || VIEW_ATTRS.has(prop)) continue;
      props.set(prop, valueText(tag, prop) ?? "");
      const literal = literalOf(jsx);
      if (literal !== undefined) literals.set(prop, literal);
    }

    const speaks = name === "text" || name === "cue";
    const text = speaks ? spokenText(tag) : undefined;
    const whole = elementOf(tag);
    if (parent !== null) {
      if (!held.has(parent)) held.set(parent, []);
      held.get(parent)!.push({ start: whole.getStart(), end: whole.getEnd() });
    }
    records.set(key, {
      key,
      named,
      tag: name,
      parent,
      owner: MOTION_TAGS.has(name) ? owner : key,
      index: counter.value,
      props,
      literals,
      ...(text === undefined ? {} : { text }),
      textIsLiteral: !speaks || !(text ?? "").includes("{"),
      viaCode: renderedByCode(tag),
      inner: "",
      position: positions.get(whole.getStart()) ?? -1,
      line: locate(tag.getStart()).line,
    });
    counter.value += 1;

    const element = whole;
    if (element === tag) return;
    const inner = { value: 0 };
    const nextOwner = MOTION_TAGS.has(name) ? owner : key;
    element.forEachChild((child) => {
      if (child.isKind(SyntaxKind.JsxOpeningElement) || child.isKind(SyntaxKind.JsxClosingElement)) return;
      visit(child, key, nextOwner, inner);
    });

    // What is left of the body once the elements in it are taken out. What a
    // text says is compared as `text`, so it is not counted twice.
    if (speaks || !element.isKind(SyntaxKind.JsxElement)) return;
    const from = element.getOpeningElement().getEnd();
    const to = element.getClosingElement().getStart();
    const full = sourceFile.getFullText();
    let body = "";
    let cursor = from;
    for (const range of (held.get(key) ?? []).sort((a, b) => a.start - b.start)) {
      body += full.slice(cursor, range.start);
      cursor = Math.max(cursor, range.end);
    }
    body += full.slice(cursor, to);
    records.get(key)!.inner = body.replace(/\s+/g, " ").trim();
  };

  const findRoots = (node: Node): void => {
    if (node.isKind(SyntaxKind.JsxElement) || node.isKind(SyntaxKind.JsxSelfClosingElement) || node.isKind(SyntaxKind.JsxFragment)) {
      roots.push({ start: node.getStart(), end: node.getEnd() });
      visit(node, null, null, { value: 0 });
      return;
    }
    node.forEachChild(findRoots);
  };
  sourceFile.forEachChild(findRoots);

  // What is left when the element trees are taken out: imports, components,
  // variables — the code around the composition.
  const full = sourceFile.getFullText();
  let rest = "";
  let cursor = 0;
  for (const root of roots.sort((a, b) => a.start - b.start)) {
    rest += full.slice(cursor, root.start);
    cursor = Math.max(cursor, root.end);
  }
  rest += full.slice(cursor);
  return { records, rest: rest.replace(/\s+/g, " ").trim() };
}

/**
 * Every composition element of one source, by id, plus the code around them —
 * what a comparison is made of. `clean` is false for a file that did not parse,
 * whose elements are not to be trusted.
 */
export function readElements(path: string, content: string): { clean: boolean; records: Map<string, ElementRecord>; rest: string } {
  const { sourceFile, clean, locate } = parseSourceFile(path, content);
  return { clean, ...read(sourceFile, locate) };
}

/**
 * The element-level difference between two versions of one source file.
 * Either version failing to parse makes the answer `code: true` with no element
 * changes: a file mid-edit has no elements to compare yet.
 */
export function diffSources(path: string, before: string, after: string): SourceDiff {
  if (before === after) return { changes: [], motion: [], code: false, identical: true };

  const a = parseSourceFile(path, before);
  const b = parseSourceFile(path, after);
  if (!a.clean || !b.clean) return { changes: [], motion: [], code: true, identical: false };

  const old = read(a.sourceFile, a.locate);
  const now = read(b.sourceFile, b.locate);
  const changes: ElementChange[] = [];
  const motion = new Map<string, MotionChange>();
  const tally = (owner: string | null, field: "added" | "removed" | "changed"): void => {
    const id = owner ?? "?";
    const entry = motion.get(id) ?? { id, added: 0, removed: 0, changed: 0 };
    entry[field] += 1;
    motion.set(id, entry);
  };

  for (const [key, record] of now.records) {
    const previous = old.records.get(key);
    const isMotion = MOTION_TAGS.has(record.tag);

    if (!previous || previous.tag !== record.tag) {
      // An element under an added element came with it; saying so twice is noise.
      if (isMotion) {
        if (record.owner === null || old.records.has(record.owner)) tally(record.owner, "added");
      } else if (record.parent === null || old.records.has(record.parent)) {
        changes.push({ kind: "added", id: key, tag: record.tag, parent: record.parent, line: record.line });
      }
      continue;
    }

    let touched = false;
    if (previous.parent !== record.parent) {
      touched = true;
      if (!isMotion) changes.push({ kind: "moved", id: key, tag: record.tag, from: previous.parent, to: record.parent, line: record.line });
    }

    for (const name of new Set([...previous.props.keys(), ...record.props.keys()])) {
      const was = previous.props.get(name);
      const is = record.props.get(name);
      if (was === is) continue;
      touched = true;
      if (!isMotion) {
        changes.push({
          kind: "prop",
          id: key,
          tag: record.tag,
          name,
          ...(was === undefined ? {} : { before: was }),
          ...(is === undefined ? {} : { after: is }),
          line: record.line,
        });
      }
    }

    if ((previous.text ?? "") !== (record.text ?? "")) {
      touched = true;
      changes.push({ kind: "text", id: key, tag: record.tag, before: previous.text ?? "", after: record.text ?? "", line: record.line });
    }

    if (isMotion && touched) tally(record.owner, "changed");
  }

  for (const [key, record] of old.records) {
    const survivor = now.records.get(key);
    if (survivor && survivor.tag === record.tag) continue;
    if (MOTION_TAGS.has(record.tag)) {
      if (record.owner === null || now.records.has(record.owner)) tally(record.owner, "removed");
    } else if (record.parent === null || now.records.has(record.parent)) {
      changes.push({ kind: "removed", id: key, tag: record.tag, parent: record.parent });
    }
  }

  // Draw order is document order, so a sibling that changed places changed
  // what is on top. Compared among the siblings both versions have.
  const siblings = (records: Map<string, ElementRecord>): Map<string | null, string[]> => {
    const groups = new Map<string | null, string[]>();
    for (const record of [...records.values()].sort((x, y) => x.index - y.index)) {
      if (MOTION_TAGS.has(record.tag)) continue;
      groups.set(record.parent, [...(groups.get(record.parent) ?? []), record.key]);
    }
    return groups;
  };
  const before_ = siblings(old.records);
  for (const [parent, order] of siblings(now.records)) {
    const previous = (before_.get(parent) ?? []).filter((key) => order.includes(key));
    const current = order.filter((key) => previous.includes(key));
    const position = new Map(previous.map((key, index) => [key, index]));
    let highest = -1;
    for (const key of current) {
      const at = position.get(key)!;
      // Anything that now sits after an element it used to precede has moved.
      if (at < highest) {
        const record = now.records.get(key)!;
        if (!changes.some((change) => change.id === key && change.kind === "moved")) {
          changes.push({ kind: "reordered", id: key, tag: record.tag, line: record.line });
        }
      } else {
        highest = at;
      }
    }
  }

  // In the order the new file reads; what is gone has no place in it, so it goes last.
  const position = (change: ElementChange): number => ("line" in change ? change.line : Number.POSITIVE_INFINITY);
  changes.sort((x, y) => position(x) - position(y));
  return { changes, motion: [...motion.values()], code: old.rest !== now.rest, identical: false };
}

const shorten = (value: string | undefined): string => {
  if (value === undefined) return "(unset)";
  return value.length > 48 ? `${value.slice(0, 47)}…` : value;
};

/**
 * One change per line, grouped by element:
 *
 *     text#hook        y          1480 → 1200
 *     text#hook        color      #ffffff → #ffe600
 *     image#clip-3     removed
 *     image#photo      motion     3 keyframes changed, 1 added
 */
export function formatDiff(diff: SourceDiff): string[] {
  if (diff.identical) return ["no changes"];
  const label = (change: { tag: string; id: string }): string => `${change.tag}#${change.id}`;
  const rows: Array<[string, string, string]> = [];

  for (const change of diff.changes) {
    if (change.kind === "prop") rows.push([label(change), change.name, `${shorten(change.before)} → ${shorten(change.after)}`]);
    else if (change.kind === "text") rows.push([label(change), "says", `"${shorten(change.before)}" → "${shorten(change.after)}"`]);
    else if (change.kind === "added") rows.push([label(change), "added", change.parent ? `under #${change.parent}` : ""]);
    else if (change.kind === "removed") rows.push([label(change), "removed", ""]);
    else if (change.kind === "moved") rows.push([label(change), "moved", `#${change.from ?? "?"} → #${change.to ?? "?"}`]);
    else rows.push([label(change), "reordered", "draws in a different order among its siblings"]);
  }
  for (const entry of diff.motion) {
    const parts = [
      entry.changed ? `${entry.changed} changed` : "",
      entry.added ? `${entry.added} added` : "",
      entry.removed ? `${entry.removed} removed` : "",
    ].filter(Boolean);
    rows.push([`#${entry.id}`, "motion", `keyframes/animations: ${parts.join(", ")}`]);
  }

  const first = Math.max(0, ...rows.map(([who]) => who.length));
  const second = Math.max(0, ...rows.map(([, what]) => what.length));
  const lines = rows.map(([who, what, detail]) => `${who.padEnd(first)}  ${what.padEnd(second)}  ${detail}`.trimEnd());
  if (diff.code) lines.push("(code outside the elements changed too: imports, components, variables or expressions)");
  if (!lines.length) lines.push("no element changed (only formatting, comments or editor view state differ)");
  return lines;
}
