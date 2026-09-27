/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trackPropertyPath } from '@posterract/video-reconciler';
import {
	Computed, Live, Source, getActiveEntity, getPropertyPaths, isKnobPath, store,
} from '@posterract/video-runtime';

import type { Entity, World } from 'koota';

/**
 * What code-driven props held at each frame the editor has shown.
 *
 * A "From code" row names motion the timeline cannot otherwise see; this is
 * what lets it also draw that motion. Sampling code means running it, which
 * the editor does anyway every time it shows a frame — so the values are
 * written down as they go by, and the curve fills in as the scene plays or is
 * scrubbed, without a second evaluation of anything.
 *
 * Keyed by the element's source id (entity ids are recycled across remounts)
 * and by scene frame, so the curve lines up with the ruler.
 */
const history = new Map<string, Map<string, Map<number, number>>>();

/** Past this many frames per prop the oldest are dropped: a curve, not a recording. */
const MAX_FRAMES = 6_000;

function keyOf(entity: Entity): string {
	return entity.get(Source)?.value ?? `#${entity.id()}`;
}

/** Writes down this frame's value of every live prop in the world. */
export function recordLiveValues(world: World): void {
	const scene = getActiveEntity(world);
	if (!scene) return;
	const frame = Math.round(store(world, Computed).localTime[scene.id()] ?? 0);
	const paths = getPropertyPaths(world) as Record<string, { authored: unknown[] } | undefined>;

	for (const entity of world.query(Live)) {
		const names = (entity.get(Live)?.props ?? '').split(',').map((name) => name.trim()).filter(Boolean);
		if (names.length === 0) continue;
		let props = history.get(keyOf(entity));
		for (const name of names) {
			const path = trackPropertyPath(entity, name);
			if (!path || isKnobPath(path)) continue;
			const value = paths[path]?.authored[entity.id()];
			if (typeof value !== 'number' || !Number.isFinite(value)) continue;
			if (!props) {
				props = new Map();
				history.set(keyOf(entity), props);
			}
			let frames = props.get(name);
			if (!frames) {
				frames = new Map();
				props.set(name, frames);
			}
			frames.set(frame, value);
			if (frames.size > MAX_FRAMES) frames.delete(frames.keys().next().value!);
		}
	}
}

/** The recorded curve of one of `entity`'s live props: frame → value, in frame order. */
export function liveCurve(entity: Entity, name: string): Array<[number, number]> {
	const frames = history.get(keyOf(entity))?.get(name);
	if (!frames) return [];
	return [...frames.entries()].sort((a, b) => a[0] - b[0]);
}

/** Forgets everything recorded: a different project's code is different motion. */
export function clearLiveHistory(): void {
	history.clear();
}
