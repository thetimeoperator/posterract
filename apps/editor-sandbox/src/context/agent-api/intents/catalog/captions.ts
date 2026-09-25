/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { VALUE_DESCRIPTIONS } from '../../command-descriptions';

import type { FamilyDef } from '../types';

export const CAPTIONS: FamilyDef = {
  id: 'captions',
  label: 'Captions',
  exclusive: true,
  ask:
    'Does the command ask about captions or subtitles — adding them to the video, their style, where they sit, their colors, '
    + 'editing the lines, fixing what one line says, or saving them as a subtitle file? '
    + 'For example "add captions", "make the captions yellow", "put the subtitles at the top", "export subtitles as SRT". '
    + 'Not an ordinary text element.',
  slots: {
    preset: { kind: 'choice', ask: 'Which caption style does the command ask for?', options: { ...VALUE_DESCRIPTIONS.preset! } },
    position: { kind: 'choice', ask: 'Where does the command ask the captions to sit?', options: { ...VALUE_DESCRIPTIONS.verticalAlign! } },
    color: { kind: 'color', ask: 'Which color does the command ask for?' },
    color_role: {
      kind: 'choice',
      ask: 'Which part of the captions does the color belong to?',
      options: {
        highlight: 'The word being said right now: the highlight, the accent, the color that follows the voice.',
        text: 'The words themselves, the main text color.',
      },
    },
    when: { kind: 'when', ask: 'Which caption line does the command mean — the one at which moment?' },
    words: { kind: 'words', text: 'what a caption line should say' },
    subtitle_format: {
      kind: 'choice',
      ask: 'Which subtitle file does the command ask for?',
      options: { srt: 'An SRT file, the usual subtitle format.', vtt: 'A WebVTT file, for the web.' },
    },
  },
  intents: [
    {
      id: 'captions.add',
      label: 'Add captions',
      text: {
        what: 'Add captions to the video, written from what is said in it: it listens to the sound and writes the lines.',
        notFor: 'Not adding a text element with words the command gives.',
        examples: ['add captions', 'caption this', 'put subtitles on the video', 'transcribe the video into captions'],
      },
      uses: ['preset', 'position'],
      target: 'optional',
      risk: 'confirm',
      covers: ['captionScene', 'captions', 'cue', 'media.transcribe'],
    },
    {
      id: 'captions.style',
      needs: ['preset'],
      label: 'Caption style',
      text: {
        what: 'Switch the captions to another style: classic, pop, karaoke, typewriter, banner and the rest.',
        examples: ['use the pop caption style', 'switch the captions to karaoke', 'make the captions look like a typewriter'],
      },
      uses: ['preset'],
      target: 'optional',
      tags: ['captions'],
      covers: ['preset'],
    },
    {
      id: 'captions.position',
      needs: ['position'],
      label: 'Caption position',
      text: {
        what: 'Put the captions at the top, in the middle, or at the bottom of the frame.',
        examples: ['put the captions at the top', 'move the subtitles to the middle', 'captions at the bottom'],
      },
      uses: ['position'],
      target: 'optional',
      tags: ['captions'],
      covers: ['verticalAlign'],
    },
    {
      id: 'captions.colors',
      needs: ['color'],
      label: 'Caption colors',
      text: {
        what: 'Change the colors of the captions: the words themselves, or the color that follows the voice.',
        examples: ['make the captions yellow', 'highlight the spoken word in green', 'change the caption accent to red'],
      },
      uses: ['color', 'color_role'],
      target: 'optional',
      tags: ['captions'],
      covers: ['colors'],
    },
    {
      id: 'captions.unpack',
      label: 'Edit the captions',
      text: {
        what: 'Turn the captions into lines that can be edited one by one.',
        examples: ['let me edit the captions', 'unpack the captions into lines', 'open the caption lines'],
      },
      target: 'optional',
      tags: ['captions'],
      covers: ['unpackCues'],
    },
    {
      id: 'captions.fix',
      needs: ['words'],
      label: 'Fix a caption',
      text: {
        what: 'Change what one caption line says.',
        examples: ['change the caption at 5 seconds to say hello there', 'fix this caption to read follow for more', 'the caption here should say storm warning'],
      },
      uses: ['when', 'words'],
      target: 'optional',
      tags: ['captions'],
      covers: ['cue.text'],
    },
    {
      id: 'captions.export',
      needs: ['subtitle_format'],
      label: 'Export subtitles',
      text: {
        what: 'Save the captions as a subtitle file.',
        examples: ['export subtitles as SRT', 'save the captions as a vtt file', 'download the subtitles'],
      },
      uses: ['subtitle_format'],
      target: 'optional',
      tags: ['captions'],
      covers: ['exportSubtitles'],
    },
  ],
};
