/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * SVG path geometry: parsing, flattening, trimming and morphing.
 *
 * Native vector elements need four things a canvas context cannot answer on
 * its own — how long a path is, what a fraction of it looks like, what it
 * halfway-is between two shapes, and what box it occupies. All four fall out
 * of one representation: commands parsed once, flattened into polylines when
 * something needs a length.
 *
 * Nothing here touches a canvas or a DOM node, so it behaves identically in
 * the live renderer and in an offline export — which is the whole point.
 */

/** One path command, absolute, with its numbers in SVG order. */
export interface PathCommand {
	readonly type: 'M' | 'L' | 'C' | 'Q' | 'A' | 'Z';
	readonly values: readonly number[];
}

/** A flattened run of points; `closed` when its subpath ended with Z. */
export interface SubPath {
	points: number[]; // x0, y0, x1, y1, …
	closed: boolean;
}

const COMMAND = /([astvzqmhlc])([^astvzqmhlc]*)/gi;
const NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

/** How many numbers each command takes, per repetition. */
const ARITY: Record<string, number> = {
	m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0,
};

/**
 * Parse SVG path data into absolute commands.
 *
 * Relative forms, implicit repeats (`M x y x y` continuing as lineto), and the
 * smooth shorthands are all normalised away, so everything downstream sees one
 * shape of data. Malformed input yields the commands parsed so far rather than
 * throwing: a half-typed `d` while the user edits should draw what it can.
 */
export function parsePath(d: string): PathCommand[] {
	const out: PathCommand[] = [];
	if (!d) return out;

	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	// The previous curve's second control point, for S/T smoothing.
	let lastControlX = 0;
	let lastControlY = 0;
	let lastType = '';

	COMMAND.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = COMMAND.exec(d)) !== null) {
		const letter = match[1]!;
		const lower = letter.toLowerCase();
		const relative = letter !== letter.toUpperCase();
		const arity = ARITY[lower] ?? 0;

		const numbers: number[] = [];
		NUMBER.lastIndex = 0;
		let number: RegExpExecArray | null;
		while ((number = NUMBER.exec(match[2]!)) !== null) numbers.push(Number(number[0]));

		if (arity === 0) {
			if (lower === 'z') {
				out.push({ type: 'Z', values: [] });
				x = startX;
				y = startY;
				lastType = 'z';
			}
			continue;
		}

		for (let i = 0; i + arity <= numbers.length; i += arity) {
			const n = numbers.slice(i, i + arity);
			switch (lower) {
				case 'm': {
					const [dx, dy] = n as [number, number];
					x = relative ? x + dx : dx;
					y = relative ? y + dy : dy;
					// Only the first pair is a moveto; the rest are linetos.
					if (i === 0) {
						startX = x;
						startY = y;
						out.push({ type: 'M', values: [x, y] });
					} else {
						out.push({ type: 'L', values: [x, y] });
					}
					break;
				}
				case 'l': {
					const [dx, dy] = n as [number, number];
					x = relative ? x + dx : dx;
					y = relative ? y + dy : dy;
					out.push({ type: 'L', values: [x, y] });
					break;
				}
				case 'h': {
					x = relative ? x + n[0]! : n[0]!;
					out.push({ type: 'L', values: [x, y] });
					break;
				}
				case 'v': {
					y = relative ? y + n[0]! : n[0]!;
					out.push({ type: 'L', values: [x, y] });
					break;
				}
				case 'c': {
					const [c1x, c1y, c2x, c2y, ex, ey] = n as [number, number, number, number, number, number];
					const a1x = relative ? x + c1x : c1x;
					const a1y = relative ? y + c1y : c1y;
					const a2x = relative ? x + c2x : c2x;
					const a2y = relative ? y + c2y : c2y;
					x = relative ? x + ex : ex;
					y = relative ? y + ey : ey;
					out.push({ type: 'C', values: [a1x, a1y, a2x, a2y, x, y] });
					lastControlX = a2x;
					lastControlY = a2y;
					break;
				}
				case 's': {
					const [c2x, c2y, ex, ey] = n as [number, number, number, number];
					// The first control point mirrors the previous curve's last.
					const smooth = lastType === 'c' || lastType === 's';
					const a1x = smooth ? 2 * x - lastControlX : x;
					const a1y = smooth ? 2 * y - lastControlY : y;
					const a2x = relative ? x + c2x : c2x;
					const a2y = relative ? y + c2y : c2y;
					x = relative ? x + ex : ex;
					y = relative ? y + ey : ey;
					out.push({ type: 'C', values: [a1x, a1y, a2x, a2y, x, y] });
					lastControlX = a2x;
					lastControlY = a2y;
					break;
				}
				case 'q': {
					const [cx, cy, ex, ey] = n as [number, number, number, number];
					const ax = relative ? x + cx : cx;
					const ay = relative ? y + cy : cy;
					x = relative ? x + ex : ex;
					y = relative ? y + ey : ey;
					out.push({ type: 'Q', values: [ax, ay, x, y] });
					lastControlX = ax;
					lastControlY = ay;
					break;
				}
				case 't': {
					const [ex, ey] = n as [number, number];
					const smooth = lastType === 'q' || lastType === 't';
					const ax = smooth ? 2 * x - lastControlX : x;
					const ay = smooth ? 2 * y - lastControlY : y;
					x = relative ? x + ex : ex;
					y = relative ? y + ey : ey;
					out.push({ type: 'Q', values: [ax, ay, x, y] });
					lastControlX = ax;
					lastControlY = ay;
					break;
				}
				case 'a': {
					const [rx, ry, rotation, large, sweep, ex, ey] = n as
						[number, number, number, number, number, number, number];
					const nx = relative ? x + ex : ex;
					const ny = relative ? y + ey : ey;
					out.push({ type: 'A', values: [rx, ry, rotation, large, sweep, nx, ny] });
					x = nx;
					y = ny;
					break;
				}
			}
			lastType = lower;
		}
	}

	return out;
}

