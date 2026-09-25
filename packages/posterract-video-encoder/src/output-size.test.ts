import assert from 'node:assert/strict';
import test from 'node:test';

import { outputSize } from './output-size';

test('a landscape scene is sized exactly as it always was: the resolution is its height', () => {
	assert.deepEqual(outputSize(1920, 1080, 1080), { scale: 1, width: 1920, height: 1080 });
	assert.deepEqual(outputSize(1920, 1080, 720), { scale: 0.666667, width: 1280, height: 720 });
	assert.deepEqual(outputSize(3840, 2160, 1080), { scale: 0.5, width: 1920, height: 1080 });
});

test('a vertical scene at 1080p is 1080 wide, not 1080 tall', () => {
	assert.deepEqual(outputSize(1080, 1920, 1080), { scale: 1, width: 1080, height: 1920 });
	assert.deepEqual(outputSize(1080, 1920, 720), { scale: 0.666667, width: 720, height: 1280 });
	assert.deepEqual(outputSize(1080, 1920, 1440), { scale: 1.333333, width: 1440, height: 2560 });
});

test('a square is its resolution on both sides, and every size is even', () => {
	assert.deepEqual(outputSize(1080, 1080, 1080), { scale: 1, width: 1080, height: 1080 });
	const odd = outputSize(1080, 1350, 721);
	assert.equal(odd.width % 2, 0);
	assert.equal(odd.height % 2, 0);
});
