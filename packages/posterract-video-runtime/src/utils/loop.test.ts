import assert from 'node:assert/strict';
import test from 'node:test';

import { TrackLoop } from '../constants';
import { loopedFrame } from './loop';

test('a track that does not loop is sampled where it is asked', () => {
	for (const frame of [-5, 0, 10, 30, 31, 500]) assert.equal(loopedFrame(frame, 10, 30, TrackLoop.NONE), frame);
});

test('a repeat plays first → last again and again, and every cycle is the first one', () => {
	// Keyframes at 10 and 30: a cycle is 20 frames.
	const at = (frame: number) => loopedFrame(frame, 10, 30, TrackLoop.REPEAT);
	assert.equal(at(5), 5, 'before the first keyframe the value still holds');
	assert.equal(at(10), 10);
	assert.equal(at(30), 30, 'the first pass reaches the last keyframe');
	assert.equal(at(31), 11, 'and the next frame is one into the next cycle, not the seam again');
	assert.equal(at(50), 30, 'a boundary shows the last keyframe, as it did the first time');
	assert.equal(at(51), 11);
	assert.equal(at(10 + 20 * 7 + 3), 13);
});

test('a ping-pong comes back the way it went', () => {
	const at = (frame: number) => loopedFrame(frame, 0, 10, TrackLoop.PINGPONG);
	assert.deepEqual([0, 5, 10, 11, 15, 19, 20, 21, 30, 35, 40].map(at), [0, 5, 10, 9, 5, 1, 0, 1, 10, 5, 0]);
});

test('a track with one keyframe, or none of any length, has nothing to loop', () => {
	assert.equal(loopedFrame(99, 10, 10, TrackLoop.REPEAT), 99);
	assert.equal(loopedFrame(99, 10, 10, TrackLoop.PINGPONG), 99);
});
