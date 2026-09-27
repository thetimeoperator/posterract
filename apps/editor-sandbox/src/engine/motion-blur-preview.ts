/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from 'solid-js';
import {
	Computed, Playback, getActiveEntity, renderMotionBlurredFrame, sceneMotionBlur, store,
} from '@posterract/video-runtime';

import type { World } from 'koota';

/**
 * Whether the preview blurs while it plays, not only while paused and
 * scrubbing. Blur draws every frame several times over, so a heavy scene can
 * stutter with it on; it is the viewer's choice, remembered on this machine,
 * and never part of the project — an export always blurs.
 */
const STORAGE_KEY = 'posterract.motionBlurWhilePlaying';

function stored(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) === '1';
	} catch {
		return false;
	}
}

const [whilePlaying, setWhilePlaying] = createSignal(stored());

export const blurWhilePlaying = whilePlaying;

export function setBlurWhilePlaying(value: boolean): void {
	setWhilePlaying(value);
	try {
		localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
	} catch {
		// Private windows refuse storage; the choice still holds for this session.
	}
}

/**
 * Redraws the canvas with the active scene's motion blur, the way an export
 * will write the frame: while paused and scrubbing always, while playing only
 * when the viewer asked for it. Runs after the render system and before the
 * HUD, so selection handles stay sharp on top.
 */
export function motionBlurPreview(world: World): void {
	const scene = getActiveEntity(world);
	const settings = sceneMotionBlur(scene);
	if (!scene || !settings) return;
	if (scene.get(Playback)?.playing === true && !whilePlaying()) return;
	renderMotionBlurredFrame(world, scene, store(world, Computed).localTime[scene.id()] ?? 0, settings);
}
