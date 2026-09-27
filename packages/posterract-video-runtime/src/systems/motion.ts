/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Not, Or } from 'koota';
import { cubicBezier, steps, spring } from 'animejs';

import { store } from '../world/store';
import {
	Geometry, Group, AdjustmentLayer, Hidden, Culled,
	Computed, Cache, Animation, KeyframeTrack, Keyframe, Chars,
	UniformScale, Position, Offset, Rotation, Scale, Skew, Size, Opacity,
	Color, Blur, Volume, Effect, StrokeStyle, CornerRadius, MixedCornerRadius,
	ColorStop, Diagram, LottieSlot, Path, PathTrim,
	Knobs, TextAnimator, TextPath, Tilt, DEFAULT_TILT_PERSPECTIVE,
} from '../traits';
import { AnimationType, AnimationPhase, TrackLoop } from '../constants';
import { animationParams } from '../utils/animation-params';
import { loopedFrame } from '../utils/loop';
import { revealChars, revealWords, scrambleChars } from '../utils/text-motion';
import { getLocalWindow, getStaggerOffset } from '../utils/time';

import type { Entity, Trait, TraitRecord, World } from 'koota';

/**
 * Reset an entity's Computed values back to its authored trait values.
 * Motion (animations + keyframes) then layers on top each frame. A trait
 * the entity does not carry counts as its default: koota leaves store slots
 * as they were when a trait is removed, so the slot alone cannot say.
 * `ignore` treats one more trait as absent, for onRemove handlers (koota
 * fires them before the trait is cleared).
 */
export function resetAnimatedValues(world: World, entity: Entity | null, ignore?: Trait) {
	if (entity === null) return;

	const computed = store(world, Computed);
	const eid = entity.id();
	const read = <T extends Trait, K extends keyof TraitRecord<T>>(trait: T, field: K, fallback: TraitRecord<T>[K]): TraitRecord<T>[K] => {
		if (trait === ignore || !entity.has(trait)) return fallback;
		return (store(world, trait) as Record<K, TraitRecord<T>[K][]>)[field][eid] ?? fallback;
	};

	computed.positionX[eid] = read(Position, 'x', 0);
	computed.positionY[eid] = read(Position, 'y', 0);
	computed.offsetX[eid] = read(Offset, 'x', 0);
	computed.offsetY[eid] = read(Offset, 'y', 0);
	computed.rotation[eid] = read(Rotation, 'value', 0);
	computed.skewX[eid] = read(Skew, 'x', 0);
	computed.skewY[eid] = read(Skew, 'y', 0);
	computed.opacity[eid] = read(Opacity, 'value', 1);
	computed.color[eid] = read(Color, 'value', 0);
	computed.blur[eid] = read(Blur, 'value', 0);
	computed.volume[eid] = read(Volume, 'value', 0);
	computed.strokeWidth[eid] = read(StrokeStyle, 'width', 1);
	computed.cornerRadius[eid] = read(CornerRadius, 'value', 0);
	computed.cornerRadiusTopLeft[eid] = read(MixedCornerRadius, 'topLeft', 0);
	computed.cornerRadiusTopRight[eid] = read(MixedCornerRadius, 'topRight', 0);
	computed.cornerRadiusBottomRight[eid] = read(MixedCornerRadius, 'bottomRight', 0);
	computed.cornerRadiusBottomLeft[eid] = read(MixedCornerRadius, 'bottomLeft', 0);
	computed.stopOffset[eid] = read(ColorStop, 'offset', 0);
	// A reveal is a ratio: an authored value outside 0..1 means the same as
	// its nearest end, here as well as at the edge of a keyframe track.
	computed.progress[eid] = clamp01(read(Diagram, 'progress', 1));
	computed.chars[eid] = read(Chars, 'value', '');
	computed.trimStart[eid] = clamp01(read(PathTrim, 'start', 0));
	computed.trimEnd[eid] = clamp01(read(PathTrim, 'end', 1));
	computed.trimOffset[eid] = read(PathTrim, 'offset', 0);
	computed.morph[eid] = clamp01(read(Path, 'morph', 0));
	computed.shapeFrom[eid] = undefined;
	computed.shapeTo[eid] = undefined;
	computed.shapeT[eid] = 0;
	computed.tiltX[eid] = read(Tilt, 'x', 0);
	computed.tiltY[eid] = read(Tilt, 'y', 0);
	computed.perspective[eid] = read(Tilt, 'perspective', DEFAULT_TILT_PERSPECTIVE);
	computed.pathOffset[eid] = read(TextPath, 'offset', 0);
	computed.pathShift[eid] = read(TextPath, 'shift', 0);
	computed.effectSize[eid] = read(Effect, 'size', 0);
	computed.effectAngle[eid] = read(Effect, 'angle', 0);
	// A Lottie slot's authored value seeds the same channel effects use, so a
	// track over it interpolates like any other number. The fallback is the
	// current value rather than 0, which leaves every non-slot entity alone.
	computed.value[eid] = read(LottieSlot, 'value', computed.value[eid] ?? 0);

	if (entity.has(UniformScale) && ignore !== UniformScale) {
		computed.scaleX[eid] = read(UniformScale, 'value', 1);
		computed.scaleY[eid] = read(UniformScale, 'value', 1);
	} else {
		computed.scaleX[eid] = read(Scale, 'x', 1);
		computed.scaleY[eid] = read(Scale, 'y', 1);
	}
}

