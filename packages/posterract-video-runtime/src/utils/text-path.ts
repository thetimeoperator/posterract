/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Text on a path: a line of text laid along a curve instead of a straight
 * baseline — After Effects' path text.
 *
 * The renderer measures each glyph's advance and asks where it goes; the
 * answer is a point and a direction for each one, worked out from distance
 * along the flattened path. Distance is the one coordinate that means the same
 * thing on every shape, and it is the one `trimPath` already speaks: an
 * `offset` of 0.25 starts the text where a trim to 0.25 ends, and keyframing
 * the offset slides the text at an even speed however the path was drawn.
 *
 * A glyph is turned to the chord across its own width, not to the segment
 * under its centre. A flattened circle is a polygon, and a glyph turned to
 * whichever facet its centre is on jumps from one facet's angle to the next as
 * it slides; the chord between its two edges turns a little at a time, and it
 * is the line the glyph's baseline actually spans.
 *
 * Angles are in screen space: 0 is +x and a quarter turn is +y, downwards.
 * Rotating the canvas by a glyph's angle lays its baseline along the path, so
 * the glyph's own "up" is the left of the direction of travel — which is the
 * way a positive `baselineShift` moves it.
 *
 * Nothing here touches a canvas or a DOM node, so the preview and an export
 * put every glyph in the same place.
 */

import type { SubPath } from './vector';

/** Where one glyph goes. */
export interface GlyphPlacement {
	/** The glyph's index in the advances it was placed from. */
	index: number;
	/** Where the glyph's horizontal centre sits on its baseline. */
	x: number;
	y: number;
	/** The direction of travel at the glyph, in radians (0 = +x, a quarter turn = +y). */
	angle: number;
	/**
	 * False when the glyph falls off either end of an open path (or of a closed
	 * one with `wrap: false`). It is placed all the same, on the end it fell
	 * off, so every glyph has somewhere to be.
	 */
	visible: boolean;
}

export interface TextPathOptions {
	/**
	 * Where the text starts, as a fraction of the path's total length. Wraps on
	 * closed paths; may be negative or > 1. Keyframed to scroll text along the
	 * path.
	 */
	offset: number;
	/** How the run sits relative to `offset`: its start, centre or end at that point. */
	align: 'start' | 'center' | 'end';
	/**
	 * When true (the default for closed paths), glyphs wrap around the seam;
	 * open paths never wrap. A path is closed when every subpath comes back to
	 * its first point — by a Z, which `flattenPath` draws back to the start, or
	 * by drawing there itself, as a circle made of two arcs does.
	 */
	wrap?: boolean;
	/**
	 * Shift perpendicular to the path, in px. Positive is to the left of the
	 * direction of travel, the glyph's own "up": above a line drawn left to
	 * right, and outward on a clockwise circle in screen coordinates (inward on
	 * an anticlockwise one). Lets several rings share one circle path.
	 */
	baselineShift?: number;
}

/**
 * A distance this small (px) is rounding, not geometry. A circle flattened
 * from arcs finishes within about 1e-13 of where it began; a path that only
 * nearly closes, like a morph a frame short of its ring, is off by orders of
 * magnitude more.
 */
const EPSILON = 1e-6;

/**
 * Place glyphs (given as advance widths, px, in reading order) along the
 * flattened path. Multiple subpaths are treated as one continuous path in
 * order, like trimPath does.
 *
 * Glyph `i` is centred `start + (the advances before it) + advances[i] / 2`
 * along the path, where `start` is `offset` of the way along, less half the
 * text for `center` or all of it for `end`. On a closed path that distance
 * goes round as often as it needs to; on an open one a glyph whose centre is
 * off either end is hidden. A glyph is turned to the chord between its two
 * edges, and one with no width, which has no edges, to the segment under it.
 * The chord stays on the glyph's own subpath: at the jump to the next one it
 * would point across empty space, not along anything the text follows.
 *
 * An empty path, or one with no length, hides every glyph at the origin.
 */
