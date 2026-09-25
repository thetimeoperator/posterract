/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Reading a file the host serves by URL a range at a time (see
// `ProjectFS.locate`). Every request names both ends, so each one is read to
// its end and nothing is left streaming after the bytes that were wanted.

import { CustomSource } from 'mediabunny';

import type { Source } from 'mediabunny';
import type { LocatedFile } from './fs';

/** Bytes `start` (inclusive) to `end` (exclusive) of the file at `url`. */
export async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
	if (end <= start) return new Uint8Array(0);

	const response = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
	if (!response.ok) throw new Error(`Could not read ${url}: ${response.status}`);

	const bytes = new Uint8Array(await response.arrayBuffer());
	// A server that ignores the range sends the file from its first byte.
	const range = response.status === 206 ? bytes : bytes.slice(start, end);
	if (range.length !== end - start) throw new Error(`Could not read ${url}: the file is shorter than expected`);
	return range;
}

/** A mediabunny source over the `size`-byte file at `url`. */
export function rangedSource(url: string, size: number): Source {
	return new CustomSource({
		getSize: () => size,
		read: (start, end) => fetchRange(url, start, end),
		prefetchProfile: 'fileSystem',
	});
}

/**
 * A mediabunny source for playing a located file: read ahead in large
 * ranges, as over a network, since every read is a round trip to the host.
 * A URL that stops answering (the desktop's grants expire) is located again
 * once before the read fails.
 */
export function locatedSource(file: LocatedFile, locate: () => Promise<LocatedFile>): Source {
	let current = file;
	return new CustomSource({
		getSize: () => current.size,
		read: async (start, end) => {
			try {
				return await fetchRange(current.url, start, end);
			} catch {
				current = await locate();
				return fetchRange(current.url, start, end);
			}
		},
		prefetchProfile: 'network',
		maxCacheSize: 64 * 2 ** 20,
	});
}
