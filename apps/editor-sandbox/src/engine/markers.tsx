/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Markers — named points on a scene's timeline.
 *
 * They render nothing and change no output; they exist so a beat, a cut, or a
 * place to come back to can be labelled in the source rather than remembered.
 * Because they are elements, they survive a reload and an agent reading the
 * file can see them.
 */
import { ChildOf, Computed, FrameRate, Marker, getActiveEntity, store } from '@posterract/video-runtime';
import { Marker as MarkerElement } from '@posterract/video-reconciler';

import { getDocumentEditor } from './editor';

import type { Entity, World } from 'koota';

/** The markers of a scene, earliest first. */
export function sceneMarkers(world: World, scene: Entity): Entity[] {
	return [...world.query(ChildOf(scene), Marker)]
		.sort((a, b) => (a.get(Marker)?.time ?? 0) - (b.get(Marker)?.time ?? 0));
}

/**
 * Add a marker at the playhead, or remove the one already there.
 *
 * Toggling rather than always adding: `M` pressed twice on the same frame
 * should leave the timeline as it found it, the way the keyframe key does.
 */
export function toggleMarkerAtPlayhead(world: World): void {
	const scene = getActiveEntity(world);
	if (!scene) return;

	const frame = Math.round(store(world, Computed).localTime[scene.id()] ?? 0);
	const existing = sceneMarkers(world, scene).find((entity) => entity.get(Marker)?.time === frame);
	const editor = getDocumentEditor(world);

	if (existing) {
		editor.remove(existing);
		return;
	}

	// Authored in seconds, like every other time in the source.
	editor.insertElement(scene, () => <MarkerElement time={frame / frameRateOf(world)} />);
}

function frameRateOf(world: World): number {
	return world.get(FrameRate)?.value ?? 30;
}
