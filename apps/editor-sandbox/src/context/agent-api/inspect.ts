/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `inspect` — what is in a video and what is wrong with it, as text.
 *
 * An agent is good at code for one reason: the loop is tight and the feedback
 * is exact. The compiler says line 42 is wrong; `ffprobe` says the file is
 * 14.2 s at 30 fps. A composition had no such answer. `validate` knows it
 * compiles, `check` knows one subtree's structure, `get_geometry` knows one
 * moment, and a capture is a picture — the most expensive thing an agent can
 * read and the one it misjudges most (cut off by 4 px or 40?).
 *
 * The mistakes agents actually make are none of those tools' business. They
 * compile and they look wrong: text running off the frame, a caption on screen
 * for four frames, a line hidden behind a later layer, a gap where nothing
 * draws. Every one of them is arithmetic on boxes and spans, so this does the
 * arithmetic — across the whole duration, not at one playhead — and reports
 * facts and problems separately, each problem with the element, the numbers
 * and what would fix it.
 *
 * Time is visited at the moments things change (an element's first and last
 * frame, its midpoint, its keyframes, the ends of its entrance and exit),
 * because between those nothing can newly go wrong for linear motion. Nothing
 * is decoded and nothing is drawn; the playhead is put back before every
 * yield, so the author's canvas never shows a moment they did not choose.
 */

import {
	Animation, AnimationPhase, Audio, Cache, Chars, Computed, Cue, Duck, Effect, FrameRate, Hidden, Keyframe, KeyframeTrack,
	Marker, Name, Position, Scene, Shadow, Size, Source, Stroke, Transition, Workarea, WorldBounds,
	getActiveEntity, getEntityBounds, getEntityChildren, isText, measureText, motionSystem, placeInTime, playbackSystem,
	setPlayhead, store, transformSystem,
	TextPath,
} from '@posterract/video-runtime';
import { parseSource } from '@posterract/composition';

import { handleCheck, kindOf, labelOf } from './check';
import { resolveNode } from './nodes';

import type { Entity, World } from 'koota';
import type { EditorSession } from './session';

export type InspectRequest = {
	/** The scene to inspect, by id; the active one when omitted. */
	id?: string;
};

export type InspectProblem = {
	severity: 'error' | 'warning' | 'note';
	code: string;
	/** The element it is about, by id. Absent for a problem of the scene as a whole. */
	id?: string;
	/** Scene-local seconds where it is worst, or where it starts. */
	at?: number;
	message: string;
	/** What would fix it, when arithmetic can say. */
	fix?: string;
};

export type InspectElement = {
	id: string | null;
	kind: string;
	name?: string;
	/** Scene-local seconds. */
	start: number;
	end: number;
	text?: string;
	/** Where it sits at the middle of its span, in scene space. Absent for sound. */
	box?: { x: number; y: number; width: number; height: number };
	/** How many keyframes move it. */
	keyframes?: number;
	depth: number;
};

export type InspectResult = {
	scene: { id: string | null; name?: string; width: number; height: number; fps: number; duration: number; workarea?: [number, number] };
	elements: InspectElement[];
	markers: Array<{ time: number; name: string }>;
	problems: InspectProblem[];
	samples: number;
	ms: number;
};

/** Nodes that live in the tree but never draw (the same list `get_geometry` leaves out). */
const NOT_DRAWN = [Keyframe, KeyframeTrack, Animation, Transition, Marker, Cue, Duck, Effect, Shadow, Stroke];

/** A visit to more moments than this is thinned: the ends and middles of spans are kept, keyframes go first. */
const MAX_SAMPLES = 360;
/** How long one synchronous burst of sampling may hold the editor's thread. */
const BURST_MS = 10;

/** On screen for less than this, nobody reads it. */
const MIN_TEXT_SECONDS = 0.3;
/** On screen for less than this, nobody sees it. */
const MIN_VISUAL_SECONDS = 0.1;
/** A box is "clipped" past this many pixels; less is antialiasing and rounding. */
const CLIP_TOLERANCE = 2;

type Box = { x: number; y: number; width: number; height: number };
type Sample = { frame: number; box: Box; opacity: number };
type Tracked = {
	entity: Entity;
	eid: number;
	id: string | null;
	kind: string;
	name?: string;
	depth: number;
	z: number;
	start: number;
	end: number;
	text?: string;
	sound: boolean;
	moving: boolean;
	keyframes: number;
	samples: Sample[];
};

