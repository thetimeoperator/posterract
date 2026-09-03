/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Transport and range controls — the muscle memory every NLE shares.
 *
 * Playhead movement and the work area already exist in the runtime; what was
 * missing was the vocabulary editors expect: Home/End, cut-to-cut navigation,
 * a J/K/L shuttle, and in/out points. In/out writes the scene's own
 * `workarea`, which is already persisted to the source and already what an
 * export renders — so marking a range is the same act as choosing what to
 * export, not a second concept sitting beside it.
 */
import {
	ChildOf, Computed, FrameRate, Playback, Selected, Workarea,
	getActiveEntity, setPlayhead, store,
} from '@posterract/video-runtime';

import { getDocumentEditor } from './editor';

import type { Entity, World } from 'koota';

/** Rates the J/K/L shuttle steps through, in each direction. */
export const SHUTTLE_RATES = [1, 2, 4] as const;

const localTime = (world: World, scene: Entity): number =>
	store(world, Computed).localTime[scene.id()] ?? 0;

const frameRateOf = (world: World): number => world.get(FrameRate)?.value ?? 30;

/** The last frame anything in the scene is scheduled to. */
function sceneDurationFrames(world: World, scene: Entity): number {
	const computed = store(world, Computed);
	let end = 0;
	for (const child of world.query(ChildOf(scene))) {
		end = Math.max(end, computed.end[child.id()] ?? 0);
	}
	return end;
}

/** The work area's frames, when one is set and non-empty. */
function activeRange(scene: Entity): { start: number; end: number } | null {
	const workarea = scene.get(Workarea);
	return workarea && workarea.end > workarea.start ? workarea : null;
}

export function seekToStart(world: World): void {
	const scene = getActiveEntity(world);
	if (!scene) return;
	// Home goes to the work area's start when one is set: that is where an
	// export begins, so it is the start the user means.
	setPlayhead(world, scene, activeRange(scene)?.start ?? 0);
}

export function seekToEnd(world: World): void {
	const scene = getActiveEntity(world);
	if (!scene) return;
	setPlayhead(world, scene, activeRange(scene)?.end ?? sceneDurationFrames(world, scene));
}

/** Every clip edge in the active scene, in order — the cuts to jump between. */
function cutFrames(world: World, scene: Entity): number[] {
	const computed = store(world, Computed);
	const cuts = new Set<number>([0]);
	const walk = (parent: Entity): void => {
		for (const child of world.query(ChildOf(parent))) {
			const eid = child.id();
			const start = computed.start[eid];
			const end = computed.end[eid];
			if (start !== undefined) cuts.add(start);
			if (end !== undefined) cuts.add(end);
			walk(child);
		}
	};
	walk(scene);
	return [...cuts].sort((a, b) => a - b);
}

export const seekToCut = (direction: -1 | 1) => (world: World): void => {
	const scene = getActiveEntity(world);
	if (!scene) return;
	const now = localTime(world, scene);
	const cuts = cutFrames(world, scene);
	// Half a frame of slack so repeated presses always advance rather than
	// re-finding the cut the playhead is already sitting on.
	const next = direction === 1
		? cuts.find((frame) => frame > now + 0.5)
		: [...cuts].reverse().find((frame) => frame < now - 0.5);
	if (next !== undefined) setPlayhead(world, scene, next);
};

/** `workarea` is authored in seconds, so frames convert on the way out. */
function writeWorkarea(world: World, scene: Entity, startFrames: number, endFrames: number): void {
	const rate = frameRateOf(world);
	getDocumentEditor(world).editProperty(scene, 'workarea', [startFrames / rate, endFrames / rate]);
}

export const setInPoint = (world: World): void => {
	const scene = getActiveEntity(world);
	if (!scene) return;
	const now = Math.round(localTime(world, scene));
	const current = activeRange(scene);
	const end = current && current.end > now ? current.end : sceneDurationFrames(world, scene);
	if (end <= now) return;
	writeWorkarea(world, scene, now, end);
};

export const setOutPoint = (world: World): void => {
	const scene = getActiveEntity(world);
	if (!scene) return;
	const now = Math.round(localTime(world, scene));
	const current = activeRange(scene);
	const start = current && current.start < now ? current.start : 0;
	if (now <= start) return;
	writeWorkarea(world, scene, start, now);
};

/** `false` is what the document treats as "no range". */
export const clearInOut = (world: World): void => {
	const scene = getActiveEntity(world);
	if (!scene) return;
	getDocumentEditor(world).editProperty(scene, 'workarea', false);
};

/**
 * J/K/L shuttle. K pauses; J and L step through the rates in their direction,
 * so pressing the same key again goes faster, as an editor expects. Reverse
 * is stepped rather than played — the audio path has no reverse, and a silent
 * backwards scrub is the honest version of it.
 */
let shuttle: { direction: -1 | 0 | 1; rate: number } = { direction: 0, rate: 0 };
let shuttleTimer: ReturnType<typeof setInterval> | undefined;

function stopShuttle(): void {
	if (shuttleTimer) clearInterval(shuttleTimer);
	shuttleTimer = undefined;
	shuttle = { direction: 0, rate: 0 };
}

export const shuttleBy = (direction: -1 | 1) => (world: World): void => {
	const scene = getActiveEntity(world);
	if (!scene) return;

	// The same direction again means faster, up to the last rate; the other
	// direction starts over at the slowest.
	const rateIndex = shuttle.direction === direction
		? Math.min(shuttle.rate + 1, SHUTTLE_RATES.length - 1)
		: 0;
	stopShuttle();
	shuttle = { direction, rate: rateIndex };

	// Forward at 1x is ordinary playback, so let the runtime do it — that
	// keeps audio and A/V sync on the path that already handles them.
	if (direction === 1 && rateIndex === 0) {
		world.set(Playback, { playing: true });
		return;
	}

	world.set(Playback, { playing: false });
	const rate = SHUTTLE_RATES[rateIndex]!;
	const interval = 1000 / frameRateOf(world);
	shuttleTimer = setInterval(() => {
		const active = getActiveEntity(world);
		if (!active) {
			stopShuttle();
			return;
		}
		setPlayhead(world, active, localTime(world, active) + direction * rate);
	}, interval);
};

export const pauseShuttle = (world: World): void => {
	stopShuttle();
	world.set(Playback, { playing: false });
};

/** Nudge every selected clip along the timeline, in frames. */
export const nudgeSelectionInTime = (frames: number) => (world: World): void => {
	const editor = getDocumentEditor(world);
	const computed = store(world, Computed);
	const rate = frameRateOf(world);
	for (const entity of world.query(Selected)) {
		const eid = entity.id();
		const start = computed.start[eid];
		const end = computed.end[eid];
		if (start === undefined || end === undefined) continue;
		const shift = Math.max(-start, frames);
		if (shift === 0) continue;
		editor.editProperty(entity, 'start', (start + shift) / rate);
		editor.editProperty(entity, 'end', (end + shift) / rate);
	}
};
