/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import test from "node:test";

import { placeGlyphsOnPath, pointAtLength } from "./text-path.ts";
import { flattenPath, measure, parsePath } from "./vector.ts";

const path = (d: string) => flattenPath(parsePath(d));

/** Radius 100 about the origin, from the top, clockwise on screen; two arcs and no Z, but it ends where it began. */
const circle = path("M0 -100 A100 100 0 1 1 0 100 A100 100 0 1 1 0 -100");
/** The same circle the other way round. */
const anticlockwise = path("M0 -100 A100 100 0 1 0 0 100 A100 100 0 1 0 0 -100");

const DEGREE = Math.PI / 180;

function near(actual: number, expected: number, tolerance = 1e-9, what = "value"): void {
	assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);
}

/** The signed difference between two angles, in (-π, π]. */
const turn = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** Where a point on the circle is, as a clockwise angle from the top. */
const bearing = (x: number, y: number) => Math.atan2(x, -y);

test("on a straight line each glyph is centred at the advances before it plus half its own", () => {
	const placed = placeGlyphsOnPath(path("M0 0 L1000 0"), [10, 20, 30], { offset: 0, align: "start" });
	assert.deepEqual(placed.map((glyph) => glyph.index), [0, 1, 2]);
	for (const [i, x] of [5, 20, 45].entries()) {
		near(placed[i]!.x, x, 1e-9, "x");
		near(placed[i]!.y, 0, 1e-9, "y");
		near(placed[i]!.angle, 0, 1e-9, "angle");
		assert.equal(placed[i]!.visible, true);
	}
});

test("the run's start, centre or end goes on the offset", () => {
	const line = path("M0 0 L100 0");
	const xs = (align: "start" | "center" | "end") =>
		placeGlyphsOnPath(line, [10, 10], { offset: 0.5, align }).map((glyph) => Math.round(glyph.x));
	assert.deepEqual(xs("start"), [55, 65]);
	assert.deepEqual(xs("center"), [45, 55]);
	assert.deepEqual(xs("end"), [35, 45]);
});

test("the offset slides the text along by that fraction of the path", () => {
	const line = path("M0 0 L200 0");
	const at = (offset: number) => placeGlyphsOnPath(line, [20], { offset, align: "start" })[0]!.x;
	near(at(0), 10);
	near(at(0.25), 60);
	near(at(0.5), 110);
});

test("a glyph off either end of an open path is hidden, and placed on the end it left by", () => {
	const line = path("M0 0 L100 0");
	const placed = placeGlyphsOnPath(line, [30, 30, 30, 30], { offset: 0, align: "start" });
	assert.deepEqual(placed.map((glyph) => glyph.visible), [true, true, true, false]);
	near(placed[3]!.x, 100);
	near(placed[3]!.y, 0);
	near(placed[3]!.angle, 0);

	const early = placeGlyphsOnPath(line, [30, 30], { offset: -0.2, align: "start" });
	assert.deepEqual(early.map((glyph) => glyph.visible), [false, true]);
	near(early[0]!.x, 0);

	// Asking an open path to wrap changes nothing: its ends do not meet.
	const asked = placeGlyphsOnPath(line, [30, 30, 30, 30], { offset: 0, align: "start", wrap: true });
	assert.deepEqual(asked.map((glyph) => glyph.visible), [true, true, true, false]);
});

test("on a circle glyphs sit on the rim, as far round as their distance, turned along it", () => {
	const placed = placeGlyphsOnPath(circle, Array<number>(12).fill(20), { offset: 0, align: "start" });
	for (const glyph of placed) {
		assert.equal(glyph.visible, true);
		near(Math.hypot(glyph.x, glyph.y), 100, 0.1, `radius of ${glyph.index}`);
		near(bearing(glyph.x, glyph.y), (10 + 20 * glyph.index) / 100, 0.002, `bearing of ${glyph.index}`);
		// Clockwise on screen, travel is the radius a quarter turn on: tangent, never across.
		near(turn(glyph.angle, bearing(glyph.x, glyph.y)), 0, 2 * DEGREE, `angle of ${glyph.index}`);
	}
});

