/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Writing what a step worked out: the props it sets on elements, the children
 * it adds, the ones it takes off, and the props it sets on a child that is no
 * element of its own (an animation's duration).
 *
 * Prop edits go through `canvasApply`, which checks every prop before anything
 * changes — inside the caller's one undo step, so a whole sentence is one ⌘Z.
 */

import { getDocumentEditor } from '@/engine/editor';

import { canvasApply } from '../../canvas';
import { findAddressed } from './helpers';

import type { CanvasEdit } from '@posterract/cli/channels';
import type { Step } from '../types';
import type { RunContext } from './types';

/** Sets on the same element, written once. */
export function mergedEdits(edits: CanvasEdit[]): CanvasEdit[] {
  const out: CanvasEdit[] = [];
  const sets = new Map<string, CanvasEdit & { op: 'set' }>();
  for (const edit of edits) {
    if (edit.op === 'set') {
      const already = sets.get(edit.id);
      if (already) {
        already.properties = { ...already.properties, ...edit.properties };
        continue;
      }
      const copy = { ...edit, properties: { ...edit.properties } } as CanvasEdit & { op: 'set' };
      sets.set(edit.id, copy);
      out.push(copy);
      continue;
    }
    out.push(edit);
  }
  return out;
}

/** Applies everything a step worked out; says whether anything was written. */
export async function applyCompiled(ctx: RunContext, step: Step): Promise<boolean> {
  const { world } = ctx;
  let changed = false;

  if (step.edits?.length) {
    await canvasApply(ctx.session, { edits: mergedEdits(step.edits) }, { inGesture: true });
    changed = true;
  }
  if (step.removals?.length || step.subs?.length) {
    const editor = getDocumentEditor(world);
    for (const address of step.removals ?? []) {
      const entity = findAddressed(world, address);
      if (entity) {
        editor.remove(entity);
        changed = true;
      }
    }
    for (const sub of step.subs ?? []) {
      const entity = findAddressed(world, sub.id);
      if (!entity) continue;
      for (const [name, value] of Object.entries(sub.props)) editor.editProperty(entity, name, value as never);
      changed = true;
    }
  }
  return changed;
}
