/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Sound: holding one clip's level down while another plays. */

import { authoredElement } from '@posterract/video-reconciler';

import { getDocumentEditor } from '@/engine/editor';

import { canvasApply } from '../../canvas';
import { amountOf, did, didNot, entitiesOf, numberOf } from './helpers';

import type { Entity } from 'koota';
import type { RunFn } from './types';

/** A `<duck>` names both clips by their `id`, so both need one in the file. */
function idFor(editor: ReturnType<typeof getDocumentEditor>, entity: Entity, suggestion: string): string {
  const already = authoredElement(entity)?.props.id;
  if (typeof already === 'string' && already) return already;
  const id = suggestion.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'clip';
  editor.editProperty(entity, 'id', id);
  return id;
}

export const SOUND_RUNS: Record<string, RunFn> = {
  'sound.duck': async (ctx, step) => {
    const { world } = ctx;
    const sceneId = ctx.situation.scene?.id;
    if (!sceneId) return didNot('no video is open');
    const [quieter] = entitiesOf(world, step);
    if (!quieter) return didNot('the command did not say which sound should give way', 'Say "lower the music when the voice plays".');
    const overId = step.slots.under?.kind === 'element' ? step.slots.under.id : null;
    if (!overId) return didNot('the command did not say what it should make way for', 'Say which voice or clip plays over it.');
    const [over] = entitiesOf(world, { ...step, targets: [overId] });
    if (!over) return didNot('that clip is not here any more');

    const editor = getDocumentEditor(world);
    const target = idFor(editor, quieter, 'music');
    const by = idFor(editor, over, 'voice');
    const decibels = numberOf(step.slots.volume)?.value ?? -[6, 12, 18][amountOf(step.slots.amount)]!;
    // `<duck>` has no component of its own: it is authored through the same
    // checked path an agent's edits take.
    await canvasApply(
      ctx.session,
      { edits: [{ op: 'create', parentId: sceneId, element: { tag: 'duck', props: { target, by, amount: -Math.abs(decibels) } } }] },
      { inGesture: true },
    );
    return did(`Ducking ${target} under ${by}`);
  },
};
