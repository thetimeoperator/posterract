/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The whole catalog: the ten areas, and what can be said in each. */

import { ARRANGE } from './arrange';
import { CAPTIONS } from './captions';
import { CREATE } from './create';
import { GENERATE } from './generate';
import { MOTION } from './motion';
import { PROJECT } from './project';
import { SOUND } from './sound';
import { STYLE } from './style';
import { TIME } from './time';
import { VIEW } from './view';

import type { Family, FamilyDef, IntentDef, SlotValue } from '../types';

export const FAMILIES: FamilyDef[] = [CREATE, TIME, ARRANGE, STYLE, MOTION, SOUND, CAPTIONS, VIEW, PROJECT, GENERATE];

export const FAMILY_BY_ID = new Map<Family, FamilyDef>(FAMILIES.map((family) => [family.id, family]));

export const INTENTS: IntentDef[] = FAMILIES.flatMap((family) => family.intents);

export const INTENT_BY_ID = new Map<string, IntentDef>(INTENTS.map((intent) => [intent.id, intent]));

export const familyOf = (intent: string): Family => intent.split('.')[0] as Family;

/** The order intents run in: what a sentence sets up first, then what it makes, then what it changes. */
const ORDER: Family[] = ['view', 'time', 'create', 'arrange', 'style', 'motion', 'sound', 'captions', 'project', 'generate'];

/** Where an intent comes in the run: moving the playhead and picking a scene come before anything is made. */
export function runOrder(intent: string): number {
  if (intent === 'time.go-to' || intent === 'time.skip' || intent === 'time.cut-jump' || intent === 'view.scene' || intent === 'view.select') return -1;
  if (intent === 'project.export' || intent === 'project.export-frame') return ORDER.length + 1;
  return ORDER.indexOf(familyOf(intent));
}

/**
 * Intents that are two readings of one wish. A sentence lands on both often
 * enough that the reading keeps only the surer of them ("take the clip out and
 * close the hole" is a ripple delete, not a delete and a ripple delete).
 */
const SAME_THING: string[][] = [
  // The most particular reading first: it wins a close call, because the words
  // that made it fire ("close the hole") are the ones with nowhere else to go.
  ['arrange.ripple-delete', 'arrange.cut', 'arrange.delete'],
  ['arrange.next-to', 'arrange.align', 'arrange.place', 'arrange.position', 'arrange.move'],
  ['arrange.size', 'arrange.fill-frame', 'style.text-size'],
  ['arrange.duplicate', 'arrange.copy'],
  ['arrange.cut', 'arrange.copy'],
  ['arrange.ungroup', 'arrange.unwrap-sequence'],
  ['arrange.group', 'arrange.wrap-sequence', 'arrange.wrap-scene'],
  ['arrange.visibility', 'view.panel'],
  ['arrange.rename', 'style.words', 'project.rename'],
  ['style.words', 'captions.fix'],
  ['style.color', 'style.gradient', 'captions.colors', 'style.background', 'project.variable'],
  ['style.filter', 'style.filter-remove'],
  ['sound.volume', 'sound.mute'],
  ['motion.add', 'motion.change', 'motion.remove', 'time.transition'],
  ['motion.keyframe-add', 'motion.keyframe-remove', 'motion.bake'],
  ['time.move-to', 'time.shift', 'time.go-to'],
  ['time.trim-start', 'time.trim-end', 'time.set-length'],
  ['time.play', 'time.pause'],
  ['create.shape', 'generate.image', 'create.text'],
  ['arrange.change-shape', 'create.shape'],
  ['arrange.replace-media', 'style.fill-media', 'create.from-asset'],
  ['create.scene-from-asset', 'arrange.wrap-scene', 'create.scene'],
  ['generate.video', 'create.from-asset'],
  ['generate.voice', 'create.text'],
  ['create.mask', 'style.corners'],
  ['create.adjustment-layer', 'style.filter'],
  ['captions.add', 'create.text'],
  ['view.scene', 'time.go-to'],
  ['view.theme', 'style.opacity'],
  ['view.tool', 'create.shape'],
  ['view.zoom', 'arrange.size'],
  ['project.variable', 'style.words', 'create.text'],
  ['project.import', 'create.from-asset'],
  ['sound.duck', 'sound.volume', 'arrange.layer'],
  ['captions.position', 'arrange.place', 'arrange.align'],
  ['captions.colors', 'style.color'],
  ['style.text-align', 'arrange.align'],
  ['motion.keyframe-easing', 'motion.change'],
  ['motion.bake', 'motion.keyframe-add'],
  ['time.range', 'time.mark-in', 'time.mark-out', 'time.trim-end'],
  ['view.zoom', 'view.timeline-zoom'],
  ['project.export', 'project.export-frame', 'captions.export'],
];

/** The intents that say the same thing as `intent`. */
export const sameThingAs = (intent: string): string[] =>
  SAME_THING.filter((group) => group.includes(intent)).flatMap((group) => group.filter((other) => other !== intent));

/** How particular a reading is among the ones that say the same thing: 0 is the most particular. */
export function howParticular(intent: string): number {
  for (const group of SAME_THING) {
    const at = group.indexOf(intent);
    if (at !== -1) return at;
  }
  return 0;
}


/**
 * What a new element is given when it is made: an intent that only repeats one
 * of these is already done by the adding.
 */
export const CREATE_CARRIES: Record<string, string> = {
  'arrange.place': 'spot',
  'arrange.size': 'size',
  'arrange.fill-frame': 'size',
  'style.color': 'color',
  'style.text-size': 'size',
  'style.words': 'words',
  'arrange.rename': 'words',
  'captions.style': 'preset',
  'captions.position': 'position',
};

