/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The project: undo, export, versions, the name, the library, variables, skills, generating. */

import { getActiveEntity } from '@posterract/video-runtime';

import { getDocumentEditor } from '@/engine/editor';
import { getEditHistory } from '@/engine/history';
import { installSkill } from '@/engine/skill-deck';
import { findSkill } from '@/lib/skills';

import { EXPORT_PRESETS } from '../catalog/project';
import { choiceOf, did, didNot, numberOf, wordsOf } from './helpers';

import type { RunFn } from './types';

const countOf = (value: Parameters<typeof numberOf>[0]): number => Math.min(20, Math.max(1, Math.round(numberOf(value)?.value ?? 1)));

export const PROJECT_RUNS: Record<string, RunFn> = {
  'project.undo': (ctx, step) => {
    const history = getEditHistory(ctx.world);
    if (!history.canUndo()) return didNot('there is nothing to undo');
    let times = 0;
    for (let index = 0; index < countOf(step.slots.count); index += 1) {
      if (!history.canUndo()) break;
      history.undo();
      times += 1;
    }
    return did(times > 1 ? `Undone ${times} changes` : 'Undone');
  },

  'project.redo': (ctx, step) => {
    const history = getEditHistory(ctx.world);
    if (!history.canRedo()) return didNot('there is nothing to redo');
    let times = 0;
    for (let index = 0; index < countOf(step.slots.count); index += 1) {
      if (!history.canRedo()) break;
      history.redo();
      times += 1;
    }
    return did(times > 1 ? `Redone ${times} changes` : 'Redone');
  },

  'project.export': async (ctx, step) => {
    if (!ctx.ui.exportVideo) return didNot('exporting is not available here');
    if (!getActiveEntity(ctx.world)) return didNot('no video is open', 'Open a scene first.');
    const preset = choiceOf(step.slots.export_preset);
    const resolution = choiceOf(step.slots.resolution);
    const format = choiceOf(step.slots.format);
    const frameRate = numberOf(step.slots.frame_rate)?.value;
    await ctx.ui.exportVideo({
      ...(preset && EXPORT_PRESETS[preset] ? { template: EXPORT_PRESETS[preset]!.template } : {}),
      ...(resolution ? { resolution: Number(resolution) } : {}),
      ...(format ? { format } : {}),
      ...(frameRate ? { frameRate } : {}),
    });
    const said = [preset, resolution ? `${resolution}p` : null, format, frameRate ? `${frameRate} fps` : null].filter(Boolean).join(', ');
    return did(`Exporting${said ? ` — ${said}` : ''}`);
  },

  'project.export-frame': async (ctx) => {
    if (!ctx.ui.exportFrame) return didNot('saving a frame is not available here');
    if (!getActiveEntity(ctx.world)) return didNot('no video is open');
    await ctx.ui.exportFrame();
    return did('Saved this frame');
  },

  'project.export-settings': (ctx) => {
    if (!ctx.ui.openExportSettings) return didNot('the export settings are not available here');
    ctx.ui.openExportSettings();
    return did('Export settings');
  },

  'project.exports-library': (ctx) => {
    if (!ctx.ui.openExports) return didNot('the exports library is not available here');
    ctx.ui.openExports();
    return did('Your exports');
  },

  'project.history': (ctx) => {
    if (!ctx.ui.openHistory) return didNot('the version history is not available here');
    ctx.ui.openHistory();
    return did('Version history');
  },

  'project.restore': async (ctx) => {
    if (!ctx.ui.restoreLatest) return didNot('restoring a version is not available here');
    const restored = await ctx.ui.restoreLatest();
    if (!restored) return didNot('there is no saved version to go back to');
    return did(`Restored the version from ${restored}`);
  },

  'project.rename': async (ctx, step) => {
    const name = wordsOf(step.slots.words);
    if (!name) return didNot('the command gave no new name', 'Say "rename the project to …".');
    if (!ctx.ui.renameProject) return didNot('renaming is not available here');
    await ctx.ui.renameProject(name);
    return did(`Project renamed “${name}”`);
  },

  'project.import': async (ctx) => {
    if (!ctx.ui.importFiles) return didNot('importing is not available here');
    const count = await ctx.ui.importFiles();
    if (!count) return didNot('no files were picked');
    return did(`Imported ${count} file${count === 1 ? '' : 's'}`);
  },

  'project.asset-rename': async (ctx, step) => {
    const path = step.slots.asset?.kind === 'asset' ? step.slots.asset.path : null;
    const name = wordsOf(step.slots.words);
    if (!path) return didNot('the command named no file in the library');
    if (!name) return didNot('the command gave no new name');
    if (!ctx.ui.renameAsset) return didNot('renaming a file is not available here');
    await ctx.ui.renameAsset(path, name);
    return did(`Renamed to “${name}”`);
  },

  'project.asset-delete': async (ctx, step) => {
    const path = step.slots.asset?.kind === 'asset' ? step.slots.asset.path : null;
    if (!path) return didNot('the command named no file in the library');
    if (!ctx.ui.deleteAsset) return didNot('deleting a file is not available here');
    await ctx.ui.deleteAsset(path);
    return did(`Deleted ${path.split('/').pop()} from the library`);
  },

  'project.variable': (ctx, step) => {
    const key = step.slots.variable?.kind === 'variable' ? step.slots.variable.key : null;
    if (!key) return didNot('the command named no project variable', 'Say which one, such as the headline.');
    const [file, name] = key.split('#');
    if (!file || !name) return didNot('that variable could not be found');
    const variable = ctx.situation.variables.find((entry) => entry.key === key);
    const words = wordsOf(step.slots.words);
    const color = step.slots.color?.kind === 'color' ? step.slots.color.hex : null;
    const number = numberOf(step.slots.value)?.value;
    const value = variable?.type === 'color' ? (color ?? words) : variable?.type === 'number' ? number : (words ?? color ?? number);
    if (value === undefined || value === null) return didNot('the command gave no value for it', 'Say what to set it to.');
    getDocumentEditor(ctx.world).editVariable(file, name, value as never);
    return did(`${variable?.name ?? name} → ${String(value)}`);
  },

  'project.skill': (ctx, step) => {
    const name = choiceOf(step.slots.skill);
    if (!name) return didNot('the command named no kind of video');
    const scene = getActiveEntity(ctx.world);
    if (!scene) return didNot('no video is open');
    const card = findSkill(name);
    if (!card) return didNot('that kind of video is not installed', 'Open the Skill Deck to add it.');
    installSkill(ctx.world, scene, card);
    return did(`This scene is a ${name}`);
  },

  'project.agent': (ctx) => {
    if (!ctx.ui.openAgent) return didNot('that is not available here');
    ctx.ui.openAgent();
    return did('Opening in your agent');
  },

  'project.generate-panel': (ctx) => {
    if (!ctx.ui.openGenerate) return didNot('the generate panel is not available here');
    ctx.ui.openGenerate();
    return did('AI Generate');
  },
};
