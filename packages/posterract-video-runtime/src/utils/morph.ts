/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Morphing between any two figures.
 *
 * Two figures whose commands match one for one can be blended command for
 * command, and when the match means something that is still the best blend:
 * it is the author's own statement of which point becomes which, and curves
 * stay curves. But commands can match by accident. The same square drawn from
 * its next corner has exactly the square's commands, and blended one for one
 * it turns through a diamond; a triangle drawn the other way round flattens
 * into a line; a circle drawn from its other side shrinks to a point. So a
 * match is checked before it is trusted (see `blendsSafely`), and whatever it
 * cannot vouch for is matched here instead.
 *
 * Matching means working out the correspondence nobody stated — and working
 * it out to be the one that looks least like a guess. Both outlines are
 * walked by arc length and resampled to the same number of points, then the
 * target's points are matched to the source's by trying every place the
 * target could start and both directions it could run, keeping whichever
 * moves the points least in total. Least travel is what stops an in-between
 * folding through itself: a morph whose points all head for the far side of
 * the shape collapses on the way there.
 *
 * Figures with several subpaths pair them biggest with biggest, so outlines
 * meet outlines and holes meet holes. A subpath left without a partner grows
 * out of, or shrinks into, its own centre instead of flying in from
 * somewhere.
 *
 * Deciding how two figures correspond takes up to a few milliseconds;
 * blending along the answer is a single pass. So the first happens once per
 * pair of figures and is cached, and a frame only does the second.
 *
 * Like the rest of the vector code this is arithmetic and nothing else — no
 * canvas, no DOM, no randomness — so a preview and an export see the same
 * in-betweens.
 */

import { compatible, flattenPath, morphPath, parsePath, toPathData, type PathCommand, type SubPath } from './vector';

/**
 * Points per resampled subpath. Enough that a circle a thousand pixels across
 * is faceted by less than a fifth of a pixel; the correspondence search is
 * quadratic in it, but runs once per pair.
 */
const SAMPLES = 128;

/**
 * A turn sharper than this at a vertex makes it a corner. Corners are always
 * among the samples, so a square is still square at either end of a morph
 * instead of leaving and arriving with its corners clipped. Flattened curves
 * turn a few degrees per step and stay well under it.
 */
const CORNER = Math.PI / 12;

/**
 * An open subpath whose ends are closer than this fraction of its length
 * loops: a circle drawn as two arcs without a Z is still a circle, and may
 * start matching anywhere round it.
 */
const LOOP = 1e-4;

/**
 * How much better another starting point or direction has to match two
 * figures' key points — as a fraction of the travel of the match as written
 * — before the written match counts as the outline begun somewhere else.
 */
const ROTATED = 0.5;

/** How many pairs of figures keep their correspondence. */
const CACHE_SIZE = 256;

/** A subpath as the resampler walks it. */
interface Outline {
	/** Its vertices, with repeats dropped; a ring does not repeat its first at the end. */
	xs: number[];
	ys: number[];
	/** Arc length at each vertex. A ring has one entry more: the whole way round. */
	at: number[];
	length: number;
	/** Closed with Z, or ending where it began: either way, a loop. */
	ring: boolean;
}

/** One subpath of the in-between: the points it runs between, already matched one for one. */
interface Match {
	from: Float64Array; // x0, y0, x1, y1, …
	to: Float64Array;
	fromClosed: boolean;
	toClosed: boolean;
}

/** What a pair of figures needs at every frame, once the expensive part is done. */
type Plan =
	| { kind: 'exact' }
	| { kind: 'matched'; matches: Match[] }
	| { kind: 'grow'; x: number; y: number; grows: boolean }
	| { kind: 'nothing' };

const EXACT: Plan = { kind: 'exact' };
const NOTHING: Plan = { kind: 'nothing' };

/** Shared by every in-between: a close has nothing in it to blend. */
const CLOSE: PathCommand = Object.freeze({ type: 'Z', values: Object.freeze([]) });