function sourceId(entity: Entity): string | null {
	const source = entity.get(Source)?.value;
	if (!source) return null;
	const locator = parseSource(source)?.locator;
	return typeof locator === 'string' ? locator : null;
}

const round = (value: number, places = 2): number => Number(value.toFixed(places));
const label = (item: { id: string | null; kind: string }): string => `${item.kind}${item.id ? `#${item.id}` : ''}`;

/** Elements that put something in the frame or the mix, with the spans their ancestors leave them. */
function track(world: World, scene: Entity): Tracked[] {
	const computed = store(world, Computed);
	const found: Tracked[] = [];
	let z = 0;

	const walk = (parent: Entity, window: { start: number; end: number }, depth: number): void => {
		for (const child of getEntityChildren(world, parent)) {
			const eid = child.id();
			// Keyframes, tracks, presets, strokes, effects, markers: nodes of the
			// tree that say how an element moves or looks, with nothing of their
			// own in the frame. (They can inherit a span and bounds from the
			// element they belong to, which is why they are named here.)
			if (NOT_DRAWN.some((trait) => child.has(trait))) continue;
			if (computed.start[eid] === undefined || computed.end[eid] === undefined) continue;
			if (kindOf(child) === 'mask') continue;
			const kind = labelOf(child);
			if (child.has(Hidden)) continue;

			const start = Math.max(window.start, computed.start[eid]!);
			const end = Math.min(window.end, computed.end[eid]!);
			z += 1;
			if (end > start) {
				const cache = child.get(Cache);
				const keyframes = (cache?.keyframeTracks ?? []).reduce(
					(sum, trackEntity) => sum + (trackEntity.get(Cache)?.keyframes.length ?? 0), 0);
				const text = child.get(Chars)?.value;
				found.push({
					entity: child,
					eid,
					id: sourceId(child),
					kind,
					...(child.get(Name)?.value ? { name: child.get(Name)!.value } : {}),
					depth,
					z,
					start,
					end,
					...(typeof text === 'string' && text ? { text } : {}),
					sound: child.has(Audio),
					moving: keyframes > 0 || (cache?.animations.length ?? 0) > 0,
					keyframes,
					samples: [],
				});
			}
			walk(child, { start, end: Math.max(start, end) }, depth + 1);
		}
	};

	const sid = scene.id();
	walk(scene, { start: computed.start[sid] ?? 0, end: computed.end[sid] ?? 0 }, 0);
	return found;
}

/** The frames worth visiting for one element: where it begins, ends, and changes direction. */
function momentsOf(world: World, item: Tracked): { anchors: number[]; turns: number[] } {
	const computed = store(world, Computed);
	const last = Math.max(item.start, item.end - 1);
	const anchors = [item.start, Math.round((item.start + last) / 2), last];
	const turns: number[] = [];

	const cache = item.entity.get(Cache);
	const origin = computed.origin[item.eid] ?? item.start;
	const rate = computed.playbackRate[item.eid] || 1;
	for (const trackEntity of cache?.keyframeTracks ?? []) {
		for (const keyframe of trackEntity.get(Cache)?.keyframes ?? []) {
			const time = keyframe.get(Keyframe)?.time;
			if (typeof time === 'number') turns.push(Math.round(origin + time / rate));
		}
	}
	for (const animationEntity of cache?.animations ?? []) {
		const animation = animationEntity.get(Animation);
		if (!animation) continue;
		const span = animation.delay + animation.duration;
		turns.push(animation.phase === AnimationPhase.OUT ? item.end - span : item.start + span);
	}
	return { anchors, turns: turns.filter((frame) => frame > item.start && frame < last) };
}

function overflow(box: Box, width: number, height: number): { left: number; top: number; right: number; bottom: number } {
	return {
		left: Math.max(0, -box.x),
		top: Math.max(0, -box.y),
		right: Math.max(0, box.x + box.width - width),
		bottom: Math.max(0, box.y + box.height - height),
	};
}

const intersects = (a: Box, b: Box): boolean =>
	a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const contains = (outer: Box, inner: Box): boolean =>
	outer.x <= inner.x && outer.y <= inner.y
	&& outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;

