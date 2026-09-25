/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A change to a source, as the few things a live canvas has to do to show it.
 *
 * When a source changes on disk — an agent edited the file, which is how agents
 * edit — the editor has always answered the only way that is always right: it
 * throws the mounted project away and mounts the file again. That costs the
 * person their undo history, flashes the canvas, and makes an agent's one-word
 * change feel like a reload of the app.
 *
 * Most such changes are small and literal: this caption's `y`, that clip's
 * `end`, what a text says. Those can be carried to the canvas as they are —
 * set this prop of this element to this value — through the same editor
 * commands a drag goes through, which also makes them one step of the person's
 * undo history. This module decides whether a change is of that kind, and if so
 * spells it out.
 *
 * It errs on one side only. Anything it is not certain it can carry exactly —
 * an element added, removed, moved or reordered; a value computed by code; an
 * element rendered by a loop; code around the elements; a prop that loads
 * something — is `ok: false` with the reason, and the caller mounts the file
 * again as it always has. A patch is an optimisation of the reload, never a
 * second opinion about what the file says.
 */

import { formatSource } from "@posterract/composition/source";

import { readElements } from "./diff.ts";

import type { ElementRecord, LiteralValue } from "./diff.ts";

export type PatchOp =
  /** `value: false` unsets the prop, the way the editor itself unsets one. */
  | { kind: "prop"; source: string; name: string; value: LiteralValue }
  | { kind: "text"; source: string; value: string };

export type SourcePatch =
  | { ok: true; ops: PatchOp[] }
  /**
   * `renames` is there when both versions parsed: where every element that
   * has no id went, by the address the compiler gives it (`file#12`), and a
   * dead address for one that cannot be found again. The file is mounted
   * again either way; with these, what was recorded against the old mount —
   * the person's undo history — can follow its elements into the new one
   * instead of being thrown away.
   */
  | { ok: false; reason: string; renames?: Record<string, string> };

/**
 * Props whose change is more than a value: `src` starts a load, `id` is the
 * element's address, a shader or its uniforms are compiled. A remount gets
 * these right; carrying them live is not worth being wrong about.
 */
const REMOUNT_PROPS: ReadonlySet<string> = new Set(["src", "id", "ref", "wgsl", "uniforms", "skill", "{...}"]);

const same = (a: LiteralValue | undefined, b: LiteralValue | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What it takes to turn a canvas showing `before` into one showing `after`, when that can be said exactly. */
export function patchSources(path: string, before: string, after: string): SourcePatch {
  if (before === after) return { ok: true, ops: [] };

  const old = readElements(path, before);
  const now = readElements(path, after);
  if (!old.clean || !now.clean) return { ok: false, reason: "the source does not parse" };

  const patch = patchRecords(path, old, now);
  return patch.ok ? patch : { ...patch, renames: sourceRenames(path, old.records, now.records) };
}

type Elements = ReturnType<typeof readElements>;

function patchRecords(path: string, old: Elements, now: Elements): SourcePatch {
  if (old.rest !== now.rest) return { ok: false, reason: "code around the elements changed (an import, a component, a variable)" };

  // The same elements, under the same parents, in the same order.
  if (old.records.size !== now.records.size) return { ok: false, reason: "elements were added or removed" };
  for (const [key, record] of now.records) {
    const previous = old.records.get(key);
    if (!previous || previous.tag !== record.tag) return { ok: false, reason: `element ${key} was added, removed or replaced` };
    if (previous.parent !== record.parent || previous.index !== record.index) {
      return { ok: false, reason: `element ${key} was moved or reordered` };
    }
    // Same elements, but not the same file around them: markup inside an
    // <html>, the condition a child is rendered under. No prop says that.
    if (previous.inner !== record.inner) return { ok: false, reason: `what ${key} holds besides elements changed (markup, or code around a child)` };
    // An address is a position for an element with no id: if those moved (a DOM
    // tag came or went inside an <html>), the mount's addresses are stale.
    if (previous.position !== record.position) return { ok: false, reason: "elements with no id changed position in the file" };
  }

  const ops: PatchOp[] = [];
  for (const [key, record] of now.records) {
    const previous = old.records.get(key)!;
    const names = new Set([...previous.props.keys(), ...record.props.keys()]);
    const changed = [...names].filter((name) => previous.props.get(name) !== record.props.get(name));
    const spoke = (previous.text ?? "") !== (record.text ?? "");
    if (!changed.length && !spoke) continue;

    if (record.viaCode || previous.viaCode) return { ok: false, reason: `element ${key} is rendered by code (a loop or a condition)` };
    // By id, or the way the compiler addresses an element that has none: its
    // position, which the loop above found unchanged.
    const source = formatSource(path, record.named ? key : record.position);

    for (const name of changed) {
      if (REMOUNT_PROPS.has(name)) return { ok: false, reason: `\`${name}\` of ${key} changed, which needs a remount` };
      const was = previous.props.has(name);
      const is = record.props.has(name);
      // A prop that was computed, or now is, is reactive code: only a compile can wire it.
      if (was && !previous.literals.has(name)) return { ok: false, reason: `\`${name}\` of ${key} was computed by code` };
      if (is && !record.literals.has(name)) return { ok: false, reason: `\`${name}\` of ${key} is now computed by code` };
      const value = is ? record.literals.get(name)! : false;
      if (was && is && same(previous.literals.get(name), value)) continue; // Respelled, not changed: 1.0 → 1.
      ops.push({ kind: "prop", source, name, value });
    }

    if (spoke) {
      if (!record.textIsLiteral || !previous.textIsLiteral) return { ok: false, reason: `what ${key} says is computed by code` };
      ops.push({ kind: "text", source, value: record.text ?? "" });
    }
  }

  return { ok: true, ops };
}

/** A source nothing answers to: where a record of an element that cannot be found again is pointed. */
const gone = (path: string, position: number): string => formatSource(path, `~gone-${position}`);

/** What makes an element with no id recognisable as itself: what it is, what it says, and everything in it. */
function fingerprints(records: Map<string, ElementRecord>): Map<string, string> {
  const children = new Map<string, ElementRecord[]>();
  for (const record of records.values()) {
    if (record.parent === null) continue;
    if (!children.has(record.parent)) children.set(record.parent, []);
    children.get(record.parent)!.push(record);
  }
  const prints = new Map<string, string>();
  const print = (record: ElementRecord): string => {
    const known = prints.get(record.key);
    if (known !== undefined) return known;
    const props = [...record.props].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, value]) => `${name}=${value}`).join(" ");
    const inside = (children.get(record.key) ?? []).sort((a, b) => a.index - b.index).map(print).join(",");
    const result = `<${record.tag} ${props}>${record.text ?? ""}|${record.inner}|${inside}`;
    prints.set(record.key, result);
    return result;
  };
  for (const record of records.values()) print(record);
  return prints;
}