/**
 * Blend any two figures. Exact command-for-command blend when
 * `compatible(from, to)` and that blend keeps the figure's shape; otherwise a
 * resampled blend.
 *
 * The exact blend is kept wherever it is safe: matching commands are the
 * author's own correspondence, and curves stay curves. Everything else is
 * resampled — each subpath becomes SAMPLES points matched to the other
 * figure's, drawn as straight segments between them. A subpath is closed in
 * the in-between when the figure it is nearer to has it closed: the source's
 * up to halfway, the target's from there. When one figure draws nothing at
 * all, the other grows from, or shrinks to, a point at its own centre.
 *
 * `t` past either end holds that end, so a spring that overshoots does not
 * throw the figure beyond its target. How the two figures correspond — the
 * safety check included — is cached on their path data, not on the arrays,
 * so a caller that refills the same array is never handed a stale answer. A
 * frame after the first serialises both figures to find it, then makes one
 * pass over the points; `morphPathData`, keyed on strings the caller already
 * has, skips the serialising.
 */
export function morphAny(from: readonly PathCommand[], to: readonly PathCommand[], t: number): PathCommand[] {
	// Written this way round so a t that is not a number holds the source.
	if (!(t > 0)) return from as PathCommand[];
	if (t >= 1) return to as PathCommand[];
	const plan = remember(byCommands, pairKey(toPathData(from), toPathData(to)), () => planFor(from, to));
	return blend(plan, from, to, t);
}

/**
 * The same blend, for figures given as path data.
 *
 * The two strings are the cache key, so after the first call a frame neither
 * parses nor serialises anything: it looks the pair up and blends. At or past
 * either end it returns the cached parse itself, shared with every other
 * caller asking for the same figure — read it, do not change it.
 */
export function morphPathData(fromD: string, toD: string, t: number): PathCommand[] {
	const pair = remember(byPathData, pairKey(fromD, toD), () => ({
		from: parsePath(fromD),
		to: parsePath(toD),
		plan: undefined as Plan | undefined,
	}));
	if (!(t > 0)) return pair.from;
	if (t >= 1) return pair.to;
	pair.plan ??= planFor(pair.from, pair.to);
	return blend(pair.plan, pair.from, pair.to, t);
}

const byCommands = new Map<string, Plan>();
const byPathData = new Map<string, { from: PathCommand[]; to: PathCommand[]; plan: Plan | undefined }>();

/**
 * Look a pair up, working it out on a miss. The cache keeps the pairs used
 * most recently, so a morph that plays every frame is never the one evicted.
 */
function remember<T>(cache: Map<string, T>, key: string, build: () => T): T {
	let value = cache.get(key);
	if (value === undefined) {
		value = build();
		if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
	} else {
		cache.delete(key);
	}
	cache.set(key, value);
	return value;
}

/** Two strings as one key. The length prefix keeps "ab" + "c" apart from "a" + "bc". */
function pairKey(a: string, b: string): string {
	return `${a.length}:${a}${b}`;
}

/** How two figures will be blended: command for command when that is safe, matched here otherwise. */
function planFor(from: readonly PathCommand[], to: readonly PathCommand[]): Plan {
	return compatible(from, to) && blendsSafely(from, to) ? EXACT : correspond(from, to);
}

/** One frame of a planned morph. */
function blend(plan: Plan, from: readonly PathCommand[], to: readonly PathCommand[], t: number): PathCommand[] {
	switch (plan.kind) {
		case 'exact':
			return morphPath(from, to, t);
		case 'matched':
			return interpolate(plan.matches, t);
		case 'grow':
			return plan.grows ? scaled(to, plan.x, plan.y, t) : scaled(from, plan.x, plan.y, 1 - t);
		case 'nothing':
			return [];
	}
}

/**
 * The in-between itself: every matched point moved `t` of the way across.
 * This is all a frame does, and the output is the only thing it allocates.
 */
