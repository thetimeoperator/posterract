import assert from 'node:assert/strict';
import test from 'node:test';

import { PLACEMENTS, elementAnchor, frameAnchor, isPlacement, placedPosition } from './placement';

/** A placement worked out the way the transform system does, for a child of the frame itself. */
function place(name: keyof typeof PLACEMENTS, size: [number, number], inset: [number, number] = [0, 0], scale = 1) {
	const [fx, fy] = PLACEMENTS[name];
	const target = frameAnchor(fx, fy, 1080, 1920, inset[0], inset[1]);
	return placedPosition({ target, ax: elementAnchor(fx), ay: elementAnchor(fy), width: size[0], height: size[1], scaleX: scale, scaleY: scale });
}

test('a placement is the same pixels an author would have worked out by hand', () => {
	// A 600×100 caption in a 1080×1920 frame.
	assert.deepEqual(place('center', [600, 100]), { x: 240, y: 910 });
	assert.deepEqual(place('top-left', [600, 100], [48, 48]), { x: 48, y: 48 });
	assert.deepEqual(place('bottom-right', [600, 100], [48, 32]), { x: 1080 - 600 - 48, y: 1920 - 100 - 32 });
	assert.deepEqual(place('bottom', [600, 100], [48, 48]), { x: 240, y: 1920 - 100 - 48 });
	assert.deepEqual(place('left', [600, 100], [48, 48]), { x: 48, y: 910 });
});

test('the thirds are lines the element is centred on, and an inset does not move them', () => {
	assert.deepEqual(place('lower-third', [600, 100]), { x: 240, y: 1280 - 50 });
	assert.deepEqual(place('upper-third', [600, 100], [48, 48]), { x: 240, y: 640 - 50 });
});

test('what is placed is the box as it is seen: a scaled element keeps its inset', () => {
	// At scale 2 about its centre a 200×100 box is seen as 400×200.
	const { x, y } = place('bottom-right', [200, 100], [48, 48], 2);
	// Its seen right edge is x + 100 (centre) + 200, and that has to be 48 from the frame's.
	assert.equal(x + 100 + 200, 1080 - 48);
	assert.equal(y + 50 + 100, 1920 - 48);
});

test('a box that does not start at its own origin (a group, a path) is placed by where it is drawn', () => {
	const [fx, fy] = PLACEMENTS['top-left'];
	const position = placedPosition({ target: frameAnchor(fx, fy, 1080, 1920, 10, 10), ax: 0, ay: 0, width: 100, height: 100, originX: -30, originY: 20 });
	// Drawn from x + originX: that is what has to land on 10.
	assert.deepEqual({ x: position.x + -30, y: position.y + 20 }, { x: 10, y: 10 });
});

test('only the names the vocabulary documents are placements', () => {
	assert.equal(isPlacement('lower-third'), true);
	assert.equal(isPlacement('middle'), false);
	assert.equal(isPlacement(undefined), false);
});
