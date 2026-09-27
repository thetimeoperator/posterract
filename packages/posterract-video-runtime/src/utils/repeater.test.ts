/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import test from "node:test";

import {
	REPEATER_DEFAULTS, REPEATER_LAYOUTS, computeInstances, layoutPoints, staggerRanks,
} from "./repeater.ts";
import type { RepeaterInput, RepeaterInstance } from "./repeater.ts";

type Point = [number, number, number];

/** The defaults with a few settings changed. */
const settings = (changes: Partial<RepeaterInput>): RepeaterInput => ({ ...REPEATER_DEFAULTS, ...changes });

/** A layout's points as [x, y, z] triples. */
function points(changes: Partial<RepeaterInput>): Point[] {
	const flat = layoutPoints(changes.layout ?? REPEATER_DEFAULTS.layout, settings(changes));
	const out: Point[] = [];
	for (let i = 0; i < flat.length; i += 3) out.push([flat[i]!, flat[i + 1]!, flat[i + 2]!]);
	return out;
}

/** Copies back in index order, to compare them one for one. */
const byIndex = (copies: RepeaterInstance[]): RepeaterInstance[] => [...copies].sort((a, b) => a.index - b.index);

/** Float dust rounded away, and -0 made 0, so positions compare exactly. */
const tidy = (value: number): number => Math.round(value * 1e6) / 1e6 + 0;

const near = (a: number, b: number, tolerance = 1e-9): boolean => Math.abs(a - b) <= tolerance;

/** Two lists of points that agree to within float dust. */
function assertClose(actual: number[][], expected: number[][], tolerance = 1e-9): void {
	assert.equal(actual.length, expected.length);
	actual.forEach((point, i) => point.forEach((value, axis) => {
		const want = expected[i]![axis]!;
		assert.ok(near(value, want, tolerance), `copy ${i}, axis ${axis}: ${value} is not ${want}`);
	}));
}

const upTo = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

test("a circle starts at 12 o'clock and goes round clockwise on screen", () => {
	const ring = points({ layout: "circle", count: 4, radius: 100 });
	assert.deepEqual(ring.map((p) => p.map(tidy)), [[0, -100, 0], [100, 0, 0], [0, 100, 0], [-100, 0, 0]]);
});

test("a line and a grid are `spacing` apart and centred", () => {
	assert.deepEqual(points({ layout: "line", count: 3, spacing: 50 }).map((p) => p.map(tidy)), [[-50, 0, 0], [0, 0, 0], [50, 0, 0]]);
	assert.deepEqual(points({ layout: "grid", count: 9, spacing: 10 }).map((p) => p.map(tidy)), [
		[-10, -10, 0], [0, -10, 0], [10, -10, 0],
		[-10, 0, 0], [0, 0, 0], [10, 0, 0],
		[-10, 10, 0], [0, 10, 0], [10, 10, 0],
	]);
	// Columns as authored; more columns than copies is one centred row.
	assert.deepEqual(points({ layout: "grid", count: 6, columns: 3, spacing: 10 }).map(([, y]) => tidy(y)), [-5, -5, -5, 5, 5, 5]);
	assert.deepEqual(points({ layout: "grid", count: 3, columns: 10, spacing: 10 }).map(([x]) => tidy(x)), [-10, 0, 10]);
});

test("a plane is the grid laid flat, its rows running away from the viewer", () => {
	assert.deepEqual(points({ layout: "plane", count: 9, spacing: 10 }).map((p) => p.map(tidy)), [
		[-10, 0, -10], [0, 0, -10], [10, 0, -10],
		[-10, 0, 0], [0, 0, 0], [10, 0, 0],
		[-10, 0, 10], [0, 0, 10], [10, 0, 10],
	]);
});

test("a sunflower's copies sit spacing × √i out, a golden angle apart", () => {
	const flower = points({ layout: "sunflower", count: 50, spacing: 7 });
	flower.forEach(([x, y, z], i) => {
		assert.ok(near(Math.hypot(x, y), 7 * Math.sqrt(i)), `copy ${i}`);
		assert.equal(z, 0);
	});
	const angle = ([x, y]: Point): number => Math.atan2(x, -y);
	const golden = (137.50776 * Math.PI) / 180;
	for (let i = 1; i < flower.length - 1; i += 1) {
		const turn = (angle(flower[i + 1]!) - angle(flower[i]!) + 4 * Math.PI) % (2 * Math.PI);
		assert.ok(near(turn, golden, 1e-6), `copy ${i} turns ${turn}`);
	}
});

