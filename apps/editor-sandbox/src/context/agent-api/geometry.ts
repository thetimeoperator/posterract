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
 * fixed by editing the numbers the agent already knows. The transform system
 * measures in stage space, where a scene sits wherever it was dropped on the
 * infinite canvas, so the scene's own origin is taken off every box: without
 * that, everything in a second scene reads as a thousand pixels off-frame.
 *
 * What is measured is what is on screen at that moment. A composition is
 * mostly elements that are not playing right now — forty captions that take
 * turns in one spot — and reporting them all as stacked on each other sends an
 * agent to fix collisions no frame ever shows.
 *
 * Measuring is reading: the playhead is put back where the author left it.
 */
import {
	Animation, Audio, Chars, Computed, Cue, Duck, Effect, FrameRate, Hidden, Keyframe, KeyframeTrack, Marker,
	Position, Shadow, Size, Source, Stroke, Transition, WorldBounds,
	getActiveEntity, getEntityChildren, getEntityBounds, isText, measureText, motionSystem, placeInTime, playbackSystem, setPlayhead,
	store, transformSystem,
} from '@posterract/video-runtime';
import { parseSource } from '@posterract/composition';

import { labelOf } from './check';

import type { Entity, World } from 'koota';
import type { EditorSession } from './session';

export type GeometryRequest = {
	/** Stable source ids; every element on screen at `time` when omitted. */
	ids?: string[];
	/** Scene-local seconds to measure at; the current playhead when omitted. */
	time?: number;
	/** Also report elements that are not playing at `time` (marked `visible: false`). */
	all?: boolean;
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
	/**
	 * Whether the element is playing at the measured time. Always true unless
	 * the element was asked for by id or with `all`: what is not on screen is
	 * otherwise left out.
	 */
	visible: boolean;
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
	/** Pairs of ids whose boxes partly intersect while both are on screen. */
	overlaps: Array<[string, string]>;
	/** Present when a list was cut to keep the answer readable: how many were left out. */
	truncated?: { boxes?: number; overlaps?: number; hint: string };
};

/** Enough for any one moment of a real composition; past this an answer is a dump, not a measurement. */
const MAX_BOXES = 250;
const MAX_OVERLAPS = 100;

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
	const sceneId = scene.id();

	// Measuring at a time means moving the playhead there: the transform
	// system is what produces the boxes, and it only knows about now. The
	// author's playhead is put back below — asking where things are is not a
	// reason for their timeline to jump.
	const parked = computed.localTime[sceneId] ?? 0;
	const moved = request.time !== undefined;
	// Spans are resolved by a tick (`after` becomes a delay there); make sure
	// one has run before anything is measured against them.
	playbackSystem(world);

	// The engine loop applies playback, motion and transforms on its next
	// tick. Reading before that tick — the first geometry call after a mount,
	// or right after the seek above — reports the authored values, not the
	// animated ones. Run the same three systems, in the loop's own order:
	// playback hands the scene's time down to its children, motion evaluates
	// the tracks at that time, transform turns the result into boxes. They are
	// functions of the frame, so an extra run changes nothing the loop would
	// not compute itself.
	// A text's size exists only once it has been laid out, which otherwise
	// happens when it is first painted: one that plays later than the playhead
	// has ever been would have no box to report. Lay them out here.
	const texts: Entity[] = [];
	const collect = (parent: Entity): void => {
		for (const child of getEntityChildren(world, parent)) {
			if (isText(child)) texts.push(child);
			collect(child);
		}
	};
	collect(scene);

	const settle = (): void => {
		motionSystem(world);
		for (const text of texts) measureText(world, text);
		transformSystem(world);
	};

	// The measured moment is visited without asking a decoder for a frame
	// (`placeInTime`): the question is where things are, not what they show,
	// and seeking every clip to answer it would stall the media the author is
	// looking at.
	if (moved) placeInTime(world, scene, Math.round(request.time! * frameRateOf(world)));
	settle();

	try {
		return measure(world, scene, request);
	} finally {
		if (moved) {
			setPlayhead(world, scene, parked);
			playbackSystem(world);
			settle();
		}
	}
}

