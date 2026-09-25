/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Every intent, and what carries it out.
 *
 * Three kinds: the settings, whose edits the reader already worked out and
 * this only writes; the editor's own commands, run exactly as their key would;
 * and the rest, each with a function of its own.
 */

import { getSelection } from '@posterract/video-runtime';

import { getDocumentEditor } from '@/engine/editor';
import { COMMANDS } from '@/engine/input/shortcuts';

import { INTENT_BY_ID } from '../catalog';
import { ARRANGE_RUNS } from './arrange';
import { CAPTIONS_RUNS } from './captions';
import { CREATE_RUNS } from './create';
import { GENERATE_RUNS } from './generate';
import { MOTION_RUNS } from './motion';
import { PROJECT_RUNS } from './project';
import { SOUND_RUNS } from './sound';
import { STYLE_RUNS } from './style';
import { TIME_RUNS } from './time';
import { VIEW_RUNS } from './view';
import { applyCompiled } from './apply';
import { did, didNot, entitiesOf, whoOf } from './helpers';

import type { Outcome, Step } from '../types';
import type { RunFn } from './types';

// ---------------------------------------------------------------------------
// The settings: what the reading already worked out
// ---------------------------------------------------------------------------

/** What a setting's receipt says, when the plain "Label — the title" is not how a person would say it. */
const RECEIPTS: Record<string, (step: Step, who: string) => string> = {
  'style.color': (step, who) => `Made ${who || 'it'} ${text(step, 'color')}`,
  'style.opacity': (_step, who) => `Changed how see-through ${who || 'it'} is`,
  'style.blend': (step, who) => `${who || 'It'} blends: ${text(step, 'blend')}`,
  'style.corners': (_step, who) => `Rounded the corners of ${who || 'it'}`,
  'style.font': (step, who) => `${who || 'It'} in ${text(step, 'font')}`,
  'style.text-size': (_step, who) => `Changed the text size of ${who || 'it'}`,
  'style.bold': (step, who) => `${step.slots.bold?.kind === 'onoff' && step.slots.bold.on ? 'Bold' : 'Not bold'}: ${who || 'it'}`,
  'style.italic': (step, who) => `${step.slots.italic?.kind === 'onoff' && step.slots.italic.on ? 'Italic' : 'Upright'}: ${who || 'it'}`,
  'style.text-align': (step, who) => `${who || 'It'} aligned ${text(step, 'text_align')}`,
  'style.text-case': (step, who) => `${who || 'It'} in ${text(step, 'text_case')}`,
  'style.decoration': (step, who) => `${who || 'It'}: ${text(step, 'decoration')}`,
  'style.words': (_step, who) => `Changed the words of ${who || 'it'}`,
  'style.filter': (step, who) => `Added a ${text(step, 'effect_type')} filter to ${who || 'it'}`,
  'style.filter-remove': (_step, who) => `Took the filter off ${who || 'it'}`,
  'style.outline': (_step, who) => `Changed the outline of ${who || 'it'}`,
  'style.shadow': (_step, who) => `Changed the shadow of ${who || 'it'}`,
  'style.fit': (step, who) => `${who || 'It'} fits: ${text(step, 'fit')}`,
  'arrange.place': (step, who) => `Moved ${who || 'it'} → ${text(step, 'spot')}`,
  'arrange.move': (step, who) => `Moved ${who || 'it'} ${text(step, 'direction')}`,
  'arrange.position': (_step, who) => `Moved ${who || 'it'}`,
  'arrange.next-to': (step, who) => `Put ${who || 'it'} ${text(step, 'relation')}`,
  'arrange.size': (step, who) => `Made ${who || 'it'} ${text(step, 'size_dir') || 'a new size'}`,
  'arrange.fill-frame': (step, who) => `Sized ${who || 'it'}: ${text(step, 'fill_how')}`,
  'arrange.rotate': (_step, who) => `Turned ${who || 'it'}`,
  'arrange.rename': (step, who) => `Renamed ${who || 'it'} ${text(step, 'words')}`,
  'arrange.visibility': (step, who) => `${step.slots.hide?.kind === 'onoff' && step.slots.hide.on ? 'Hid' : 'Showed'} ${who || 'it'}`,
  'arrange.lock': (step, who) => `${step.slots.lock?.kind === 'onoff' && step.slots.lock.on ? 'Locked' : 'Unlocked'} ${who || 'it'}`,
  'arrange.keep-ratio': (_step, who) => `Proportions of ${who || 'it'}`,
  'arrange.inset': (_step, who) => `Moved ${who || 'it'} in from the edge`,
  'time.speed': (_step, who) => `Changed the speed of ${who || 'it'}`,
  'motion.add': (step, who) => `${text(step, 'anim_type') || 'Motion'} ${step.slots.anim_phase?.kind === 'choice' && step.slots.anim_phase.value === 'out' ? 'out' : 'in'}: ${who || 'it'}`,
  'motion.remove': (_step, who) => `Took the motion off ${who || 'it'}`,
  'motion.change': (_step, who) => `Changed the motion of ${who || 'it'}`,
  'motion.stagger': (_step, who) => `Staggered ${who || 'it'}`,
  'sound.volume': (_step, who) => `Changed the volume of ${who || 'it'}`,
  'sound.mute': (step, who) => `${step.slots.mute?.kind === 'onoff' && step.slots.mute.on ? 'Muted' : 'Unmuted'} ${who || 'it'}`,
  'sound.fade': (step, who) => `Fading ${who || 'it'} ${step.slots.anim_phase?.kind === 'choice' && step.slots.anim_phase.value === 'out' ? 'out' : 'in'}`,
  'captions.style': (step) => `Captions: ${text(step, 'preset')}`,
  'captions.position': (step) => `Captions at the ${text(step, 'position')}`,
};