test("a spiral runs from the centre to its radius, its copies evenly spaced along the curve", () => {
	const spacing = 20;
	const radius = 200;
	const spiral = points({ layout: "spiral", count: 60, radius, spacing });
	assert.deepEqual(spiral[0]!.map(tidy), [0, 0, 0]);
	assert.ok(near(Math.hypot(...spiral.at(-1)!), radius));

	// r = a·θ with its turns `spacing` apart.
	const a = spacing / (2 * Math.PI);
	for (const [x, y] of spiral.slice(1)) {
		const angle = Math.hypot(x, y) / a;
		assert.ok(near(x, a * angle * Math.sin(angle), 1e-6) && near(y, -a * angle * Math.cos(angle), 1e-6), "on the curve");
	}
	const lengthTo = (r: number): number => {
		const angle = r / a;
		return (a / 2) * (angle * Math.sqrt(1 + angle * angle) + Math.asinh(angle));
	};
	const lengths = spiral.map(([x, y]) => lengthTo(Math.hypot(x, y)));
	const step = lengths.at(-1)! / (spiral.length - 1);
	lengths.forEach((length, i) => assert.ok(near(length, i * step, 1e-6), `copy ${i} is ${length - i * step} off`));
});

test("a sphere's points all sit on its surface, from top to bottom", () => {
	const sphere = points({ layout: "sphere", count: 200, radius: 150 });
	for (const point of sphere) assert.ok(near(Math.hypot(...point), 150));
	assert.ok(sphere[0]![1] < -140 && sphere.at(-1)![1] > 140);
	assert.ok(near(sphere.reduce((sum, [, y]) => sum + y, 0), 0, 1e-6), "balanced top to bottom");
});

test("a torus's points all satisfy its equation, the ring lying in x–z", () => {
	const ring = 120;
	const tube = 40;
	const torus = points({ layout: "torus", count: 300, radius: ring, tube });
	for (const [x, y, z] of torus) assert.ok(near((Math.hypot(x, z) - ring) ** 2 + y * y, tube * tube, 1e-6));
	assert.equal(new Set(torus.map((p) => p.map(tidy).join())).size, torus.length, "no two copies in one spot");
});

test("a cube is dots along its twelve edges, each corner exactly once", () => {
	const half = 100;
	const onFace = (value: number): boolean => near(Math.abs(value), half);
	for (const count of [8, 20, 50, 413]) {
		const cube = points({ layout: "cube", count, radius: half });
		for (const point of cube) {
			assert.ok(point.filter(onFace).length >= 2, `${point} is on an edge`);
			assert.ok(point.every((value) => Math.abs(value) <= half + 1e-9));
		}
		const corners = cube.filter((point) => point.every(onFace));
		assert.equal(corners.length, 8, `${count} copies`);
		assert.equal(new Set(corners.map((point) => point.map(Math.sign).join())).size, 8);
		assert.equal(new Set(cube.map((point) => point.map(tidy).join())).size, count, "no two copies in one spot");
	}
	// Twenty is the corners and one copy at the middle of each edge.
	const middles = points({ layout: "cube", count: 20, radius: half }).filter((point) => !point.every(onFace));
	assert.equal(middles.length, 12);
	for (const point of middles) assert.equal(point.filter((value) => near(value, 0)).length, 1);
});

test("a random layout repeats for a seed, differs for another, and stays inside its ball", () => {
	const cloud = (seed: number, count = 100): number[] =>
		Array.from(layoutPoints("random", settings({ count, seed, radius: 100 })));
	// Worked out afresh at another count: the same seed, the same copies.
	assert.deepEqual(cloud(7, 40), cloud(7).slice(0, 120));
	assert.notDeepEqual(cloud(7), cloud(8));

	const scattered = points({ layout: "random", count: 500, seed: 7, radius: 100 });
	assert.ok(scattered.every((point) => Math.hypot(...point) <= 100 + 1e-9));
	assert.ok(scattered.some((point) => Math.hypot(...point) < 50), "through the ball, not just on its skin");
});

