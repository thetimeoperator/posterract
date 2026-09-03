/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from 'solid-js';

import type { EditWriter, SaveState } from '@/projects/edits';

/**
 * Autosave is real but was invisible, which reads as "my work is not being
 * kept". The writer is rebuilt on every bundle mount, so the state lives here
 * at module scope and the editor rebinds it rather than threading a provider
 * through a chain that remounts.
 */
const [state, setState] = createSignal<SaveState>({ status: 'idle' });

export const saveState = state;

/**
 * Mirror one writer's save state until the next writer replaces it. `observe`
 * lets the caller react to transitions (persisting the undo cache on a
 * completed save) without a second subscription to the same writer.
 */
export function bindSaveState(writer: EditWriter, observe?: (state: SaveState) => void): () => void {
	return writer.watch((state) => {
		setState(state);
		observe?.(state);
	});
}

/** Forget the previous writer's last state when a project closes. */
export function resetSaveState(): void {
	setState({ status: 'idle' });
}

/** "just now" up to a minute, then whole minutes, then the clock time. */
export function describeSavedAt(at: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.round((now - at) / 1_000));
	if (seconds < 45) return 'just now';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