function interpolate(matches: readonly Match[], t: number): PathCommand[] {
	const late = t >= 0.5;
	let size = 0;
	for (const match of matches) {
		size += (match.from.length >> 1) + ((late ? match.toClosed : match.fromClosed) ? 1 : 0);
	}

	const out = new Array<PathCommand>(size);
	let at = 0;
	for (const { from, to, fromClosed, toClosed } of matches) {
		for (let i = 0; i < from.length; i += 2) {
			out[at++] = {
				type: i === 0 ? 'M' : 'L',
				values: [from[i]! + (to[i]! - from[i]!) * t, from[i + 1]! + (to[i + 1]! - from[i + 1]!) * t],
			};
		}
		if (late ? toClosed : fromClosed) out[at++] = CLOSE;
	}
	return out;
}

/**
 * A figure scaled about a point, exactly: curves stay curves. An arc's radii
 * scale with it and its flags do not, which is all an arc needs to stay the
 * same shape at another size.
 */
function scaled(commands: readonly PathCommand[], x: number, y: number, scale: number): PathCommand[] {
	return commands.map((command) => {
		const { type, values } = command;
		if (type === 'Z') return command;
		if (type === 'A') {
			return {
				type,
				values: [
					values[0]! * scale, values[1]! * scale, values[2]!, values[3]!, values[4]!,
					x + (values[5]! - x) * scale, y + (values[6]! - y) * scale,
				],
			};
		}
		return {
			type,
			values: values.map((value, index) => (index % 2 === 0 ? x + (value - x) * scale : y + (value - y) * scale)),
		};
	});
}

/**
 * Whether two figures whose commands match can be blended one for one
 * without the shape collapsing on the way.
 *
 * Each subpath is judged by its key points — where its commands end, and the
 * middle of each Bézier — which the one-for-one blend carries straight
 * across. A loop must wind the same way round in both figures, since turning
 * over means passing through no area at all on the way. And no other
 * starting point, or direction, may carry the key points across in less than
 * half the travel of the match as written: when one can, the written match is
 * the same outline begun somewhere else, and blending it spins the shape
 * through itself. The whole check is a few passes over the commands, done
 * once per pair with the rest of its plan.
 */
function blendsSafely(from: readonly PathCommand[], to: readonly PathCommand[]): boolean {
	const a = keyPoints(from);
	const b = keyPoints(to);
	if (a.length !== b.length) return false;
	for (let s = 0; s < a.length; s += 1) {
		const { points: before, closed } = a[s]!;
		const after = b[s]!.points;
		if (before.length !== after.length) return false;

		// A loop that ends back on its first point, in both figures, has that point once.
		let extent = 1;
		for (const value of before) extent = Math.max(extent, Math.abs(value));
		for (const value of after) extent = Math.max(extent, Math.abs(value));
		const same = extent * 1e-9;
		let n = before.length >> 1;
		const loops = (points: readonly number[]) => n > 1
			&& Math.abs(points[0]! - points[n * 2 - 2]!) <= same
			&& Math.abs(points[1]! - points[n * 2 - 1]!) <= same;
		const looped = loops(before) && loops(after);
		if (looped) n -= 1;
		const cyclic = closed || looped;

		const p = Float64Array.from(before.slice(0, n * 2));
		const q = Float64Array.from(after.slice(0, n * 2));
		if (cyclic && winding(p) * winding(q) < 0) return false;
		if (bestOrder(p, q, cyclic).cost < travel(p, q, 0, 1) * ROTATED) return false;
	}
	return true;
}

