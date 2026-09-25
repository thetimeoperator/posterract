/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Where an element goes when its source says where it belongs rather than
 * where it is: `place="lower-third"`, not `y={1480}`.
 *
 * Pixel arithmetic is the part of authoring a video that an author who cannot
 * see the frame is worst at, and the part with the least to say: "centred",
 * "bottom right, 48 in" are complete thoughts, and turning them into `x` and
 * `y` needs the frame's size and the element's — which for a text is not
 * known until it has been laid out. So the thought is kept as it was written
 * and worked out here, per frame, from the sizes as they are.
 *
 * A placement names a point of the frame and the same point of the element,
 * and puts one on the other: "bottom-right" is the frame's bottom right corner
 * and the element's. `inset` moves the frame's point inwards from the edges it
 * touches, so it never applies to an axis the placement centres. The thirds
 * are the lines a third and two thirds of the way down, with the element
 * centred on them.
 */

export const PLACEMENTS = {
	'top-left': [0, 0],
	'top': [0.5, 0],
	'top-right': [1, 0],
	'left': [0, 0.5],
	'center': [0.5, 0.5],
	'right': [1, 0.5],
	'bottom-left': [0, 1],
	'bottom': [0.5, 1],
	'bottom-right': [1, 1],
	'upper-third': [0.5, 1 / 3],
	'lower-third': [0.5, 2 / 3],
} as const satisfies Record<string, readonly [number, number]>;

export type Placement = keyof typeof PLACEMENTS;

export const isPlacement = (value: unknown): value is Placement =>
	typeof value === 'string' && Object.hasOwn(PLACEMENTS, value);

/**
 * The point of the frame a placement names, in the frame's own space, with
 * the inset taken off the edges it touches.
 */
export function frameAnchor(
	fx: number,
	fy: number,
	frameWidth: number,
	frameHeight: number,
	insetX: number,
	insetY: number,
): { x: number; y: number } {
	const inward = (fraction: number, inset: number): number => (fraction === 0 ? inset : fraction === 1 ? -inset : 0);
	return { x: fx * frameWidth + inward(fx, insetX), y: fy * frameHeight + inward(fy, insetY) };
}

/**
 * Which point of the element goes on the frame's: the same one for an edge or
 * a corner, its centre for the thirds (they are lines to sit on, not edges).
 */
export const elementAnchor = (fraction: number): number => (fraction === 0 || fraction === 1 ? fraction : 0.5);

/**
 * The `x`/`y` — the top-left of the element's box, in its parent's space —
 * that puts the element's anchor on `target` (a point in that same space).
 *
 * The box is `width`×`height` from `origin`, and the element scales about the
 * box's centre, so what is seen is a box `scale` times the size around the
 * same centre. It is the seen box that is placed: an element at `scale={1.5}`
 * placed at the bottom with an inset of 48 shows 48 px of frame under it, not
 * 48 minus a quarter of its height.
 */
export function placedPosition(options: {
	target: { x: number; y: number };
	ax: number;
	ay: number;
	width: number;
	height: number;
	originX?: number;
	originY?: number;
	scaleX?: number;
	scaleY?: number;
}): { x: number; y: number } {
	const { target, ax, ay, width, height } = options;
	const seenWidth = width * Math.abs(options.scaleX ?? 1);
	const seenHeight = height * Math.abs(options.scaleY ?? 1);
	// The centre of the box, from where its anchor has to be.
	const centerX = target.x - (ax - 0.5) * seenWidth;
	const centerY = target.y - (ay - 0.5) * seenHeight;
	return {
		x: centerX - width / 2 - (options.originX ?? 0),
		y: centerY - height / 2 - (options.originY ?? 0),
	};
}
