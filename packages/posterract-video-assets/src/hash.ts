/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Content identity for assets. Footage runs to gigabytes, and hashing all of
// it on every import would make dropping a clip into the project take
// seconds; the id instead is a SHA-256 over a sample — the size and the head,
// middle and tail of the bytes — which is stable for the same file, tells
// apart anything a user is likely to have two of, and costs milliseconds.
// Truncated to 16 hex characters: plenty for one project's library, short
// enough to read in a manifest.

import { fetchRange } from './ranges';

/** Bytes hashed from each of the head, middle and tail of a file. */
const SAMPLE_BYTES = 1024 * 1024;

export const ID_LENGTH = 16;

/** The content id of `blob`. */
export async function hashBlob(blob: Blob): Promise<string> {
	const size = blob.size;
	const parts: Blob[] = [new Blob([String(size)])];

	if (size <= SAMPLE_BYTES * 3) {
		parts.push(blob);
	} else {
		const middle = Math.floor(size / 2 - SAMPLE_BYTES / 2);
		parts.push(
			blob.slice(0, SAMPLE_BYTES),
			blob.slice(middle, middle + SAMPLE_BYTES),
			blob.slice(size - SAMPLE_BYTES),
		);
	}

	const bytes = await new Blob(parts).arrayBuffer();
	return hexOf(await crypto.subtle.digest('SHA-256', bytes)).slice(0, ID_LENGTH);
}

/**
 * The content id of the `size`-byte file served at `url`: the id `hashBlob`
 * gives the same file, from the same samples, read in ranges so the file is
 * never loaded whole.
 */
export async function hashUrl(url: string, size: number): Promise<string> {
	const middle = Math.floor(size / 2 - SAMPLE_BYTES / 2);
	const ranges: Array<[start: number, end: number]> = size <= SAMPLE_BYTES * 3
		? [[0, size]]
		: [[0, SAMPLE_BYTES], [middle, middle + SAMPLE_BYTES], [size - SAMPLE_BYTES, size]];

	const parts = [
		new TextEncoder().encode(String(size)),
		...await Promise.all(ranges.map(([start, end]) => fetchRange(url, start, end))),
	];
	const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	return hexOf(await crypto.subtle.digest('SHA-256', bytes)).slice(0, ID_LENGTH);
}

/** The id of a sequence: the hash of its frame names and sizes, not their bytes. */
export async function hashSequence(frames: { name: string; size: number }[]): Promise<string> {
	const text = frames.map((frame) => `${frame.name}:${frame.size}`).join('\n');
	const bytes = new TextEncoder().encode(`seq\n${text}`);
	return hexOf(await crypto.subtle.digest('SHA-256', bytes)).slice(0, ID_LENGTH);
}

/** Whether a string could be an asset id (and not, say, a library path). */
export const looksLikeId = (value: string): boolean =>
	value.length === ID_LENGTH && /^[0-9a-f]+$/.test(value);

function hexOf(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