/** Each subpath's key points, x0, y0, x1, y1, …: where its commands end, and the middle of each Bézier. */
function keyPoints(commands: readonly PathCommand[]): Array<{ points: number[]; closed: boolean }> {
	const subpaths: Array<{ points: number[]; closed: boolean }> = [];
	let current: { points: number[]; closed: boolean } | undefined;
	// The pen, which a Bézier's middle depends on, and where a close returns it.
	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;

	const add = (px: number, py: number) => {
		if (!current) {
			current = { points: [], closed: false };
			subpaths.push(current);
		}
		current.points.push(px, py);
	};

	for (const { type, values } of commands) {
		switch (type) {
			case 'M':
				current = { points: [], closed: false };
				subpaths.push(current);
				startX = values[0]!;
				startY = values[1]!;
				add(values[0]!, values[1]!);
				break;
			case 'L':
				add(values[0]!, values[1]!);
				break;
			case 'C':
				add(
					(x + 3 * values[0]! + 3 * values[2]! + values[4]!) / 8,
					(y + 3 * values[1]! + 3 * values[3]! + values[5]!) / 8,
				);
				add(values[4]!, values[5]!);
				break;
			case 'Q':
				add((x + 2 * values[0]! + values[2]!) / 4, (y + 2 * values[1]! + values[3]!) / 4);
				add(values[2]!, values[3]!);
				break;
			case 'A':
				add(values[5]!, values[6]!);
				break;
			case 'Z':
				if (current) current.closed = true;
				break;
		}
		if (type === 'Z') {
			x = startX;
			y = startY;
		} else if (values.length >= 2) {
			x = values[values.length - 2]!;
			y = values[values.length - 1]!;
		}
	}
	return subpaths;
}

/** A loop's signed area, or 0 for a sliver too thin to have a winding worth keeping. */
function winding(points: Float64Array): number {
	const n = points.length >> 1;
	let area = 0;
	let perimeter = 0;
	for (let i = 0; i < n; i += 1) {
		const j = i + 1 === n ? 0 : i + 1;
		area += points[i * 2]! * points[j * 2 + 1]! - points[j * 2]! * points[i * 2 + 1]!;
		perimeter += Math.hypot(points[j * 2]! - points[i * 2]!, points[j * 2 + 1]! - points[i * 2 + 1]!);
	}
	area /= 2;
	// A circle's area is 0.08 of its perimeter squared; a 250:1 sliver's is 0.001.
	return Math.abs(area) > 1e-3 * perimeter * perimeter ? area : 0;
}

/**
 * Work out how one figure becomes another: which subpath becomes which, and
 * which point of each becomes which point of its partner.
 */
function correspond(from: readonly PathCommand[], to: readonly PathCommand[]): Plan {
	const a = flattenPath(from).map(toOutline);
	const b = flattenPath(to).map(toOutline);
	if (a.length === 0 && b.length === 0) return NOTHING;
	if (a.length === 0) return { kind: 'grow', ...centreOf(b), grows: true };
	if (b.length === 0) return { kind: 'grow', ...centreOf(a), grows: false };

	const rankA = bySize(a);
	const rankB = bySize(b);
	const pairs: Array<{ order: number; match: Match }> = [];
	for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
		const ia = rankA[i];
		const ib = rankB[i];
		pairs.push({
			// Drawn in the source's order, with the target's extra subpaths after it.
			order: ia ?? a.length + ib!,
			match: matchOutlines(ia === undefined ? undefined : a[ia], ib === undefined ? undefined : b[ib]),
		});
	}
	pairs.sort((p, q) => p.order - q.order);
	return { kind: 'matched', matches: pairs.map((pair) => pair.match) };
}

/** Subpath indices, longest first; equal lengths keep their order. */
function bySize(outlines: readonly Outline[]): number[] {
	return outlines.map((_, index) => index).sort((i, j) => outlines[j]!.length - outlines[i]!.length || i - j);
}

/**
 * Resample a pair of subpaths and line their points up.
 *
 * Two loops can match starting anywhere, in either direction. Two open runs
 * can only match end to end, one way or the other. A loop and an open run
 * meet by cutting the loop where it best fits the run: it is sampled with one
 * point fewer and its first point repeated at the end, so the run's two ends
 * both land on the cut and close up as the loop forms. A subpath with no
 * partner is matched with itself collapsed onto its own centre.
 */
