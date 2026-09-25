/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Keyframes: recording a value at a moment, taking them off, looping them, baking motion into them. */

import { Cache, Computed, Keyframe, setPlayhead, store } from '@posterract/video-runtime';

import { bakeToKeyframes } from '@/engine/bake';
import { getDocumentEditor } from '@/engine/editor';
import { findKeyframeTrack, removeKeyframeTrack, writeKeyframe } from '@/engine/keyframes';

import { KEYFRAME_TRACKS } from '../catalog/shared';
import { choiceOf, did, didNot, entitiesOf, framesOf, sceneOf, secondsOfSlot, whoOf } from './helpers';

import type { AnimatableProperty } from '@posterract/composition';
import type { Entity } from 'koota';
import type { RunFn } from './types';

/** The animatable properties behind a spoken one: "position" is x and y. */
const propertiesOf = (said: string | null): AnimatableProperty[] =>
  ((said ? KEYFRAME_TRACKS[said] ?? [said] : []) as AnimatableProperty[]);

export const MOTION_RUNS: Record<string, RunFn> = {
  'motion.keyframe-add': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected', 'Say which element.');
    const properties = propertiesOf(choiceOf(step.slots.property));
    if (!properties.length) return didNot('the command did not say which property', 'Say "keyframe the position", or the opacity, scale or rotation.');

    const scene = sceneOf(world);
    const at = secondsOfSlot(step.slots.when);
    if (scene && at !== null) setPlayhead(world, scene, framesOf(world, at));

    const editor = getDocumentEditor(world);
    let written = 0;
    for (const entity of entities) {
      for (const property of properties) {
        if (writeKeyframe(world, editor, entity, property)) written += 1;
      }
    }
    if (!written) return didNot('that property cannot be keyframed on it', 'Try the position, scale, rotation or opacity.');
    return did(`Keyframed the ${choiceOf(step.slots.property)} of ${whoOf(step, ctx.situation) || 'it'}`);
  },

  'motion.keyframe-remove': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected', 'Say which element.');
    const properties = propertiesOf(choiceOf(step.slots.property));
    const editor = getDocumentEditor(world);
    let removed = 0;
    for (const entity of entities) {
      const tracks = properties.length
        ? properties.map((property) => findKeyframeTrack(world, entity, property)).filter((track): track is Entity => track !== null)
        : (entity.get(Cache)?.keyframeTracks ?? []);
      for (const track of tracks) {
        editor.remove(track);
        removed += 1;
      }
      // Removing the whole track through the editor keeps the property's own
      // value, which is what the panel's own button does.
      void removeKeyframeTrack;
    }
    if (!removed) return didNot('it has no keyframes for that', 'Say which property, or add some first.');
    return did(`Removed ${removed === 1 ? 'the keyframes' : `${removed} keyframe tracks`}`);
  },

  'motion.loop': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected', 'Say which element.');
    const how = choiceOf(step.slots.loop_how) ?? 'repeat';
    const properties = propertiesOf(choiceOf(step.slots.property));
    const editor = getDocumentEditor(world);
    let changed = 0;
    for (const entity of entities) {
      const tracks = properties.length
        ? properties.map((property) => findKeyframeTrack(world, entity, property)).filter((track): track is Entity => track !== null)
        : (entity.get(Cache)?.keyframeTracks ?? []);
      for (const track of tracks) {
        editor.editProperty(track, 'loop', how === 'off' ? false : how);
        changed += 1;
      }
    }
    if (!changed) return didNot('it has no keyframed motion to loop', 'Keyframe something first, or say "loop" on a Lottie.');
    return did(how === 'off' ? 'Stopped looping' : how === 'pingpong' ? 'Looping back and forth' : 'Looping');
  },

  'motion.bake': async (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('nothing is selected', 'Say which element.');
    const properties = propertiesOf(choiceOf(step.slots.property));
    if (!properties.length) return didNot('the command did not say which property', 'Say "bake the position", or the rotation, scale or opacity.');
    const editor = getDocumentEditor(world);
    let baked = 0;
    for (const entity of entities) {
      for (const property of properties) {
        const result = await bakeToKeyframes(world, editor, entity, property, { dir: ctx.dir() });
        if (result) baked += result.keyframes;
      }
    }
    if (!baked) return didNot('there is no motion in the code to bake', 'It bakes motion written in the project, not the preset animations.');
    return did(`Baked ${baked} keyframes`);
  },

  'motion.keyframe-easing': (ctx, step) => {
    const { world } = ctx;
    const entities = entitiesOf(world, step);
    const easing = choiceOf(step.slots.easing);
    if (!easing) return didNot('the command did not say how the motion should feel');
    if (!entities.length) return didNot('nothing is selected', 'Say which element.');
    const properties = propertiesOf(choiceOf(step.slots.property));
    const editor = getDocumentEditor(world);
    let changed = 0;
    for (const entity of entities) {
      const tracks = properties.length
        ? properties.map((property) => findKeyframeTrack(world, entity, property)).filter((track): track is Entity => track !== null)
        : (entity.get(Cache)?.keyframeTracks ?? []);
      for (const track of tracks) {
        for (const keyframe of track.get(Cache)?.keyframes ?? []) {
          if (!keyframe.has(Keyframe)) continue;
          editor.editProperty(keyframe, 'easing', easing);
          changed += 1;
        }
      }
    }
    if (!changed) return didNot('it has no keyframes to ease', 'Keyframe something first.');
    return did(`Keyframes ${easing}`);
  },
};

void Computed;
void store;
