/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MAIN_CHANNELS } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';

import { getProject, readProjectSource, writeProjectSource } from './host';

import type { RevisionEntry, TrashEntry } from '@desktop/main-channels';

export type { RevisionEntry, TrashEntry };

/** The project's entry TSX — the file version history is kept for. */
export async function entryPath(dir: string): Promise<string> {
	const project = await getProject(dir);
	if (!project) throw new Error('The project is no longer available');
	return project.entry;
}

export async function listRevisions(dir: string): Promise<RevisionEntry[]> {
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_REVISIONS_LIST, { dir, path: await entryPath(dir) });
}

export async function readRevision(dir: string, id: string): Promise<string> {
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_REVISIONS_READ, { dir, path: await entryPath(dir), id });
}

/**
 * Put a stored revision back. The desktop writes it through the normal source
 * path, so the state being replaced is itself snapshotted first and restoring
 * the wrong version is never a second loss.
 */
export async function restoreRevision(dir: string, id: string): Promise<void> {
	await mainBridge.call(MAIN_CHANNELS.PROJECTS_REVISIONS_RESTORE, { dir, path: await entryPath(dir), id });
}

export function listTrash(dir: string): Promise<TrashEntry[]> {
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_TRASH_LIST, { dir });
}

export function putTrash(dir: string, entry: { sceneId: string; name: string }): Promise<TrashEntry> {
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_TRASH_PUT, { dir, ...entry });
}

export function removeTrash(dir: string, id: string): Promise<void> {
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_TRASH_REMOVE, { dir, id });
}

/** Where a restored scene is spliced back in: the stage's closing tag. */
const STAGE_CLOSE = '</stage>';

/**
 * Put a trashed scene back into the document as the stage's last child.
 *
 * This is a source splice rather than a document edit because a deleted scene
 * has no entity left to address, and its stored text is already exactly what
 * the file had. The write is revision-checked, so a concurrent edit rejects it
 * instead of overwriting; a source whose stage close tag is ambiguous is
 * refused outright rather than guessed at.
 */
export async function restoreTrash(dir: string, id: string): Promise<{ name: string }> {
	const entry = await mainBridge.call(MAIN_CHANNELS.PROJECTS_TRASH_READ, { dir, id });
	const path = await entryPath(dir);
	const { content, revisionId } = await readProjectSource(dir, path);

	const close = content.lastIndexOf(STAGE_CLOSE);
	if (close === -1 || content.indexOf(STAGE_CLOSE) !== close) {
		throw new Error('This project’s stage could not be located, so the scene was not restored');
	}

	// Match the indentation of whatever the stage's last line uses, so the
	// restored scene reads like the rest of the file rather than a paste.
	const lineStart = content.lastIndexOf('\n', close) + 1;
	const indent = content.slice(lineStart, close).match(/^[ \t]*/)?.[0] ?? '';
	// The stored text keeps its own relative indentation; one shared prefix
	// re-seats the whole block under the stage.
	const body = entry.source
		.trim()
		.split('\n')
		.map((line) => `${indent}  ${line}`)
		.join('\n');

	const next = `${content.slice(0, lineStart)}${body}\n${content.slice(lineStart)}`;
	await writeProjectSource(dir, path, next, revisionId);
	await removeTrash(dir, id);
	return { name: entry.name };
}
