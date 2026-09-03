/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Timeline zoom by keyboard.
 *
 * The wheel already zooms, but a trackpad gesture is not a substitute for
 * `⌥+` / `⌥−` when you are working the keyboard. The playhead anchors every
 * zoom: the frame you are looking at should stay where it is on screen rather
 * than sliding away as the scale changes.
 */
import { Computed, Selected, getActiveEntity, store } from '@posterract/video-runtime';

import { MAX_RESOLUTION, MIN_RESOLUTION, TIMELINE_ZOOM_STEP } from './detail';
import { getResolution, getScrollX, setResolution, setScrollX } from './view';

import type { World } from 'koota';

const clampResolution = (value: number): number =>
	Math.min(MAX_RESOLUTION, Math.max(MIN_RESOLUTION, value));

export const zoomTimeline = (factor: number) => (world: World): void => {
	const scene = getActiveEntity(world);
	if (!scene) return;

	const next = clampResolution(getResolution(world, scene) * factor);
	// Hold the playhead still: its offset from the left edge is what the user
	// is reading, so the scroll moves with the scale rather than after it.
	const playhead = store(world, Computed).localTime[scene.id()] ?? 0;
	const offset = playhead - getScrollX(world, scene);
	setResolution(world, scene, next);
	setScrollX(world, scene, Math.max(0, playhead - offset));
};

export const zoomTimelineIn = zoomTimeline(1 / TIMELINE_ZOOM_STEP);
export const zoomTimelineOut = zoomTimeline(TIMELINE_ZOOM_STEP);

/** Fit a frame span into the viewport, with a little air either side. */
function fitSpan(world: World, from: number, to: number): void {
	const scene = getActiveEntity(world);
	if (!scene || to <= from) return;
	const viewport = document.querySelector('[data-timeline-layers-viewport]')?.clientWidth ?? 0;
	const width = viewport || 800;
	const padded = (to - from) * 1.06;
	setResolution(world, scene, clampResolution(padded / width));
	setScrollX(world, scene, Math.max(0, from - (to - from) * 0.03));
}

/** `⇧Z` — the whole scene in view. */
export function zoomTimelineToFit(world: World): void {
	const scene = getActiveEntity(world);
	if (!scene) return;
	const computed = store(world, Computed);
	let end = 0;
	for (const child of world.query(Computed)) end = Math.max(end, computed.end[child.id()] ?? 0);
	fitSpan(world, 0, end || 1);
}

/** `⌥Z` — just what is selected, which is usually what is being worked on. */
export function zoomTimelineToSelection(world: World): void {
	const computed = store(world, Computed);
	let from = Infinity;
	let to = -Infinity;
	for (const entity of world.query(Selected)) {
		const eid = entity.id();
		from = Math.min(from, computed.start[eid] ?? Infinity);
		to = Math.max(to, computed.end[eid] ?? -Infinity);
	}
	if (!Number.isFinite(from) || !Number.isFinite(to)) return zoomTimelineToFit(world);
	fitSpan(world, from, to);
}