export function handleInspect(session: () => EditorSession) {
	return async (request: InspectRequest = {}): Promise<InspectResult> => {
		const began = performance.now();
		const { world } = session();
		const scene = request.id ? resolveNode(world, request.id) : getActiveEntity(world);
		if (!scene) throw new Error('No active video to inspect. Pass a scene id.');
		if (!scene.has(Scene)) throw new Error(`"${request.id}" is not a scene; inspect takes the id of a scene (a whole video).`);

		const computed = store(world, Computed);
		const fps = world.get(FrameRate)?.value ?? 30;
		const sid = scene.id();
		// Spans are resolved by a tick (`after` becomes a delay there); make sure one has run.
		playbackSystem(world);

		const width = computed.width[sid] || scene.get(Size)?.width || 0;
		const height = computed.height[sid] || scene.get(Size)?.height || 0;
		const originX = scene.get(Position)?.x ?? 0;
		const originY = scene.get(Position)?.y ?? 0;
		const sceneStart = computed.start[sid] ?? 0;
		const seconds = (frame: number): number => round((frame - sceneStart) / fps, 3);

		const items = track(world, scene);
		const visual = items.filter((item) => !item.sound);
		const texts = visual.filter((item) => isText(item.entity));

		// Which frames to visit. Every element's first, middle and last frame
		// always; its turning points while there is room.
		const anchors = new Set<number>();
		const turns = new Set<number>();
		for (const item of visual) {
			const moments = momentsOf(world, item);
			for (const frame of moments.anchors) anchors.add(frame);
			for (const frame of moments.turns) turns.add(frame);
		}
		for (const frame of anchors) turns.delete(frame);
		let extra = [...turns].sort((a, b) => a - b);
		const room = Math.max(0, MAX_SAMPLES - anchors.size);
		if (extra.length > room) {
			const step = extra.length / Math.max(1, room);
			extra = Array.from({ length: room }, (_, index) => extra[Math.floor(index * step)]!);
		}
		const frames = [...new Set([...anchors, ...extra])].sort((a, b) => a - b);

		// Visit them in short bursts. Within a burst the scene is moved without
		// touching a decoder (`placeInTime`); before every yield the playhead goes
		// back where the author left it, so nothing they see ever jumps.
		const parked = computed.localTime[sid] ?? 0;
		const bounds = store(world, WorldBounds);
		const measure = (frame: number): void => {
			placeInTime(world, scene, frame);
			motionSystem(world);
			for (const item of texts) if (item.entity.isAlive()) measureText(world, item.entity);
			transformSystem(world);
			for (const item of visual) {
				if (frame < item.start || frame >= item.end || !item.entity.isAlive()) continue;
				if (bounds.minX[item.eid] === undefined) continue;
				const rect = getEntityBounds(world, [item.entity]);
				if (!rect) continue;
				item.samples.push({
					frame,
					box: { x: Math.round(rect.x - originX), y: Math.round(rect.y - originY), width: Math.round(rect.width), height: Math.round(rect.height) },
					opacity: computed.opacity[item.eid] ?? 1,
				});
			}
		};
		const restore = (): void => {
			setPlayhead(world, scene, parked);
			playbackSystem(world);
			motionSystem(world);
			transformSystem(world);
		};

		try {
			let burst = performance.now();
			for (const frame of frames) {
				measure(frame);
				if (performance.now() - burst > BURST_MS) {
					restore();
					await new Promise((resolve) => setTimeout(resolve, 0));
					if (!scene.isAlive()) throw new Error('The project was reloaded while it was being inspected; run inspect again.');
					burst = performance.now();
				}
			}
		} finally {
			if (scene.isAlive()) restore();
		}

		const problems: InspectProblem[] = [];

		// Structure first: what `check` already knows — black frames, sources
		// that failed, spans that never open.
		const structure = await handleCheck(session)({ id: sourceId(scene) ?? scene.get(Source)?.value ?? '' }).catch(() => null);
		for (const issue of structure?.issues ?? []) {
			const about = issue.node ? parseSource(issue.node)?.locator : undefined;
			problems.push({
				severity: issue.severity === 'error' ? 'error' : 'warning',
				code: issue.code,
				...(typeof about === 'string' ? { id: about } : {}),
				...(issue.ranges?.length ? { at: issue.ranges[0]!.start } : {}),
				message: issue.ranges?.length
					? `${issue.message}: ${issue.ranges.slice(0, 6).map((range) => `${range.start}–${range.end}s`).join(', ')}${issue.ranges.length > 6 ? ', …' : ''}`
					: issue.message,
			});
		}

		for (const item of visual) {
			const { samples } = item;
			if (!samples.length) continue;
			const duration = (item.end - item.start) / fps;
			const isWords = isText(item.entity);

			// Text off the frame. An entrance may begin off-frame on purpose, so
			// one bad moment is not a finding: most of them, or the middle, is.
			// Text on a path is laid along it — a marquee runs off the frame on
			// purpose — so its box says nothing about glyphs being cut.
			if (isWords && !item.entity.has(TextPath)) {
				const worst = { left: 0, top: 0, right: 0, bottom: 0, frame: samples[0]!.frame, count: 0 };
				for (const sample of samples) {
					const over = overflow(sample.box, width, height);
					const most = Math.max(over.left, over.top, over.right, over.bottom);
					if (most <= CLIP_TOLERANCE) continue;
					worst.count += 1;
					if (most > Math.max(worst.left, worst.top, worst.right, worst.bottom)) Object.assign(worst, over, { frame: sample.frame });
				}
				if (worst.count * 2 >= samples.length) {
					const middle = samples[Math.floor(samples.length / 2)]!.box;
					const edges = (['left', 'top', 'right', 'bottom'] as const).filter((edge) => worst[edge] > CLIP_TOLERANCE);
					const fixes: string[] = [];
					if (middle.width > width) fixes.push(`it is ${middle.width}px wide in a ${width}px frame: give it width={${Math.max(1, width - 96)}} so it wraps`);
					else if (worst.right > CLIP_TOLERANCE) fixes.push(`x ${middle.x} → ${middle.x - worst.right}`);
					else if (worst.left > CLIP_TOLERANCE) fixes.push(`x ${middle.x} → ${middle.x + worst.left}`);
					if (middle.height <= height && worst.bottom > CLIP_TOLERANCE) fixes.push(`y ${middle.y} → ${middle.y - worst.bottom}`);
					else if (middle.height <= height && worst.top > CLIP_TOLERANCE) fixes.push(`y ${middle.y} → ${middle.y + worst.top}`);
					problems.push({
						severity: 'error',
						code: 'text-cut-off',
						...(item.id ? { id: item.id } : {}),
						at: seconds(worst.frame),
						message: `${label(item)} "${(item.text ?? '').slice(0, 40)}" runs off the frame: ${edges.map((edge) => `${worst[edge]}px past the ${edge} edge`).join(', ')}`,
						...(fixes.length ? { fix: item.moving ? `${fixes.join('; ')} (it is animated — move its keyframes by the same amount)` : fixes.join('; ') } : {}),
					});
				}
			}

			// Never in the frame at all.
			const outside = samples.every(({ box }) => box.x + box.width <= 0 || box.y + box.height <= 0 || box.x >= width || box.y >= height);
			if (outside) {
				const box = samples[Math.floor(samples.length / 2)]!.box;
				problems.push({
					severity: 'warning',
					code: 'never-in-frame',
					...(item.id ? { id: item.id } : {}),
					at: seconds(item.start),
					message: `${label(item)} is outside the ${width}×${height} frame for its whole span (at ${box.x},${box.y}, ${box.width}×${box.height})`,
				});
			}

			// Never opaque enough to see.
			if (samples.every((sample) => sample.opacity <= 0.01)) {
				problems.push({
					severity: 'warning',
					code: 'never-visible',
					...(item.id ? { id: item.id } : {}),
					at: seconds(item.start),
					message: `${label(item)} has opacity 0 for its whole span`,
					fix: 'set opacity, or give it a fade that ends above 0',
				});
			}

			// Too brief to register.
			const minimum = isWords ? MIN_TEXT_SECONDS : MIN_VISUAL_SECONDS;
			if (duration < minimum) {
				problems.push({
					severity: 'warning',
					code: 'too-short',
					...(item.id ? { id: item.id } : {}),
					at: seconds(item.start),
					message: `${label(item)} is on screen for ${round(duration)}s (${item.end - item.start} frames) — too short to ${isWords ? 'read' : 'see'}`,
					fix: `end ${seconds(item.end)} → ${round(seconds(item.start) + minimum)}`,
				});
			}
		}

		// Words fighting words, and words behind pictures. Compared moment by
		// moment: two captions that take turns in one spot never meet.
		const byFrame = new Map<number, Array<{ item: Tracked; sample: Sample }>>();
		for (const item of visual) {
			for (const sample of item.samples) {
				if (sample.opacity <= 0.05) continue;
				const list = byFrame.get(sample.frame) ?? [];
				list.push({ item, sample });
				byFrame.set(sample.frame, list);
			}
		}
		const clashes = new Map<string, InspectProblem>();
		for (const [frame, present] of byFrame) {
			for (const { item: words, sample } of present) {
				if (!isText(words.entity)) continue;
				for (const { item: other, sample: otherSample } of present) {
					if (other === words || other.z <= words.z) continue;
					if (isText(other.entity)) {
						if (!intersects(sample.box, otherSample.box) || contains(sample.box, otherSample.box) || contains(otherSample.box, sample.box)) continue;
						const key = `overlap:${words.eid}:${other.eid}`;
						if (!clashes.has(key)) {
							clashes.set(key, {
								severity: 'warning',
								code: 'text-overlap',
								...(words.id ? { id: words.id } : {}),
								at: seconds(frame),
								message: `${label(words)} and ${label(other)} overlap while both are on screen`,
							});
						}
					} else if (otherSample.opacity >= 0.99 && contains(otherSample.box, sample.box) && ['video', 'image', 'rect'].includes(other.kind)) {
						const key = `behind:${words.eid}:${other.eid}`;
						if (!clashes.has(key)) {
							clashes.set(key, {
								severity: 'warning',
								code: 'text-behind',
								...(words.id ? { id: words.id } : {}),
								at: seconds(frame),
								message: `${label(words)} is drawn underneath ${label(other)}, which covers it completely — it may not be visible`,
								fix: `move ${label(words)} after ${label(other)} in the source (later draws on top)`,
							});
						}
					}
				}
			}
		}
		problems.push(...clashes.values());

		// Captions that are pictures: they look right and cannot be edited.
		const captionLike = visual.filter((item) => item.kind === 'image' && /caption|subtitle|cue/i.test(`${item.name ?? ''} ${item.id ?? ''}`));
		if (captionLike.length >= 5 && texts.length === 0) {
			problems.push({
				severity: 'note',
				code: 'captions-as-images',
				message: `${captionLike.length} images look like captions (by name) and there is no <text> or <captions> in the scene: the words are pixels, so nobody can edit them on the canvas. <captions> with <cue> children keeps them text.`,
			});
		}

		const rank = { error: 0, warning: 1, note: 2 } as const;
		problems.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.at ?? 0) - (b.at ?? 0));

		const workarea = scene.get(Workarea);
		const markers = getEntityChildren(world, scene)
			.flatMap((child) => {
				const marker = child.get(Marker);
				return marker ? [{ time: round(marker.time / fps, 3), name: marker.name }] : [];
			})
			.sort((a, b) => a.time - b.time);

		return {
			scene: {
				id: sourceId(scene),
				...(scene.get(Name)?.value ? { name: scene.get(Name)!.value } : {}),
				width,
				height,
				fps,
				duration: round(((computed.end[sid] ?? 0) - sceneStart) / fps, 3),
				...(workarea ? { workarea: [round(workarea.start / fps, 3), round((workarea.end || (computed.end[sid] ?? 0) - sceneStart) / fps, 3)] as [number, number] } : {}),
			},
			elements: items.map((item) => {
				const middle = item.samples[Math.floor(item.samples.length / 2)]?.box;
				return {
					id: item.id,
					kind: item.kind,
					...(item.name ? { name: item.name } : {}),
					start: seconds(item.start),
					end: seconds(item.end),
					...(item.text ? { text: item.text.length > 80 ? `${item.text.slice(0, 79)}…` : item.text } : {}),
					...(middle ? { box: middle } : {}),
					...(item.keyframes ? { keyframes: item.keyframes } : {}),
					depth: item.depth,
				};
			}),
			markers,
			problems,
			samples: frames.length,
			ms: Math.round(performance.now() - began),
		};
	};
}