test("a morph blends copy for copy: 0 and 1 are the two layouts, 0.5 halfway", () => {
	const base = { count: 9, radius: 100, spacing: 50, layout: "circle", layoutTo: "grid" } as const;
	const at = (morph: number): number[][] =>
		byIndex(computeInstances(settings({ ...base, morph }))).map((copy) => [copy.x, copy.y]);
	const circle = points({ ...base, layout: "circle" });
	const grid = points({ ...base, layout: "grid" });
	assertClose(at(0), circle.map(([x, y]) => [x, y]));
	assertClose(at(1), grid.map(([x, y]) => [x, y]));
	assertClose(at(0.5), circle.map(([x, y], i) => [(x + grid[i]![0]) / 2, (y + grid[i]![1]) / 2]));
	// Past 1 is 1, and without a layoutTo there is nothing to morph toward.
	assertClose(at(1.5), at(1));
	assertClose(byIndex(computeInstances(settings({ ...base, layoutTo: null, morph: 0.7 }))).map((c) => [c.x, c.y]), at(0));

	// In depth too: halfway from a floor to a ball.
	const plane = points({ count: 16, spacing: 30, layout: "plane" });
	const sphere = points({ count: 16, radius: 90, layout: "sphere" });
	const halfway = byIndex(computeInstances(settings({ count: 16, spacing: 30, radius: 90, layout: "plane", layoutTo: "sphere", morph: 0.5 })));
	assertClose(halfway.map((c) => [c.x, c.y, c.depth]), plane.map((p, i) => p.map((value, axis) => (value + sphere[i]![axis]!) / 2)));
});

test("tipped 90° a grid is seen edge-on; a plane starts edge-on and tipped 90° is the grid", () => {
	const grid = points({ layout: "grid", count: 9, spacing: 10 });
	const tipped = byIndex(computeInstances(settings({ layout: "grid", count: 9, spacing: 10, tiltX: 90 })));
	assertClose(tipped.map((c) => [c.x, c.y]), grid.map(([x]) => [x, 0]));
	assert.ok(tipped[0]!.depth > 0 && tipped[8]!.depth < 0, "the top row went away, the bottom row came nearer");

	const plane = byIndex(computeInstances(settings({ layout: "plane", count: 9, spacing: 10 })));
	assertClose(plane.map((c) => [c.x, c.y]), grid.map(([x]) => [x, 0]));
	const raised = byIndex(computeInstances(settings({ layout: "plane", count: 9, spacing: 10, tiltX: 90 })));
	assertClose(raised.map((c) => [c.x, c.y, c.depth]), grid);
});

test("roll turns clockwise on screen, and tiltY swings the right side away", () => {
	const rolled = byIndex(computeInstances(settings({ layout: "circle", count: 4, radius: 100, roll: 90 })));
	assertClose(rolled.map((c) => [c.x, c.y]), [[100, 0], [0, 100], [-100, 0], [0, -100]]);
	const turned = byIndex(computeInstances(settings({ layout: "line", count: 3, spacing: 100, tiltY: 90 })));
	assertClose(turned.map((c) => [c.x, c.depth]), [[0, -100], [0, 0], [0, 100]]);
});

test("under perspective nearer copies are larger, and the farthest are drawn first", () => {
	// A line turned to run straight away from the viewer: its right end is farthest.
	const row = computeInstances(settings({ layout: "line", count: 3, spacing: 100, tiltY: 90, perspective: 1000 }));
	assert.deepEqual(row.map((c) => c.index), [2, 1, 0]);
	assert.deepEqual(row.map((c) => tidy(c.depth)), [1100, 1000, 900]);
	assert.ok(row[0]!.scale < row[1]!.scale && row[1]!.scale < row[2]!.scale);
	assert.equal(tidy(row[1]!.scale), 1, "at the focal distance a copy is its own size");

	// A grid leaning back into a floor: its far row is narrower, smaller, and drawn first.
	const floor = computeInstances(settings({ layout: "grid", count: 9, spacing: 100, tiltX: 60, perspective: 800 }));
	assert.deepEqual(floor.map((c) => c.index), upTo(9));
	const [far, , , , , , nearRow] = byIndex(floor);
	assert.ok(Math.abs(far!.x) < Math.abs(nearRow!.x) && far!.scale < nearRow!.scale);

	// Zoom scales where copies are and how large, together.
	const zoomed = computeInstances(settings({ layout: "grid", count: 9, spacing: 100, tiltX: 60, perspective: 800, zoom: 2 }));
	zoomed.forEach((copy, i) => {
		assert.ok(near(copy.x, 2 * floor[i]!.x) && near(copy.y, 2 * floor[i]!.y) && near(copy.scale, 2 * floor[i]!.scale));
	});
});

test("dollying the camera past a copy hides it", () => {
	const single = (cameraZ: number): RepeaterInstance =>
		computeInstances(settings({ layout: "line", count: 1, perspective: 1000, cameraZ }))[0]!;
	assert.equal(single(0).visible, true);
	assert.equal(tidy(single(0).scale), 1);
	assert.equal(tidy(single(500).scale), 2, "halfway there, it looks twice the size");
	for (const cameraZ of [999.5, 1000, 1500]) {
		const copy = single(cameraZ);
		assert.equal(copy.visible, false, `camera at ${cameraZ}`);
		assert.equal(copy.scale, 0);
		assert.ok([copy.x, copy.y, copy.depth].every(Number.isFinite));
	}
	// Flying down a line of copies: those behind the camera drop out, the rest are still drawn.
	const corridor = computeInstances(settings({ layout: "line", count: 3, spacing: 100, tiltY: 90, perspective: 1000, cameraZ: 1050 }));
	assert.deepEqual(corridor.filter((c) => c.visible).map((c) => c.index), [2]);
});

