/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Looks: gradients, filling a shape with a file, styling one word, the background. */

import { ColorStop, ImagePaint, LinearGradientPaint, RadialGradientPaint, TextRange, VideoPaint } from '@posterract/video-reconciler';
import { Cache, Chars, Library, Root, getActiveEntity } from '@posterract/video-runtime';

import { getDocumentEditor } from '@/engine/editor';

import { PALETTE, colorsSaid, stepColor } from '../words';
import { choiceOf, did, didNot, entitiesOf, numberOf, onOf, wordsOf } from './helpers';

import type { Entity } from 'koota';
import type { Asset } from '@posterract/video-assets';
import type { SlotValue } from '../types';
import type { RunFn } from './types';

/** A color slot as a hex, against what the element is now. */
function hexOf(value: SlotValue | undefined, now: string | undefined): string | null {
  if (!value) return null;
  if (value.kind === 'color') return value.hex;
  if (value.kind === 'color-step') return stepColor(now ?? '#808080', value.lighter);
  return null;
}

export const STYLE_RUNS: Record<string, RunFn> = {
  'style.gradient': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected', 'Say which element.');
    // Two colors, in the order the command says them.
    const said = colorsSaid(ctx.situation.command);
    const from = said[0] ? PALETTE[said[0]]?.hex : (step.slots.color?.kind === 'color' ? step.slots.color.hex : undefined);
    const to = said[1] ? PALETTE[said[1]]?.hex : from ? stepColor(from, false, 0.5) : undefined;
    if (!from || !to) return didNot('the command named no two colors', 'Say it as "green to blue gradient".');
    const radial = choiceOf(step.slots.gradient_kind) === 'radial';
    const editor = getDocumentEditor(world);
    for (const entity of entities) {
      for (const fill of entity.get(Cache)?.fills ?? []) editor.remove(fill);
      editor.insertElement(entity, () => (
        radial
          ? <RadialGradientPaint><ColorStop offset={0} color={from} /><ColorStop offset={1} color={to} /></RadialGradientPaint>
          : <LinearGradientPaint><ColorStop offset={0} color={from} /><ColorStop offset={1} color={to} /></LinearGradientPaint>
      ));
    }
    return did(`${radial ? 'Radial' : 'Linear'} gradient, ${said[0] ?? from} to ${said[1] ?? to}`);
  },

  'style.fill-media': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected', 'Say which shape.');
    const path = step.slots.asset?.kind === 'asset' ? step.slots.asset.path : null;
    const asset = path ? world.get(Library)?.assets().find((entry: Asset) => entry.path === path) : null;
    if (!asset) return didNot('the command named no picture or clip in the library');
    const editor = getDocumentEditor(world);
    for (const entity of entities) {
      for (const fill of entity.get(Cache)?.fills ?? []) editor.remove(fill);
      editor.insertElement(entity, () => (
        asset.type === 'VIDEO' || asset.type === 'SEQUENCE' ? <VideoPaint src={path!} /> : <ImagePaint src={path!} />
      ));
    }
    return did(`Filled with ${path!.split('/').pop()}`);
  },

  'style.word': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    const [entity] = entities;
    if (!entity) return didNot('nothing is selected', 'Say which text.');
    const text = entity.get(Chars)?.value ?? '';
    const wanted = wordsOf(step.slots.words);
    if (!text || !wanted) return didNot('the command did not say which word', 'Say it as: make the word storm green.');
    // The word as the text has it, however it was said.
    const at = text.toLowerCase().indexOf(wanted.toLowerCase());
    if (at === -1) return didNot(`“${wanted}” is not in that text`, 'Say a word the text actually has.');

    const props: Record<string, unknown> = {};
    const hex = hexOf(step.slots.color, undefined);
    if (hex) props.color = hex;
    const bold = onOf(step.slots.bold);
    if (bold !== null) props.fontWeight = bold ? 'bold' : 'normal';
    const italic = onOf(step.slots.italic);
    if (italic !== null) props.fontStyle = italic ? 'italic' : 'normal';
    const size = numberOf(step.slots.font_size);
    if (size) props.fontSize = size.value;
    const decoration = choiceOf(step.slots.decoration);
    if (decoration) props.textDecoration = decoration;
    const textCase = choiceOf(step.slots.text_case);
    if (textCase) props.textCase = textCase;
    if (!Object.keys(props).length) return didNot('the command did not say how to style it', 'Say a color, bold, italic or a size.');

    const editor = getDocumentEditor(world);
    editor.insertElement(entity, () => <TextRange start={at} end={at + wanted.length} {...props} />);
    return did(`Styled “${wanted}”`);
  },

  'style.background': (ctx, step) => {
    const { world } = ctx;
    const scene = getActiveEntity(world);
    const hex = hexOf(step.slots.color, undefined);
    if (!hex) return didNot('the command named no color', 'Say a color, such as black.');
    const editor = getDocumentEditor(world);
    // The scene's own background; with no scene open, the canvas behind them all.
    const target: Entity | null = scene ?? world.get(Root) ?? null;
    if (!target) return didNot('there is no project open');
    editor.editProperty(target, scene ? 'fill' : 'background', hex);
    return did(`Background ${hex}`);
  },
};
