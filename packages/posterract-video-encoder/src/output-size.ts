/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The size a scene is encoded at for a given `resolution`.
 *
 * "1080p" names the *shorter* side. For the landscape video the term grew up
 * with, that is the height — which is how this used to be worked out, always
 * from the height. For a vertical video the shorter side is the width, and
 * reading "1080" as its height made a 1080×1920 scene export at 608×1080: a
 * third of the pixels anyone asking for 1080p means, on the format this editor
 * is mostly used for. Measured against the shorter side, 1080p is 1920×1080
 * for a landscape scene (exactly as before), 1080×1920 for a vertical one, and
 * 1080×1080 for a square.
 *
 * Both sides are rounded to even numbers: the H.264 and HEVC encoders take
 * nothing else.
 */
export function outputSize(sceneWidth: number, sceneHeight: number, resolution: number): { scale: number; width: number; height: number } {
	const shorter = Math.min(sceneWidth, sceneHeight);
	const scale = shorter > 0 ? Math.round(resolution * 1e6 / shorter) / 1e6 : 1;
	return {
		scale,
		width: Math.round(sceneWidth * scale / 2) * 2,
		height: Math.round(sceneHeight * scale / 2) * 2,
	};
}
