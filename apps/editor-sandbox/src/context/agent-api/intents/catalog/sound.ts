/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { VALUE_DESCRIPTIONS } from '../../command-descriptions';
import { AMOUNT } from './shared';

import type { FamilyDef } from '../types';

export const SOUND: FamilyDef = {
  id: 'sound',
  label: 'Sound',
  exclusive: false,
  ask:
    'Does the command ask about sound — how loud something is, muting or unmuting it, fading a sound in or out, '
    + 'lowering the music while someone speaks, or the volume of the whole scene? '
    + 'For example "turn the music down", "mute the clip", "fade the song out", "duck the music under the voice". '
    + 'Not adding a sound file (that is adding something), and not captions.',
  slots: {
    volume: { kind: 'number', text: 'How loud, in decibels or as a percentage (100 percent is unchanged).', units: ['db', '%', 'x'] },
    loudness: {
      kind: 'choice',
      ask: 'Does the command ask for it to be louder or quieter?',
      options: { louder: 'Louder, turn it up.', quieter: 'Quieter, turn it down, softer.' },
    },
    amount: AMOUNT,
    mute: { kind: 'onoff', ask: 'Does the command ask to turn the sound off (yes), rather than back on (no)?', yes: 'Mute', no: 'Unmute' },
    anim_phase: { kind: 'choice', ask: 'Does the command ask for the sound to fade up as it starts, or down as it ends?', options: { ...VALUE_DESCRIPTIONS.animationPhase! } },
    duration: { kind: 'number', text: 'How long the fade takes, in seconds.', units: ['s', 'frames'] },
    under: { kind: 'element', ask: 'Which sound plays over it — the voice or clip it should make way for?' },
    whole_scene: {
      kind: 'onoff',
      ask: 'Does the command ask about the sound of the whole scene or video (yes), rather than one element (no)?',
      yes: 'The whole scene',
      no: 'One element',
    },
  },
  intents: [
    {
      id: 'sound.volume',
      needs: ['volume', 'loudness'],
      label: 'Volume',
      text: {
        what: 'Change how loud an element is: louder, quieter, half volume, or a value in decibels or percent.',
        notFor: 'Not muting it altogether, and not how fast it plays.',
        examples: ['turn the music down', 'louder', 'set the volume to 50 percent', 'half volume', 'minus 6 decibels'],
      },
      uses: ['volume', 'loudness', 'amount', 'whole_scene'],
      target: 'many',
      covers: ['volume'],
    },
    {
      id: 'sound.mute',
      needs: ['mute'],
      label: 'Mute',
      text: {
        what: 'Turn an element\'s sound off, or back on.',
        examples: ['mute the video', 'unmute the music', 'turn the sound off on this clip', 'sound back on'],
      },
      uses: ['mute'],
      target: 'many',
      covers: ['muted'],
    },
    {
      id: 'sound.fade',
      label: 'Fade the sound',
      text: {
        what: 'Fade a sound up as it starts, or down as it ends.',
        notFor: 'Not fading a picture in or out on screen.',
        examples: ['fade the music out', 'fade in the audio over 2 seconds', 'let the song fade away at the end'],
      },
      uses: ['anim_phase', 'duration'],
      target: 'many',
      covers: ['animation.gain'],
    },
    {
      id: 'sound.duck',
      needs: ['under'],
      label: 'Duck',
      text: {
        what: 'Lower one sound whenever another plays — music under a voice — and let it come back up after.',
        examples: ['lower the music when he talks', 'duck the song under the voiceover', 'keep the music under the narration'],
      },
      uses: ['under', 'volume', 'amount'],
      target: 'one',
      covers: ['duck', 'target', 'by', 'attack', 'release', 'amount'],
    },
  ],
};
