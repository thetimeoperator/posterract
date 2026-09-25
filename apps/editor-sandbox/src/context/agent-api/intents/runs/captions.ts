/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Captions: writing them from the sound, editing the lines, fixing one, saving them out. */

import { Cue } from '@posterract/video-runtime';

import { addCaptions, captionsOf, cuesOf, subtitlesText, transcribeIntoCues, unpackCues } from '@/engine/captions';
import { getDocumentEditor } from '@/engine/editor';
import { CAPTION_PRESET_OPTIONS } from '@/components/sidebar-right/inspector/caption-types';

import { addressOf, choiceOf, did, didNot, entitiesOf, frameRateOf, playheadOf, sceneOf, secondsOfSlot, wordsOf } from './helpers';

import type { Entity } from 'koota';
import type { RunFn } from './types';

/** The captions a step is about: the one it names, or the scene's own. */
function captionsFor(ctx: Parameters<RunFn>[0], step: Parameters<RunFn>[1]): Entity | null {
  const named = entitiesOf(ctx.world, step)[0];
  if (named) return named;
  const scene = sceneOf(ctx.world);
  return scene ? captionsOf(ctx.world, scene) : null;
}

export const CAPTIONS_RUNS: Record<string, RunFn> = {
  'captions.add': async (ctx, step) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot('no video is open', 'Open a project first.');
    const dir = ctx.dir();
    if (!dir) return didNot('no project is open');
    const editor = getDocumentEditor(world);
    const already = captionsOf(world, scene);
    const captions = already ?? addCaptions(world, editor, scene, {
      ...(choiceOf(step.slots.preset) ? { preset: choiceOf(step.slots.preset)! } : {}),
      ...(choiceOf(step.slots.position) ? { position: choiceOf(step.slots.position)! } : {}),
    });
    if (!captions) return didNot('the captions could not be added');
    if (already && cuesOf(world, captions).length) return didNot('this video already has captions', 'Say "let me edit the captions" to change the lines.');

    const { lines, why } = await transcribeIntoCues(world, editor, captions, scene, dir);
    if (!lines) return didNot(why ?? 'nothing could be transcribed', 'Add the clip with the speech first.');
    const address = addressOf(captions);
    return did(`Wrote ${lines} caption lines`, address ? [address] : []);
  },

  'captions.unpack': (ctx, step) => {
    const { world } = ctx;
    const captions = captionsFor(ctx, step);
    if (!captions) return didNot('this video has no captions', 'Say "add captions" first.');
    if (cuesOf(world, captions).length) return didNot('the caption lines are already editable', 'Open the inspector to change them.');
    const lines = unpackCues(world, getDocumentEditor(world), captions);
    if (!lines) return didNot('there is nothing in the captions to unpack');
    return did(`${lines} caption lines, ready to edit`);
  },

  'captions.fix': (ctx, step) => {
    const { world } = ctx;
    const captions = captionsFor(ctx, step);
    if (!captions) return didNot('this video has no captions', 'Say "add captions" first.');
    const words = wordsOf(step.slots.words);
    if (!words) return didNot('the command did not say what the line should say', 'Say it as: change the caption here to say …');
    const cues = cuesOf(world, captions);
    if (!cues.length) return didNot('the captions have no editable lines yet', 'Say "let me edit the captions" first.');
    const fps = frameRateOf(world);
    const at = secondsOfSlot(step.slots.when) ?? playheadOf(world);
    const frame = at * fps;
    const line = cues.find((cue) => {
      const value = cue.get(Cue)!;
      return frame >= value.start && frame <= value.end;
    }) ?? [...cues].sort((a, b) => Math.abs((a.get(Cue)?.start ?? 0) - frame) - Math.abs((b.get(Cue)?.start ?? 0) - frame))[0];
    if (!line) return didNot('there is no caption line at that moment');
    getDocumentEditor(world).editText(line, words);
    return did(`Caption now says “${words}”`);
  },

  'captions.colors': (ctx, step) => {
    const { world } = ctx;
    const captions = captionsFor(ctx, step);
    if (!captions) return didNot('this video has no captions', 'Say "add captions" first.');
    const hex = step.slots.color?.kind === 'color' ? step.slots.color.hex : null;
    if (!hex) return didNot('the command named no color');
    const element = ctx.situation.elements.find((entry) => entry.id === (addressOf(captions) ?? ''));
    const preset = CAPTION_PRESET_OPTIONS.find((option) => option.name === (element?.preset ?? 'classic'))
      ?? CAPTION_PRESET_OPTIONS[0]!;
    // The colors are positional per preset: the one that follows the voice is
    // the first slot a preset has, and a preset with no slots has none to set.
    const slots = preset.slots.length;
    if (!slots) return didNot(`the ${preset.label.toLowerCase()} caption style has no color of its own`, 'Switch to a style like pop or karaoke first.');
    const colors = preset.slots.map((slot, index) => (index === 0 ? hex : `#${slot.defaultColor.toString(16).padStart(6, '0')}`));
    getDocumentEditor(world).editProperty(captions, 'colors', colors as never);
    return did(`Captions in ${hex}`);
  },

  'captions.export': async (ctx, step) => {
    const { world } = ctx;
    const captions = captionsFor(ctx, step);
    if (!captions) return didNot('this video has no captions', 'Say "add captions" first.');
    const format = (choiceOf(step.slots.subtitle_format) ?? 'srt') as 'srt' | 'vtt';
    const text = subtitlesText(world, captions, format);
    if (!text) return didNot('the captions have no editable lines to save', 'Say "let me edit the captions" first.');
    if (!ctx.ui.exportSubtitles) return didNot('saving subtitles is not available here');
    await ctx.ui.exportSubtitles(format, text);
    return did(`Saved the subtitles as ${format.toUpperCase()}`);
  },
};