// The presets' own curves, as they have always been. Built once: a curve is
// asked for on every frame of every animated node.
const EASE_OUT_SOFT = cubicBezier(0.1, 0.7, 0.5, 1);
const EASE_GAIN = cubicBezier(0.4, 0.095, 0.546, 0.875);
const EASE_BLUR_OUT = cubicBezier(0.4, 0, 1, 1);
const EASE_BLUR_IN = cubicBezier(0.33, 0, 0.2, 1);
const EASE_SPIN = cubicBezier(0.44, 0.02, 0.252, 0.992);
const LINEAR: EasingFunction = (t) => t;

/**
 * The curve an animation plays with: the one it was given, or the preset's
 * own. "linear" has to be said in full here — for a keyframe the empty
 * descriptor means linear, for a preset it means "yours".
 */
function animationEasing(descriptor: string | undefined, own: EasingFunction): EasingFunction {
	if (!descriptor) return own;
	if (descriptor === 'linear') return LINEAR;
	return resolveEasing(descriptor) ?? own;
}

/**
 * Apply a preset animation to a node at the given normalized progress.
 *
 * `distance` and `amount` are the preset's magnitudes (see
 * `animationDefaults` for what each means per preset); left unset they are
 * what the presets always did.
 */
function applyAnimation(world: World, entity: Entity, anim: Entity, progress: number) {
	const computed = store(world, Computed);
	const animation = store(world, Animation);
	const chars = store(world, Chars);
	const eid = entity.id();
	const aid = anim.id();

	const type = animation.type[aid]!;
	const phase = animation.phase[aid];
	const isOut = phase === AnimationPhase.OUT;
	const { distance, amount } = animationParams(type, animation.distance[aid], animation.amount[aid]);
	const given = animation.easing[aid];

	switch (type) {
		case AnimationType.FADE: {
			const eased = clamp01(animationEasing(given, EASE_OUT_SOFT)(progress));
			// How far from fully shown: 1 at the hidden end, 0 at the shown one.
			const t = isOut ? eased : 1 - eased;
			computed.opacity[eid] = 1 - clamp01(amount) * t;
			break;
		}
		case AnimationType.GAIN: {
			const eased = clamp01(animationEasing(given, EASE_GAIN)(progress));
			const amplitude = isOut ? 1 - eased : eased;
			computed.volume[eid] = (computed.volume[eid] ?? 0) + amplitudeToDecibels(amplitude);
			break;
		}
		case AnimationType.GROW: {
			// Not clamped past 1: an overshooting curve (a spring) is the point of giving one.
			const eased = Math.max(0, animationEasing(given, EASE_OUT_SOFT)(progress));
			const t = isOut ? eased : 1 - eased;
			const scale = 1 - amount * t;
			computed.scaleX[eid] = scale;
			computed.scaleY[eid] = scale;
			break;
		}
		case AnimationType.SHRINK: {
			const eased = Math.max(0, animationEasing(given, EASE_OUT_SOFT)(progress));
			const t = isOut ? eased : 1 - eased;
			const scale = 1 + amount * t;
			computed.scaleX[eid] = scale;
			computed.scaleY[eid] = scale;
			break;
		}
		case AnimationType.BLUR: {
			const eased = clamp01(animationEasing(given, isOut ? EASE_BLUR_OUT : EASE_BLUR_IN)(progress));
			computed.blur[eid] = isOut ? lerp(0, amount, eased) : lerp(amount, 0, eased);
			break;
		}
		case AnimationType.SLIDE_LEFT:
		case AnimationType.SLIDE_RIGHT:
		case AnimationType.SLIDE_UP:
		case AnimationType.SLIDE_DOWN: {
			const eased = Math.max(0, animationEasing(given, EASE_OUT_SOFT)(progress));
			const t = isOut ? eased : 1 - eased;

			const sign = isOut ? -1 : 1;
			if (type === AnimationType.SLIDE_LEFT) {
				computed.offsetX[eid] = sign * distance * t;
			} else if (type === AnimationType.SLIDE_RIGHT) {
				computed.offsetX[eid] = sign * -distance * t;
			} else if (type === AnimationType.SLIDE_UP) {
				computed.offsetY[eid] = sign * distance * t;
			} else if (type === AnimationType.SLIDE_DOWN) {
				computed.offsetY[eid] = sign * -distance * t;
			}
			// The fade that travels with it; `amount` 0 slides at full opacity.
			computed.opacity[eid] = 1 - clamp01(amount) * clamp01(t);
			break;
		}
		case AnimationType.SPIN: {
			const eased = clamp01(animationEasing(given, EASE_SPIN)(progress));
			const t = isOut ? eased : 1 - eased;
			const scale = 1 - t;
			computed.scaleX[eid] = scale;
			computed.scaleY[eid] = scale;
			computed.rotation[eid] = -amount * t;
			break;
		}
		case AnimationType.TWIST: {
			const eased = clamp01(animationEasing(given, EASE_OUT_SOFT)(progress));
			const t = isOut ? eased : 1 - eased;
			const scale = 1 + t;
			computed.scaleX[eid] = scale;
			computed.scaleY[eid] = scale;
			computed.rotation[eid] = -amount * t;
			computed.offsetX[eid] = -distance * t;
			computed.offsetY[eid] = -distance * t;
			break;
		}
		case AnimationType.APPEAR_WORD: {
			const eased = clamp01(animationEasing(given, LINEAR)(progress));
			const t = isOut ? eased : 1 - eased;
			computed.chars[eid] = revealWords(chars.value[eid] ?? '', 1 - t);
			break;
		}
		case AnimationType.APPEAR_CHAR: {
			const eased = clamp01(animationEasing(given, LINEAR)(progress));
			const t = isOut ? eased : 1 - eased;
			computed.chars[eid] = revealChars(chars.value[eid] ?? '', 1 - t);
			break;
		}
		case AnimationType.SCRAMBLE: {
			const eased = clamp01(animationEasing(given, LINEAR)(progress));
			const t = isOut ? eased : 1 - eased;
			computed.chars[eid] = scrambleChars(chars.value[eid] ?? '', 1 - t);
			break;
		}
	}
}