function measure(world: World, scene: Entity, request: GeometryRequest): GeometryResult {
	const computed = store(world, Computed);
	const sceneId = scene.id();
	const frame = Math.round(computed.localTime[sceneId] ?? 0);
	const frameWidth = computed.width[sceneId] || scene.get(Size)?.width || 0;
	const frameHeight = computed.height[sceneId] || scene.get(Size)?.height || 0;
	// Where the scene sits on the stage. Bounds come back in stage space; the
	// source is written in the scene's.
	const originX = scene.get(Position)?.x ?? 0;
	const originY = scene.get(Position)?.y ?? 0;
	const wanted = request.ids?.length ? new Set(request.ids) : null;

	const boxes: GeometryBox[] = [];
	let order = 0;
	let dropped = 0;
	const walk = (parent: Entity, parentPlaying: boolean): void => {
		for (const child of getEntityChildren(world, parent)) {
			if (!isDrawn(child)) continue;
			const id = sourceId(child);
			const eid = child.id();
			order += 1;

			// Playing means on screen at this frame: inside its own span, not
			// hidden, and under a parent that is playing too — the renderer
			// stops at the first of those that fails (see `renderNode`).
			const playing = parentPlaying && computed.visibility[eid] !== 0 && !child.has(Hidden);
			const named = wanted !== null && id !== null && wanted.has(id);
			const reported = wanted ? named : playing || request.all === true;

			// Sound has a tile on the editor's canvas and nothing in the frame.
			if (reported && !child.has(Audio)) {
				const rect = getEntityBounds(world, [child]);
				if (rect && store(world, WorldBounds).minX[eid] !== undefined) {
					if (boxes.length >= MAX_BOXES) {
						dropped += 1;
					} else {
						const box: GeometryBox = {
							id,
							kind: labelOf(child),
							x: Math.round(rect.x - originX),
							y: Math.round(rect.y - originY),
							width: Math.round(rect.width),
							height: Math.round(rect.height),
							z: order,
							opacity: Number((computed.opacity[eid] ?? 1).toFixed(3)),
							visible: playing,
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
			}
			walk(child, playing);
		}
	};
	walk(scene, true);

	// Collisions worth reporting, not every stacked pair. A backplate that
	// contains its own text is the normal shape of a composition — flagging it
	// would send an agent to fix something that was never wrong. What is worth
	// knowing is a partial overlap: two things fighting for the same space,
	// both on screen, both opaque enough to be seen.
	const overlaps: Array<[string, string]> = [];
	let unlisted = 0;
	for (let i = 0; i < boxes.length; i += 1) {
		for (let j = i + 1; j < boxes.length; j += 1) {
			const a = boxes[i]!;
			const b = boxes[j]!;
			if (!a.id || !b.id || !a.visible || !b.visible || a.opacity <= 0 || b.opacity <= 0) continue;
			if (!intersects(a, b) || contains(a, b) || contains(b, a)) continue;
			if (overlaps.length >= MAX_OVERLAPS) unlisted += 1;
			else overlaps.push([a.id, b.id]);
		}
	}

	return {
		time: Number((frame / frameRateOf(world)).toFixed(4)),
		frame,
		scene: { id: sourceId(scene), width: frameWidth, height: frameHeight },
		boxes,
		overlaps,
		...(dropped || unlisted
			? {
				truncated: {
					...(dropped ? { boxes: dropped } : {}),
					...(unlisted ? { overlaps: unlisted } : {}),
					hint: 'Narrow the question: pass `ids`, or measure at a `time` when fewer elements are on screen.',
				},
			}
			: {}),
	};
}

function frameRateOf(world: World): number {
	return world.get(FrameRate)?.value ?? 30;
}
