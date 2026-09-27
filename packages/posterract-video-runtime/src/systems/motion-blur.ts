/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Motion blur: a frame drawn the way a camera with an open shutter records it.
 *
 * The scene is put at `samples` moments spread across the shutter — centred on
 * the frame, `shutter` degrees of it wide — drawn at each, and the drawings
 * averaged. Anything that moves during the shutter smears along its path, and
 * anything still stays exactly as it was: a pixel that never changes averages
 * to itself. Elements that opt out (`motionBlur={false}`) are held at the
 * frame's own moment in every sample, so they come out sharp.
 *
 * Only what the motion system decides is resampled — transforms, keyframes,
 * presets, knobs, shapes, Lottie. Decoders are not re-seeked between samples
 * (a video frame already carries the camera's own blur), and no audio or
 * mount is stepped, so blurring a frame changes nothing but its pixels.
 */

import { store } from '../world/store';
import { Computed, HitRegions, MotionBlur, RenderSurface, Scene } from '../traits';
import { createFrameAccumulator, type FrameAccumulator } from '../media/accumulate';
import { motionSystem } from './motion';
import { placeInTime } from './playback';
import { transformSystem } from './transform';
import { renderSystem } from './render';

import type { Entity, World } from 'koota';

export type MotionBlurSettings = { shutter: number; samples: number };

/** The most samples a frame is ever blended from: past this the smear is smooth anyway. */
export const MAX_MOTION_BLUR_SAMPLES = 32;

/** The scene's motion blur, or null when it has none (or a shutter that is closed). */
export function sceneMotionBlur(scene: Entity | null | undefined): MotionBlurSettings | null {
	if (!scene || !scene.has(Scene) || !scene.has(MotionBlur)) return null;
	const settings = scene.get(MotionBlur)!;
	const shutter = Math.max(0, Math.min(360, settings.shutter));
	const samples = Math.max(1, Math.min(MAX_MOTION_BLUR_SAMPLES, Math.round(settings.samples)));
	if (shutter <= 0 || samples <= 1) return null;
	return { shutter, samples };
}

/** Where, in frames from the frame itself, each sample of the shutter sits. */
export function shutterOffsets(settings: MotionBlurSettings): number[] {
	const span = settings.shutter / 360;
	const offsets: number[] = [];
	for (let i = 0; i < settings.samples; i++) {
		offsets.push(((i + 0.5) / settings.samples - 0.5) * span);
	}
	return offsets;
}

const accumulators = new WeakMap<World, FrameAccumulator>();

function accumulatorOf(world: World): FrameAccumulator {
	let accumulator = accumulators.get(world);
	if (!accumulator) {
		accumulator = createFrameAccumulator();
		accumulators.set(world, accumulator);
	}
	return accumulator;
}

/** Releases the GPU resources a world's motion blur holds. */
export function disposeMotionBlur(world: World): void {
	accumulators.get(world)?.dispose();
	accumulators.delete(world);
}

/**
 * Redraws the world's canvas as `scene`'s frame `frame` seen through the
 * shutter, then puts the scene back at `frame` so whatever reads it next —
 * the HUD, hit testing, the next tick — finds it where it was.
 *
 * `prepare` runs after the motion system on every sample, for a caller that
 * pins something the systems would otherwise move (an export keeps the
 * scene itself at the origin). Call it after an ordinary render of the frame;
 * the hit regions that render collected are kept, the samples' are not.
 */
export function renderMotionBlurredFrame(
	world: World,
	scene: Entity,
	frame: number,
	settings: MotionBlurSettings,
	prepare?: (world: World) => void,
): void {
	const surface = world.get(RenderSurface);
	const canvas = surface?.canvas;
	const ctx = surface?.ctx;
	if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return;

	const regions = world.get(HitRegions)?.list;
	const kept = regions?.length ?? 0;
	const computed = store(world, Computed);
	const seconds = computed.localTimeInSeconds[scene.id()];

	const accumulator = accumulatorOf(world);
	accumulator.begin(canvas.width, canvas.height);
	const weight = 1 / settings.samples;

	for (const offset of shutterOffsets(settings)) {
		placeInTime(world, scene, Math.max(0, frame + offset), { exact: true, pinned: frame });
		motionSystem(world);
		prepare?.(world);
		transformSystem(world);
		renderSystem(world);
		accumulator.add(canvas, weight);
	}

	if (regions) regions.length = kept;

	placeInTime(world, scene, frame);
	if (seconds !== undefined) computed.localTimeInSeconds[scene.id()] = seconds;
	motionSystem(world);
	prepare?.(world);
	transformSystem(world);

	accumulator.resolveInto(ctx);
}
