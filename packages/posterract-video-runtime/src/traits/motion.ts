/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait, type Entity } from 'koota';

import { AnimationType, AnimationPhase, TrackLoop } from '../constants';

// KeyframeTrack entity: one per (target, property) pair. ChildOf its target
// (geometry, paint, color stop, ...) and owns the Keyframe entities as
// children. `target` is denormalised: ChildOf is authoritative, but the keyed
// lookup is refreshed when tracks are aggregated so motion/render don't have
// to walk up the relation on every frame.
export const KeyframeTrack = trait({
	property: '',
	target: null as Entity | null,
	// What happens after the last keyframe: hold, repeat, or ping-pong (see
	// `loopedFrame`). A loop is what keeps a wiggle five keyframes long.
	loop: TrackLoop.NONE as TrackLoop,
});

// Keyframe entity: ChildOf its KeyframeTrack. Easing applies to the segment
// from this keyframe to the next-in-time on the same track.
export const Keyframe = trait({
	time: 0,
	value: 0,
	easing: 'linear',
	// A shape keyframe's path data (a `d` or `path` track); empty on numeric ones.
	text: '',
});

// Animation entity: one preset in/out animation, ChildOf its target.
export const Animation = trait({
	type: AnimationType.FADE as AnimationType,
	duration: 0, // frames
	delay: 0, // frames
	phase: AnimationPhase.IN as AnimationPhase,
	// How far and how much, where the preset has a say in it; null is the
	// preset's own (see `animationDefaults`). Without these a slide was always
	// 100 px, and any entrance that was not had to be written as keyframes.
	distance: null as number | null,
	amount: null as number | null,
	// An easing descriptor ('cubicBezier(…)', 'spring(…)', 'steps(…)',
	// 'linear'); empty is the preset's own curve.
	easing: '',
});
