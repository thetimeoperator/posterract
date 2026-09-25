/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The timeline: splitting, trimming, moving in time, speed, transitions, the playhead, markers. */

import { Computed, Playback, Selected, Workarea, setPlayhead, store, togglePlayback } from '@posterract/video-runtime';

import { getDocumentEditor } from '@/engine/editor';
import { splitAtPlayhead } from '@/engine/split';
import { authoredTime, editTime, editWorkarea, moveEntityTo, slideEntity, slipEntity, trimIn, trimOut } from '@/engine/timing';
import { clearInOut, seekToCut, setInPoint, setOutPoint } from '@/engine/transport';

import { TRANSITION_OPTIONS } from '../catalog/time';
import { timecode } from '../words';
import {
  addressOf, amountOf, choiceOf, did, didNot, entitiesOf, findAddressed, frameRateOf, framesFromSlot, framesOf,
  numberOf, playheadOf, sceneOf, secondsOfSlot, whoOf,
} from './helpers';

import type { Entity } from 'koota';
import type { RunFn } from './types';

const NO_VIDEO = ['no video is open', 'Open a project first.'] as const;

/** Where in time a step means, in scene frames: what it said, or the playhead. */
function whenFrames(ctx: Parameters<RunFn>[0], step: Parameters<RunFn>[1]): number {
  const seconds = secondsOfSlot(step.slots.when);
  return framesOf(ctx.world, seconds ?? playheadOf(ctx.world));
}

/** How far a step moves something, in frames; a step of time when it gives no number. */
function byFrames(ctx: Parameters<RunFn>[0], step: Parameters<RunFn>[1]): number {
  const given = framesFromSlot(ctx.world, step.slots.by);
  if (given !== null) return Math.abs(given);
  const fps = frameRateOf(ctx.world);
  return Math.round([0.25, 0.5, 1][amountOf(step.slots.amount)]! * fps);
}

const laterOf = (step: Parameters<RunFn>[1]): boolean => choiceOf(step.slots.direction) !== 'earlier';

