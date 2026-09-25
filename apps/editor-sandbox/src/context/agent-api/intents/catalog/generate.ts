/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { FamilyDef } from '../types';

/**
 * Making something with AI spends the person's own provider credit, so every
 * intent here asks first, however sure the reading is.
 */
export const GENERATE: FamilyDef = {
  id: 'generate',
  label: 'Generate',
  exclusive: true,
  ask:
    'Does the command ask to make something new with AI from a description — generate a picture, generate a video clip, '
    + 'or speak some words in a voice? For example "generate an image of a stormy sky", "make me a 6 second clip of waves", '
    + '"say welcome back in the deep voice". Not adding a file that is already in the library, and not writing words.',
  slots: {
    words: { kind: 'words', text: 'what to make, or the words to speak' },
    aspect: {
      kind: 'choice',
      ask: 'Which shape does the command ask the picture or clip to be?',
      options: {
        '9:16': 'Vertical, 9:16, portrait, for phones.',
        '16:9': 'Wide, 16:9, landscape.',
        '1:1': 'Square.',
        '4:3': 'Almost square, wider than tall.',
        '3:4': 'Almost square, taller than wide.',
      },
    },
    resolution: { kind: 'choice', ask: 'How big does the command ask the picture to be?', options: { '1K': 'Ordinary size, 1K.', '2K': 'Large, 2K, high resolution.' } },
    quality: { kind: 'choice', ask: 'How good does the command ask the clip to be?', options: { '768P': 'Ordinary, quicker and cheaper.', '2K': 'High quality, slower and dearer.' } },
    seconds: { kind: 'number', text: 'How long the clip should be, in seconds (4 to 15).', units: ['s'] },
    voice: { kind: 'choice', ask: 'Which voice does the command ask for?', options: {} },
  },
  intents: [
    {
      id: 'generate.image',
      needs: ['words'],
      label: 'Generate a picture',
      text: {
        what: 'Make a new picture with AI from a description, and put it in the video.',
        notFor: 'Not a picture already in the library.',
        examples: ['generate an image of a stormy sky', 'make me a picture of a red sports car, vertical', 'create an illustration of a mountain'],
      },
      uses: ['words', 'aspect', 'resolution'],
      target: 'none',
      risk: 'confirm',
      covers: ['ai.image', 'insertGeneration'],
    },
    {
      id: 'generate.video',
      needs: ['words'],
      label: 'Generate a clip',
      text: {
        what: 'Make a new video clip with AI from a description, and put it in the video.',
        examples: ['generate a 6 second clip of waves crashing', 'make a video of a city at night', 'animate this picture into a clip'],
      },
      uses: ['words', 'aspect', 'seconds', 'quality'],
      target: 'none',
      risk: 'confirm',
      covers: ['ai.video'],
    },
    {
      id: 'generate.voice',
      needs: ['words'],
      label: 'Generate a voice',
      text: {
        what: 'Say words aloud in a voice, and put the sound in the video.',
        notFor: 'Not captions, and not writing the words themselves.',
        examples: ['say welcome back in the deep voice', 'read this line out in the warm voice', 'make a voiceover saying follow for more'],
      },
      uses: ['words', 'voice'],
      target: 'none',
      risk: 'confirm',
      covers: ['ai.voice'],
    },
  ],
};
