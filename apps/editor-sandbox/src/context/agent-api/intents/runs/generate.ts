/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Making something with AI. Every one of these spends the person's own
 * provider credit, so the bar has already asked before any of it runs.
 */

import { choiceOf, did, didNot, numberOf, wordsOf } from './helpers';

import type { RunFn } from './types';

/** What follows "of", "showing" or "with": the description, when the command gives one. */
function promptOf(command: string, words: string | null): string | null {
  if (words) return words;
  const match = /\b(?:of|showing|with|that shows|depicting)\s+(.+)$/i.exec(command);
  return match ? match[1]!.replace(/[.!?]+$/, '').trim() : null;
}

export const GENERATE_RUNS: Record<string, RunFn> = {
  'generate.image': async (ctx, step) => {
    if (!ctx.ui.generate) return didNot('generating is not available here');
    const prompt = promptOf(ctx.situation.command, wordsOf(step.slots.words));
    if (!prompt) return didNot('the command did not say what to make', 'Say it as "generate an image of …".');
    await ctx.ui.generate('image', {
      prompt,
      aspectRatio: choiceOf(step.slots.aspect) ?? '9:16',
      resolution: choiceOf(step.slots.resolution) ?? '1K',
    });
    return did(`Generated a picture of ${prompt}`);
  },

  'generate.video': async (ctx, step) => {
    if (!ctx.ui.generate) return didNot('generating is not available here');
    const prompt = promptOf(ctx.situation.command, wordsOf(step.slots.words));
    if (!prompt) return didNot('the command did not say what to make', 'Say it as "generate a clip of …".');
    const seconds = numberOf(step.slots.seconds)?.value;
    await ctx.ui.generate('video', {
      prompt,
      aspectRatio: choiceOf(step.slots.aspect) ?? '9:16',
      durationSec: Math.min(15, Math.max(4, Math.round(seconds ?? 6))),
      quality: choiceOf(step.slots.quality) ?? '768P',
    });
    return did(`Generated a clip of ${prompt}`);
  },

  'generate.voice': async (ctx, step) => {
    if (!ctx.ui.generate) return didNot('generating is not available here');
    const said = wordsOf(step.slots.words) ?? promptOf(ctx.situation.command, null);
    if (!said) return didNot('the command did not say what to speak', 'Say it as: say "welcome back" in the deep voice.');
    await ctx.ui.generate('voice', { text: said, voiceId: choiceOf(step.slots.voice) ?? '' });
    return did(`Said “${said}”`);
  },
};
