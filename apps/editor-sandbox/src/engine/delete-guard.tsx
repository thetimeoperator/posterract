/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Deleting a scene removes a whole branch of the composition, and until now it
 * happened on a bare keypress with nothing to undo it after a reload. Both the
 * delete shortcut and the layer context menu route through here, so the
 * confirmation and the trash copy cannot be bypassed by using the other one.
 *
 * Everything that is not a populated scene still deletes immediately: undo
 * covers those, and a prompt on every keypress would be worse than the risk.
 */
import { createSignal } from 'solid-js';
import { Locked, Name, Scene, Source, getEntityChildren } from '@posterract/video-runtime';
import { getDocumentEditor } from './editor';
import { parseSource } from '@posterract/composition';

import type { Entity, World } from 'koota';

export type PendingSceneDelete = {
  world: World;
  /** The scenes that need confirming, with what to call them. */
  scenes: Array<{ entity: Entity; id: string; name: string }>;
  /** Everything in the same delete that needs no confirmation. */
  rest: Entity[];
};

const [pending, setPending] = createSignal<PendingSceneDelete | null>(null);

export const pendingSceneDelete = pending;
export const clearPendingSceneDelete = () => setPending(null);

/** The stable id the source stamp carries, which the trash stores under. */
export function stampedId(entity: Entity): string | null {
  const source = entity.get(Source)?.value;
  if (!source) return null;
  const locator = parseSource(source)?.locator;
  return typeof locator === 'string' ? locator : null;
}

/**
 * Delete `entities`, asking first when any of them is a scene with content.
 * Returns true when the deletion already happened.
 */
export function requestDelete(world: World, entities: Entity[]): boolean {
  // A locked layer refuses every destructive path, including the ones that
  // never ask — that is the whole point of locking it.
  const deletable = entities.filter((entity) => !entity.has(Locked));
  if (!deletable.length) return true;
  entities = deletable;

  const scenes: PendingSceneDelete['scenes'] = [];
  const rest: Entity[] = [];
  for (const entity of entities) {
    const id = stampedId(entity);
    // A scene with no children has nothing to lose, and one with no stamp
    // cannot be written to trash, so neither is worth interrupting for.
    if (entity.has(Scene) && id && getEntityChildren(world, entity).length) {
      scenes.push({ entity, id, name: entity.get(Name)?.value || 'Untitled scene' });
    } else {
      rest.push(entity);
    }
  }

  if (!scenes.length) {
    getDocumentEditor(world).remove(entities);
    return true;
  }

  setPending({ world, scenes, rest });
  return false;
}
