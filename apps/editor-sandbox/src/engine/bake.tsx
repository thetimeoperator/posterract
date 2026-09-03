/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Baking motion into keyframes.
 *
 * A property driven by code — a `useTicker` expression, a signal, an easing
 * written by hand — moves on the canvas but has no rows on the timeline, so
 * there is nothing to grab, retime, or ease. Baking samples what the property
 * actually does, frame by frame, and writes that back as a `<keyframeTrack>`:
 * the motion becomes an editable object without the original expression being
 * touched. A track wins over the code value, so the baked version is what
 * plays from then on.
 *
 * Sampling happens in an offline copy of the project — the same world an
 * export builds — so the values are the ones a render would produce, not
 * whatever the live preview happens to be showing.
 */

import {
	ChildOf, Computed, FrameRate, FramePromises, Root, Source, Time,
	assetSystem, getLocalWindow, getPropertyPaths, getSceneAncestor, isScene,
	motionSystem, playbackSystem, transformSystem, store,
} from '@posterract/video-runtime';
import {
	Keyframe as KeyframeElement, KeyframeTrack as KeyframeTrackElement, trackPropertyPath,
} from '@posterract/video-reconciler';

import { createCapture } from './capture';
import { removeKeyframeTrack } from './keyframes';

import type { AnimatableProperty } from '@posterract/composition';
import type { DocumentEditor } from './editor';
import type { Entity, World } from 'koota';

/** A sampled point: the frame it was taken at and what the property held. */
interface Sample {
	frame: number;
	value: number;
}

/**
 * How far a sample may sit from the straight line between its neighbours
 * before it earns a keyframe of its own — in the property's own units.
 *
 * A quarter of a pixel is invisible; a quarter of an opacity is a quarter of
 * the whole range. So the default depends on what is being baked: properties
 * that mean "a fraction of something" get a tolerance a thousand times
 * tighter, and everything else is measured in pixels or degrees.
 *
 * Deliberately tight either way: a bake that loses a visible wobble is worse
 * than one with a few extra keyframes, and the simplifier is only there to
 * keep a linear ramp from becoming three hundred rows.
 */
const PIXEL_TOLERANCE = 0.25;
const RATIO_TOLERANCE = 0.0025;

/** Properties whose whole range is 0–1, and so need the tighter tolerance. */
const RATIO_PROPERTIES = new Set<AnimatableProperty>([
	'opacity', 'morph', 'trimStart', 'trimEnd', 'trimOffset', 'progress', 'scale', 'scaleX', 'scaleY',
]);

function defaultTolerance(property: AnimatableProperty): number {
	return RATIO_PROPERTIES.has(property) ? RATIO_TOLERANCE : PIXEL_TOLERANCE;
}

/** The most frames one bake will sample, so a long scene cannot hang the app. */
const MAX_FRAMES = 3600;

export interface BakeResult {
	/** How many keyframes were written. */
	keyframes: number;
	/** The frames sampled before simplification. */
	sampled: number;
}

/**
 * Sample `property` on `target` across its own span and write the result as a
 * keyframe track.
 *
 * Returns null when the element is not in the source yet, when the property is
 * not one the runtime animates, or when the span is empty.
 */
export async function bakeToKeyframes(
	world: World,
	editor: DocumentEditor,
	target: Entity,
	property: AnimatableProperty,
	options: { tolerance?: number; dir?: string } = {},
): Promise<BakeResult | null> {
	const stamp = target.get(Source)?.value;
	if (!stamp) return null;

	const path = trackPropertyPath(target, property);
	if (!path) return null;

	const window = getLocalWindow(target);
	const first = Math.max(0, Math.round(window.in));
	const last = Math.round(window.out);
	if (!(last > first)) return null;
	if (last - first > MAX_FRAMES) return null;

	const scene = sceneOf(target);
	if (!scene) return null;

	const capture = await createCapture(world, scene, { mode: 'offline-video', dir: options.dir });
	let samples: Sample[];
	try {
		samples = await sample(capture.world, stamp, path, first, last);
	} finally {
		capture.dispose();
	}
	if (samples.length < 2) return null;

	const kept = simplify(samples, options.tolerance ?? defaultTolerance(property));

	// The old track goes first: baking twice should replace the result, not
	// interleave two sets of keyframes on the same property.
	removeKeyframeTrack(world, editor, target, property);

	const frameRate = world.get(FrameRate)?.value ?? 30;
	editor.insertElement(target, () => (
		<KeyframeTrackElement property={property}>
			{kept.map((point) => (
				<KeyframeElement time={round(point.frame / frameRate)} value={round(point.value)} />
			))}
		</KeyframeTrackElement>
	));

	return { keyframes: kept.length, sampled: samples.length };
}