test("on the closed circle text runs on past the seam and comes round from the start", () => {
	const length = measure(circle).total;
	const options = { offset: 0.95, align: "start" } as const;
	// Centres 10, 30, 50 and 70 on from 0.95 of the way round: the last two have gone past the seam.
	const placed = placeGlyphsOnPath(circle, [20, 20, 20, 20], options);
	assert.deepEqual(placed.map((glyph) => glyph.visible), [true, true, true, true]);
	assert.ok(placed[1]!.x < 0 && Math.hypot(placed[1]!.x, placed[1]!.y + 100) < 5, "just before the seam");
	assert.ok(placed[2]!.x > 0 && Math.hypot(placed[2]!.x, placed[2]!.y + 100) < 20, "just after it, near the start");
	near(bearing(placed[2]!.x, placed[2]!.y), (0.95 * length + 50 - length) / 100, 0.002, "bearing after the seam");
	assert.ok(placed[3]!.x > placed[2]!.x, "and on round from there");

	// Once round is no distance at all, whichever way.
	for (const offset of [1.95, -0.05]) {
		const again = placeGlyphsOnPath(circle, [20, 20, 20, 20], { ...options, offset });
		for (const [i, glyph] of again.entries()) {
			near(glyph.x, placed[i]!.x, 1e-6, "x");
			near(glyph.y, placed[i]!.y, 1e-6, "y");
			near(glyph.angle, placed[i]!.angle, 1e-9, "angle");
		}
	}

	// Without wrap the closed circle keeps its ends, like an open path.
	const kept = placeGlyphsOnPath(circle, [20, 20, 20, 20], { ...options, wrap: false });
	assert.deepEqual(kept.map((glyph) => glyph.visible), [true, true, false, false]);
});

test("a Z-closed figure walks its closing edge, wraps by default, and turns across the seam", () => {
	const square = path("M0 0 H100 V100 H0 Z");
	// Centres at 380 (on the closing edge, heading up), then 420 and 460: round again along the top.
	const placed = placeGlyphsOnPath(square, [40, 40, 40], { offset: 0.9, align: "start" });
	assert.deepEqual(placed.map((glyph) => glyph.visible), [true, true, true]);
	near(placed[0]!.x, 0);
	near(placed[0]!.y, 20);
	near(placed[0]!.angle, -Math.PI / 2);
	near(placed[1]!.x, 20);
	near(placed[1]!.y, 0);
	near(placed[2]!.x, 60);
	near(placed[2]!.angle, 0);

	// Centred on the seam's corner, a glyph spans the end of the closing edge and the start of the top.
	const seam = placeGlyphsOnPath(square, [40], { offset: 0.95, align: "start" })[0]!;
	near(seam.x, 0);
	near(seam.y, 0);
	near(seam.angle, -Math.PI / 4);
});

test("a glyph turns to the chord across its width; one with no width to the segment it is on", () => {
	const corner = path("M0 0 L100 0 L100 100");
	// Centred on the corner, 20 wide: its edges are at (90, 0) and (100, 10).
	const wide = placeGlyphsOnPath(corner, [90, 20], { offset: 0, align: "start" })[1]!;
	near(wide.x, 100);
	near(wide.y, 0);
	near(wide.angle, Math.PI / 4);
	// No width, on the corner: the direction of the segment that starts there.
	const thin = placeGlyphsOnPath(corner, [100, 0], { offset: 0, align: "start" })[1]!;
	near(thin.x, 100);
	near(thin.angle, Math.PI / 2);
});

test("sliding round a curve, a glyph turns a little at a time rather than facet by facet", () => {
	// The flattened circle turns 3.75° at each corner; the chord under a glyph never jumps like that.
	const length = measure(circle).total;
	let previous: number | null = null;
	for (let step = 0; step <= 300; step += 1) {
		const { angle } = placeGlyphsOnPath(circle, [20], { offset: (100 + step / 10) / length, align: "center" })[0]!;
		if (previous !== null) assert.ok(Math.abs(turn(angle, previous)) < 0.5 * DEGREE, `jumped at step ${step}`);
		previous = angle;
	}
});