/**
 * Properties that mean "a fraction of something" and are clamped to 0–1 after
 * sampling, so an overshooting easing reads as fully drawn rather than as
 * more than drawn.
 */
const RATIO_PROPERTIES = new Set<PropertyPath>(['diagram.progress', 'trim.start', 'trim.end', 'path.morph']);

export function motionSystem(world: World): void {
	const computed = store(world, Computed);

	// Knobs start every frame from what the source says; their tracks, run
	// below with every other track, write over that.
	const knobs = store(world, Knobs);
	for (const entity of world.query(Knobs)) {
		const kid = entity.id();
		knobs.computed[kid] = { ...(knobs.authored[kid] ?? {}) };
	}

	for (const entity of world.query(
		Or(Geometry, Group, AdjustmentLayer), Not(Hidden), Not(Culled),
	)) {
		const eid = entity.id();

		if (computed.visibility[eid] === 0) continue;

		// A staggering ancestor shifts this node's motion clock without moving
		// the node: the nth child simply samples its own tracks that much
		// earlier in their span.
		applyMotion(world, entity, computed.localTime[eid]! - getStaggerOffset(entity));
	}
}

/**
 * Runs one node's preset animations and keyframe tracks at `localFrame` (its
 * own clock, in frames — fractional frames sample between keyframes). The
 * motion system calls it for every visible node at the playhead; a repeater
 * calls it again for its template at each copy's own delayed clock.
 */
