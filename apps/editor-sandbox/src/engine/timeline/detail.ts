/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * How much of the document the timeline shows.
 *
 * A composition holds more than clips — effects, paints, strokes, shadows and
 * preset animations are all real elements in the source, and until now none of
 * them had a row. Showing them all by default would bury the clips, so the
 * level is a user choice that persists.
 */
import { createStoredSignal } from '@/lib/store';
import { store } from '@/init';

import type { TimelineDetail } from '@posterract/video-runtime';

export const TIMELINE_DETAILS: Array<{ value: TimelineDetail; label: string; hint: string }> = [
	{ value: 'clips', label: 'Clips', hint: 'What plays, and its keyframes' },
	{ value: 'animation', label: 'Animation', hint: 'Adds preset animations' },
	{ value: 'everything', label: 'Everything', hint: 'Adds effects, paints, strokes and shadows' },
];

const [detail, setDetail] = createStoredSignal(
	store.define<TimelineDetail>('timeline.detail', 'clips'),
);

export const timelineDetail = detail;
export const setTimelineDetail = setDetail;

/**
 * Timeline zoom, as keys rather than only a wheel gesture.
 *
 * `resolution` is frames-per-pixel, so zooming in divides it. The playhead is
 * the anchor: zooming should keep the frame you are looking at where it is,
 * not scroll the view out from under you.
 */
export const TIMELINE_ZOOM_STEP = 1.4;
export const MIN_RESOLUTION = 0.02;
export const MAX_RESOLUTION = 40;
