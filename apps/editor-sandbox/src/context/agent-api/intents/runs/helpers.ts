/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** What the runs share: finding elements, times and the scene they act in. */

import { Computed, FrameRate, Scene, Source, getActiveEntity, store } from '@posterract/video-runtime';
import { parseSource } from '@posterract/composition';

import { resolveNode } from '../../nodes';
import { nameOf } from '../scene';

import type { Entity, World } from 'koota';
import type { Outcome, SceneElement, SlotValue, Step, Situation } from '../types';

/** An entity by the address a reading gave it, whether or not it is a node (an animation is not). */
export function findAddressed(world: World, address: string): Entity | null {
  for (const entity of world.query(Source)) {
    const stamp = entity.get(Source)!.value;
    if (stamp === address || String(parseSource(stamp)?.locator) === address) return entity;
  }
  return null;
}

/** The elements a step acts on, as entities; ones that have gone are left out. */
export function entitiesOf(world: World, step: Step): Entity[] {
  const found: Entity[] = [];
  for (const id of step.targets) {
    try {
      const entity = resolveNode(world, id);
      if (entity.isAlive()) found.push(entity);
    } catch {
      // Gone since the command was read: the others still stand.
    }
  }
  return found;
}

export const frameRateOf = (world: World): number => world.get(FrameRate)?.value || 30;

/** Scene seconds as frames of this project. */
export const framesOf = (world: World, seconds: number): number => Math.round(seconds * frameRateOf(world));

/** The scene a command acts in. */
export function sceneOf(world: World): Entity | null {
  return getActiveEntity(world);
}

/** The playhead, in scene seconds. */
export function playheadOf(world: World): number {
  const scene = getActiveEntity(world);
  if (!scene) return 0;
  return (store(world, Computed).localTime[scene.id()] ?? 0) / frameRateOf(world);
}

/** The last frame anything in the scene is scheduled to. */
export function sceneEndFrames(world: World, scene: Entity): number {
  const computed = store(world, Computed);
  let end = 0;
  for (const child of world.query(Source)) {
    if (child === scene) continue;
    const parent = child.get(Source) ? computed.end[child.id()] : undefined;
    if (parent !== undefined) end = Math.max(end, parent);
  }
  return end || computed.end[scene.id()] || 0;
}

/** A moment slot, in scene seconds; null when the command gave none. */
export function secondsOfSlot(value: SlotValue | undefined): number | null {
  return value?.kind === 'time' ? value.seconds : null;
}

export const choiceOf = (value: SlotValue | undefined): string | null => (value?.kind === 'choice' ? value.value : null);
export const numberOf = (value: SlotValue | undefined): { value: number; unit: string } | null =>
  value?.kind === 'number' ? { value: value.value, unit: value.unit } : null;
export const onOf = (value: SlotValue | undefined): boolean | null => (value?.kind === 'onoff' ? value.on : null);
export const wordsOf = (value: SlotValue | undefined): string | null => (value?.kind === 'words' ? value.value : null);
export const amountOf = (value: SlotValue | undefined): 0 | 1 | 2 => (value?.kind === 'amount' ? value.step : 1);

/** A number of seconds as the command's own unit means it: frames stay frames. */
export function framesFromSlot(world: World, value: SlotValue | undefined): number | null {
  if (value?.kind === 'time') return framesOf(world, value.seconds);
  if (value?.kind === 'number') {
    if (value.unit === 'frames') return Math.round(value.value);
    return framesOf(world, value.value);
  }
  return null;
}

/** What a receipt calls the elements a step acted on. */
export function whoOf(step: Step, situation: Situation): string {
  if (step.targets.length === 1) {
    const element = situation.elements.find((entry: SceneElement) => entry.id === step.targets[0]);
    return element ? nameOf(element) : 'it';
  }
  if (step.targets.length > 1) return `${step.targets.length} elements`;
  return '';
}

export const did = (receipt: string, made?: string[]): Outcome => ({ changed: true, receipt, ...(made ? { made } : {}) });
export const didNot = (why: string, fix?: string): Outcome => ({ changed: false, receipt: '', why, ...(fix ? { fix } : {}) });

/** The address an edit gives an entity, for selecting what was made. */
export function addressOf(entity: Entity): string | null {
  const stamp = entity.get(Source)?.value;
  if (!stamp) return null;
  const locator = parseSource(stamp)?.locator;
  return typeof locator === 'string' ? locator : stamp;
}

export const isScene = (entity: Entity): boolean => entity.has(Scene);