export function applyMotion(world: World, entity: Entity, localFrame: number): void {
	const computed = store(world, Computed);
	const cache = store(world, Cache);
	const animation = store(world, Animation);
	const keyframeTrack = store(world, KeyframeTrack);
	const worldProps = getPropertyPaths(world);
	const eid = entity.id();

	{
		const animations = cache.animations[eid] ?? [];
		const keyframeTracks = cache.keyframeTracks[eid] ?? [];
		if (animations.length === 0 && keyframeTracks.length === 0) return;

		resetAnimatedValues(world, entity);

		const source = getLocalWindow(entity);

		// 1: Preset animations (FADE/GAIN/GROW/SHRINK/BLUR/SLIDE)
		for (const anim of animations) {
			const aid = anim.id();
			const duration = animation.duration[aid] ?? 0;
			if (duration <= 0) continue;

			const delay = animation.delay[aid] ?? 0;
			const isOut = animation.phase[aid] === AnimationPhase.OUT;
			const windowStart = isOut
				? source.out - duration - delay
				: source.in + delay;
			const windowEnd = windowStart + duration;
			if (isOut ? localFrame < windowStart : localFrame >= windowEnd) continue;

			const progress = clamp01((localFrame - windowStart) / Math.max(1, duration - 1));
			applyAnimation(world, entity, anim, progress);
		}

		// 2: Keyframe tracks
		let uniformScale = entity.has(UniformScale);
		for (const track of keyframeTracks) {
			const tid = track.id();
			const property = keyframeTrack.property[tid] as PropertyPath;
			const target = keyframeTrack.target[tid];
			const keyframes = cache.keyframes[tid] ?? [];
			// A text animator's tracks play once per letter, word or line, each
			// at its own clock; the text renderer samples them (sampleTrackAt).
			if (target == null || target.has(TextAnimator)) continue;
			const loop = keyframeTrack.loop[tid] ?? TrackLoop.NONE;
			// Knobs and uniforms are named, not fixed fields: the value lands in
			// the target's computed knobs under the part of the path after the dot.
			if (isKnobPath(property)) {
				const value = sampleTrack(world, keyframes, localFrame, property, loop);
				if (value === null) continue;
				if (!target.has(Knobs)) target.add(Knobs);
				const holder = store(world, Knobs);
				const knobs = holder.computed[target.id()] ?? (holder.computed[target.id()] = {});
				knobs[knobName(property)] = value;
				continue;
			}
			// Shape keyframes carry path data rather than numbers: what the frame
			// needs is the two shapes it sits between and how far along.
			if (property === 'shape.d' || property === 'text.path') {
				sampleShapeTrack(world, keyframes, localFrame, loop, target);
				continue;
			}
			// A track whose property the runtime does not know is skipped, not
			// fatal: an unrecognised name should leave the frame alone rather
			// than take the whole composition down.
			const channel = worldProps[property] as { computed: number[] } | undefined;
			if (channel === undefined) continue;
			const result = sampleTrack(world, keyframes, localFrame, property, loop);
			if (result === null) continue;
			// A reveal is a ratio, so a track that overshoots (a spring, a
			// keyframe authored past the end) still reads as fully drawn.
			channel.computed[target.id()] = RATIO_PROPERTIES.has(property)
				? clamp01(result)
				: result;
			// A 'scale' track is the uniform scale whether or not the node also
			// authors the prop, so it scales both axes like UniformScale does.
			if (property === 'scale' && target === entity) uniformScale = true;
		}

		// Uniform scale is authored/animated as scaleX only; mirror it onto scaleY.
		if (uniformScale) {
			computed.scaleY[eid] = computed.scaleX[eid];
		}
	}
}

/**
 * Keyframeable properties: dot-path string to the computed (per-frame
 * resolved) and authored (document) store arrays.
 */