/** How finely curves are broken into line segments. Fixed, so flattening is deterministic. */
const CURVE_STEPS = 24;

/**
 * Flatten commands into polylines.
 *
 * Curves become fixed-step polylines rather than adaptively subdivided ones:
 * an export must produce exactly what the preview did, and a tolerance that
 * depends on the current transform would not.
 */
export function flattenPath(commands: readonly PathCommand[]): SubPath[] {
	const subpaths: SubPath[] = [];
	let current: SubPath | null = null;
	let x = 0;
	let y = 0;

	const push = (px: number, py: number) => {
		if (!current) {
			current = { points: [px, py], closed: false };
			subpaths.push(current);
			return;
		}
		current.points.push(px, py);
	};

	for (const command of commands) {
		switch (command.type) {
			case 'M': {
				[x, y] = command.values as [number, number];
				current = { points: [x, y], closed: false };
				subpaths.push(current);
				break;
			}
			case 'L': {
				[x, y] = command.values as [number, number];
				push(x, y);
				break;
			}
			case 'C': {
				const [c1x, c1y, c2x, c2y, ex, ey] = command.values as
					[number, number, number, number, number, number];
				for (let step = 1; step <= CURVE_STEPS; step += 1) {
					const t = step / CURVE_STEPS;
					const u = 1 - t;
					push(
						u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
						u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
					);
				}
				x = ex;
				y = ey;
				break;
			}
			case 'Q': {
				const [cx, cy, ex, ey] = command.values as [number, number, number, number];
				for (let step = 1; step <= CURVE_STEPS; step += 1) {
					const t = step / CURVE_STEPS;
					const u = 1 - t;
					push(u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey);
				}
				x = ex;
				y = ey;
				break;
			}
			case 'A': {
				const [rx, ry, rotation, large, sweep, ex, ey] = command.values as
					[number, number, number, number, number, number, number];
				for (const [px, py] of arcPoints(x, y, rx, ry, rotation, large !== 0, sweep !== 0, ex, ey)) {
					push(px, py);
				}
				x = ex;
				y = ey;
				break;
			}
			case 'Z': {
				if (current) {
					current.closed = true;
					const [sx, sy] = [current.points[0]!, current.points[1]!];
					// The closing edge is a real edge: trim and length must see it.
					if (x !== sx || y !== sy) push(sx, sy);
					x = sx;
					y = sy;
				}
				break;
			}
		}
	}

	return subpaths.filter((subpath) => subpath.points.length >= 4);
}