export const TIME_RUNS: Record<string, RunFn> = {
  'time.split': (ctx, step) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot(...NO_VIDEO);
    const frame = whenFrames(ctx, step);
    setPlayhead(world, scene, frame);
    // A named element is what the cut is about; otherwise the selection, or
    // every clip under that moment.
    const editor = getDocumentEditor(world);
    const named = step.targetHow === 'named' || step.targetHow === 'all' ? entitiesOf(world, step) : [];
    if (named.length) editor.select(named);
    const halves = splitAtPlayhead(world, frame);
    if (!halves.length) {
      return didNot(
        "the playhead isn't over a clip",
        'Move it onto a clip, or say "split at 5 seconds".',
      );
    }
    const made = halves.map(addressOf).filter((id): id is string => id !== null);
    return did(`Split at ${timecode(frame / frameRateOf(world))}`, made);
  },

  'time.trim-start': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected to trim', 'Say which clip to trim.');
    const computed = store(world, Computed);
    const by = step.slots.by ? byFrames(ctx, step) : null;
    let changed = false;
    for (const entity of entities) {
      const start = computed.start[entity.id()] ?? 0;
      const frame = by !== null ? start + by : whenFrames(ctx, step);
      const end = computed.end[entity.id()] ?? 0;
      if (frame <= start || frame >= end) continue;
      trimIn(world, entity, Math.round(frame));
      changed = true;
    }
    if (!changed) return didNot('that moment is not inside the clip', 'Say a time inside it.');
    return did(`Trimmed the start of ${whoOf(step, ctx.situation) || 'the clip'}`);
  },

  'time.trim-end': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected to trim', 'Say which clip to trim.');
    const computed = store(world, Computed);
    const by = step.slots.by ? byFrames(ctx, step) : null;
    let changed = false;
    for (const entity of entities) {
      const start = computed.start[entity.id()] ?? 0;
      const end = computed.end[entity.id()] ?? 0;
      const frame = by !== null ? end - by : whenFrames(ctx, step);
      if (frame <= start || frame >= end) continue;
      trimOut(world, entity, Math.round(frame));
      changed = true;
    }
    if (!changed) return didNot('that moment is not inside the clip', 'Say a time inside it.');
    return did(`Trimmed the end of ${whoOf(step, ctx.situation) || 'the clip'}`);
  },

  'time.set-length': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected', 'Say which element.');
    const length = framesFromSlot(world, step.slots.length);
    if (length === null || length <= 0) return didNot('the command gave no length', 'Say how long, in seconds.');
    const computed = store(world, Computed);
    for (const entity of entities) {
      const start = computed.start[entity.id()] ?? 0;
      trimOut(world, entity, Math.round(start + length));
    }
    return did(`${whoOf(step, ctx.situation) || 'It'} lasts ${Math.round((length / frameRateOf(world)) * 10) / 10} s`);
  },

  'time.move-to': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected to move', 'Say which element.');
    const frame = whenFrames(ctx, step);
    for (const entity of entities) moveEntityTo(world, entity, frame);
    return did(`Moved ${whoOf(step, ctx.situation) || 'it'} to ${timecode(frame / frameRateOf(world))}`);
  },

  'time.shift': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected to move', 'Say which element.');
    const computed = store(world, Computed);
    const delta = byFrames(ctx, step) * (laterOf(step) ? 1 : -1);
    let changed = false;
    for (const entity of entities) {
      const start = computed.start[entity.id()] ?? 0;
      const next = Math.max(0, start + delta);
      if (Math.round(next) === Math.round(start)) continue;
      moveEntityTo(world, entity, Math.round(next));
      changed = true;
    }
    if (!changed) return didNot("it didn't move — it is already at the start");
    const seconds = Math.round((Math.abs(delta) / frameRateOf(world)) * 100) / 100;
    return did(`Moved ${whoOf(step, ctx.situation) || 'it'} ${seconds} s ${laterOf(step) ? 'later' : 'earlier'}`);
  },

  'time.fill': (ctx, step) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    const entities = entitiesOf(world, step);
    if (!scene) return didNot(...NO_VIDEO);
    if (!entities.length) return didNot('nothing is selected', 'Say which element.');
    const computed = store(world, Computed);
    const end = computed.end[scene.id()] ?? 0;
    const sceneStart = computed.start[scene.id()] ?? 0;
    for (const entity of entities) {
      editTime(world, entity, 'start', 0);
      editTime(world, entity, 'end', Math.round(end - sceneStart));
    }
    return did(`${whoOf(step, ctx.situation) || 'It'} lasts the whole video`);
  },

  'time.slip': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected to slip');
    const frames = byFrames(ctx, step) * (laterOf(step) ? 1 : -1);
    const before = entities.map((entity) => authoredTime(world, entity, 'sourceIn') ?? 0);
    for (const entity of entities) slipEntity(world, entity, frames);
    const after = entities.map((entity) => authoredTime(world, entity, 'sourceIn') ?? 0);
    if (before.every((value, index) => value === after[index])) {
      return didNot('there is no more footage to slip into', 'Try the other direction, or a smaller amount.');
    }
    return did(`Slipped ${whoOf(step, ctx.situation) || 'the clip'}`);
  },

  'time.slide': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected to slide');
    const computed = store(world, Computed);
    const frames = byFrames(ctx, step) * (laterOf(step) ? 1 : -1);
    const before = entities.map((entity) => computed.start[entity.id()] ?? 0);
    for (const entity of entities) slideEntity(world, entity, frames);
    const after = entities.map((entity) => computed.start[entity.id()] ?? 0);
    if (before.every((value, index) => value === after[index])) {
      return didNot('its neighbours leave it no room', 'Try a smaller amount.');
    }
    return did(`Slid ${whoOf(step, ctx.situation) || 'the clip'}`);
  },

  'time.transition': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected', 'Say which clip.');
    const type = choiceOf(step.slots.transition_type) ?? 'dissolve';
    const seconds = secondsOfSlot(step.slots.length) ?? numberOf(step.slots.length)?.value ?? 1;
    const editor = getDocumentEditor(world);
    let changed = false;
    for (const entity of entities) {
      const element = ctx.situation.elements.find((entry) => entry.id === (addressOf(entity) ?? ''));
      if (element && !element.inSequence) {
        return didNot(
          "it isn't in a sequence, so there is nothing to blend into",
          'Say "put these in a sequence" first.',
        );
      }
      editor.editProperty(entity, 'transition', type === 'remove' ? false : ({ type, duration: seconds } as never));
      changed = true;
    }
    if (!changed) return didNot('the transition could not be set');
    return did(type === 'remove' ? 'Removed the transition' : `${TRANSITION_OPTIONS[type]?.split(':')[0] ?? type} into the next clip`);
  },

  'time.go-to': (ctx, step) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot(...NO_VIDEO);
    const seconds = secondsOfSlot(step.slots.when);
    if (seconds === null) return didNot('the command gave no moment', 'Say a time, "the start", or a marker.');
    const was = playheadOf(world);
    setPlayhead(world, scene, framesOf(world, Math.max(0, seconds)));
    if (Math.abs(was - seconds) < 0.001) return didNot(`the playhead is already at ${timecode(seconds)}`);
    return did(`At ${timecode(seconds)}`);
  },

  'time.skip': (ctx, step) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot(...NO_VIDEO);
    const frames = byFrames(ctx, step) * (laterOf(step) ? 1 : -1);
    const now = store(world, Computed).localTime[scene.id()] ?? 0;
    const next = Math.max(0, now + frames);
    setPlayhead(world, scene, Math.round(next));
    if (Math.round(next) === Math.round(now)) return didNot('the playhead is already at the start');
    return did(`At ${timecode(next / frameRateOf(world))}`);
  },

  'time.cut-jump': (ctx, step) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot(...NO_VIDEO);
    const was = playheadOf(world);
    seekToCut(laterOf(step) ? 1 : -1)(world);
    const now = playheadOf(world);
    if (Math.abs(now - was) < 0.001) return didNot(`there is no ${laterOf(step) ? 'next' : 'previous'} cut`);
    return did(`At the ${laterOf(step) ? 'next' : 'previous'} cut, ${timecode(now)}`);
  },

  'time.play': (ctx) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot(...NO_VIDEO);
    if (scene.get(Playback)?.playing) return didNot('it is already playing');
    togglePlayback(world, scene);
    return did('Playing');
  },

  'time.pause': (ctx) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot(...NO_VIDEO);
    if (!scene.get(Playback)?.playing) return didNot('it is already paused');
    togglePlayback(world, scene);
    return did('Paused');
  },

  'time.range': (ctx, step) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot(...NO_VIDEO);
    const from = framesFromSlot(world, step.slots.from);
    const to = framesFromSlot(world, step.slots.to);
    if (from === null || to === null || to <= from) {
      return didNot('the command gave no range', 'Say it as "from 2 to 8 seconds".');
    }
    editWorkarea(world, scene, [Math.round(from), Math.round(to)]);
    const fps = frameRateOf(world);
    return did(`Exporting ${timecode(from / fps)}–${timecode(to / fps)}`);
  },

  'time.mark-in': (ctx, step) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot(...NO_VIDEO);
    const seconds = secondsOfSlot(step.slots.when);
    if (seconds !== null) setPlayhead(world, scene, framesOf(world, seconds));
    const was = scene.get(Workarea)?.start;
    setInPoint(world);
    if (scene.get(Workarea)?.start === was) return didNot('the in point is already there');
    return did(`Marked in at ${timecode(seconds ?? playheadOf(world))}`);
  },

  'time.mark-out': (ctx, step) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot(...NO_VIDEO);
    const seconds = secondsOfSlot(step.slots.when);
    if (seconds !== null) setPlayhead(world, scene, framesOf(world, seconds));
    const was = scene.get(Workarea)?.end;
    setOutPoint(world);
    if (scene.get(Workarea)?.end === was) return didNot('the out point is already there');
    return did(`Marked out at ${timecode(seconds ?? playheadOf(world))}`);
  },

  'time.range-clear': (ctx) => {
    const { world } = ctx;
    const scene = sceneOf(world);
    if (!scene) return didNot(...NO_VIDEO);
    const workarea = scene.get(Workarea);
    if (!workarea || workarea.end <= workarea.start) return didNot('no range is marked');
    clearInOut(world);
    return did('Cleared the range');
  },

  'time.marker-remove': (ctx, step) => {
    const { world } = ctx;
    const marker = markerOf(ctx, step);
    if (!marker) return didNot('the command named no marker', 'Say which marker.');
    getDocumentEditor(world).remove(marker);
    return did('Removed the marker');
  },

  'time.marker-rename': (ctx, step) => {
    const { world } = ctx;
    const marker = markerOf(ctx, step);
    if (!marker) return didNot('the command named no marker', 'Say which marker.');
    const name = step.slots.words?.kind === 'words' ? step.slots.words.value : null;
    if (!name) return didNot('the command gave no new name');
    getDocumentEditor(world).editProperty(marker, 'name', name);
    return did(`Marker renamed “${name}”`);
  },
};

/** The marker a step names, or the one nearest the playhead. */
function markerOf(ctx: Parameters<RunFn>[0], step: Parameters<RunFn>[1]): Entity | null {
  const { world } = ctx;
  const named = step.slots.marker?.kind === 'marker' ? step.slots.marker.id : null;
  if (named) return findAddressed(world, named);
  const here = playheadOf(world);
  const nearest = [...ctx.situation.markers].sort((a, b) => Math.abs(a.time - here) - Math.abs(b.time - here))[0];
  return nearest ? findAddressed(world, nearest.id) : null;
}

void Selected;