export function getPropertyPaths(world: World) {
	const computed = store(world, Computed);
	return {
		'position.x': {
			computed: computed.positionX,
			authored: store(world, Position).x,
		},
		'position.y': {
			computed: computed.positionY,
			authored: store(world, Position).y,
		},
		'offset.x': {
			computed: computed.offsetX,
			authored: store(world, Offset).x,
		},
		'offset.y': {
			computed: computed.offsetY,
			authored: store(world, Offset).y,
		},
		'rotation': {
			computed: computed.rotation,
			authored: store(world, Rotation).value,
		},
		'rotation.x': {
			computed: computed.tiltX,
			authored: store(world, Tilt).x,
		},
		'rotation.y': {
			computed: computed.tiltY,
			authored: store(world, Tilt).y,
		},
		'perspective': {
			computed: computed.perspective,
			authored: store(world, Tilt).perspective,
		},
		'scale.x': {
			computed: computed.scaleX,
			authored: store(world, Scale).x,
		},
		'scale.y': {
			computed: computed.scaleY,
			authored: store(world, Scale).y,
		},
		'scale': {
			computed: computed.scaleX,
			authored: store(world, UniformScale).value,
		},
		'skew.x': {
			computed: computed.skewX,
			authored: store(world, Skew).x,
		},
		'skew.y': {
			computed: computed.skewY,
			authored: store(world, Skew).y,
		},
		'width': {
			computed: computed.width,
			authored: store(world, Size).width,
		},
		'height': {
			computed: computed.height,
			authored: store(world, Size).height,
		},
		'opacity': {
			computed: computed.opacity,
			authored: store(world, Opacity).value,
		},
		'color': {
			computed: computed.color,
			authored: store(world, Color).value,
		},
		'blur': {
			computed: computed.blur,
			authored: store(world, Blur).value,
		},
		'volume': {
			computed: computed.volume,
			authored: store(world, Volume).value,
		},
		'effect.value': {
			computed: computed.value,
			authored: store(world, Effect).value,
		},
		'slot.value': {
			computed: computed.value,
			authored: store(world, LottieSlot).value,
		},
		'trim.start': {
			computed: computed.trimStart,
			authored: store(world, PathTrim).start,
		},
		'trim.end': {
			computed: computed.trimEnd,
			authored: store(world, PathTrim).end,
		},
		'trim.offset': {
			computed: computed.trimOffset,
			authored: store(world, PathTrim).offset,
		},
		'path.morph': {
			computed: computed.morph,
			authored: store(world, Path).morph,
		},
		'stroke.width': {
			computed: computed.strokeWidth,
			authored: store(world, StrokeStyle).width,
		},
		'vertexRadius': {
			computed: computed.cornerRadius,
			authored: store(world, CornerRadius).value,
		},
		'mixedVertexRadius.topLeft': {
			computed: computed.cornerRadiusTopLeft,
			authored: store(world, MixedCornerRadius).topLeft,
		},
		'mixedVertexRadius.topRight': {
			computed: computed.cornerRadiusTopRight,
			authored: store(world, MixedCornerRadius).topRight,
		},
		'mixedVertexRadius.bottomRight': {
			computed: computed.cornerRadiusBottomRight,
			authored: store(world, MixedCornerRadius).bottomRight,
		},
		'mixedVertexRadius.bottomLeft': {
			computed: computed.cornerRadiusBottomLeft,
			authored: store(world, MixedCornerRadius).bottomLeft,
		},
		'stop.offset': {
			computed: computed.stopOffset,
			authored: store(world, ColorStop).offset,
		},
		'diagram.progress': {
			computed: computed.progress,
			authored: store(world, Diagram).progress,
		},
		'textPath.offset': {
			computed: computed.pathOffset,
			authored: store(world, TextPath).offset,
		},
		'textPath.shift': {
			computed: computed.pathShift,
			authored: store(world, TextPath).shift,
		},
		'effect.size': {
			computed: computed.effectSize,
			authored: store(world, Effect).size,
		},
		'effect.angle': {
			computed: computed.effectAngle,
			authored: store(world, Effect).angle,
		},
		'chars': {
			computed: computed.chars,
			authored: store(world, Chars).value,
		},
	};
}

/**
 * Every path a keyframe track can drive: the fixed fields above, a knob or a
 * uniform by name (`knob.tilt`, `uniform.amount`), and shape keyframes.
 */