/** Why a setting changed nothing, in the words a person would use. */
const NOTHING: Record<string, string> = {
  'arrange.visibility': 'it is already like that',
  'arrange.lock': 'it is already like that',
  'sound.mute': 'its sound is already like that',
  'style.color': 'it has no color of its own to change',
  'style.bold': 'it is not a text',
  'style.italic': 'it is not a text',
  'style.words': 'it is not a text',
  'style.font': 'it is not a text',
  'style.filter-remove': 'it has no filter to take off',
  'motion.remove': 'it has no entrance or exit to take off',
  'motion.change': 'it has no entrance or exit to change',
  'style.outline': 'it has no outline to change',
  'style.shadow': 'it has no shadow to change',
};

const text = (step: Step, slot: string): string => {
  const value = step.slots[slot];
  if (!value) return '';
  if (value.kind === 'choice') return value.value.replace(/-/g, ' ');
  if (value.kind === 'color') return value.word;
  if (value.kind === 'words') return `“${value.value}”`;
  return '';
};

/** The intents whose whole work is the props the reading worked out. */
const SETTINGS = [
  'arrange.place', 'arrange.move', 'arrange.position', 'arrange.next-to', 'arrange.size', 'arrange.fill-frame',
  'arrange.rotate', 'arrange.rename', 'arrange.visibility', 'arrange.lock', 'arrange.keep-ratio', 'arrange.inset',
  'style.color', 'style.opacity', 'style.blend', 'style.corners', 'style.font', 'style.text-size', 'style.bold',
  'style.italic', 'style.text-align', 'style.text-case', 'style.decoration', 'style.letter-spacing',
  'style.line-spacing', 'style.baseline', 'style.text-box', 'style.words', 'style.fit', 'style.filter',
  'style.filter-remove', 'style.outline', 'style.shadow',
  'motion.add', 'motion.remove', 'motion.change', 'motion.stagger',
  'sound.volume', 'sound.mute', 'sound.fade',
  'time.speed', 'captions.style', 'captions.position',
];

