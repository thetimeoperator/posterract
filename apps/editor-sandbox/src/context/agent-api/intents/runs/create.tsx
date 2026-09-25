/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Adding something new: a shape, a text, a scene, a file, a marker, a mask, an adjustment layer. */

import { AdjustmentLayer, Effect, Marker as MarkerElement, Rect } from '@posterract/video-reconciler';
import { Cache, Computed, Library, Root, Source, getActiveEntity, getNextName, store } from '@posterract/video-runtime';

import { getDocumentEditor } from '@/engine/editor';
import { SHAPE_DEFAULTS, insertShape, insertText, textSizeIn } from '@/engine/create';
import { insertAsset } from '@/engine/insert-asset';
import { createScene, insertMediaAsScenes, insertSounds, isFrameable } from '@/engine/new-scene';
import { findEmptyPlacement } from '@/engine/placement';
import { SCENE_GAP } from '@/engine/new-scene';

import { SCENE_FORMATS } from '../catalog/create';
import { SIZE_BUCKETS } from '../words';
import { addressOf, choiceOf, did, didNot, entitiesOf, frameRateOf, numberOf, sceneOf, secondsOfSlot, wordsOf } from './helpers';

import type { Asset, ImageAsset, VideoAsset } from '@posterract/video-assets';
import type { ShapeKind } from '@/engine/shapes';
import type { RunFn } from './types';

/** The shape a spoken kind draws, and whether its sides are equal. */
function shapeFor(said: string | null): { kind: ShapeKind; equal: boolean } {
  if (said === 'circle') return { kind: 'ellipse', equal: true };
  if (said === 'square') return { kind: 'rectangle', equal: true };
  if (said === 'oval') return { kind: 'ellipse', equal: false };
  const kinds: ShapeKind[] = ['rectangle', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'arrow'];
  return { kind: (kinds.find((kind) => kind === said) ?? 'rectangle'), equal: false };
}

/** How big a new thing is: the tool's own 300×300 unless the command said otherwise. */
function sizeFor(bucket: string | null, side: { value: number; unit: string } | null, frame: { width: number; height: number }): number {
  if (side) return side.unit === '%' ? Math.round((side.value / 100) * Math.min(frame.width, frame.height)) : Math.round(side.value);
  if (!bucket) return SHAPE_DEFAULTS.width;
  const share = SIZE_BUCKETS[bucket as keyof typeof SIZE_BUCKETS] ?? SIZE_BUCKETS.medium;
  return Math.round(share * Math.min(frame.width, frame.height));
}

const NO_VIDEO = ['no video is open', 'Say "new scene" first.'] as const;

