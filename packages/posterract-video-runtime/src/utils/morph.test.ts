/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import test from "node:test";

import { morphAny, morphPathData } from "./morph.ts";
import { boundsOf, compatible, flattenPath, morphPath, parsePath, type PathCommand, type SubPath } from "./vector.ts";

const CIRCLE = "M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50";
const SQUARE = "M0 0 H100 V100 H0 Z";
const ROUNDED_SQUARE = "M20 0 H80 A20 20 0 0 1 100 20 V80 A20 20 0 0 1 80 100 H20 A20 20 0 0 1 0 80 V20 A20 20 0 0 1 20 0 Z";
const TRIANGLE = "M50 0 L100 100 L0 100 Z";
/** Six petals: an arc bulging outwards from each side of a hexagon. */
const FLOWER = "M70 50 A14 14 0 1 1 60 67.321 A14 14 0 1 1 40 67.321 A14 14 0 1 1 30 50 "
	+ "A14 14 0 1 1 40 32.679 A14 14 0 1 1 60 32.679 A14 14 0 1 1 70 50 Z";

/** The points a blended figure is drawn through, one list per subpath. */
function outlines(commands: readonly PathCommand[]): Array<Array<[number, number]>> {
	const out: Array<Array<[number, number]>> = [];
	for (const { type, values } of commands) {
		if (type === "M") out.push([[values[0]!, values[1]!]]);
		else if (type === "L") out.at(-1)!.push([values[0]!, values[1]!]);
	}
	return out;
}

/** How far a point is from the nearest edge of a flattened figure. */
function distanceTo(subpaths: readonly SubPath[], x: number, y: number): number {
	let best = Infinity;
	for (const { points } of subpaths) {
		for (let i = 2; i < points.length; i += 2) {
			const ax = points[i - 2]!;
			const ay = points[i - 1]!;
			const dx = points[i]! - ax;
			const dy = points[i + 1]! - ay;
			const u = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
			best = Math.min(best, Math.hypot(x - ax - dx * u, y - ay - dy * u));
		}
	}
	return best;
}

/** Signed area of a polygon given as x0, y0, x1, y1, …; its sign is its winding. */
function area(points: readonly number[]): number {
	let sum = 0;
	for (let i = 0; i < points.length; i += 2) {
		const j = (i + 2) % points.length;
		sum += points[i]! * points[j + 1]! - points[j]! * points[i + 1]!;
	}
	return sum / 2;
}

function finite(commands: readonly PathCommand[]): boolean {
	return commands.every((command) => command.values.every(Number.isFinite));
}

test("the ends are the figures themselves, and commands that match and line up still blend one for one", () => {
	const circle = parsePath(CIRCLE);
	const square = parsePath(SQUARE);
	assert.equal(morphAny(circle, square, 0), circle);
	assert.equal(morphAny(circle, square, 1), square);
	assert.equal(morphAny(circle, square, -0.1), circle, "a spring undershooting the start holds the source");
	assert.equal(morphAny(circle, square, 1.1), square, "and one overshooting the end holds the target");
	assert.equal(morphAny(circle, square, NaN), circle);

	const a = parsePath("M0 0 L10 0 L10 10 Z");
	const b = parsePath("M0 0 L20 10 L0 30 Z");
	assert.ok(compatible(a, b));
	for (const t of [0.25, 0.5, 0.75]) assert.deepEqual(morphAny(a, b, t), morphPath(a, b, t));

	// Two ellipses of four arcs each, the way ellipse nodes are built: the
	// match is sound, so the blend stays one for one and the arcs stay arcs.
	const small = parsePath("M0 30 A50 30 0 0 1 50 0 A50 30 0 0 1 100 30 A50 30 0 0 1 50 60 A50 30 0 0 1 0 30 Z");
	const large = parsePath("M0 50 A100 50 0 0 1 100 0 A100 50 0 0 1 200 50 A100 50 0 0 1 100 100 A100 50 0 0 1 0 50 Z");
	assert.deepEqual(morphAny(small, large, 0.5), morphPath(small, large, 0.5));
	assert.ok(morphAny(small, large, 0.5).some((command) => command.type === "A"));
	assert.deepEqual(morphPathData("M0 0 L10 0 L10 10 Z", "M0 0 L20 10 L0 30 Z", 0.5), morphPath(a, b, 0.5));
});

