/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Arranging: aligning, spacing, layer order, moving into a container, duplicating, reshaping, swapping a file. */

import { Cache, Computed, Library, getParentEntity, store } from '@posterract/video-runtime';
import { authoredElement } from '@posterract/video-reconciler';

import { alignSelection, distributeSelection, getAlignableSelection } from '@/engine/align';
import { getDocumentEditor } from '@/engine/editor';
import { changeShape, isReshapeable } from '@/engine/shapes';

import { addressOf, choiceOf, did, didNot, entitiesOf, numberOf, sceneOf, whoOf } from './helpers';

import type { Entity } from 'koota';
import type { Asset } from '@posterract/video-assets';
import type { ShapeKind } from '@/engine/shapes';
import type { AlignAction } from '@/engine/align';
import type { RunFn } from './types';

const ALIGN_ACTIONS: Record<string, AlignAction> = {
  left: 'align-left',
  'center-horizontal': 'align-center-horizontal',
  right: 'align-right',
  top: 'align-top',
  'center-vertical': 'align-center-vertical',
  bottom: 'align-bottom',
};

/** One element against the frame: the alignment code needs two, so the frame is the other. */
function alignToFrame(ctx: Parameters<RunFn>[0], entity: Entity, how: string): boolean {
  const { world } = ctx;
  const scene = sceneOf(world);
  if (!scene) return false;
  const computed = store(world, Computed);
  const frame = { width: computed.width[scene.id()] ?? 0, height: computed.height[scene.id()] ?? 0 };
  const box = { width: computed.width[entity.id()] ?? 0, height: computed.height[entity.id()] ?? 0 };
  const editor = getDocumentEditor(world);
  const props: Record<string, number> = {};
  if (how === 'left') props.x = 0;
  if (how === 'right') props.x = Math.round(frame.width - box.width);
  if (how === 'center-horizontal') props.x = Math.round((frame.width - box.width) / 2);
  if (how === 'top') props.y = 0;
  if (how === 'bottom') props.y = Math.round(frame.height - box.height);
  if (how === 'center-vertical') props.y = Math.round((frame.height - box.height) / 2);
  if (!Object.keys(props).length) return false;
  for (const [name, value] of Object.entries(props)) editor.editProperty(entity, name, value);
  return true;
}

