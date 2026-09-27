/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ChildOf, Marker, Playback, Tempo, setPlayhead } from '@posterract/video-runtime';

import { assert } from '@/utils';
import { RULER_INTERVALS } from '../constants';
import {
	MARKER_LANE_HEIGHT,
	RULER_HEIGHT,
	RULER_LABEL_Y,
	RULER_TICK_HEIGHT_MAJOR,
	RULER_TICK_HEIGHT_MINOR,
	TARGET_MAJOR_TICK_DISTANCE,
} from '../config';
import { editWorkarea } from '../../timing';
import { framesToPixels, getFrameRate, getResolution, getScrollX, getViewport, pixelsToFrames } from '../view';

import type { Entity, World } from 'koota';
import type { TimelineSurfaceState } from '../surface';

/**
 * The time ruler, and the two gestures that belong to it: a drag scrubs the
 * playhead, a shift-drag sets the work area. Both are ephemeral state, so
 * neither is an edit — the file has nothing to say about where the playhead
 * is or what part of the scene is being previewed.
 */
export function renderRuler(world: World, scene: Entity, surface: TimelineSurfaceState): void {
	const { ctx, pointer } = surface;
	if (!ctx || !pointer) return;

	const scrollX = getScrollX(world, scene);
	const resolution = getResolution(world, scene);
	const fps = getFrameRate(world);

	ctx.save();
	ctx.translate(-(scrollX * resolution), 0);

	const [minX, maxX] = getViewport(world, scene, surface.layout.width);

	const { dragging, clicked } = pointer
		.scope('ruler')
		.region(minX, 0, maxX - minX, RULER_HEIGHT);

	// A scrub takes over from playback: the playhead goes where it is put.
	if (clicked || (dragging && !pointer.shiftPressed)) {
		assert(pointer.position, 'Pointer position must be set');

		// Set rather than written through the store, and only when it would
		// change something: the transport button is watching.
		if (scene.get(Playback)?.playing) scene.set(Playback, { playing: false });

		setPlayhead(world, scene, pixelsToFrames(pointer.position.currentX + scrollX * resolution, resolution));
	}

	if (dragging && pointer.shiftPressed) {
		assert(pointer.position, 'Pointer position must be set');
		assert(pointer.position.state !== 'idle', 'Pointer must be pressing');

		const start = pixelsToFrames(pointer.position.initialX + scrollX * resolution, resolution);
		const end = pixelsToFrames(pointer.position.currentX + scrollX * resolution, resolution);

		editWorkarea(world, scene, [start, end]);

		// The playhead follows the edge being dragged, so the frame under the
		// pointer is the one on the canvas.
		setPlayhead(world, scene, pointer.position.currentX > pointer.position.initialX ? end : start);
	}

	const interval = getRulerInterval(resolution);
	const firstFrame = pixelsToFrames(minX, resolution);
	const lastFrame = pixelsToFrames(maxX, resolution);
	const step = Math.max(1, Math.round(interval.numerator / interval.denominator));

	const majorOffset = RULER_HEIGHT - RULER_TICK_HEIGHT_MAJOR;
	const minorOffset = RULER_HEIGHT - RULER_TICK_HEIGHT_MINOR;

	// A time strip, not a comb: sparse mono labels, hairline ticks, and a
	// baseline the lanes hang from.
	ctx.font = '400 10px JetBrains Mono';
	ctx.fillStyle = surface.colors.ruler.text;
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'center';

	for (let frame = Math.floor(firstFrame / step) * step; frame <= lastFrame; frame += step) {
		const x = Math.round(framesToPixels(frame, resolution)) + 0.5;
		let y = minorOffset;

		// Only the ticks of the interval itself are labelled; the rest are the
		// subdivisions between them.
		if (frame % interval.numerator === 0) {
			y = majorOffset;
			ctx.fillText(formatTickLabel(frame, fps), x, RULER_LABEL_Y);
		}

		ctx.lineWidth = 1;
		ctx.strokeStyle = surface.colors.ruler.tick;
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x, RULER_HEIGHT);
		ctx.stroke();
	}

	ctx.strokeStyle = surface.colors.ruler.tick;
	ctx.beginPath();
	ctx.moveTo(minX, RULER_HEIGHT - 0.5);
	ctx.lineTo(maxX, RULER_HEIGHT - 0.5);
	ctx.stroke();

	drawBeats(world, scene, surface, minX, maxX);
	drawMarkers(world, scene, surface);

	ctx.restore();
}

/** The accent the beat grid is drawn in: the product's green, so it reads as music, not time. */
const BEAT_COLOR = '#65ff9a';

/**
 * A scene with a tempo gets its bars and beats along the bottom of the ruler:
 * a tall tick and the bar number on every downbeat, a short one on every
 * other beat — thinned out when they would crowd, so a zoomed-out timeline
 * shows bars and a zoomed-in one shows every beat.
 */