function matchOutlines(a: Outline | undefined, b: Outline | undefined): Match {
	if (a && b) {
		if (a.ring === b.ring) {
			const from = resample(a, SAMPLES);
			return { from, to: align(from, resample(b, SAMPLES), a.ring), fromClosed: a.ring, toClosed: b.ring };
		}
		if (a.ring) {
			const to = resample(b, SAMPLES);
			return { from: align(to, resample(a, SAMPLES - 1), true), to, fromClosed: true, toClosed: false };
		}
		const from = resample(a, SAMPLES);
		return { from, to: align(from, resample(b, SAMPLES - 1), true), fromClosed: false, toClosed: true };
	}

	const only = (a ?? b)!;
	const points = resample(only, SAMPLES);
	const { x, y } = centreOf([only]);
	const centre = new Float64Array(SAMPLES * 2);
	for (let i = 0; i < centre.length; i += 2) {
		centre[i] = x;
		centre[i + 1] = y;
	}
	return a
		? { from: points, to: centre, fromClosed: only.ring, toClosed: only.ring }
		: { from: centre, to: points, fromClosed: only.ring, toClosed: only.ring };
}

/**
 * The summed squared distance from each point of `fixed` to its partner in
 * `moving`, read from `start` in steps of `step` and wrapping round. Gives up
 * once the sum passes `limit`, returning something no smaller.
 */
function travel(fixed: Float64Array, moving: Float64Array, start: number, step: number, limit = Infinity): number {
	const n = fixed.length >> 1;
	const m = moving.length >> 1;
	let sum = 0;
	for (let i = 0, j = start; i < n && sum < limit; i += 1) {
		const dx = fixed[i * 2]! - moving[j * 2]!;
		const dy = fixed[i * 2 + 1]! - moving[j * 2 + 1]!;
		sum += dx * dx + dy * dy;
		j += step;
		if (j === m) j = 0;
		else if (j < 0) j = m - 1;
	}
	return sum;
}

/**
 * The order of `moving` that sits closest to `fixed`, point for point, and
 * what it costs. Least squared travel does not care where either figure is or
 * how big it is, only how the two line up. `cyclic` tries every starting
 * point in both directions; otherwise only end to end, forwards or
 * backwards. A cyclic `moving` may have one point fewer than `fixed`, and
 * then its starting point comes round again last.
 */
function bestOrder(fixed: Float64Array, moving: Float64Array, cyclic: boolean): { start: number; step: number; cost: number } {
	const m = moving.length >> 1;
	let best = { start: 0, step: 1, cost: Infinity };
	const consider = (start: number, step: number) => {
		const cost = travel(fixed, moving, start, step, best.cost);
		if (cost < best.cost) best = { start, step, cost };
	};
	if (cyclic) {
		for (let start = 0; start < m; start += 1) consider(start, 1);
		for (let start = 0; start < m; start += 1) consider(start, -1);
	} else {
		consider(0, 1);
		consider(m - 1, -1);
	}
	return best;
}

/** `moving` reordered to follow `fixed` point for point, in the order that moves the points least. */
function align(fixed: Float64Array, moving: Float64Array, cyclic: boolean): Float64Array {
	const n = fixed.length >> 1;
	const m = moving.length >> 1;
	const { start, step } = bestOrder(fixed, moving, cyclic);
	const out = new Float64Array(n * 2);
	for (let i = 0, j = start; i < n; i += 1) {
		out[i * 2] = moving[j * 2]!;
		out[i * 2 + 1] = moving[j * 2 + 1]!;
		j += step;
		if (j === m) j = 0;
		else if (j < 0) j = m - 1;
	}
	return out;
}