export function placeGlyphsOnPath(
	subpaths: readonly SubPath[],
	advances: readonly number[],
	options: TextPathOptions,
): GlyphPlacement[] {
	if (advances.length === 0) return [];
	const figure = measureRuns(subpaths);
	if (figure.runs.length === 0) {
		return advances.map((_, index) => ({ index, x: 0, y: 0, angle: 0, visible: false }));
	}

	const pathLength = figure.total;
	const widths = advances.map(finite);
	const textLength = widths.reduce((sum, width) => sum + width, 0);
	const anchor = finite(options.offset) * pathLength;
	const start = options.align === 'center'
		? anchor - textLength / 2
		: options.align === 'end' ? anchor - textLength : anchor;
	const wrap = figure.closed && (options.wrap ?? true);
	const shift = finite(options.baselineShift ?? 0);

	const placements: GlyphPlacement[] = [];
	let before = 0;
	for (let index = 0; index < widths.length; index += 1) {
		const advance = widths[index]!;
		const along = start + before + advance / 2;
		before += advance;

		const visible = wrap || (along >= 0 && along <= pathLength);
		const at = wrap ? wrapInto(along, pathLength) : clamp(along, 0, pathLength);
		const { x, y, angle } = place(figure, at, advance);
		// Left of the direction of travel is (sin, -cos): the glyph's own up.
		placements.push({
			index,
			x: x + shift * Math.sin(angle),
			y: y - shift * Math.cos(angle),
			angle,
			visible,
		});
	}
	return placements;
}

/**
 * The point and direction at arc length `s` (px) along the path; wraps when
 * closed. Returns null for an empty path, or one with no length to travel.
 *
 * With `wrap`, a length past either end of a closed path comes round again, as
 * text does; on an open path, or without it, the length stops at the nearer
 * end. The direction is the segment's own, not smoothed across any width.
 */
export function pointAtLength(
	subpaths: readonly SubPath[],
	s: number,
	wrap: boolean,
): { x: number; y: number; angle: number } | null {
	const figure = measureRuns(subpaths);
	if (figure.runs.length === 0) return null;
	const at = wrap && figure.closed ? wrapInto(finite(s), figure.total) : clamp(finite(s), 0, figure.total);
	const run = runAt(figure.runs, at);
	const { x, y, segment } = pointInRun(run, clamp(at - run.start, 0, run.length));
	return { x, y, angle: heading(run, segment) };
}

/** One subpath, measured: how far along it each of its points is. */
interface Run {
	readonly points: readonly number[];
	/** Distance from the run's first point to each of its points. */
	readonly along: Float64Array;
	readonly length: number;
	/** Where the run starts and ends along the whole figure. The jump to the next run has no length. */
	readonly start: number;
	readonly end: number;
	/** Whether it ends where it began, so a distance past either end comes round. */
	readonly loops: boolean;
}

/** A figure measured once, for as many lookups as there are glyphs. */
interface Measured {
	readonly runs: readonly Run[];
	readonly total: number;
	/** Whether every run is a loop, so the whole figure can be gone round. */
	readonly closed: boolean;
}

/**
 * Measure every subpath the way `measure` does, to the last digit, so a
 * fraction of this length is the same place as the same fraction of a trim.
 *
 * A Z's closing edge is already in the points — `flattenPath` draws it back to
 * the first one — so it is counted like any other edge and nothing is added
 * for it here, just as `measure` adds nothing. A subpath with no length is
 * left out: it has no direction to lay a glyph along, and at the boundary
 * between two runs it would only be somewhere wrong to land.
 */
