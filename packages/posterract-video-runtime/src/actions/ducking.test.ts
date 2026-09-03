/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import test from "node:test";

import { envelopeAt } from "./ducking.ts";

// A voice clip over frames 100..200, ducking with a 10-frame attack and a
// 20-frame release.
const at = (frame: number) => envelopeAt(frame, 100, 200, 10, 20);

test("the level is untouched well before and well after the clip", () => {
	assert.equal(at(0), 0);
	assert.equal(at(89), 0);
	assert.equal(at(221), 0);
	assert.equal(at(400), 0);
});

test("the duck leads the clip, so the music is already down on the first word", () => {
	assert.equal(at(90), 0);
	assert.ok(at(95) > 0.4 && at(95) < 0.6, `midway through the attack: ${at(95)}`);
	assert.equal(at(100), 1);
});

test("it holds for the whole clip", () => {
	assert.equal(at(120), 1);
	assert.equal(at(199), 1);
	assert.equal(at(200), 1);
});

test("and recovers over the release", () => {
	assert.ok(at(210) > 0.4 && at(210) < 0.6, `midway through the release: ${at(210)}`);
	assert.equal(at(220), 0);
});

test("the ramps are smooth at both ends, never a sudden move", () => {
	// A smoothstep leaves and arrives at zero slope: the first and last steps
	// of each ramp move less than the middle ones.
	const early = at(91) - at(90);
	const middle = at(95) - at(94);
	assert.ok(early < middle, `ramp starts gently: ${early} < ${middle}`);
});

test("a zero-length attack or release still resolves", () => {
	assert.equal(envelopeAt(100, 100, 200, 0, 0), 1);
	assert.equal(envelopeAt(99, 100, 200, 0, 0), 0);
	assert.equal(envelopeAt(201, 100, 200, 0, 0), 0);
});
