/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { TrackLoop } from '../constants';

/**
 * The frame a looping keyframe track is sampled at.
 *
 * A track is a stretch of motion between its first and last keyframe. Without
 * a loop the value holds on either side of it, which is why anything that
 * keeps moving — a bob, a pulse, a wiggle — used to be written out as one
 * keyframe per change of direction for as long as the clip ran: thirty-seven
 * keyframes for a twelve second wiggle, regenerated whenever the clip was
 * trimmed. A loop says the same thing once: these few keyframes, again and
 * again.
 *
 * Only what comes after the first pass wraps. Before the first keyframe the
 * value holds as it always has, so a track can still start late.
 *
 * Every cycle is the same as the first one, boundary included: a cycle runs
 * over the frames `(first, last]`, so the frame that lands exactly on a
 * boundary shows the last keyframe, as it does the first time through. For a
 * seamless loop — last value equal to the first — that also means no frame is
 * shown twice at the seam.
 *
 * A ping-pong mirrors time rather than reversing the keyframes, so the way
 * back is the way there played backwards, easings included.
 */
export function loopedFrame(frame: number, first: number, last: number, mode: TrackLoop): number {
	const span = last - first;
	if (mode === TrackLoop.NONE || span <= 0 || frame <= last) return frame;

	const elapsed = frame - first;
	if (mode === TrackLoop.REPEAT) {
		const into = elapsed % span;
		return first + (into === 0 ? span : into);
	}

	const into = elapsed % (2 * span);
	return first + (into <= span ? into : 2 * span - into);
}