/** The scene an element belongs to, which is what the offline world mounts. */
function sceneOf(target: Entity): Entity | null {
	return isScene(target) ? target : getSceneAncestor(target);
}

/**
 * Step the offline world frame by frame, reading the resolved property each
 * time.
 *
 * The systems run in the encoder's order, and the frame barrier is drained
 * between steps, so a value that depends on a decoded frame or a loaded asset
 * is sampled after it has arrived rather than before.
 */
async function sample(
	world: World,
	stamp: string,
	path: string,
	first: number,
	last: number,
): Promise<Sample[]> {
	const entity = findByStamp(world, stamp);
	if (!entity) return [];

	const computed = store(world, Computed);
	const channel = getPropertyPaths(world)[path as keyof ReturnType<typeof getPropertyPaths>];
	if (!channel) return [];

	const frameRate = world.get(FrameRate)?.value ?? 30;
	// The capture world holds one scene, and the encoder drives its clock
	// directly rather than letting playback advance it — the same thing an
	// export does, which is what makes these samples the render's values.
	const sceneId = sceneEntity(world)?.id();
	const samples: Sample[] = [];

	for (let frame = first; frame <= last; frame += 1) {
		const seconds = frame / frameRate;
		if (sceneId !== undefined) {
			computed.localTimeInSeconds[sceneId] = seconds;
			computed.localTime[sceneId] = frame;
		}
		const time = world.get(Time)!;
		world.set(Time, { delta: (1 / frameRate) * 1000, now: time.now + (1 / frameRate) * 1000 });

		assetSystem(world);
		playbackSystem(world);
		await drain(world);
		motionSystem(world);
		transformSystem(world);

		// The channel may hold a string (a text reveal); only numbers are a
		// curve, and only numbers are what a keyframe track interpolates.
		const held = channel.computed[entity.id()];
		samples.push({ frame, value: typeof held === 'number' ? held : 0 });
	}

	return samples;
}

/** The scene the capture world mounted — the stage's only child. */
function sceneEntity(world: World): Entity | null {
	const root = world.get(Root);
	if (!root) return null;
	const [scene] = world.query(ChildOf(root));
	return scene ?? null;
}

/** Await whatever the systems queued for this frame, then clear the queue. */
async function drain(world: World): Promise<void> {
	const list = world.get(FramePromises)?.list;
	if (!list?.length) return;
	await Promise.all(list.splice(0, list.length));
}

function findByStamp(world: World, stamp: string): Entity | null {
	for (const entity of world.query(Source)) {
		if (store(world, Source).value[entity.id()] === stamp) return entity;
	}
	return null;
}

/**
 * Ramer–Douglas–Peucker: keep the points that carry the shape.
 *
 * A property that moves linearly becomes two keyframes; one that eases becomes
 * a handful; one that jitters keeps its jitter. Nothing is invented — every
 * keyframe kept is a frame that was actually sampled.
 */
function simplify(points: Sample[], tolerance: number): Sample[] {
	if (points.length <= 2) return points;

	const first = points[0]!;
	const last = points.at(-1)!;
	const span = last.frame - first.frame;

	let worst = 0;
	let index = 0;
	for (let i = 1; i < points.length - 1; i += 1) {
		const point = points[i]!;
		// Vertical distance from the chord, which is what "off the line" means
		// for a value over time; a perpendicular one would mix frames and units.
		const expected = span === 0
			? first.value
			: first.value + ((point.frame - first.frame) / span) * (last.value - first.value);
		const distance = Math.abs(point.value - expected);
		if (distance > worst) {
			worst = distance;
			index = i;
		}
	}

	if (worst <= tolerance) return [first, last];

	return [
		...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
		...simplify(points.slice(index), tolerance),
	];
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
