/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import test from "node:test";

import {
	boundsOf, compatible, flattenPath, measure, morphPath, parsePath, parsePoints, toPathData, trimPath,
} from "./vector.ts";

test("path data parses into absolute commands", () => {
	assert.deepEqual(parsePath("M0 0 L10 0").map((c) => c.type), ["M", "L"]);
	assert.deepEqual(parsePath("M10 10 l5 0").at(-1)!.values, [15, 10]);
	assert.deepEqual(parsePath("M0 0 H10 V10").map((c) => c.values), [[0, 0], [10, 0], [10, 10]]);
});

test("an implicit repeat after a moveto is a lineto", () => {
	assert.deepEqual(parsePath("M0 0 5 5").map((c) => c.type), ["M", "L"]);
});

test("smooth curves mirror the previous control point", () => {
	assert.deepEqual(parsePath("M0 0 C1 1 2 2 3 3 S5 5 6 6").at(-1)!.values, [4, 4, 5, 5, 6, 6]);
});

test("a close returns the pen to the subpath's start", () => {
	assert.deepEqual(parsePath("M2 2 L8 2 Z L9 9").at(-1)!.values, [9, 9]);
});

test("length counts the closing edge", () => {
	assert.equal(Math.round(measure(flattenPath(parsePath("M0 0 L100 0"))).total), 100);
	assert.equal(Math.round(measure(flattenPath(parsePath("M0 0 H10 V10 H0 Z"))).total), 40);
});

test("arcs flatten to their true circumference", () => {
	const circle = flattenPath(parsePath("M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50"));
	assert.ok(Math.abs(measure(circle).total - 2 * Math.PI * 50) < 1.5);
});

test("trim takes the fraction it is asked for", () => {
	const line = flattenPath(parsePath("M0 0 L100 0"));
	assert.deepEqual(trimPath(line, 0, 0.5)[0]!.points.map(Math.round), [0, 0, 50, 0]);
	assert.deepEqual(trimPath(line, 0.25, 0.75)[0]!.points.map(Math.round), [25, 0, 75, 0]);
	assert.equal(trimPath(line, 0.5, 0.5).length, 0);
	assert.equal(Math.round(measure(trimPath(line, 0, 1)).total), 100);
});

test("a trim window that runs past the end wraps to the beginning", () => {
	const line = flattenPath(parsePath("M0 0 L100 0"));
	assert.equal(Math.round(measure(trimPath(line, 0, 0.5, 0.75)).total), 50);
});

test("trim treats every subpath as one figure", () => {
	const two = flattenPath(parsePath("M0 0 L100 0 M0 10 L100 10"));
	assert.equal(Math.round(measure(trimPath(two, 0, 0.5)).total), 100);
});

test("compatible paths blend command for command", () => {
	const a = parsePath("M0 0 L10 0");
	const b = parsePath("M0 0 L20 10");
	assert.ok(compatible(a, b));
	assert.deepEqual(morphPath(a, b, 0.5).at(-1)!.values, [15, 5]);
	assert.deepEqual(morphPath(a, b, 0).at(-1)!.values, [10, 0]);
	assert.deepEqual(morphPath(a, b, 1).at(-1)!.values, [20, 10]);
});

test("paths that disagree swap rather than fold through each other", () => {
	const a = parsePath("M0 0 L10 0");
	const c = parsePath("M0 0 L10 0 L20 20");
	assert.equal(compatible(a, c), false);
	assert.deepEqual(morphPath(a, c, 0.4), a);
	assert.deepEqual(morphPath(a, c, 0.6), c);
});

test("bounds, points and serialisation", () => {
	assert.deepEqual(boundsOf(flattenPath(parsePath("M10 20 L30 60"))), { x: 10, y: 20, width: 20, height: 40 });
	assert.deepEqual(parsePoints("0,0 10,0 10,10"), [0, 0, 10, 0, 10, 10]);
	assert.deepEqual(parsePoints("0,0 10"), [0, 0]);
	assert.equal(toPathData(parsePath("M0 0 L10 0")), "M0 0L10 0");
});