function drawBeats(world: World, scene: Entity, surface: TimelineSurfaceState, minX: number, maxX: number): void {
	const { ctx } = surface;
	const tempo = scene.get(Tempo);
	if (!ctx || !tempo || !(tempo.bpm > 0)) return;

	const resolution = getResolution(world, scene);
	const fps = getFrameRate(world);
	const beat = (60 / tempo.bpm) * fps;
	const meter = tempo.meter > 0 ? tempo.meter : 4;
	const beatWidth = framesToPixels(beat, resolution);
	if (!(beatWidth > 0)) return;

	const showBeats = beatWidth >= 6;
	const barWidth = beatWidth * meter;
	// Label every bar, or every 2nd, 4th… when bars are narrow.
	let labelEvery = 1;
	while (barWidth * labelEvery < 28 && labelEvery < 1024) labelEvery *= 2;

	const first = Math.max(0, Math.floor(pixelsToFrames(minX, resolution) / beat));
	const last = Math.ceil(pixelsToFrames(maxX, resolution) / beat);

	ctx.save();
	ctx.strokeStyle = BEAT_COLOR;
	ctx.fillStyle = BEAT_COLOR;
	ctx.font = '600 9px JetBrains Mono';
	ctx.textAlign = 'left';
	ctx.textBaseline = 'bottom';
	for (let i = first; i <= last; i++) {
		const downbeat = i % meter === 0;
		if (!downbeat && !showBeats) continue;
		const x = Math.round(framesToPixels(i * beat, resolution)) + 0.5;
		ctx.globalAlpha = downbeat ? 0.85 : 0.4;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(x, RULER_HEIGHT - (downbeat ? 9 : 4));
		ctx.lineTo(x, RULER_HEIGHT);
		ctx.stroke();
		const bar = i / meter;
		if (downbeat && bar % labelEvery === 0) {
			ctx.globalAlpha = 0.9;
			ctx.fillText(String(bar + 1), x + 3, RULER_HEIGHT - 1);
		}
	}
	ctx.restore();
}

const MARKER_HALF = 3.5;

/**
 * The scene's markers, in their own lane above the time labels: a small lit
 * diamond with the name beside it. A marker is a note about a moment, not
 * about a layer, and in its own lane it can never sit on top of a time.
 */
function drawMarkers(world: World, scene: Entity, surface: TimelineSurfaceState): void {
	const { ctx } = surface;
	if (!ctx) return;

	const markers = [...world.query(ChildOf(scene), Marker)];
	if (!markers.length) return;

	const resolution = getResolution(world, scene);
	const scroll = getScrollX(world, scene);
	const y = MARKER_LANE_HEIGHT / 2 + 1;

	ctx.save();
	ctx.font = '500 9px JetBrains Mono';
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'left';
	for (const entity of markers) {
		const marker = entity.get(Marker)!;
		const x = framesToPixels(marker.time - scroll, resolution);
		const color = marker.color || surface.colors.border.scrubber;

		ctx.fillStyle = color;
		ctx.shadowColor = color;
		ctx.shadowBlur = 6;
		ctx.beginPath();
		ctx.moveTo(x, y - MARKER_HALF);
		ctx.lineTo(x + MARKER_HALF, y);
		ctx.lineTo(x, y + MARKER_HALF);
		ctx.lineTo(x - MARKER_HALF, y);
		ctx.closePath();
		ctx.fill();
		ctx.shadowBlur = 0;

		if (marker.name) {
			ctx.globalAlpha = 0.85;
			ctx.fillText(marker.name, x + MARKER_HALF + 4, y);
			ctx.globalAlpha = 1;
		}
	}
	ctx.restore();
}

/** Whole seconds read as a clock, anything finer as a frame count. */
function formatTickLabel(frame: number, fps: number): string {
	if (frame === 0) return '0';
	if (frame % fps !== 0) return `${frame}f`;

	const total = Math.round(frame / fps);
	const minutes = Math.floor(total / 60).toString();
	const seconds = Math.floor(total % 60).toString().padStart(2, '0');

	return `${minutes}:${seconds}`;
}

/**
 * The tick interval whose labelled ticks land nearest the target spacing at
 * this zoom, so the ruler stays about as dense however far in it is.
 */
function getRulerInterval(resolution: number) {
	let closest = RULER_INTERVALS[0]!;
	let closestDelta = Infinity;

	for (const interval of RULER_INTERVALS) {
		const delta = Math.abs(framesToPixels(interval.numerator, resolution) - TARGET_MAJOR_TICK_DISTANCE);
		if (delta < closestDelta) {
			closest = interval;
			closestDelta = delta;
		}
	}

	return closest;
}