/**
 * Sentences that are one intent with its value already in them, matched word
 * for word before anything is asked: the editor's own toggles ("hide", "play",
 * "snapping off") would otherwise flip whatever they found, and a person who
 * says "hide" never means "show".
 */
export const EXACT_INTENTS: Array<{ says: string[]; intent: string; slots: Record<string, SlotValue>; label: string }> = [
  { says: ['play', 'play it', 'play the video', 'resume', 'keep playing'], intent: 'time.play', slots: {}, label: 'Play' },
  { says: ['pause', 'stop', 'pause it', 'stop playing', 'hold it'], intent: 'time.pause', slots: {}, label: 'Pause' },
  { says: ['hide', 'hide this', 'hide it', 'hide them'], intent: 'arrange.visibility', slots: { hide: { kind: 'onoff', on: true } }, label: 'Hide' },
  { says: ['show', 'show this', 'show it', 'unhide', 'unhide it'], intent: 'arrange.visibility', slots: { hide: { kind: 'onoff', on: false } }, label: 'Show' },
  { says: ['mute', 'mute it', 'mute this', 'sound off'], intent: 'sound.mute', slots: { mute: { kind: 'onoff', on: true } }, label: 'Mute' },
  { says: ['unmute', 'unmute it', 'sound on'], intent: 'sound.mute', slots: { mute: { kind: 'onoff', on: false } }, label: 'Unmute' },
  { says: ['lock', 'lock it', 'lock this'], intent: 'arrange.lock', slots: { lock: { kind: 'onoff', on: true } }, label: 'Lock' },
  { says: ['unlock', 'unlock it', 'unlock this'], intent: 'arrange.lock', slots: { lock: { kind: 'onoff', on: false } }, label: 'Unlock' },
  { says: ['snapping off', 'turn snapping off', 'no snapping'], intent: 'view.snapping', slots: { snapping: { kind: 'onoff', on: false } }, label: 'Snapping off' },
  { says: ['snapping on', 'turn snapping on'], intent: 'view.snapping', slots: { snapping: { kind: 'onoff', on: true } }, label: 'Snapping on' },
  { says: ['noir', 'switch to noir', 'dark look'], intent: 'view.theme', slots: { theme: { kind: 'choice', value: 'noir' } }, label: 'Noir' },
  { says: ['glass', 'switch to glass', 'frost'], intent: 'view.theme', slots: { theme: { kind: 'choice', value: 'frost' } }, label: 'Glass' },
  {
    says: ['show the assets', 'show assets', 'open the assets'],
    intent: 'view.panel',
    slots: { panel: { kind: 'choice', value: 'assets' }, panel_show: { kind: 'onoff', on: true } },
    label: 'Show the assets',
  },
  {
    says: ['hide the assets', 'hide assets', 'close the assets', 'collapse the assets'],
    intent: 'view.panel',
    slots: { panel: { kind: 'choice', value: 'assets' }, panel_show: { kind: 'onoff', on: false } },
    label: 'Hide the assets',
  },
  {
    says: ['show the inspector', 'open the inspector'],
    intent: 'view.panel',
    slots: { panel: { kind: 'choice', value: 'inspector' }, panel_show: { kind: 'onoff', on: true } },
    label: 'Show the inspector',
  },
  {
    says: ['hide the inspector', 'close the inspector'],
    intent: 'view.panel',
    slots: { panel: { kind: 'choice', value: 'inspector' }, panel_show: { kind: 'onoff', on: false } },
    label: 'Hide the inspector',
  },
  {
    says: ['show the timeline', 'expand the timeline', 'open the timeline'],
    intent: 'view.panel',
    slots: { panel: { kind: 'choice', value: 'timeline' }, panel_show: { kind: 'onoff', on: true } },
    label: 'Show the timeline',
  },
  {
    says: ['hide the timeline', 'collapse the timeline', 'close the timeline'],
    intent: 'view.panel',
    slots: { panel: { kind: 'choice', value: 'timeline' }, panel_show: { kind: 'onoff', on: false } },
    label: 'Hide the timeline',
  },
  {
    says: ['hide the interface', 'hide the ui', 'clean view', 'just the video'],
    intent: 'view.panel',
    slots: { panel: { kind: 'choice', value: 'interface' }, panel_show: { kind: 'onoff', on: false } },
    label: 'Hide the interface',
  },
  {
    says: ['show the interface', 'show the ui', 'bring the panels back'],
    intent: 'view.panel',
    slots: { panel: { kind: 'choice', value: 'interface' }, panel_show: { kind: 'onoff', on: true } },
    label: 'Show the interface',
  },
  {
    says: ['what can you do', 'what can i say', 'help', 'what commands are there', 'what can this do', 'how do i use this'],
    intent: 'view.help',
    slots: {},
    label: 'What you can say',
  },
];

const tidy = (text: string): string => text.trim().toLowerCase().replace(/[.!?,;:]+$/g, '').replace(/\s+/g, ' ');

/** The intent a sentence says word for word, with the value it names; null when it is not one of them. */
export function exactIntent(said: string): (typeof EXACT_INTENTS)[number] | null {
  const words = tidy(said);
  return EXACT_INTENTS.find((entry) => entry.says.includes(words)) ?? null;
}

/** Every command id the catalog carries out, whether as an intent of its own or inside one. */
export const COVERED_COMMANDS = new Set<string>(
  INTENTS.flatMap((intent) => [...(intent.command ? [intent.command] : []), ...(intent.covers ?? [])]).filter((id) => /^[a-z]+\.[a-z-]+$/.test(id)),
);
