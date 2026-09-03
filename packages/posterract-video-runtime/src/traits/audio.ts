/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

// Audio volume in decibels (0 dB = unity, -Infinity = silence).
export const Volume = trait({ value: 0 });

// Presence means muted.
export const Muted = trait();

// Runtime-only solo tag (not serialized).
export const Soloed = trait();

// Runtime-only: maps timeline time to AudioContext time while playing.
export const AudioPlayback = trait({
	wasPlaying: false,
	contextOffsetInSeconds: 0,
	timelineOffsetInSeconds: 0,
});


/**
 * `<duck>` — hold one clip's level down while another one plays.
 *
 * The music under a voiceover is the case: `target` names what gets quieter,
 * `by` names what makes it quieter, `amount` is how much in dB, and `attack`
 * and `release` (in frames) are how quickly it gives way and comes back.
 *
 * The envelope is a pure function of the frame — derived from the `by` clip's
 * own span rather than from anything the player accumulates — so scrubbing to
 * the middle of a duck shows the same level an export writes there.
 */
export const Duck = trait({ target: '', by: '', amount: -12, attack: 3, release: 12 });

/**
 * The dB a duck is currently taking off a target, written each frame by the
 * playback system and added to the bus's own volume. Separate from `Volume`
 * so an authored level, a volume keyframe track and a duck all compose
 * instead of overwriting one another.
 */
export const DuckGain = trait({ db: 0 });
