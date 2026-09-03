/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Web font loading (was engine/font/utils.ts, minus the app-side pieces:
// getLocalFonts needs window.queryLocalFonts, and font persistence is the
// app's IndexedDB concern; it wraps loadWebFont and re-calls it on restore).

import { WebFonts } from './fixtures';
import { FontStyle } from '../constants';
import { Fonts } from '../traits';

import type { World } from 'koota';
import type * as types from './types';

const STYLE_MAP = {
	[FontStyle.NORMAL]: 'normal',
	[FontStyle.ITALIC]: 'italic',
	[FontStyle.OBLIQUE]: 'oblique',
} as const;

/** The environment's FontFaceSet: document.fonts on a page, self.fonts in a worker. */
function getFontFaceSet(): FontFaceSet | null {
	const scope = globalThis as { document?: { fonts?: FontFaceSet }; fonts?: FontFaceSet };
	return scope.document?.fonts ?? scope.fonts ?? null;
}

/**
 * Where a face is actually loaded from.
 *
 * The copy the build staged into the app's own assets when there is one —
 * resolved against the document's base, because the desktop app serves the
 * editor from `posterract-app://app/editor-sandbox/` and an absolute path
 * would miss it — and the original URL otherwise, which is what the web app
 * uses. The desktop renderer allows no network, so without the staged copy a
 * preset falls back to a serif.
 */
export function fontUrl(family: keyof typeof WebFonts): string {
	const config = WebFonts[family] as { url: string; file?: string };
	if (!config.file) return config.url;
	const base = typeof document !== 'undefined' ? document.baseURI : null;
	return base ? new URL(`fonts/${config.file}`, base).toString() : config.url;
}

/**
 * Get common web fonts
 */
export function getWebFonts(): types.FontSources[] {
	return Object.keys(WebFonts).map((family) => {
		return {
			family,
			variants: WebFonts[family as keyof typeof WebFonts].weights.map((weight) => {
				return {
					family,
					source: `url(${fontUrl(family as keyof typeof WebFonts)})`,
					weight: weight,
				};
			}),
		};
	});
}

export async function loadWebFont(
	world: World,
	family: keyof typeof WebFonts,
	style: FontStyle = FontStyle.NORMAL,
	weight?: string,
): Promise<types.FontSource> {
	const source = `url(${fontUrl(family)})`;
	const font: types.FontSource = {
		source,
		family,
		weight,
		style,
	};

	const fonts = world.get(Fonts)?.list;
	// No FontFace = headless environment without font rasterization; text
	// measurement falls back to the system font.
	if (!fonts || typeof FontFace === 'undefined') return font;

	// Already loaded
	if (fonts.some((f) => f.source === font.source && f.weight === font.weight)) {
		return font;
	}

	fonts.push(font);

	// Load all weights if no weight is specified
	if (!weight) {
		const config = WebFonts[family as keyof typeof WebFonts];
		const weights = config.weights;
		weight = weights.length > 1 ? `${weights[0]} ${weights[weights.length - 1]}` : weights[0];
	}

	const fontFace = new FontFace(family, source, { weight, style: STYLE_MAP[style] });

	await new Promise((resolve, reject) => {
		fontFace
			.load()
			.then((loaded) => {
				getFontFaceSet()?.add(loaded);
				resolve(null);
			})
			.catch((error) => {
				world.set(Fonts, {
					list: fonts.filter((f) => f.source !== font.source && f.weight !== font.weight),
				});
				reject(error);
			});
	});

	return font;
}