/**
 * Points along an SVG elliptical arc, endpoint parameterisation.
 * Follows the implementation notes in the SVG spec (F.6.5).
 */
function arcPoints(
	x1: number, y1: number,
	rxIn: number, ryIn: number,
	rotation: number,
	large: boolean, sweep: boolean,
	x2: number, y2: number,
): Array<[number, number]> {
	if (rxIn === 0 || ryIn === 0) return [[x2, y2]];

	let rx = Math.abs(rxIn);
	let ry = Math.abs(ryIn);
	const phi = (rotation * Math.PI) / 180;
	const cosPhi = Math.cos(phi);
	const sinPhi = Math.sin(phi);

	const dx = (x1 - x2) / 2;
	const dy = (y1 - y2) / 2;
	const x1p = cosPhi * dx + sinPhi * dy;
	const y1p = -sinPhi * dx + cosPhi * dy;

	// Scale the radii up when they are too small to span the endpoints.
	const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
	if (lambda > 1) {
		const scale = Math.sqrt(lambda);
		rx *= scale;
		ry *= scale;
	}

	const sign = large === sweep ? -1 : 1;
	const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
	const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
	const factor = sign * Math.sqrt(Math.max(0, numerator / (denominator || 1)));

	const cxp = (factor * rx * y1p) / ry;
	const cyp = (-factor * ry * x1p) / rx;
	const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
	const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

	const angle = (ux: number, uy: number, vx: number, vy: number): number => {
		const dot = ux * vx + uy * vy;
		const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy)) || 1;
		const value = Math.acos(Math.min(1, Math.max(-1, dot / len)));
		return ux * vy - uy * vx < 0 ? -value : value;
	};

	const theta = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
	let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
	if (!sweep && delta > 0) delta -= 2 * Math.PI;
	if (sweep && delta < 0) delta += 2 * Math.PI;

	const steps = Math.max(2, Math.ceil((Math.abs(delta) / (Math.PI / 2)) * CURVE_STEPS));
	const points: Array<[number, number]> = [];
	for (let step = 1; step <= steps; step += 1) {
		const t = theta + (delta * step) / steps;
		const px = cosPhi * rx * Math.cos(t) - sinPhi * ry * Math.sin(t) + cx;
		const py = sinPhi * rx * Math.cos(t) + cosPhi * ry * Math.sin(t) + cy;
		points.push([px, py]);
	}
	return points;
}

/** Total length of every subpath, and each one's own length. */
export function measure(subpaths: readonly SubPath[]): { total: number; lengths: number[] } {
	const lengths: number[] = [];
	let total = 0;
	for (const subpath of subpaths) {
		let length = 0;
		const { points } = subpath;
		for (let i = 2; i < points.length; i += 2) {
			length += Math.hypot(points[i]! - points[i - 2]!, points[i + 1]! - points[i - 1]!);
		}
		lengths.push(length);
		total += length;
	}
	return { total, lengths };
}

/**
 * The portion of `subpaths` between `start` and `end` (both 0–1 of the whole
 * figure), rotated by `offset`.
 *
 * This is After Effects' Trim Paths, and the reason a line can draw itself: a
 * track from `end` 0 to 1 reveals the stroke exactly as it was drawn. A window
 * that wraps past the end continues from the beginning, so an offset animation
 * chases around a closed shape rather than stopping at its seam.
 */