test("a circle becomes a square through a single closed outline", () => {
	const middle = morphAny(parsePath(CIRCLE), parsePath(SQUARE), 0.5);
	const [outline, ...rest] = outlines(middle);
	assert.equal(rest.length, 0);
	assert.equal(outline!.length, 128);
	assert.equal(middle.at(-1)!.type, "Z");
	for (const [x, y] of outline!) {
		assert.ok(Number.isFinite(x) && Number.isFinite(y));
		assert.ok(x >= -1 && x <= 101 && y >= -1 && y <= 101, `${x}, ${y} is outside the box`);
	}
});

test("the same square started from another vertex, or run the other way, morphs without moving", () => {
	const square = parsePath(SQUARE);
	const outline = flattenPath(square);
	// The first two have the square's own command sequence, so they could be
	// blended one for one — through a diamond, and through a line. They must
	// not be. The rest draw the same square with other sequences.
	const matching = ["M100 0 V100 H0 V0 Z", "M0 0 V100 H100 V0 Z"];
	for (const other of matching) assert.ok(compatible(square, parsePath(other)));
	for (const other of [...matching, "M100 0 V100 H0 V0 H100 Z", "M30 0 H100 V100 H0 V0 Z", "M30 0 H0 V100 H100 V0 Z"]) {
		const target = parsePath(other);
		const start = outlines(morphAny(square, target, 1e-9))[0]!;
		const middle = outlines(morphAny(square, target, 0.5))[0]!;
		assert.equal(middle.length, 128);
		middle.forEach(([x, y], i) => {
			assert.ok(distanceTo(outline, x, y) <= 1, `${other}: ${x}, ${y} left the square`);
			assert.ok(Math.hypot(x - start[i]![0], y - start[i]![1]) <= 1, `${other}: point ${i} travelled`);
		});
		assert.deepEqual(morphPathData(SQUARE, other, 0.5), morphAny(square, target, 0.5));
	}
});

test("a triangle wound the other way is matched backwards rather than turned inside out", () => {
	const clockwise = parsePath("M50 0 L100 100 L0 100 Z");
	// The same triangle anticlockwise. Its commands match the clockwise one's
	// one for one, and blended that way it would flatten into a line halfway.
	const anticlockwise = parsePath("M50 0 L0 100 L100 100 Z");
	assert.ok(compatible(clockwise, anticlockwise));
	const before = area(flattenPath(clockwise)[0]!.points);
	assert.equal(Math.sign(before), -Math.sign(area(flattenPath(anticlockwise)[0]!.points)), "they really are wound opposite ways");

	// And the same again closed explicitly, so its commands do not match at all.
	for (const target of [anticlockwise, parsePath("M50 0 L0 100 L100 100 L50 0 Z")]) {
		for (const t of [0.25, 0.5, 0.75]) {
			const between = area(flattenPath(morphAny(clockwise, target, t))[0]!.points);
			assert.equal(Math.sign(between), Math.sign(before));
			assert.ok(Math.abs(Math.abs(between) - Math.abs(before)) <= 0.01 * Math.abs(before), `area ${between} at ${t}`);
		}
	}
	assert.deepEqual(
		morphPathData("M50 0 L100 100 L0 100 Z", "M50 0 L0 100 L100 100 Z", 0.5),
		morphAny(clockwise, anticlockwise, 0.5),
	);

	// A triangle flipped over, apex through its base. No other starting point
	// matches it much better, but it turns over, so one for one it would pass
	// through almost nothing halfway.
	const down = parsePath("M0 0 L100 0 L50 100 Z");
	const up = parsePath("M0 0 L100 10 L50 -100 Z");
	assert.ok(compatible(down, up));
	const full = area(flattenPath(down)[0]!.points);
	assert.ok(Math.abs(area(flattenPath(morphPath(down, up, 0.5))[0]!.points)) < 0.1 * full);
	for (const t of [0.25, 0.5, 0.75]) {
		assert.ok(area(flattenPath(morphAny(down, up, t))[0]!.points) > 0.5 * full, `it keeps its area at ${t}`);
	}
});