test("a ripple's phase carries the wave outward", () => {
	const line = (ripplePhase: number): RepeaterInstance[] =>
		computeInstances(settings({ layout: "line", count: 21, spacing: 50, ripple: 10, rippleFrequency: 1, ripplePhase }));
	const crest = (copies: RepeaterInstance[]): number =>
		Math.abs(copies.reduce((best, copy) => (copy.wave > best.wave ? copy : best)).x);
	// One cycle per 1000 px: the crest is 250 px out, and a quarter turn later 500.
	assert.equal(crest(line(0)), 250);
	assert.equal(crest(line(Math.PI / 2)), 500);
	for (const copy of line(0)) {
		assert.ok(near(copy.wave, Math.sin((2 * Math.PI * Math.abs(copy.x)) / 1000)));
		assert.ok(near(copy.depth, 10 * copy.wave), "pushed along z by the wave");
		assert.equal(tidy(copy.y), 0, "which straight on does not move it on screen");
	}
});

test("a scale ripple grows and shrinks copies, never below nothing", () => {
	// Copies out to 1000 px: a whole cycle of the wave, troughs included.
	const line = (ripple: number): RepeaterInstance[] =>
		computeInstances(settings({ layout: "line", count: 21, spacing: 100, ripple, rippleFrequency: 1, rippleMode: "scale" }));
	for (const copy of line(0.5)) {
		assert.ok(near(copy.scale, 1 + 0.5 * copy.wave));
		assert.equal(tidy(copy.depth), 0, "a scale ripple moves nothing");
	}
	const deep = line(3);
	assert.ok(deep.every((copy) => copy.scale >= 0));
	assert.ok(deep.some((copy) => copy.scale === 0));
});

test("a ripple on a plane is measured across the floor and bobs it up and down", () => {
	const floor = { layout: "plane", count: 9, spacing: 100, ripple: 10, rippleFrequency: 1 } as const;
	const plane = points(floor);
	byIndex(computeInstances(settings(floor))).forEach((copy, i) => {
		const [x, , z] = plane[i]!;
		assert.ok(near(copy.wave, Math.sin((2 * Math.PI * Math.hypot(x, z)) / 1000)));
		assert.ok(near(copy.y, 10 * copy.wave), "it bobs");
		assert.ok(near(copy.depth, z), "and stays where it was across the floor");
	});
	// The centre is a point on the floor, (x, z): the back right copy here, at the crest.
	const shifted = byIndex(computeInstances(settings({ ...floor, rippleCenterX: 100, rippleCenterY: 100, ripplePhase: -Math.PI / 2 })));
	assert.equal(shifted[8]!.wave, 1);
});

test("copies at the same depth keep their order", () => {
	assert.deepEqual(computeInstances(settings({ layout: "grid", count: 25 })).map((c) => c.index), upTo(25));
	// A line tipped about its own axis stays at one depth.
	assert.deepEqual(computeInstances(settings({ layout: "line", count: 10, tiltX: 50, perspective: 900 })).map((c) => c.index), upTo(10));
	// Rows at different depths are ordered back to front; within a row, by index.
	assert.deepEqual(computeInstances(settings({ layout: "grid", count: 9, tiltX: -30 })).map((c) => c.index), [6, 7, 8, 3, 4, 5, 0, 1, 2]);
});

test("stagger ranks by index, in reverse, from the centre and from the edges", () => {
	const five = settings({ count: 5 });
	assert.deepEqual([...staggerRanks(five, "index")], [0, 1, 2, 3, 4]);
	assert.deepEqual([...staggerRanks(five, "reverse")], [4, 3, 2, 1, 0]);
	assert.deepEqual([...staggerRanks(five, "center")], [2, 1, 0, 1, 2]);
	assert.deepEqual([...staggerRanks(five, "edges")], [0, 1, 2, 1, 0]);
	// With no middle copy the middle two start together, and at once.
	assert.deepEqual([...staggerRanks(settings({ count: 4 }), "center")], [1, 0, 0, 1]);
	assert.deepEqual([...staggerRanks(settings({ count: 4 }), "edges")], [0, 1, 1, 0]);
	assert.deepEqual([...staggerRanks(settings({ count: 3 }), "sideways" as never)], [0, 1, 2]);
});

