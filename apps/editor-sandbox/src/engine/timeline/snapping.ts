/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What a dragged edge sticks to: the start of the scene, the playhead, and
 * the edges of every clip that is not moving. Worked out in frames rather
 * than pixels — a frame is what the timeline is actually made of, and
 * rounding to pixels and back makes a clip jitter by a frame either side of
 * the snap at fractional zooms.
 */

import {
	AdjustmentLayer,
	ChildOf,
	ClipDragOrigin,
	Computed,
	Geometry,
	Group,
	Selected,
	TrimDragOrigin,
	getActiveEntity,
	getParentEntity,
	store,
} from '@posterract/video-runtime';
import { Or } from 'koota';

import { createStoredSignal } from '@/lib/store';
import { store as store_ } from '@/init';

import { SNAP_DISTANCE } from './config';
import { framesToPixels, getCurrentFrame } from './view';

import type { Entity, World } from 'koota';

const NODES = Or(Geometry, Group, AdjustmentLayer);

/**
 * Snapping was always on, which makes frame-exact placement impossible. It is
 * now a persisted preference with a momentary override: holding the modifier
 * while dragging inverts whatever the preference is, so either state is one
 * key away without changing the setting.
 */
const [snapping, setSnapping] = createStoredSignal(
	store_.define<boolean>('timeline.snapping', true),
);

export const snappingEnabled = snapping;
export const toggleSnapping = (): void => setSnapping(!snapping());

let bypassed = false;

/** Held while a drag is in flight; the drag reads it through `snapsNow`. */
export function setSnapBypass(active: boolean): void {
	bypassed = active;
}

/** Whether this moment's drag should snap at all. */
export function snapsNow(): boolean {
	return bypassed ? !snapping() : snapping();
}

/**
 * The frames worth snapping to. Anything whose own time moves with the drag
 * is useless as a target — an ancestor whose bounds come from what is being
 * dragged, or a descendant carried along by it — so those are left out along
 * with the dragged clips themselves.
 */
export function getSnapFrames(world: World): number[] {
	const scene = getActiveEntity(world);
	if (scene === null) return [];

	const computed = store(world, Computed);

	const active = [...world.query(NODES, ClipDragOrigin), ...world.query(NODES, TrimDragOrigin)];
	const excluded = new Set<Entity>(active);

	for (const entity of active) {
		for (let parent = getParentEntity(entity); parent && parent !== scene; parent = getParentEntity(parent)) {
			excluded.add(parent);
		}
		for (const descendant of descendantsOf(world, entity)) excluded.add(descendant);
	}

	// The beginning of the scene and the playhead are always worth landing on.
	const frames = new Set<number>([0, getCurrentFrame(world, scene)]);

	for (const entity of descendantsOf(world, scene)) {
		if (excluded.has(entity) || entity.has(Selected)) continue;
		frames.add(computed.start[entity.id()] ?? 0);
		frames.add(computed.end[entity.id()] ?? 0);
	}

	return [...frames];
}

/**
 * How far off a snap the drag currently is, in frames, for the caller to take
 * off its own offset — or 0 when nothing is near enough. Every dragged clip
 * offers both its edges, and the nearest pairing of an edge to a snap frame
 * wins, so a clip snaps by whichever end is closest to something.
 *
 * The edges come from the snapshots taken when the drag began rather than
 * from where the clips are now: a group's edges are its children's, which
 * have already moved.
 */
export function findSnapDelta(world: World, resolution: number, offsetFrames: number): { delta: number; frame: number } | null {
	if (!snapsNow()) return null;
	const origins = store(world, ClipDragOrigin);

	const edges = new Set<number>();
	for (const entity of world.query(NODES, ClipDragOrigin)) {
		const eid = entity.id();
		edges.add((origins.start[eid] ?? 0) + offsetFrames);
		edges.add((origins.end[eid] ?? 0) + offsetFrames);
	}

	return nearestSnap(getSnapFrames(world), edges, resolution);
}

/**
 * The snap a single frame is nearest to — what a trim uses, where there is
 * one edge being moved rather than a clip's two.
 */
export function findSnapFrame(world: World, resolution: number, frame: number): number | null {
	if (!snapsNow()) return null;
	return nearestSnap(getSnapFrames(world), new Set([frame]), resolution)?.frame ?? null;
}

function nearestSnap(frames: number[], edges: Set<number>, resolution: number): { delta: number; frame: number } | null {
	let best: { delta: number; frame: number; distance: number } | null = null;

	for (const frame of frames) {
		for (const edge of edges) {
			const delta = edge - frame;
			const distance = Math.abs(framesToPixels(delta, resolution));
			if (distance >= SNAP_DISTANCE) continue;
			if (best && distance >= best.distance) continue;
			best = { delta, frame, distance };
		}
	}

	return best === null ? null : { delta: best.delta, frame: best.frame };
}

/** Every node under `entity`, however deep. */
function descendantsOf(world: World, entity: Entity): Entity[] {
	const found: Entity[] = [];

	const walk = (parent: Entity): void => {
		for (const child of world.query(NODES, ChildOf(parent))) {
			found.push(child);
			walk(child);
		}
	};

	walk(entity);

	return found;
}