test("an extra subpath grows in place, and a missing one shrinks away where it was", () => {
	const one = parsePath(CIRCLE);
	const two = parsePath(`${CIRCLE} M150 50 A20 20 0 1 0 190 50 A20 20 0 1 0 150 50`);
	const growing = morphAny(one, two, 0.5);
	const shrinking = morphAny(two, one, 0.5);
	assert.ok(finite(growing) && finite(shrinking));
	for (const between of [outlines(growing), outlines(shrinking)]) {
		assert.equal(between.length, 2);
		// The big circles pair up and stay put.
		for (const [x, y] of between[0]!) assert.ok(Math.abs(Math.hypot(x - 50, y - 50) - 50) < 0.1);
		// Halfway, the small one is half its radius, about its own centre.
		for (const [x, y] of between[1]!) assert.ok(Math.abs(Math.hypot(x - 170, y - 50) - 10) < 0.1);
	}
});

test("path data is worked out once, and every later call gets the same answer", () => {
	const first = morphPathData(CIRCLE, TRIANGLE, 0.3);
	assert.deepEqual(morphPathData(CIRCLE, TRIANGLE, 0.3), first);
	assert.deepEqual(morphAny(parsePath(CIRCLE), parsePath(TRIANGLE), 0.3), first, "the same blend as from commands");
	assert.deepEqual(morphPathData(CIRCLE, TRIANGLE, 0), parsePath(CIRCLE));
	assert.deepEqual(morphPathData(CIRCLE, TRIANGLE, 1), parsePath(TRIANGLE));
	assert.deepEqual(
		morphPathData("M0 0 L10 0", "M0 0 L20 10", 0.5),
		morphPath(parsePath("M0 0 L10 0"), parsePath("M0 0 L20 10"), 0.5),
	);

	// More pairs than the cache holds: the oldest are dropped and worked out again, never confused.
	for (let i = 0; i < 300; i += 1) morphPathData(`M0 ${i} L100 ${i}`, "M0 0 L50 50 L100 0", 0.5);
	assert.deepEqual(morphPathData(CIRCLE, TRIANGLE, 0.3), first);
});

test("a caller refilling the same array is never handed the old figure's correspondence", () => {
	const scratch: PathCommand[] = parsePath(CIRCLE);
	const square = parsePath(SQUARE);
	morphAny(scratch, square, 0.5);
	scratch.splice(0, scratch.length, ...parsePath(TRIANGLE));
	assert.deepEqual(morphAny(scratch, square, 0.5), morphPathData(TRIANGLE, SQUARE, 0.5));
});

test("a morph leaves its source and reaches its target without a jump", () => {
	const circle = parsePath(CIRCLE);
	const triangle = parsePath(TRIANGLE);
	const source = outlines(morphAny(circle, triangle, 1e-9))[0]!;
	const target = outlines(morphAny(circle, triangle, 1 - 1e-9))[0]!;

	// The resampled ends lie on the figures themselves, corners and all.
	for (const [x, y] of source) assert.ok(distanceTo(flattenPath(circle), x, y) < 1e-6);
	for (const [x, y] of target) assert.ok(distanceTo(flattenPath(triangle), x, y) < 1e-6);
	for (const [x, y] of [[50, 0], [100, 100], [0, 100]] as const) {
		assert.ok(target.some(([px, py]) => Math.hypot(px - x, py - y) < 1e-6), `the corner ${x}, ${y} is kept`);
	}

	const early = outlines(morphAny(circle, triangle, 0.001))[0]!;
	const late = outlines(morphAny(circle, triangle, 0.999))[0]!;
	early.forEach(([x, y], i) => assert.ok(Math.hypot(x - source[i]![0], y - source[i]![1]) <= 1));
	late.forEach(([x, y], i) => assert.ok(Math.hypot(x - target[i]![0], y - target[i]![1]) <= 1));
});