test("a random stagger is a shuffle that its seed repeats", () => {
	const shuffle = (seed: number): number[] => [...staggerRanks(settings({ count: 50, seed }), "random")];
	assert.deepEqual([...shuffle(3)].sort((a, b) => a - b), upTo(50));
	assert.deepEqual(shuffle(3), shuffle(3));
	assert.notDeepEqual(shuffle(3), shuffle(4));
	assert.notDeepEqual(shuffle(3), upTo(50));
});

test("a radial stagger spreads from the centre at an even speed", () => {
	const grid = [...staggerRanks(settings({ layout: "grid", count: 9, spacing: 40 }), "radial")];
	const side = 8 / Math.SQRT2;
	assertClose([grid], [[8, side, 8, side, 0, side, 8, side, 8]]);

	// Rank in proportion to distance: a sunflower's is √(i / (n − 1)) of the way.
	staggerRanks(settings({ layout: "sunflower", count: 30 }), "radial").forEach((rank, i) => {
		assert.ok(near(rank, Math.sqrt(i / 29) * 29));
	});
	// A ring is all at one distance, so it starts all at once.
	assert.deepEqual([...staggerRanks(settings({ layout: "circle", count: 6 }), "radial")], [0, 0, 0, 0, 0, 0]);
	// Measured on the layout, not a morph's in-between.
	assert.deepEqual(
		staggerRanks(settings({ layout: "grid", count: 9, spacing: 40, layoutTo: "circle", morph: 0.5 }), "radial"),
		staggerRanks(settings({ layout: "grid", count: 9, spacing: 40 }), "radial"),
	);
});

test("a count is a whole number from 0 to 5000", () => {
	assert.deepEqual(computeInstances(settings({ count: 0 })), []);
	assert.equal(computeInstances(settings({ count: -3 })).length, 0);
	assert.equal(computeInstances(settings({ count: 12.7 })).length, 12);
	assert.equal(computeInstances(settings({ count: 11.9999999 })).length, 12, "keyframe dust is not a missing copy");
	assert.equal(computeInstances(settings({ count: 1e9, layout: "line" })).length, 5000);
	assert.equal(layoutPoints("grid", settings({ count: 0 })).length, 0);
	assert.equal(staggerRanks(settings({ count: 0 }), "radial").length, 0);
});

test("nothing comes out NaN, however broken the input", () => {
	const finite = (copies: RepeaterInstance[]): boolean =>
		copies.every((c) => [c.x, c.y, c.depth, c.scale, c.wave].every(Number.isFinite));

	for (const layout of REPEATER_LAYOUTS) {
		for (const layoutTo of [null, ...REPEATER_LAYOUTS]) {
			for (const rippleMode of ["z", "scale"] as const) {
				const copies = computeInstances(settings({
					layout, layoutTo, morph: 0.37, count: 60, ripple: 25, rippleMode, tiltX: 35, tiltY: -20, roll: 10,
					perspective: 600, cameraZ: 650, zoom: 1.5,
				}));
				assert.equal(copies.length, 60);
				assert.ok(finite(copies), `${layout} → ${layoutTo}, ${rippleMode}`);
			}
		}
	}

	const broken = {
		...REPEATER_DEFAULTS, layout: "hexagon", layoutTo: "", count: "20", morph: NaN, spacing: Infinity, radius: NaN,
		tube: -Infinity, seed: NaN, ripple: 1e308, rippleFrequency: NaN, ripplePhase: Infinity, rippleMode: "wobble",
		tiltX: NaN, tiltY: Infinity, roll: -Infinity, zoom: NaN, perspective: 1e308, cameraZ: NaN,
	} as unknown as RepeaterInput;
	const copies = computeInstances(broken);
	assert.equal(copies.length, 12, "a count that is not a number is the default");
	assert.ok(finite(copies));
	assert.ok(staggerRanks(broken, "radial").every(Number.isFinite));

	// An unknown layout is the default one, and an empty layoutTo is none.
	assert.deepEqual(computeInstances(settings({ layout: "hexagon" as never, layoutTo: "" as never, morph: 1 })), computeInstances(REPEATER_DEFAULTS));
});

test("layoutPoints hands out a copy, so changing it changes nothing else", () => {
	const ring = settings({ layout: "circle", count: 4, radius: 100 });
	layoutPoints("circle", ring).fill(999);
	assert.equal(tidy(layoutPoints("circle", ring)[1]!), -100);
	assert.equal(tidy(byIndex(computeInstances(ring))[0]!.y), -100);
});
