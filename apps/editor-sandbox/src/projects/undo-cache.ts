/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Persisting the undo stack between sessions.
 *
 * Undo steps address elements by their stamped source id, so they only mean
 * anything against the revision of the file they were recorded on. The
 * revision travels with the stack and is checked on load: a source edited in
 * another editor, by an agent, or restored from history invalidates the stack
 * rather than replaying onto a document that has moved underneath it.
 */
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';

const VERSION = 1;

type CachedHistory = {
	version: number;
	revisionId: string;
	stack: unknown;
};

export function loadUndoCache(dir: string, revisionId: string): Promise<unknown | null> {
	return mainBridge
		.call(MAIN_CHANNELS.PROJECTS_HISTORY_READ, { dir })
		.then((value) => {
			const cached = value as CachedHistory | null;
			if (!cached || cached.version !== VERSION) return null;
			return cached.revisionId === revisionId ? cached.stack : null;
		})
		.catch(() => null);
}

export function saveUndoCache(dir: string, revisionId: string, stack: unknown): Promise<void> {
	return mainBridge
		.call(MAIN_CHANNELS.PROJECTS_HISTORY_WRITE, {
			dir,
			value: { version: VERSION, revisionId, stack } satisfies CachedHistory,
		})
		.catch(() => undefined);
}

export function clearUndoCache(dir: string): Promise<void> {
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_HISTORY_WRITE, { dir, value: null }).catch(() => undefined);
}