const settingRun = (id: string): RunFn => async (ctx, step) => {
  if (!step.edits?.length && !step.removals?.length && !step.subs?.length) {
    const intent = INTENT_BY_ID.get(id);
    const needs = intent && intent.target !== 'none' && !step.targets.length;
    if (needs) return didNot('nothing is selected', 'Say which element.');
    return didNot(NOTHING[id] ?? 'there was nothing to change', 'Say what to change, and how much.');
  }
  const changed = await applyCompiled(ctx, step);
  if (!changed) return didNot(NOTHING[id] ?? 'nothing changed');
  const who = whoOf(step, ctx.situation);
  const receipt = RECEIPTS[id]?.(step, who) ?? `${INTENT_BY_ID.get(id)?.label ?? id}${who ? ` — ${who}` : ''}`;
  return did(receipt, step.targets);
};

// ---------------------------------------------------------------------------
// The editor's own commands
// ---------------------------------------------------------------------------

/** What a command changed nothing means, in the words a person would use. */
const COMMAND_NOTHING: Record<string, { why: string; fix?: string }> = {
  'edit.delete': { why: 'nothing selected could be deleted' },
  'edit.ripple-delete': { why: 'nothing selected could be deleted' },
  'edit.duplicate': { why: 'nothing selected could be copied' },
  'edit.group': { why: 'the selection could not be grouped', fix: 'Select two or more elements.' },
  'edit.ungroup': { why: "the selection isn't a group" },
  'edit.wrap-scene': { why: 'the selection could not be put in a scene' },
  'edit.wrap-sequence': { why: 'the selection could not be put in a sequence' },
  'edit.unwrap-sequence': { why: "the selection isn't a sequence" },
  'edit.paste': { why: 'nothing has been copied', fix: 'Copy something first.' },
  'edit.cut': { why: 'nothing selected could be cut' },
  'edit.copy': { why: 'nothing selected could be copied' },
};

/** Runs one of the editor's own commands, on what the sentence named. */
export const runEditorCommand: (ctx: Parameters<RunFn>[0], step: Step, id: string) => Outcome = (ctx, step, id) => {
  const command = COMMANDS.find((entry) => entry.id === id);
  if (!command) return didNot(`"${id}" is not a command any more`);
  const { world } = ctx;
  if (step.targets.length) {
    const entities = entitiesOf(world, step);
    if (entities.length) getDocumentEditor(world).select(entities);
  }
  if (command.when === 'selection' && !getSelection(world).length) {
    return didNot('nothing is selected', 'Say which element first.');
  }
  const who = whoOf(step, ctx.situation) || (getSelection(world).length > 1 ? `${getSelection(world).length} elements` : '');
  command.action(world);
  const label = command.done ?? command.label.split(' — ')[0]!;
  const nothing = COMMAND_NOTHING[id];
  // Whether it really did anything is settled by the history, in `runReading`;
  // `ifNothing` is what the bar says when it turns out it did not.
  return {
    changed: true,
    receipt: `${label}${who ? ` ${who}` : ''}`,
    made: step.targets,
    ...(nothing ? { ifNothing: nothing } : {}),
  };
};

const commandRun = (id: string): RunFn => (ctx, step) => runEditorCommand(ctx, step, id);

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const RUNS_BY_ID: Record<string, RunFn> = {
  ...CREATE_RUNS,
  ...TIME_RUNS,
  ...ARRANGE_RUNS,
  ...STYLE_RUNS,
  ...MOTION_RUNS,
  ...SOUND_RUNS,
  ...CAPTIONS_RUNS,
  ...VIEW_RUNS,
  ...PROJECT_RUNS,
  ...GENERATE_RUNS,
};

for (const id of SETTINGS) {
  if (!RUNS_BY_ID[id]) RUNS_BY_ID[id] = settingRun(id);
}
for (const intent of INTENT_BY_ID.values()) {
  if (!RUNS_BY_ID[intent.id] && intent.command) RUNS_BY_ID[intent.id] = commandRun(intent.command);
}

export const RUNS: Record<string, RunFn> = RUNS_BY_ID;

/** Intents with nothing to carry them out yet: the coverage test keeps this empty. */
export const UNWIRED: string[] = [...INTENT_BY_ID.keys()].filter((id) => !RUNS[id]);
