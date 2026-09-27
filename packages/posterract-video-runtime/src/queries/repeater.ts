/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { store } from '../world/store';
import { Knobs, Repeater } from '../traits';
import { REPEATER_DEFAULTS, type RepeaterInput, type RepeaterLayout } from '../utils/repeater';

import type { Entity, World } from 'koota';

function knobNumber(knobs: Record<string, number | string>, name: keyof RepeaterInput): number {
	const value = knobs[name];
	return typeof value === 'number' && Number.isFinite(value) ? value : REPEATER_DEFAULTS[name] as number;
}

/**
 * A repeater's settings for this frame, as the layout maths takes them: its
 * numbers from its computed knobs (so keyframes have moved them), the rest
 * from its `Repeater` trait.
 */
export function repeaterInput(world: World, entity: Entity): RepeaterInput {
	const knobs = store(world, Knobs).computed[entity.id()] ?? {};
	const settings = entity.get(Repeater)!;
	return {
		...REPEATER_DEFAULTS,
		count: Math.max(0, Math.round(knobNumber(knobs, 'count'))),
		layout: settings.layout as RepeaterLayout,
		layoutTo: settings.layoutTo ? settings.layoutTo as RepeaterLayout : null,
		morph: knobNumber(knobs, 'morph'),
		columns: Math.max(0, Math.round(knobNumber(knobs, 'columns'))),
		spacing: knobNumber(knobs, 'spacing'),
		radius: knobNumber(knobs, 'radius'),
		tube: knobNumber(knobs, 'tube'),
		seed: Math.round(knobNumber(knobs, 'seed')),
		ripple: knobNumber(knobs, 'ripple'),
		rippleFrequency: knobNumber(knobs, 'rippleFrequency'),
		ripplePhase: knobNumber(knobs, 'ripplePhase'),
		rippleMode: settings.rippleMode === 'scale' ? 'scale' : 'z',
		rippleCenterX: knobNumber(knobs, 'rippleCenterX'),
		rippleCenterY: knobNumber(knobs, 'rippleCenterY'),
		tiltX: knobNumber(knobs, 'tiltX'),
		tiltY: knobNumber(knobs, 'tiltY'),
		roll: knobNumber(knobs, 'roll'),
		zoom: knobNumber(knobs, 'zoom'),
		perspective: knobNumber(knobs, 'perspective'),
		cameraZ: knobNumber(knobs, 'cameraZ'),
	};
}