test("a positive baseline shift moves glyphs to the left of travel: up off a line, out from a clockwise circle", () => {
	const lifted = placeGlyphsOnPath(path("M0 0 L100 0"), [10], { offset: 0, align: "start", baselineShift: 5 })[0]!;
	near(lifted.x, 5);
	near(lifted.y, -5);
	near(lifted.angle, 0);

	const rings = (figure: typeof circle, shift: number) =>
		placeGlyphsOnPath(figure, Array<number>(12).fill(20), { offset: 0, align: "start", baselineShift: shift });
	for (const glyph of rings(circle, 10)) near(Math.hypot(glyph.x, glyph.y), 110, 0.1, "outward");
	for (const glyph of rings(circle, -10)) near(Math.hypot(glyph.x, glyph.y), 90, 0.1, "inward");
	// Left of travel is inward when the circle runs the other way.
	for (const glyph of rings(anticlockwise, 10)) near(Math.hypot(glyph.x, glyph.y), 90, 0.1, "anticlockwise");
});

test("subpaths are one path in order, and a glyph never turns across the jump between them", () => {
	const two = path("M0 0 L100 0 M0 50 L100 50");
	const placed = placeGlyphsOnPath(two, [50, 50, 50, 50], { offset: 0, align: "start" });
	assert.deepEqual(placed.map((glyph) => [Math.round(glyph.x), Math.round(glyph.y)]), [[25, 0], [75, 0], [25, 50], [75, 50]]);
	assert.deepEqual(placed.map((glyph) => glyph.visible), [true, true, true, true]);

	// Centred 10 from the end of the first line and 60 wide, its far edge would be on the second.
	const straddling = placeGlyphsOnPath(two, [60, 60], { offset: 0, align: "start" })[1]!;
	near(straddling.x, 90);
	near(straddling.y, 0);
	near(straddling.angle, 0);
});

test("the point at a length: the same at 0 and L on a closed path, clamped on an open one", () => {
	const length = measure(circle).total;
	const start = pointAtLength(circle, 0, true)!;
	const end = pointAtLength(circle, length, true)!;
	near(start.x, 0);
	near(start.y, -100);
	near(end.x, start.x);
	near(end.y, start.y);
	near(end.angle, start.angle);
	// Unwrapped, L is the last point, which is the first one again.
	const last = pointAtLength(circle, length, false)!;
	near(last.x, start.x);
	near(last.y, start.y);

	const square = path("M0 0 H100 V100 H0 Z");
	const at = (s: number, wrap: boolean) => pointAtLength(square, s, wrap)!;
	assert.deepEqual(at(150, false), { x: 100, y: 50, angle: Math.PI / 2 });
	assert.deepEqual(at(350, false), { x: 0, y: 50, angle: -Math.PI / 2 }, "the closing edge is part of the length");
	assert.deepEqual(at(450, true), { x: 50, y: 0, angle: 0 });
	assert.deepEqual(at(-50, true), { x: 0, y: 50, angle: -Math.PI / 2 });
	assert.deepEqual(at(450, false), { x: 0, y: 0, angle: -Math.PI / 2 });

	// An open path stops at its ends even when asked to wrap.
	assert.deepEqual(pointAtLength(path("M0 0 L100 0"), 150, true), { x: 100, y: 0, angle: 0 });
});

test("nothing to follow: an empty or zero-length path hides every glyph at the origin", () => {
	const hidden = [
		{ index: 0, x: 0, y: 0, angle: 0, visible: false },
		{ index: 1, x: 0, y: 0, angle: 0, visible: false },
	];
	assert.deepEqual(placeGlyphsOnPath([], [10, 20], { offset: 0, align: "start" }), hidden);
	assert.deepEqual(placeGlyphsOnPath(path("M5 5 L5 5"), [10, 20], { offset: 0.5, align: "center" }), hidden);
	assert.deepEqual(placeGlyphsOnPath(path("M0 0 L100 0"), [], { offset: 0, align: "start" }), []);
	assert.equal(pointAtLength([], 10, true), null);
	assert.equal(pointAtLength(path("M5 5 L5 5"), 0, false), null);
});

test("placing is pure: the same answer twice, and the path left as it was", () => {
	const before = structuredClone(circle);
	const options = { offset: 0.3, align: "center", baselineShift: 4 } as const;
	assert.deepEqual(placeGlyphsOnPath(circle, [12, 7, 30], options), placeGlyphsOnPath(circle, [12, 7, 30], options));
	assert.deepEqual(circle, before);
});