export type PropertyPath =
	| keyof ReturnType<typeof getPropertyPaths>
	| `knob.${string}`
	| `uniform.${string}`
	| 'shape.d'
	| 'text.path';

/** Whether a track drives a named knob (or a shader uniform) rather than a field. */
export function isKnobPath(path: string): path is `knob.${string}` | `uniform.${string}` {
	return path.startsWith('knob.') || path.startsWith('uniform.');
}

/** The knob a knob path names: `knob.tilt` is `tilt`. */
export function knobName(path: string): string {
	return path.slice(path.indexOf('.') + 1);
}

/**
 * One track, sampled at `frame` of its holder's clock: what a text animator
 * asks for each letter, at that letter's own delayed clock. Null for a track
 * with no keyframes.
 */
export function sampleTrackAt(world: World, track: Entity, frame: number): number | null {
	const tid = track.id();
	const keyframes = store(world, Cache).keyframes[tid] ?? [];
	const keyframeTrack = store(world, KeyframeTrack);
	return sampleTrack(world, keyframes, frame, keyframeTrack.property[tid] as PropertyPath, keyframeTrack.loop[tid] ?? TrackLoop.NONE);
}

/**
 * Samples a shape track: finds the two keyframes the frame sits between and
 * writes them, with the eased progress between them, to the target's
 * `Computed.shapeFrom/shapeTo/shapeT`. The blend itself happens where the
 * figure is drawn (see `morphPathData`), cached per pair of shapes.
 */
function sampleShapeTrack(world: World, keyframes: Entity[], frame: number, loop: TrackLoop, target: Entity): void {
	const computed = store(world, Computed);
	const keyframe = store(world, Keyframe);
	const tid = target.id();
	const shaped = keyframes.filter((key) => (keyframe.text[key.id()] ?? '') !== '');
	if (shaped.length === 0) return;

	const first = shaped[0]!;
	const last = shaped[shaped.length - 1]!;
	if (shaped.length === 1) {
		computed.shapeFrom[tid] = keyframe.text[first.id()];
		computed.shapeTo[tid] = keyframe.text[first.id()];
		computed.shapeT[tid] = 0;
		return;
	}

	const firstFrame = keyframe.time[first.id()]!;
	const lastFrame = keyframe.time[last.id()]!;
	const at = loopedFrame(frame, firstFrame, lastFrame, loop);

	if (at <= firstFrame || at >= lastFrame) {
		const held = at <= firstFrame ? first : last;
		computed.shapeFrom[tid] = keyframe.text[held.id()];
		computed.shapeTo[tid] = keyframe.text[held.id()];
		computed.shapeT[tid] = 0;
		return;
	}

	for (let i = 0; i < shaped.length - 1; i++) {
		const from = shaped[i]!;
		const to = shaped[i + 1]!;
		const start = keyframe.time[from.id()]!;
		const end = keyframe.time[to.id()]!;
		if (at < start || at > end || end <= start) continue;

		let progress = (at - start) / (end - start);
		const easingFn = resolveEasing(keyframe.easing[from.id()]);
		if (easingFn) progress = easingFn(progress);

		computed.shapeFrom[tid] = keyframe.text[from.id()];
		computed.shapeTo[tid] = keyframe.text[to.id()];
		// A spring may overshoot; a shape cannot go past its target.
		computed.shapeT[tid] = Math.max(0, Math.min(1, progress));
		return;
	}
}

// ─── Easing ─────────────────────────────────────────────────

type EasingFunction = (t: number) => number;

const easingCache = new Map<string, EasingFunction>();

/**
 * Parse an easing descriptor string and return an easing function.
 * Returns null for empty/undefined (= default linear interpolation).
 * Supported formats:
 *   "steps(9)"  or "steps(9,true)"        → animejs steps(n, fromStart?)
 *   "cubicBezier(0.25,0.1,0.25,1)"       → animejs cubicBezier(x1,y1,x2,y2)
 *   "spring(0.5,500)"                     → animejs spring({ bounce, duration })
 */