export function trimPath(
	subpaths: readonly SubPath[],
	start: number,
	end: number,
	offset = 0,
): SubPath[] {
	const from = Math.min(start, end);
	const to = Math.max(start, end);
	if (to - from >= 1 && offset === 0) return subpaths.map((subpath) => ({ ...subpath }));
	if (to <= from) return [];

	const { total } = measure(subpaths);
	if (total <= 0) return [];

	// Windows are expressed in length, and wrap: [0.8, 1.2] is the last fifth
	// followed by the first fifth.
	const shift = offset % 1;
	let a = (from + shift) % 1;
	if (a < 0) a += 1;
	const span = Math.min(1, to - from);
	const windows: Array<[number, number]> = a + span <= 1
		? [[a * total, (a + span) * total]]
		: [[a * total, total], [0, (a + span - 1) * total]];

	const out: SubPath[] = [];
	for (const [windowStart, windowEnd] of windows) {
		let walked = 0;
		for (const subpath of subpaths) {
			const { points } = subpath;
			let run: number[] = [];
			for (let i = 2; i < points.length; i += 2) {
				const x0 = points[i - 2]!;
				const y0 = points[i - 1]!;
				const x1 = points[i]!;
				const y1 = points[i + 1]!;
				const length = Math.hypot(x1 - x0, y1 - y0);
				const segmentStart = walked;
				const segmentEnd = walked + length;
				walked = segmentEnd;
				if (length === 0) continue;

				const lo = Math.max(windowStart, segmentStart);
				const hi = Math.min(windowEnd, segmentEnd);
				if (hi <= lo) {
					// The run ends wherever the window does.
					if (run.length >= 4) out.push({ points: run, closed: false });
					if (run.length) run = [];
					continue;
				}

				const t0 = (lo - segmentStart) / length;
				const t1 = (hi - segmentStart) / length;
				if (run.length === 0) run.push(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0);
				run.push(x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1);
			}
			if (run.length >= 4) out.push({ points: run, closed: false });
		}
	}
	return out;
}

/**
 * Blend two paths, command for command.
 *
 * Only shapes that agree on their command sequence can morph: anything else
 * would need a correspondence nobody has stated, and guessing one produces the
 * folding, self-crossing in-betweens that make morphs look broken. When they
 * disagree the target simply replaces the source at the halfway point, which
 * is honest and never wrong-looking.
 */
export function morphPath(from: readonly PathCommand[], to: readonly PathCommand[], t: number): PathCommand[] {
	if (t <= 0) return from as PathCommand[];
	if (t >= 1) return to as PathCommand[];
	if (!compatible(from, to)) return (t < 0.5 ? from : to) as PathCommand[];

	return from.map((command, index) => {
		const target = to[index]!;
		return {
			type: command.type,
			values: command.values.map((value, position) => {
				const other = target.values[position] ?? value;
				// Arc flags are booleans in a number's clothing; blending one
				// would ask for a half-taken sweep.
				if (command.type === 'A' && (position === 3 || position === 4)) {
					return t < 0.5 ? value : other;
				}
				return value + (other - value) * t;
			}),
		};
	});
}

/** Whether two command lists can be blended one for one. */
export function compatible(from: readonly PathCommand[], to: readonly PathCommand[]): boolean {
	if (from.length !== to.length || from.length === 0) return false;
	return from.every((command, index) => command.type === to[index]!.type);
}

/** Serialise commands back to SVG path data. */
export function toPathData(commands: readonly PathCommand[]): string {
	return commands
		.map((command) => (command.values.length ? `${command.type}${command.values.map(round).join(' ')}` : command.type))
		.join('');
}

function round(value: number): string {
	return String(Math.round(value * 1000) / 1000);
}

/** The axis-aligned box a flattened figure occupies, or null when it is empty. */
export function boundsOf(subpaths: readonly SubPath[]): { x: number; y: number; width: number; height: number } | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const subpath of subpaths) {
		const { points } = subpath;
		for (let i = 0; i < points.length; i += 2) {
			const x = points[i]!;
			const y = points[i + 1]!;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
	}
	if (minX > maxX) return null;
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** `points="x,y x,y …"` as a flat number list; malformed pairs are dropped. */
export function parsePoints(input: string): number[] {
	const numbers: number[] = [];
	NUMBER.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = NUMBER.exec(input)) !== null) numbers.push(Number(match[0]));
	return numbers.length % 2 === 0 ? numbers : numbers.slice(0, -1);
}