/**
 * Where the elements the compiler addresses by position went between two
 * versions of a source. An element with an id keeps its address whatever
 * happens around it; one without is "the nth element of the file", and an
 * element added above it makes it the n+1th. The elements are paired in order
 * (a longest common subsequence over what they are and hold), so one that was
 * itself changed, or whose twin cannot be told from it, is not guessed at: its
 * old address is pointed at nothing.
 */
function sourceRenames(path: string, old: Map<string, ElementRecord>, now: Map<string, ElementRecord>): Record<string, string> {
  const before = [...old.values()].filter((record) => !record.named || !now.get(record.key)?.named).sort((a, b) => a.position - b.position);
  const after = [...now.values()].filter((record) => !record.named || !old.get(record.key)?.named).sort((a, b) => a.position - b.position);
  const was = fingerprints(old);
  const is = fingerprints(now);
  const alike = (a: ElementRecord, b: ElementRecord): boolean => was.get(a.key) === is.get(b.key);

  // Most edits touch one place: what is the same from the top and from the
  // bottom pairs off without the table.
  let head = 0;
  while (head < before.length && head < after.length && alike(before[head]!, after[head]!)) head += 1;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && alike(before[before.length - 1 - tail]!, after[after.length - 1 - tail]!)) tail += 1;

  const pairs = new Map<ElementRecord, ElementRecord>();
  for (let index = 0; index < head; index += 1) pairs.set(before[index]!, after[index]!);
  for (let index = 0; index < tail; index += 1) pairs.set(before[before.length - 1 - index]!, after[after.length - 1 - index]!);

  const left = before.slice(head, before.length - tail);
  const right = after.slice(head, after.length - tail);
  // Beyond this the table is not worth its memory; the middle goes unpaired,
  // which only costs the history of the elements in it.
  if (left.length * right.length <= 4_000_000) {
    const width = right.length + 1;
    const table = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i -= 1) {
      for (let j = right.length - 1; j >= 0; j -= 1) {
        table[i * width + j] = alike(left[i]!, right[j]!)
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
      }
    }
    for (let i = 0, j = 0; i < left.length && j < right.length; ) {
      if (alike(left[i]!, right[j]!)) {
        pairs.set(left[i]!, right[j]!);
        i += 1;
        j += 1;
      } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i += 1;
      else j += 1;
    }
  }

  const address = (record: ElementRecord): string => formatSource(path, record.named ? record.key : record.position);
  const renames: Record<string, string> = {};
  for (const record of before) {
    const partner = pairs.get(record);
    const from = address(record);
    const to = partner ? address(partner) : gone(path, record.position);
    if (from !== to) renames[from] = to;
  }
  return renames;
}