test("a figure with nothing to draw makes the other grow from, or shrink to, its centre", () => {
	const circle = parsePath(CIRCLE);
	const near = (box: ReturnType<typeof boundsOf>, x: number, size: number) =>
		box !== null && [box.x - x, box.y - x, box.width - size, box.height - size].every((d) => Math.abs(d) < 1e-6);

	assert.ok(near(boundsOf(flattenPath(morphAny([], circle, 0.5))), 25, 50));
	assert.ok(near(boundsOf(flattenPath(morphAny(circle, [], 0.25))), 12.5, 75));
	// A lone moveto draws nothing either.
	assert.ok(near(boundsOf(flattenPath(morphAny(parsePath("M5 5"), circle, 0.5))), 25, 50));
	assert.deepEqual(morphAny([], [], 0.5), []);

	// A stroke of no length is a point, and the other figure grows out of it.
	const dot = parsePath("M5 5 L5 5");
	for (const t of [0.001, 0.5, 0.999]) {
		assert.ok(finite(morphAny(dot, parsePath(SQUARE), t)));
		assert.ok(finite(morphAny(parsePath(SQUARE), dot, t)));
	}
	const early = outlines(morphAny(dot, parsePath(SQUARE), 0.001))[0]!;
	for (const [x, y] of early) assert.ok(Math.hypot(x - 5, y - 5) < 0.2);
});

test("an open stroke drawn the other way is matched end to end, not folded through its middle", () => {
	const line = parsePath("M0 0 L100 0");
	const backwards = parsePath("M100 0 L50 0 L0 0");
	assert.equal(compatible(line, backwards), false);
	const middle = morphAny(line, backwards, 0.5);
	assert.equal(middle.some((command) => command.type === "Z"), false);
	const xs = outlines(middle)[0]!.map(([x]) => x);
	assert.ok(Math.min(...xs) < 1 && Math.max(...xs) > 99, "the stroke keeps its length");
});

test("a circle drawn from its other side, without a close, still matches round it", () => {
	const circle = parsePath(CIRCLE);
	// The same circle started on the opposite side: in two arcs, whose commands
	// match the original's one for one and would shrink it to a point halfway;
	// and in three, whose commands do not match at all.
	const twoArcs = parsePath("M100 50 A50 50 0 1 0 0 50 A50 50 0 1 0 100 50");
	const threeArcs = parsePath("M100 50 A50 50 0 0 0 50 0 A50 50 0 0 0 0 50 A50 50 0 1 0 100 50");
	assert.ok(compatible(circle, twoArcs));
	assert.equal(compatible(circle, threeArcs), false);
	for (const other of [twoArcs, threeArcs]) {
		for (const t of [0.25, 0.5, 0.75]) {
			for (const [x, y] of outlines(morphAny(circle, other, t))[0]!) {
				assert.ok(Math.abs(Math.hypot(x - 50, y - 50) - 50) < 0.5, `${x}, ${y} fell inside the circle at ${t}`);
			}
		}
	}
});

test("circle, rounded square, triangle, flower: every step is one outline inside both figures' box", () => {
	const chain = [CIRCLE, ROUNDED_SQUARE, TRIANGLE, FLOWER].map(parsePath);
	for (let i = 1; i < chain.length; i += 1) {
		const from = chain[i - 1]!;
		const to = chain[i]!;
		const a = boundsOf(flattenPath(from))!;
		const b = boundsOf(flattenPath(to))!;
		const left = Math.min(a.x, b.x) - 1;
		const top = Math.min(a.y, b.y) - 1;
		const right = Math.max(a.x + a.width, b.x + b.width) + 1;
		const bottom = Math.max(a.y + a.height, b.y + b.height) + 1;
		for (const t of [0.25, 0.5, 0.75]) {
			const between = outlines(morphAny(from, to, t));
			assert.equal(between.length, 1);
			assert.equal(between[0]!.length, 128);
			for (const [x, y] of between[0]!) {
				assert.ok(x >= left && x <= right && y >= top && y <= bottom, `step ${i} at ${t}: ${x}, ${y}`);
			}
		}
	}
});
