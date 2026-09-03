/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Rendered geometry, for an agent that needs to check layout from data.
 *
 * Until now an agent could only see what it had written and what a capture
 * looked like — it had no way to ask "does this overlap", "is this off the
 * canvas", "did that text wrap". Those questions are answerable exactly from
 * the transform system, and guessing at them from a PNG is both unreliable
 * and expensive in tokens.
 *
 * Boxes are post-transform and in scene space, which is the space the source's
 * own `x`/`y`/`width`/`height` are written in, so a reported overlap can be
 * fixed by editing the numbers the agent already knows.
 */
import {
	Animation, Chars, Computed, Cue, Duck, Effect, FrameRate, Keyframe, KeyframeTrack, Marker,
	Scene, Shadow, Size, Source, Stroke, Transition, WorldBounds,
	getActiveEntity, getEntityChildren, getEntityBounds, isText, motionSystem, playbackSystem, setPlayhead,
	store, transformSystem,
} from '@posterract/video-runtime';
import { parseSource } from '@posterract/composition';

import type { Entity, World } from 'koota';
import type { EditorSession } from './session';

export type GeometryRequest = {
	/** Stable source ids; every visible element when omitted. */
	ids?: string[];
	/** Scene-local seconds to measure at; the current playhead when omitted. */
	time?: number;
};

export type GeometryBox = {
	id: string | null;
	kind: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/** Painter order: a higher number draws on top of a lower one. */
	z: number;
	opacity: number;
	/** True when the box falls entirely outside the scene's frame. */
	offscreen: boolean;
	/** True when the box extends past any edge of the frame. */
	clipped: boolean;
	/** Present for text: what it renders, for spotting overflow and wrapping. */
	text?: string;
};

export type GeometryResult = {
	time: number;
	frame: number;
	scene: { id: string | null; width: number; height: number };
	boxes: GeometryBox[];
	/** Pairs of ids whose boxes intersect, for a quick overlap check. */
	overlaps: Array<[string, string]>;
};

/**
 * Nodes that live in the tree but never draw: keyframes, tracks, presets,
 * transitions, markers, caption cues, ducking, effects and paint children.
 * They carry inherited bounds from the transform system, so without this
 * filter a keyframe shows up as a 400px "element" and pollutes the overlap
 * report with collisions nobody can see.
 */
const NOT_DRAWN = [Keyframe, KeyframeTrack, Animation, Transition, Marker, Cue, Duck, Effect, Shadow, Stroke];

function isDrawn(entity: Entity): boolean {
	return !NOT_DRAWN.some((trait) => entity.has(trait));
}

function sourceId(entity: Entity): string | null {
	const source = entity.get(Source)?.value;
	if (!source) return null;
	const locator = parseSource(source)?.locator;
	return typeof locator === 'string' ? locator : null;
}

function intersects(a: GeometryBox, b: GeometryBox): boolean {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function contains(outer: GeometryBox, inner: GeometryBox): boolean {
	return outer.x <= inner.x && outer.y <= inner.y
		&& outer.x + outer.width >= inner.x + inner.width
		&& outer.y + outer.height >= inner.y + inner.height;
}

export function readGeometry(
	session: () => EditorSession,
	request: GeometryRequest = {},
): GeometryResult {
	const { world } = session();
	const scene = getActiveEntity(world);
	if (!scene) throw new Error('No active video to measure');

	const computed = store(world, Computed);

	// Measuring at a time means moving the playhead there: the transform
	// system is what produces the boxes, and it only knows about now.
	if (request.time !== undefined) {
		setPlayhead(world, scene, Math.round(request.time * frameRateOf(world)));
	}
	// The engine loop applies playback, motion and transforms on its next
	// tick. Reading before that tick — the first geometry call after a mount,
	// or right after the seek above — reports the authored values, not the
	// animated ones. Run the same three systems, in the loop's own order:
	// playback hands the scene's time down to its children, motion evaluates
	// the tracks at that time, transform turns the result into boxes. They are
	// functions of the frame, so an extra run changes nothing the loop would
	// not compute itself.
	playbackSystem(world);
	motionSystem(world);
	transformSystem(world);

	const frame = Math.round(computed.localTime[scene.id()] ?? 0);
	const sceneId = scene.id();
	const frameWidth = computed.width[sceneId] || scene.get(Size)?.width || 0;
	const frameHeight = computed.height[sceneId] || scene.get(Size)?.height || 0;
	const wanted = request.ids?.length ? new Set(request.ids) : null;

	const boxes: GeometryBox[] = [];
	let order = 0;
	const walk = (parent: Entity): void => {
		for (const child of getEntityChildren(world, parent)) {
			if (!isDrawn(child)) continue;
			const id = sourceId(child);
			const eid = child.id();
			order += 1;
			if (!wanted || (id && wanted.has(id))) {
				const rect = getEntityBounds(world, [child]);
				if (rect && store(world, WorldBounds).minX[eid] !== undefined) {
					const box: GeometryBox = {
						id,
						kind: isText(child) ? 'text' : child.has(Scene) ? 'scene' : 'element',
						x: Math.round(rect.x),
						y: Math.round(rect.y),
						width: Math.round(rect.width),
						height: Math.round(rect.height),
						z: order,
						opacity: Number((computed.opacity[eid] ?? 1).toFixed(3)),
						offscreen: false,
						clipped: false,
					};
					box.offscreen = box.x + box.width <= 0 || box.y + box.height <= 0
						|| box.x >= frameWidth || box.y >= frameHeight;
					box.clipped = !box.offscreen
						&& (box.x < 0 || box.y < 0 || box.x + box.width > frameWidth || box.y + box.height > frameHeight);
					const chars = child.get(Chars)?.value;
					if (typeof chars === 'string' && chars) box.text = chars;
					boxes.push(box);
				}
			}
			walk(child);
		}
	};
	walk(scene);

	// Collisions worth reporting, not every stacked pair. A backplate that
	// contains its own text is the normal shape of a composition — flagging it
	// would send an agent to fix something that was never wrong. What is worth
	// knowing is a partial overlap: two things fighting for the same space.
	const overlaps: Array<[string, string]> = [];
	for (let i = 0; i < boxes.length; i += 1) {
		for (let j = i + 1; j < boxes.length; j += 1) {
			const a = boxes[i]!;
			const b = boxes[j]!;
			if (!a.id || !b.id || a.opacity <= 0 || b.opacity <= 0) continue;
			if (!intersects(a, b) || contains(a, b) || contains(b, a)) continue;
			overlaps.push([a.id, b.id]);
		}
	}

	return {
		time: Number((frame / frameRateOf(world)).toFixed(4)),
		frame,
		scene: { id: sourceId(scene), width: frameWidth, height: frameHeight },
		boxes,
		overlaps,
	};
}

function frameRateOf(world: World): number {
	return world.get(FrameRate)?.value ?? 30;
}
