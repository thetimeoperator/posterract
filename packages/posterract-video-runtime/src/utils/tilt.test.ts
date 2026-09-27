/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import test from "node:test";

import { applyHomography, invert3, isTilted, multiply3, screenTilt, tiltHomography } from "./tilt.ts";
import type { Mat3 } from "./tilt.ts";

const close = (actual: number, expected: number, message?: string) =>
	assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ""} expected ${expected}, got ${actual}`);

test("no tilt leaves every point where it is", () => {
	const h = tiltHomography({ rotationX: 0, rotationY: 0, perspective: 1000 });
	for (const [x, y] of [[0, 0], [120, -80], [-300, 45]] as const) {
		const p = applyHomography(h, x, y);
		close(p.x, x);
		close(p.y, y);
		close(p.w, 1);
	}
	assert.equal(isTilted({ rotationX: 0, rotationY: 0 }), false);
	assert.equal(isTilted({ rotationX: 0, rotationY: 12 }), true);
});

test("rotationX tips the top away: the top edge narrows, the bottom widens", () => {
	const h = tiltHomography({ rotationX: 40, rotationY: 0, perspective: 1000 });
	const topLeft = applyHomography(h, -100, -100);
	const bottomLeft = applyHomography(h, -100, 100);
	assert.ok(topLeft.w > 1, "the top is farther from the camera");
	assert.ok(bottomLeft.w < 1, "the bottom is nearer");
	assert.ok(Math.abs(topLeft.x) < 100, "the far edge is narrower");
	assert.ok(Math.abs(bottomLeft.x) > 100, "the near edge is wider");
	// The pivot stays put.
	const pivot = applyHomography(h, 0, 0);
	close(pivot.x, 0);
	close(pivot.y, 0);
});

test("rotationY turns the right side away", () => {
	const h = tiltHomography({ rotationX: 0, rotationY: 50, perspective: 800 });
	const right = applyHomography(h, 100, 0);
	const left = applyHomography(h, -100, 0);
	assert.ok(right.w > 1 && right.x < 100, "the right side recedes");
	assert.ok(left.w < 1 && -left.x > right.x, "the left side comes forward, larger than the right");
});

test("with no perspective a tilt only foreshortens", () => {
	const h = tiltHomography({ rotationX: 60, rotationY: 0, perspective: 0 });
	const p = applyHomography(h, 80, 100);
	close(p.x, 80, "x");
	close(p.y, 50, "y is cos 60 of itself");
	close(p.w, 1, "w");
});

test("a point swung behind the camera has a negative depth sign", () => {
	const h = tiltHomography({ rotationX: -80, rotationY: 0, perspective: 100 });
	// The top swings toward the camera by more than its distance.
	assert.ok(applyHomography(h, 0, -1000).w < 0);
	assert.ok(applyHomography(h, 0, 0).w > 0);
});

test("invert3 undoes a homography", () => {
	const h = tiltHomography({ rotationX: 25, rotationY: -35, perspective: 1200 });
	const inverse = invert3(h)!;
	const identity = multiply3(h, inverse);
	const expected: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
	identity.forEach((value, index) => close(value, expected[index]!, `entry ${index}`));
	assert.equal(invert3([1, 2, 3, 2, 4, 6, 0, 0, 1]), null, "a flattening matrix has no inverse");
});

test("a rotated card tips about its own axis, not the screen's", () => {
	// Turned 90° clockwise: the card's top faces screen right.
	const axes = [0, 1, -1, 0] as const;
	const pivot = { x: 500, y: 300 };
	const h = screenTilt({ rotationX: 45, rotationY: 0, perspective: 1000 }, axes, pivot)!;
	const cardTop = applyHomography(h, pivot.x + 100, pivot.y);
	const cardBottom = applyHomography(h, pivot.x - 100, pivot.y);
	assert.ok(cardTop.w > 1, "the card's top — screen right — goes away");
	assert.ok(cardTop.x - pivot.x < 100 && cardTop.x - pivot.x > 0);
	assert.ok(cardBottom.w < 1, "its bottom comes forward");
	const fixed = applyHomography(h, pivot.x, pivot.y);
	close(fixed.x, pivot.x);
	close(fixed.y, pivot.y);
});

test("a scaled card keeps the shape of its tilt", () => {
	const tilt = { rotationX: 30, rotationY: 20, perspective: 900 };
	const pivot = { x: 0, y: 0 };
	const one = screenTilt(tilt, [1, 0, 0, 1], pivot)!;
	const two = screenTilt(tilt, [2, 0, 0, 2], pivot)!;
	const small = applyHomography(one, 50, -70);
	const large = applyHomography(two, 100, -140);
	close(large.x, small.x * 2);
	close(large.y, small.y * 2);
	assert.equal(screenTilt(tilt, [0, 0, 0, 0], pivot), null, "a card scaled to nothing has no tilt");
});