function measureRuns(subpaths: readonly SubPath[]): Measured {
	const runs: Run[] = [];
	let total = 0;
	let closed = true;
	for (const { points } of subpaths) {
		const count = points.length >> 1;
		if (count < 2) continue;

		const along = new Float64Array(count);
		let length = 0;
		for (let i = 1; i < count; i += 1) {
			length += Math.hypot(points[2 * i]! - points[2 * i - 2]!, points[2 * i + 1]! - points[2 * i - 1]!);
			along[i] = length;
		}
		if (!(length > 0 && Number.isFinite(length))) continue;

		const gap = Math.hypot(points[2 * count - 2]! - points[0]!, points[2 * count - 1]! - points[1]!);
		const loops = gap <= EPSILON;
		runs.push({ points, along, length, start: total, end: total + length, loops });
		total += length;
		closed &&= loops;
	}
	return { runs, total, closed: closed && runs.length > 0 };
}

/**
 * A glyph's centre and angle at distance `s` along the figure: the chord
 * across its width when it has one, the segment under it when not (or when
 * the chord comes out too short to point anywhere).
 */
function place(figure: Measured, s: number, advance: number): { x: number; y: number; angle: number } {
	const run = runAt(figure.runs, s);
	const u = clamp(s - run.start, 0, run.length);
	const centre = pointInRun(run, u);

	const half = Math.abs(advance) / 2;
	if (half > 0) {
		const a = pointInRun(run, keepOnRun(run, u - half));
		const b = pointInRun(run, keepOnRun(run, u + half));
		if (Math.hypot(b.x - a.x, b.y - a.y) > EPSILON) {
			return { x: centre.x, y: centre.y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
		}
	}
	return { x: centre.x, y: centre.y, angle: heading(run, centre.segment) };
}

/** The run a distance along the figure falls in: the first one ending at or after it. */
function runAt(runs: readonly Run[], s: number): Run {
	let lo = 0;
	let hi = runs.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (runs[mid]!.end < s) lo = mid + 1;
		else hi = mid;
	}
	return runs[lo]!;
}

/** A distance along a run, kept on it: round again on a loop, stopped at the ends otherwise. */
function keepOnRun(run: Run, u: number): number {
	return run.loops ? wrapInto(u, run.length) : clamp(u, 0, run.length);
}

/** The point `u` into a run, and the segment it lies on: the last one starting at or before it. */
function pointInRun(run: Run, u: number): { x: number; y: number; segment: number } {
	const { points, along } = run;
	let lo = 0;
	let hi = along.length - 2;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (along[mid]! <= u) lo = mid;
		else hi = mid - 1;
	}
	const from = along[lo]!;
	const span = along[lo + 1]! - from;
	const t = span > 0 ? clamp((u - from) / span, 0, 1) : 0;
	const i = 2 * lo;
	return {
		x: points[i]! + (points[i + 2]! - points[i]!) * t,
		y: points[i + 1]! + (points[i + 3]! - points[i + 1]!) * t,
		segment: lo,
	};
}

/**
 * The direction of travel along a run's segment. One too short to point
 * anywhere — a repeated point — takes the next real segment's direction, or,
 * at the very end of the run, the last real one's.
 */
function heading(run: Run, segment: number): number {
	const { points, along } = run;
	const last = along.length - 2;
	for (let j = segment; j <= last; j += 1) {
		if (along[j + 1]! - along[j]! > EPSILON) return segmentAngle(points, j);
	}
	for (let j = segment - 1; j >= 0; j -= 1) {
		if (along[j + 1]! - along[j]! > EPSILON) return segmentAngle(points, j);
	}
	return 0;
}

function segmentAngle(points: readonly number[], segment: number): number {
	const i = 2 * segment;
	return Math.atan2(points[i + 3]! - points[i + 1]!, points[i + 2]! - points[i]!);
}

/** `value` brought into [0, period): a distance that has gone round a loop. */
function wrapInto(value: number, period: number): number {
	const wrapped = value % period;
	if (wrapped >= 0) return wrapped;
	const up = wrapped + period;
	// A hair below zero can round up to the period itself, which is zero again.
	return up < period ? up : 0;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** Anything that is not a finite number counts as 0, so one bad value cannot poison every placement. */
function finite(value: number): number {
	return Number.isFinite(value) ? value : 0;
}
