/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AnimationType } from '../constants';

/**
 * What `distance` and `amount` come to for a preset that was not given them —
 * the magnitudes the presets always had, which is what keeps every existing
 * composition playing exactly as it did.
 *
 * `distance` is a length in px: how far a slide travels, how far a twist
 * drifts. `amount` is the preset's own measure of how strong it is, and what
 * that is differs by preset because the presets do different things:
 *
 *   fade              how much of the opacity it covers, 0–1      1
 *   grow              how much smaller it starts, as a scale     0.5  (from 50%)
 *   shrink            how much larger it starts, as a scale      0.5  (from 150%)
 *   blur              the blur it starts from, px                24
 *   slide*            how much it fades while it travels, 0–1    1    (0 = no fade)
 *   spin              the rotation it starts from, degrees       45
 *   twist             the rotation it starts from, degrees       10
 *
 * `gain` and the text reveals have no magnitude to set.
 */
export function animationDefaults(type: AnimationType): { distance: number; amount: number } {
	switch (type) {
		case AnimationType.SLIDE_LEFT:
		case AnimationType.SLIDE_RIGHT:
		case AnimationType.SLIDE_UP:
		case AnimationType.SLIDE_DOWN:
			return { distance: 100, amount: 1 };
		case AnimationType.TWIST:
			return { distance: 30, amount: 10 };
		case AnimationType.SPIN:
			return { distance: 0, amount: 45 };
		case AnimationType.BLUR:
			return { distance: 0, amount: 24 };
		case AnimationType.GROW:
		case AnimationType.SHRINK:
			return { distance: 0, amount: 0.5 };
		case AnimationType.FADE:
			return { distance: 0, amount: 1 };
		default:
			return { distance: 0, amount: 0 };
	}
}

/** The given value when there is one, the preset's own otherwise. */
export function animationParams(
	type: AnimationType,
	distance: number | null | undefined,
	amount: number | null | undefined,
): { distance: number; amount: number } {
	const own = animationDefaults(type);
	return {
		distance: typeof distance === 'number' && Number.isFinite(distance) ? distance : own.distance,
		amount: typeof amount === 'number' && Number.isFinite(amount) ? amount : own.amount,
	};
}