/** A flattened subpath as an outline: repeats dropped, loops recognised, lengths measured. */
function toOutline(subpath: SubPath): Outline {
	const { points } = subpath;
	let extent = 1;
	for (const value of points) extent = Math.max(extent, Math.abs(value));
	// Closer than this is the same point: far above float noise, far below anything visible.
	const same = extent * 1e-9;

	const xs: number[] = [];
	const ys: number[] = [];
	for (let i = 0; i < points.length; i += 2) {
		const x = points[i]!;
		const y = points[i + 1]!;
		const last = xs.length - 1;
		if (last >= 0 && Math.abs(x - xs[last]!) <= same && Math.abs(y - ys[last]!) <= same) continue;
		xs.push(x);
		ys.push(y);
	}

	let open = 0;
	for (let i = 1; i < xs.length; i += 1) open += Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!);
	const meet = subpath.closed ? same : Math.max(same, open * LOOP);
	const gap = () => Math.hypot(xs.at(-1)! - xs[0]!, ys.at(-1)! - ys[0]!);
	const ring = subpath.closed || (xs.length > 2 && gap() <= meet);
	// A ring's closing edge is implied, so a last point back on the first goes.
	while (ring && xs.length > 1 && gap() <= meet) {
		xs.pop();
		ys.pop();
	}

	const n = xs.length;
	const at = [0];
	for (let i = 1; i < n; i += 1) at.push(at[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!));
	if (ring && n > 1) at.push(at[n - 1]! + Math.hypot(xs[0]! - xs[n - 1]!, ys[0]! - ys[n - 1]!));
	return { xs, ys, at, length: at.at(-1)!, ring };
}

/**
 * Where outlines balance, each edge weighted by its length: the point a
 * subpath grows out of or shrinks into. Outlines with no length at all are
 * points, and balance at their average.
 */
function centreOf(outlines: readonly Outline[]): { x: number; y: number } {
	let sx = 0;
	let sy = 0;
	let total = 0;
	for (const { xs, ys, ring } of outlines) {
		const n = xs.length;
		for (let i = 0; i < (ring ? n : n - 1); i += 1) {
			const j = i + 1 === n ? 0 : i + 1;
			const length = Math.hypot(xs[j]! - xs[i]!, ys[j]! - ys[i]!);
			sx += ((xs[i]! + xs[j]!) / 2) * length;
			sy += ((ys[i]! + ys[j]!) / 2) * length;
			total += length;
		}
	}
	if (total > 0) return { x: sx / total, y: sy / total };

	let x = 0;
	let y = 0;
	for (const { xs, ys } of outlines) {
		x += xs[0]!;
		y += ys[0]!;
	}
	return { x: x / outlines.length, y: y / outlines.length };
}

/**
 * `count` points along an outline, spaced by arc length, with its corners
 * among them.
 *
 * A ring gives `count` points once round, starting at its first corner if it
 * has one; an open outline gives `count` points from its first point to its
 * last, both included. Corners are pinned and the rest of the points are
 * shared between the stretches in between by length, so a polygon is sampled
 * at the same points whichever vertex it was drawn from.
 */
function resample(outline: Outline, count: number): Float64Array {
	const out = new Float64Array(count * 2);
	const { xs, ys, at, length, ring } = outline;
	if (!(length > 0)) {
		// A point, or a subpath that never leaves one: every sample is that point.
		for (let i = 0; i < out.length; i += 2) {
			out[i] = xs[0]!;
			out[i + 1] = ys[0]!;
		}
		return out;
	}

	const pins = corners(outline, Math.max(0, (ring ? count : count - 2) >> 1));
	if (ring && pins.length === 0) {
		for (let i = 0; i < count; i += 1) pointAt(outline, (i * length) / count, out, i * 2);
		return out;
	}

	// The vertices the samples must include, in order: the corners, and an
	// open outline's two ends.
	const anchors = ring ? pins : [0, ...pins, xs.length - 1];
	const spans = ring ? anchors.length : anchors.length - 1;
	const starts: number[] = [];
	const lengths: number[] = [];
	for (let j = 0; j < spans; j += 1) {
		const start = at[anchors[j]!]!;
		let end = at[anchors[(j + 1) % anchors.length]!]!;
		// The stretch that runs past a ring's starting point.
		if (end <= start) end += length;
		starts.push(start);
		lengths.push(end - start);
	}
	const inside = allot(outline, starts, lengths, count - anchors.length);

	let k = 0;
	for (let j = 0; j < spans; j += 1) {
		out[k] = xs[anchors[j]!]!;
		out[k + 1] = ys[anchors[j]!]!;
		k += 2;
		const between = inside[j]!;
		for (let i = 1; i <= between; i += 1) {
			pointAt(outline, (starts[j]! + (lengths[j]! * i) / (between + 1)) % length, out, k);
			k += 2;
		}
	}
	if (!ring) {
		out[k] = xs.at(-1)!;
		out[k + 1] = ys.at(-1)!;
	}
	return out;
}

