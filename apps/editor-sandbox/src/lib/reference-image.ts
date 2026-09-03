/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Turns any image the editor can see — a project asset's file, a generated
 * result's URL — into the reference frame a video generation accepts: a JPEG
 * data URL, downscaled so the whole request stays inside the server's 1 MiB
 * body. A first frame does not need print resolution; ~1536px is more than
 * the video models consume.
 */

import { AI_REFERENCE_IMAGE_MAX_CHARS } from '@/lib/ai-bridge';

const MAX_EDGE_PX = 1536;
const RETRY_EDGE_PX = 1024;

export class ReferenceImageError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'ReferenceImageError';
	}
}

async function bitmapFrom(source: Blob | string): Promise<ImageBitmap> {
	if (typeof source !== 'string') {
		try {
			return await createImageBitmap(source);
		} catch {
			throw new ReferenceImageError('This file could not be read as an image.');
		}
	}
	// A URL (a generated result, a remote asset): fetch first so the canvas is
	// never tainted. Data URLs take the same path and never hit the network.
	let blob: Blob;
	try {
		const response = await fetch(source);
		if (!response.ok) throw new Error(String(response.status));
		blob = await response.blob();
	} catch {
		throw new ReferenceImageError('The image could not be loaded from its source.');
	}
	try {
		return await createImageBitmap(blob);
	} catch {
		throw new ReferenceImageError('This file could not be read as an image.');
	}
}

function encode(bitmap: ImageBitmap, maxEdge: number, quality: number): string | undefined {
	const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) return undefined;
	// A JPEG has no alpha; transparent regions composite onto black otherwise.
	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, width, height);
	context.drawImage(bitmap, 0, 0, width, height);
	return canvas.toDataURL('image/jpeg', quality);
}

/**
 * The reference frame for `source`, as a data URL under the wire cap.
 * Throws a `ReferenceImageError` with a sentence worth showing when the
 * source cannot be read or cannot be made small enough.
 */
export async function toReferenceImage(source: Blob | string): Promise<string> {
	const bitmap = await bitmapFrom(source);
	try {
		const attempts: Array<[number, number]> = [
			[MAX_EDGE_PX, 0.85],
			[RETRY_EDGE_PX, 0.75],
			[RETRY_EDGE_PX, 0.6],
		];
		for (const [edge, quality] of attempts) {
			const dataUrl = encode(bitmap, edge, quality);
			if (dataUrl && dataUrl.length <= AI_REFERENCE_IMAGE_MAX_CHARS) return dataUrl;
		}
		throw new ReferenceImageError('This image could not be compressed enough to animate.');
	} finally {
		bitmap.close();
	}
}
