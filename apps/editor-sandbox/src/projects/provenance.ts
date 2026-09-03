/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What a finished render came from.
 *
 * A video in the exports library is only useful if it can be traced back to
 * the composition that produced it — the project, the scene, and the exact
 * revision of the source. Collected at export time because the source can move
 * on immediately afterwards.
 */
import { Scene, Source } from '@posterract/video-runtime';
import { parseSource } from '@posterract/composition';

import { getProject, readProjectSource } from './host';

import type { Entity } from 'koota';

export type ExportProvenance = {
	projectId: string | null;
	sceneId: string | null;
	sourceRevision: string | null;
	width: number | null;
	height: number | null;
};

export async function exportProvenance(dir: string, scene: Entity): Promise<ExportProvenance> {
	const stamp = scene.get(Source)?.value;
	const locator = stamp ? parseSource(stamp)?.locator : undefined;
	const size = scene.get(Scene);

	let projectId: string | null = null;
	let sourceRevision: string | null = null;
	try {
		const project = await getProject(dir);
		if (project) {
			projectId = project.id;
			sourceRevision = (await readProjectSource(dir, project.entry)).revisionId;
		}
	} catch {
		// Provenance is a record, not a gate: a render still completes without it.
	}

	return {
		projectId,
		sceneId: typeof locator === 'string' ? locator : null,
		sourceRevision,
		width: size?.width ?? null,
		height: size?.height ?? null,
	};
}
