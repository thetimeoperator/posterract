/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The described caption presets.
 *
 * Each is a set of choices, not a piece of code: how a line is broken, how
 * much of it is on screen, what happens to the word being said, and what it is
 * all set in. `StyledCaptionDecoder` turns each of these into a caption track.
 */

import { CaptionAlign, CaptionType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';

import type { CaptionStyleSpec } from './styled';

// Every face here is one the build stages into the app (see
// `scripts/vendor-fonts.mjs`). The two the upstream fork hosted on its own
// bucket are deliberately unused: their licences are not stated, and a preset
// whose type silently falls back to a serif is worse than no preset.

/** Everything a preset must state, so switching presets resets the last one. */
const BASE = {
	fontStyle: FontStyle.NORMAL,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	letterSpacing: undefined,
} as const;

export const STYLED_CAPTION_PRESETS: Record<number, CaptionStyleSpec> = {
	/** One word at a time, big, and it lands with a snap. The TikTok default. */
	[CaptionType.POP]: {
		type: CaptionType.POP,
		style: { ...BASE, fontFamily: 'Geologica', fontWeight: '900', fontSize: 96, textCase: TextCase.UPPER, leading: 1 },
		width: 900, height: 220, align: CaptionAlign.CENTER,
		group: { duration: 1.6 },
		reveal: 'word', emphasis: 'color',
		accent: 0x5DFF9D, base: 0xFFFFFF,
	},

	/** The line sits there and fills in behind the voice, like a lyric video. */
	[CaptionType.KARAOKE]: {
		type: CaptionType.KARAOKE,
		style: { ...BASE, fontFamily: 'Figtree', fontWeight: '800', fontSize: 62, textCase: TextCase.ORIGINAL, leading: 1.15 },
		width: 940, height: 220, align: CaptionAlign.BOTTOM,
		group: { duration: 2.4 },
		reveal: 'line', emphasis: 'fill',
		accent: 0x24D5FF, base: 0xFFFFFF,
	},

	/** The line arrives a word at a time and stays: a thought being written. */
	[CaptionType.TYPEWRITER]: {
		type: CaptionType.TYPEWRITER,
		style: { ...BASE, fontFamily: 'Source Code Pro', fontWeight: '600', fontSize: 48, textCase: TextCase.ORIGINAL, leading: 1.35 },
		width: 900, height: 260, align: CaptionAlign.BOTTOM,
		group: { duration: 2.6 },
		reveal: 'typewriter', emphasis: 'none',
		accent: 0xFFFFFF, base: 0xF4FFF8,
	},

	/** Short, wide lines low in frame — the news-ticker read. */
	[CaptionType.BANNER]: {
		type: CaptionType.BANNER,
		style: { ...BASE, fontFamily: 'Urbanist', fontWeight: '700', fontSize: 52, textCase: TextCase.UPPER, leading: 1.1 },
		width: 1000, height: 160, align: CaptionAlign.BOTTOM,
		group: { length: 34 },
		reveal: 'line', emphasis: 'color',
		accent: 0xFFD166, base: 0xFFFFFF,
	},

	/** The said word swells out of the line. Loud, and it lands on the beat. */
	[CaptionType.PUNCH]: {
		type: CaptionType.PUNCH,
		style: { ...BASE, fontFamily: 'Chewy', fontWeight: '400', fontSize: 72, textCase: TextCase.UPPER, leading: 1.2 },
		width: 900, height: 280, align: CaptionAlign.CENTER,
		group: { duration: 2 },
		reveal: 'line', emphasis: 'pop', popScale: 1.35,
		accent: 0xFF3355, base: 0xFFFFFF,
	},

	/** Two or three words at a time, rolling: reads fast without crowding. */
	[CaptionType.MARQUEE]: {
		type: CaptionType.MARQUEE,
		style: { ...BASE, fontFamily: 'Bangers', fontWeight: '400', fontSize: 84, textCase: TextCase.UPPER, leading: 1.05 },
		width: 900, height: 200, align: CaptionAlign.CENTER,
		group: { length: 16 },
		reveal: 'line', emphasis: 'color',
		accent: 0x24D5FF, base: 0xFFF3C4,
	},
};
