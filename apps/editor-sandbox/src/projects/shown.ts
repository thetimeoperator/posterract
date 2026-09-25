/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Which revision of each source the canvas is showing, for anyone outside the
 * editor page who needs to ask.
 *
 * The file and the canvas are two views of one document, and for a moment
 * after the file changes they disagree: the change is on disk and not yet on
 * screen. An agent that edits the file and then asks the editor what the
 * video looks like needs to know which of the two it is being told about —
 * so the editor page publishes the map it keeps (see pages/editor.tsx), and
 * `context` reports it beside the revision on disk. Equal means caught up.
 */

const shown = new Map<string, ReadonlyMap<string, string>>();

/** Publishes the live map of a mounted project; returns the way to withdraw it. */
export function publishShownRevisions(dir: string, revisions: ReadonlyMap<string, string>): () => void {
	shown.set(dir, revisions);
	return () => {
		if (shown.get(dir) === revisions) shown.delete(dir);
	};
}

/** The revision of `path` the canvas of the project in `dir` is showing, or null when nothing vouches for one. */
export const shownRevision = (dir: string, path: string): string | null => shown.get(dir)?.get(path) ?? null;
