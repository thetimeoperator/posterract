/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The geometry of a 3D tilt: a flat picture turned about a point of its own
 * and seen through a camera straight in front of that point, the way CSS
 * draws `perspective(p) rotateY(y) rotateX(x)`.
 *
 * `rotationX` tips the top away, `rotationY` turns the right side away, both
 * in degrees, X first. `perspective` is how far the camera is, in the
 * picture's own pixels; 0 looks from infinitely far, so the picture
 * foreshortens without getting smaller in the distance.
 *
 * A tilted plane seen through a pinhole is a homography of the flat one: a
 * 3×3 matrix applied to (x, y, 1) and divided by its third coordinate. Every
 * matrix here is row-major.
 */

export type TiltAngles = {
	rotationX: number;
	rotationY: number;
	perspective: number;
};

/** A 3×3 matrix, row-major. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/**
 * The tilt about the pivot in the picture's own units: takes a point of the
 * flat picture, relative to the pivot, to where it lands.
 *
 * The axes are x right, y down, z away from the camera. The plane's x axis
 * turns to `u = Ry·Rx·x̂` and its y axis to `v = Ry·Rx·ŷ`; a point `(x, y)` goes
 * to `P = x·u + y·v`, which a camera `f` in front of the pivot sees at
 * `P.xy · f / (f + P.z)`.
 */
export function tiltHomography(tilt: TiltAngles): Mat3 {
	const ax = (tilt.rotationX * Math.PI) / 180;
	const ay = (tilt.rotationY * Math.PI) / 180;
	const cx = Math.cos(ax);
	const sx = Math.sin(ax);
	const cy = Math.cos(ay);
	const sy = Math.sin(ay);
	// Rx = [1 0 0; 0 cx sx; 0 −sx cx] tips +y (down) toward the camera, so the
	// top goes away; Ry = [cy 0 −sy; 0 1 0; sy 0 cy] sends +x (right) away.
	const ux = cy;
	const uy = 0;
	const uz = sy;
	const vx = sy * sx;
	const vy = cx;
	const vz = -cy * sx;
	const k = tilt.perspective > 0 ? 1 / tilt.perspective : 0;
	return [
		ux, vx, 0,
		uy, vy, 0,
		k * uz, k * vz, 1,
	];
}

export function multiply3(a: Mat3, b: Mat3): Mat3 {
	const out = new Array(9).fill(0) as Mat3;
	for (let row = 0; row < 3; row++) {
		for (let column = 0; column < 3; column++) {
			out[row * 3 + column] =
				a[row * 3]! * b[column]! + a[row * 3 + 1]! * b[3 + column]! + a[row * 3 + 2]! * b[6 + column]!;
		}
	}
	return out;
}

/** The inverse, or null for a matrix that flattens the plane to a line. */
export function invert3(m: Mat3): Mat3 | null {
	const [a, b, c, d, e, f, g, h, i] = m;
	const A = e * i - f * h;
	const B = -(d * i - f * g);
	const C = d * h - e * g;
	const det = a * A + b * B + c * C;
	if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
	const k = 1 / det;
	return [
		A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
		B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
		C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
	];
}

/** Applies a homography to a point: where it lands, and its depth sign `w` (> 0 in front of the camera). */
export function applyHomography(m: Mat3, x: number, y: number): { x: number; y: number; w: number } {
	const w = m[6] * x + m[7] * y + m[8];
	return {
		x: (m[0] * x + m[1] * y + m[2]) / w,
		y: (m[3] * x + m[4] * y + m[5]) / w,
		w,
	};
}

/**
 * The tilt as it happens on screen. `axes` is the picture's own frame in
 * device pixels — the linear part of its 2D transform, `[a, b, c, d]` as a
 * canvas writes it — and `pivot` is where the pivot is on screen. The picture
 * is turned in its own frame (a rotated card tips about its own edge, not the
 * screen's), then drawn through that frame again.
 *
 * Returns the homography from a screen point of the flat picture to the same
 * point tilted, or null when the frame is degenerate (scaled to nothing).
 */
export function screenTilt(
	tilt: TiltAngles,
	axes: readonly [number, number, number, number],
	pivot: { x: number; y: number },
): Mat3 | null {
	const [a, b, c, d] = axes;
	// Local (about the pivot) → screen, and back.
	const toScreen: Mat3 = [a, c, pivot.x, b, d, pivot.y, 0, 0, 1];
	const toLocal = invert3(toScreen);
	if (toLocal === null) return null;
	return multiply3(multiply3(toScreen, tiltHomography(tilt)), toLocal);
}

/** Whether a tilt turns the picture at all. */
export function isTilted(tilt: Pick<TiltAngles, 'rotationX' | 'rotationY'>): boolean {
	return Math.abs(tilt.rotationX) > 1e-6 || Math.abs(tilt.rotationY) > 1e-6;
}