function resolveEasing(descriptor: string | undefined): EasingFunction | null {
	if (!descriptor || descriptor === '') return null;

	const cached = easingCache.get(descriptor);
	if (cached) return cached;

	let fn: EasingFunction | null = null;

	const stepsMatch = descriptor.match(/^steps\((\d+)(?:,(true|false))?\)$/);
	if (stepsMatch) {
		const n = Number.parseInt(stepsMatch[1]!, 10);
		const fromStart = stepsMatch[2] === 'true';
		fn = steps(n, fromStart);
	}

	const bezierMatch = descriptor.match(/^cubicBezier\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)$/);
	if (bezierMatch) {
		const [, x1, y1, x2, y2] = bezierMatch;
		fn = cubicBezier(Number(x1), Number(y1), Number(x2), Number(y2));
	}

	const springMatch = descriptor.match(/^spring\(([\d.-]+),([\d.-]+)\)$/);
	if (springMatch) {
		const [, bounce, duration] = springMatch;
		const s = spring({
			bounce: Number(bounce),
			duration: Number(duration),
		});
		fn = (t: number) => s.ease(t);
	}

	if (fn) {
		easingCache.set(descriptor, fn);
		return fn;
	}

	return null;
}

/**
 * Sample a presorted aggregated keyframe track at a local frame.
 * Returns null only if the track has no keyframes.
 */
function sampleTrack(
	world: World,
	keyframes: Entity[],
	frame: number,
	property: PropertyPath,
	loop: TrackLoop = TrackLoop.NONE,
): number | null {
	const keyframe = store(world, Keyframe);
	if (keyframes.length === 0) return null;

	if (keyframes.length === 1) {
		return keyframe.value[keyframes[0]!.id()]!;
	}

	const firstValue = keyframe.value[keyframes[0]!.id()]!;
	const lastValue = keyframe.value[keyframes[keyframes.length - 1]!.id()]!;

	const firstFrame = keyframe.time[keyframes[0]!.id()]!;
	const lastFrame = keyframe.time[keyframes[keyframes.length - 1]!.id()]!;

	// A looping track is the same track sampled at a wrapped time.
	frame = loopedFrame(frame, firstFrame, lastFrame, loop);

	if (frame <= firstFrame) {
		return firstValue;
	}

	if (frame >= lastFrame) {
		return lastValue;
	}

	for (let i = 0; i < keyframes.length - 1; i++) {
		const start = keyframe.time[keyframes[i]!.id()]!;
		const end = keyframe.time[keyframes[i + 1]!.id()]!;
		if (frame < start || frame > end) continue;

		const span = end - start;
		if (span <= 0) continue;

		let progress = Math.max(0, Math.min(1, (frame - start) / span));

		const easingFn = resolveEasing(keyframe.easing[keyframes[i]!.id()]);
		if (easingFn) {
			progress = easingFn(progress);
		}

		const startValue = keyframe.value[keyframes[i]!.id()]!;
		const endValue = keyframe.value[keyframes[i + 1]!.id()]!;

		if (property === 'color') {
			return lerpColor(startValue, endValue, progress);
		}

		// Linear interpolation
		return startValue + (endValue - startValue) * progress;
	}

	return lastValue;
}

/**
 * Channel-wise linear interpolation between two packed 0xRRGGBB colors.
 * Linear interpolation on the packed integer bleeds bits between channels
 * and produces wrong intermediate hues.
 */
function lerpColor(from: number, to: number, progress: number): number {
	const r0 = (from >> 16) & 0xFF;
	const g0 = (from >> 8) & 0xFF;
	const b0 = from & 0xFF;
	const r1 = (to >> 16) & 0xFF;
	const g1 = (to >> 8) & 0xFF;
	const b1 = to & 0xFF;
	const r = Math.round(r0 + (r1 - r0) * progress);
	const g = Math.round(g0 + (g1 - g0) * progress);
	const b = Math.round(b0 + (b1 - b0) * progress);
	return (r << 16) | (g << 8) | b;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

/**
 * An amplitude multiplier (0-1) as the decibels to add to a volume. Silence
 * is -Infinity, which is what the audio bus reads as a gain of zero; every
 * other value is negative, so a ramp only ever attenuates.
 */
function amplitudeToDecibels(amplitude: number): number {
	return amplitude <= 0 ? -Infinity : 20 * Math.log10(amplitude);
}

function lerp(from: number, to: number, progress: number): number {
	return from + (to - from) * progress;
}