export const ARRANGE_RUNS: Record<string, RunFn> = {
  'arrange.align': (ctx, step) => {
    const { world } = ctx;
    const how = choiceOf(step.slots.align_how);
    if (!how) return didNot('the command did not say how to line them up', 'Say "align these left", or "line up their tops".');
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected to line up', 'Select the elements first.');
    const editor = getDocumentEditor(world);
    if (entities.length === 1) {
      return alignToFrame(ctx, entities[0]!, how)
        ? did(`Aligned ${whoOf(step, ctx.situation)} ${how.replace('center-horizontal', 'to the middle').replace('center-vertical', 'to the middle')}`)
        : didNot('that element cannot be aligned');
    }
    editor.select(entities);
    if (getAlignableSelection(world).length < 2) return didNot('those elements cannot be lined up with each other');
    alignSelection(world, ALIGN_ACTIONS[how]!);
    return did(`Aligned ${entities.length} elements`);
  },

  'arrange.distribute': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (entities.length < 3) return didNot('three or more elements are needed to space them out', 'Select at least three.');
    const editor = getDocumentEditor(world);
    editor.select(entities);
    distributeSelection(world, choiceOf(step.slots.axis) === 'y' ? 'y' : 'x');
    return did(`Spaced out ${entities.length} elements`);
  },

  'arrange.layer': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected', 'Say which element.');
    const how = choiceOf(step.slots.layer_how) ?? 'front';
    const editor = getDocumentEditor(world);
    const anchorId = step.slots.anchor?.kind === 'element' ? step.slots.anchor.id : null;
    let changed = false;

    for (const entity of entities) {
      const parent = getParentEntity(entity);
      if (!parent) continue;
      const siblings = (parent.get(Cache)?.children ?? []).filter((child) => child !== entity);
      const at = (parent.get(Cache)?.children ?? []).indexOf(entity);

      if (how === 'front') changed = editor.reparent(entity, parent) || changed;
      else if (how === 'back') changed = editor.reparent(entity, parent, siblings[0]) || changed;
      else if (how === 'forward') changed = editor.reparent(entity, parent, siblings[at + 1]) || changed;
      else if (how === 'backward') changed = editor.reparent(entity, parent, siblings[Math.max(0, at - 2)]) || changed;
      else if (anchorId) {
        const anchor = entitiesOf(world, { ...step, targets: [anchorId] })[0];
        if (!anchor) continue;
        const anchorParent = getParentEntity(anchor);
        if (!anchorParent) continue;
        const order = anchorParent.get(Cache)?.children ?? [];
        const index = order.indexOf(anchor);
        const before = how === 'behind' ? anchor : order[index + 1];
        changed = editor.reparent(entity, anchorParent, before) || changed;
      }
    }
    if (!changed) return didNot(how === 'front' ? "it's already in front" : how === 'back' ? "it's already at the back" : 'it did not move');
    return did(`${whoOf(step, ctx.situation) || 'It'} ${how === 'front' ? 'to the front' : how === 'back' ? 'to the back' : `moved ${how}`}`);
  },

  'arrange.into': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    const containerId = step.slots.container?.kind === 'element' ? step.slots.container.id : null;
    if (!containerId) return didNot('the command did not say what to move it into', 'Say "into the second scene", or "into the group".');
    const [container] = entitiesOf(world, { ...step, targets: [containerId] });
    if (!container) return didNot('that group or scene is not here any more');
    if (!entities.length) return didNot('nothing is selected to move');
    const editor = getDocumentEditor(world);
    let changed = false;
    for (const entity of entities) changed = editor.reparent(entity, container) || changed;
    if (!changed) return didNot('it could not be moved there', 'It may already be inside it.');
    return did(`Moved ${whoOf(step, ctx.situation) || 'it'} in`);
  },

  'arrange.duplicate': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected to copy', 'Say which element.');
    const count = Math.min(20, Math.max(1, Math.round(numberOf(step.slots.count)?.value ?? 1)));
    const editor = getDocumentEditor(world);
    const made: string[] = [];
    let copies = entities;
    for (let index = 0; index < count; index += 1) {
      copies = editor.duplicate(copies);
      if (!copies.length) break;
      for (const copy of copies) {
        const address = addressOf(copy);
        if (address) made.push(address);
      }
    }
    if (!made.length) return didNot('nothing could be copied');
    return did(count > 1 ? `Made ${count} copies` : `Duplicated ${whoOf(step, ctx.situation) || 'it'}`, made);
  },

  'arrange.change-shape': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected', 'Say which shape.');
    const said = choiceOf(step.slots.shape_kind);
    if (!said) return didNot('the command did not say which shape');
    const kind: ShapeKind = said === 'circle' ? 'ellipse' : said === 'square' ? 'rectangle' : said === 'oval' ? 'ellipse' : (said as ShapeKind);
    const made: string[] = [];
    for (const entity of entities) {
      if (!isReshapeable(entity)) continue;
      const next = changeShape(world, entity, kind);
      const address = next ? addressOf(next) : null;
      if (address) made.push(address);
    }
    if (!made.length) return didNot('that element cannot be turned into another shape', 'It works on rectangles, ovals and polygons.');
    return did(`Now a ${said}`, made);
  },

  'arrange.replace-media': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected', 'Say which clip.');
    const path = step.slots.asset?.kind === 'asset' ? step.slots.asset.path : null;
    if (!path) return didNot('the command did not name a file in the library');
    const asset = world.get(Library)?.assets().find((entry: Asset) => entry.path === path);
    if (!asset) return didNot('that file is not in the library any more');
    const editor = getDocumentEditor(world);
    let changed = false;
    for (const entity of entities) {
      // The source sits on the element itself, or on the paint that fills it.
      const own = authoredElement(entity)?.props.src;
      const target = own !== undefined ? entity : (entity.get(Cache)?.fills ?? []).find((fill) => authoredElement(fill)?.props.src !== undefined);
      if (!target) continue;
      editor.editProperty(target, 'src', path);
      changed = true;
    }
    if (!changed) return didNot('that element plays no file', 'Try it on a clip or a picture.');
    return did(`Now playing ${path.split('/').pop()}`);
  },
};
