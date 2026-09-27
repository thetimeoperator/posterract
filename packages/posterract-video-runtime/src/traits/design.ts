/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

/**
 * Motion design state: what makes motion read as smooth (motion blur, the
 * beat grid), the knobs code-drawn content is driven by, and the elements
 * that multiply or rearrange what they hold (the repeater, the text animator,
 * text on a path).
 */

/**
 * A scene's motion blur: `shutter` is the fraction of a frame the shutter is
 * open, in degrees (180 is half a frame), `samples` how many in-between
 * moments one frame is blended from. Only on scenes.
 */
export const MotionBlur = trait({ shutter: 180, samples: 8 });

/** An element that stays sharp while its scene blurs (`motionBlur={false}`). */
export const NoMotionBlur = trait();

/** How far the camera of a 3D tilt is when the source does not say, in the element's pixels. */
export const DEFAULT_TILT_PERSPECTIVE = 2000;

/**
 * An element tilted in 3D (`rotationX`, `rotationY`, degrees) and the camera
 * it is seen through (`perspective`, px): X tips the top away, Y turns the
 * right side away, about the element's middle. Canvas 2D only draws flat
 * pictures, so a tilted element is drawn flat into a layer and the layer is
 * turned on the GPU (see `media/tilt`).
 */
export const Tilt = trait({ x: 0, y: 0, perspective: DEFAULT_TILT_PERSPECTIVE });

/** A scene's tempo: beats per minute, and beats to the bar. Only on scenes. */
export const Tempo = trait({ bpm: 0, meter: 4 });

/**
 * Named values that code reads and the timeline drives: a `<surface>`'s and an
 * `<html>`'s knobs, a `<shaderPaint>`'s numeric uniforms, a `<repeater>`'s
 * numbers. `authored` is what the source says, `computed` what this frame
 * says once the knob tracks have run — the motion system resets one to the
 * other every frame, the way it does for every other animated value.
 */
export const Knobs = trait({
	authored: () => ({} as Record<string, number | string>),
	computed: () => ({} as Record<string, number | string>),
});

/** What a surface's `draw` is handed besides its knobs. */
export type SurfaceDrawInfo = {
	width: number;
	height: number;
	pixelRatio: number;
	canvas: HTMLCanvasElement | OffscreenCanvas;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SurfaceDrawFunction = (context: any, knobs: Readonly<Record<string, number | string>>, info: SurfaceDrawInfo) => void;

/**
 * A `<surface>` that draws itself from its knobs. The renderer calls `draw`
 * whenever the knobs or the box change (`drawn` remembers what it last drew
 * for), which is what makes a surface a function of the timeline instead of a
 * clock of its own.
 */
export const SurfaceDraw = trait({
	draw: () => null as SurfaceDrawFunction | null,
	context: () => '2d' as '2d' | 'webgl' | 'webgl2',
	drawn: () => '',
});

export enum TextAnimatorUnit {
	LETTER,
	WORD,
	LINE,
}

export enum TextAnimatorOrder {
	FORWARD,
	REVERSE,
	CENTER,
	EDGES,
	RANDOM,
}

/**
 * A `<textAnimator>`: moves its text a unit at a time. `stagger` is in frames.
 * Its keyframe tracks are sampled per unit by the text renderer, each unit at
 * its own clock — never applied to the animator itself.
 */
export const TextAnimator = trait({
	by: TextAnimatorUnit.LETTER as TextAnimatorUnit,
	stagger: 0,
	order: TextAnimatorOrder.FORWARD as TextAnimatorOrder,
});

/**
 * A `<repeater>`'s settings that are not numbers. Its numbers — count,
 * spacing, the camera — are `Knobs`, so each is keyframeable by name.
 * `stagger` is in frames; `colorTo` is 0xRRGGBB, or -1 for none.
 */
export const Repeater = trait({
	layout: 'circle',
	layoutTo: '',
	rippleMode: 'z',
	staggerOrder: 'index',
	stagger: 0,
	colorTo: -1,
	colorBy: 'wave',
});

/** The numbers a repeater takes, with what they are when not authored. */
export const REPEATER_KNOBS: Readonly<Record<string, number>> = {
	count: 12,
	morph: 0,
	columns: 0,
	spacing: 40,
	radius: 200,
	tube: 60,
	seed: 1,
	ripple: 0,
	rippleFrequency: 2,
	ripplePhase: 0,
	rippleCenterX: 0,
	rippleCenterY: 0,
	tiltX: 0,
	tiltY: 0,
	roll: 0,
	zoom: 1,
	perspective: 0,
	cameraZ: 0,
	depthFade: 0,
};

export enum TextPathAlign {
	START,
	CENTER,
	END,
}

/**
 * A `<text>` laid along a path: `d` in the element's own coordinates, how far
 * along it the text sits (`offset`, a fraction of its length), how far off it
 * (`shift`, px), and which part of the text sits at `offset`.
 */
export const TextPath = trait({
	d: '',
	offset: 0,
	shift: 0,
	align: TextPathAlign.START as TextPathAlign,
});