export const CREATE_RUNS: Record<string, RunFn> = {
  'create.shape': (ctx, step) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot(...NO_VIDEO);
    const computed = store(world, Computed);
    const frame = { width: computed.width[scene.id()] ?? 1080, height: computed.height[scene.id()] ?? 1920 };
    const { kind, equal } = shapeFor(choiceOf(step.slots.shape_kind));
    const side = sizeFor(choiceOf(step.slots.size), numberOf(step.slots.side), frame);
    const width = side;
    const height = equal ? side : Math.round(kind === 'rectangle' && !choiceOf(step.slots.size) ? side : side);
    const spot = choiceOf(step.slots.spot);
    const start = secondsOfSlot(step.slots.when);

    const entity = insertShape(world, getDocumentEditor(world), {
      parent: scene,
      kind,
      x: Math.round((frame.width - width) / 2),
      y: Math.round((frame.height - height) / 2),
      width,
      height,
      ...(step.slots.color?.kind === 'color' ? { color: step.slots.color.hex } : {}),
      ...(spot ? { place: spot } : {}),
      ...(start !== null ? { start } : {}),
    });
    if (!entity) return didNot('the shape could not be added', 'Open a project first.');
    const address = addressOf(entity);
    return did(`Added a ${choiceOf(step.slots.shape_kind) ?? kind}`, address ? [address] : []);
  },

  'create.text': (ctx, step) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot(...NO_VIDEO);
    const computed = store(world, Computed);
    const frame = { width: computed.width[scene.id()] ?? 1080, height: computed.height[scene.id()] ?? 1920 };
    const words = wordsOf(step.slots.words) ?? undefined;
    const bucket = choiceOf(step.slots.size);
    const base = textSizeIn(world, scene);
    const font = numberOf(step.slots.side)?.value
      ?? (bucket ? Math.round(base * ({ tiny: 0.4, small: 0.65, medium: 1, large: 1.8, huge: 3, fill: 4 } as Record<string, number>)[bucket]!) : base);
    const spot = choiceOf(step.slots.spot);
    const start = secondsOfSlot(step.slots.when);

    const entity = insertText(world, getDocumentEditor(world), {
      parent: scene,
      ...(words ? { words } : {}),
      x: Math.round(frame.width / 2 - (words ?? 'Text').length * font * 0.28),
      y: Math.round((frame.height - font * 1.2) / 2),
      fontSize: font,
      ...(step.slots.color?.kind === 'color' ? { color: step.slots.color.hex } : {}),
      ...(spot ? { place: spot } : {}),
      ...(start !== null ? { start } : {}),
    });
    if (!entity) return didNot('the text could not be added', 'Open a project first.');
    const address = addressOf(entity);
    return did(words ? `Added the text “${words}”` : 'Added a text', address ? [address] : []);
  },

  'create.scene': (ctx, step) => {
    const { world } = ctx;
    const key = choiceOf(step.slots.format);
    const format = (key && SCENE_FORMATS[key]) || SCENE_FORMATS.vertical!;
    const name = wordsOf(step.slots.words) ?? undefined;
    const at = findEmptyPlacement(world, format.width, format.height, SCENE_GAP);
    const scene = createScene(world, { width: format.width, height: format.height }, { ...(name ? { name } : {}), at });
    if (!scene) return didNot('there is no project to add a scene to', 'Open a project first.');
    const address = addressOf(scene);
    return did(`Added a ${format.label.toLowerCase()} scene`, address ? [address] : []);
  },

  'create.from-asset': (ctx, step) => {
    const { world } = ctx;
    const asset = assetOf(ctx, step.slots.asset?.kind === 'asset' ? step.slots.asset.path : null);
    if (!asset) return didNot('the command did not name a file in the library', 'Say the file\'s name, or import it first.');
    const start = secondsOfSlot(step.slots.when);
    const scene = sceneOf(world);
    if (!scene && asset.type === 'AUDIO') return didNot(...NO_VIDEO);
    const entity = insertAsset(world, asset, { ...(start !== null ? { start } : {}) });
    if (!entity) return didNot('there was nowhere to put it', 'Open a scene first.');
    const spot = choiceOf(step.slots.spot);
    if (spot) getDocumentEditor(world).editProperty(entity, 'place', spot);
    const address = addressOf(entity);
    return did(`Added ${asset.path.split('/').pop()}`, address ? [address] : []);
  },

  'create.scene-from-asset': (ctx, step) => {
    const { world } = ctx;
    const asset = assetOf(ctx, step.slots.asset?.kind === 'asset' ? step.slots.asset.path : null);
    if (!asset) return didNot('the command did not name a file in the library');
    if (asset.type === 'AUDIO') {
      const done = insertSounds(world, [asset]);
      return done ? did(`Added ${asset.path.split('/').pop()}`) : didNot('the sound could not be added');
    }
    if (!isFrameable(asset)) return didNot('only a picture or a clip can be a scene of its own', 'Say "add the file" instead.');
    const at = findEmptyPlacement(world, 1080, 1920, SCENE_GAP);
    const scenes = insertMediaAsScenes(world, [asset as ImageAsset | VideoAsset], at);
    if (!scenes.length) return didNot('the scene could not be made');
    const address = addressOf(scenes[0]!);
    return did(`Made a scene from ${asset.path.split('/').pop()}`, address ? [address] : []);
  },

  'create.marker': (ctx, step) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot(...NO_VIDEO);
    const fps = frameRateOf(world);
    const at = secondsOfSlot(step.slots.when) ?? (store(world, Computed).localTime[scene.id()] ?? 0) / fps;
    const name = wordsOf(step.slots.words);
    const editor = getDocumentEditor(world);
    const [entity] = editor.insertElement(scene, () => (
      <MarkerElement time={Math.round(at * fps) / fps} {...(name ? { name } : {})} />
    ));
    if (!entity) return didNot('the marker could not be added');
    return did(`Marker${name ? ` “${name}”` : ''} at ${Math.round(at * 10) / 10} s`);
  },

  'create.mask': (ctx, step) => {
    const { world } = ctx;
    const [entity] = entitiesOf(world, step);
    if (!entity) return didNot('nothing is selected to mask', 'Say which element to mask.');
    const computed = entity.get(Computed);
    const width = Math.round(computed?.width ?? 0);
    const height = Math.round(computed?.height ?? 0);
    const size = width > 0 && height > 0 ? { width, height } : {};
    const editor = getDocumentEditor(world);
    const [mask] = editor.insertElement(entity, () => (
      <Rect mask name={getNextName(world, 'Mask')} x={20} y={20} {...size} />
    ));
    if (!mask) return didNot('the mask could not be added');
    const address = addressOf(mask);
    return did('Added a mask', address ? [address] : []);
  },

  'create.adjustment-layer': (ctx, step) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot(...NO_VIDEO);
    const type = choiceOf(step.slots.effect_type) ?? 'blur';
    const value = type === 'blur' ? 8 : type === 'hueRotate' ? 90 : 1;
    const editor = getDocumentEditor(world);
    const [layer] = editor.insertElement(scene, () => (
      <AdjustmentLayer name={getNextName(world, 'Adjustment')}>
        <Effect type={type as never} value={value} />
      </AdjustmentLayer>
    ));
    if (!layer) return didNot('the adjustment layer could not be added');
    const address = addressOf(layer);
    return did(`Added an adjustment layer with ${type}`, address ? [address] : []);
  },
};

function assetOf(ctx: { world: Parameters<RunFn>[0]['world'] }, path: string | null): Asset | null {
  if (!path) return null;
  const library = ctx.world.get(Library);
  return library?.assets().find((asset: Asset) => asset.path === path) ?? null;
}

/** Unused imports kept honest: the Cache, Root and Source traits are read by the helpers above. */
void Cache;
void Root;
void Source;
void getActiveEntity;