/**
 * The vertices where an outline turns by more than CORNER, in order along it.
 * When there are more than `limit` — a figure too detailed for its samples to
 * hold every corner — the sharpest are kept.
 */
function corners(outline: Outline, limit: number): number[] {
	const { xs, ys, ring } = outline;
	const n = xs.length;
	const found: Array<{ index: number; turn: number }> = [];
	// An open outline's ends are samples anyway, and have no turn to measure.
	for (let i = ring ? 0 : 1; i < (ring ? n : n - 1); i += 1) {
		const before = i === 0 ? n - 1 : i - 1;
		const after = i === n - 1 ? 0 : i + 1;
		const ax = xs[i]! - xs[before]!;
		const ay = ys[i]! - ys[before]!;
		const bx = xs[after]! - xs[i]!;
		const by = ys[after]! - ys[i]!;
		const turn = Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by);
		if (turn > CORNER) found.push({ index: i, turn });
	}
	if (found.length > limit) {
		found.sort((p, q) => q.turn - p.turn || p.index - q.index);
		found.length = limit;
	}
	return found.map((corner) => corner.index).sort((p, q) => p - q);
}

/**
 * Share `budget` points between stretches in proportion to their length.
 *
 * The few left over by rounding go to the stretches rounding shorted most,
 * and between equal claims to the one further left, then higher up. That is
 * a rule about where a stretch is rather than where the outline happened to
 * start, so the same figure drawn from another vertex, or the other way
 * round, is sampled at exactly the same points — and morphs into itself
 * without moving.
 */
function allot(outline: Outline, starts: readonly number[], lengths: readonly number[], budget: number): number[] {
	const total = lengths.reduce((sum, length) => sum + length, 0);
	const shares = lengths.map((length) => (budget * length) / total);
	const counts = shares.map(Math.floor);
	let left = budget - counts.reduce((sum, count) => sum + count, 0);
	if (left <= 0) return counts;

	const middle = new Float64Array(2);
	const claims = lengths.map((length, j) => {
		pointAt(outline, (starts[j]! + length / 2) % outline.length, middle, 0);
		return {
			j,
			// Rounded, so claims that differ only by float noise are equal.
			shorted: Math.round((shares[j]! - counts[j]!) * 1e6),
			x: Math.round(middle[0]! * 1e3),
			y: Math.round(middle[1]! * 1e3),
		};
	});
	claims.sort((p, q) => q.shorted - p.shorted || p.x - q.x || p.y - q.y || p.j - q.j);
	for (let i = 0; left > 0; i += 1, left -= 1) counts[claims[i % claims.length]!.j]! += 1;
	return counts;
}

/** Write the point `s` along an outline into `out` at `index`. */
function pointAt(outline: Outline, s: number, out: Float64Array, index: number): void {
	const { xs, ys, at } = outline;
	const last = at.length - 2; // the last edge
	if (last < 0) {
		out[index] = xs[0]!;
		out[index + 1] = ys[0]!;
		return;
	}

	// The edge `s` falls on: the last one starting at or before it.
	let lo = 0;
	let hi = last;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (at[mid]! <= s) lo = mid;
		else hi = mid - 1;
	}
	const next = lo + 1 === xs.length ? 0 : lo + 1;
	const edge = at[lo + 1]! - at[lo]!;
	const u = edge > 0 ? Math.min(1, Math.max(0, (s - at[lo]!) / edge)) : 0;
	out[index] = xs[lo]! + (xs[next]! - xs[lo]!) * u;
	out[index + 1] = ys[lo]! + (ys[next]! - ys[lo]!) * u;
}
