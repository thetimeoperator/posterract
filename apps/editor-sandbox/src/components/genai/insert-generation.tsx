/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Puts a finished generation on the canvas the way an imported asset goes on:
 * through the document editor's insert path, into the active scene, at the
 * playhead, centered. The element's `src` is the output URL the shell served
 * — the runtime plays URL sources as it plays files, and freezing a copy into
 * the project's assets is the shell's job, later, not the editor's.
 */

import { Audio, Image, Video } from '@posterract/video-reconciler';
import { Computed, getActiveEntity, getNextName, Root, Source, store } from '@posterract/video-runtime';

import { getDocumentEditor } from '@/engine/editor';
import { AUDIO_SIZE } from '@/engine/insert-asset';

import type { AiGenerationKind, AiGenerationOutput } from '@/lib/ai-bridge';
import type { Entity, World } from 'koota';

const NAMES: Record<AiGenerationKind, string> = {
	image: 'Generated image',
	video: 'Generated video',
	voice: 'Generated voice',
};

/**
 * Inserts `output` into the active scene as the element of its kind and
 * returns the entity — or null when there is nothing to insert into (no
 * project mounted, no source to write under) or no URL to point at.
 */
export function insertGeneration(world: World, kind: AiGenerationKind, output: AiGenerationOutput): Entity | null {
	const src = output.url;
	if (!src) return null;

	const parent = getActiveEntity(world) ?? world.get(Root)!;
	if (!parent.get(Source)?.value) return null;

	const editor = getDocumentEditor(world);
	const name = getNextName(world, NAMES[kind]);
	const start = store(world, Computed).localTimeInSeconds[parent.id()] ?? 0;
	const timing = start > 0 ? { start } : {};

	const size = kind === 'voice'
		? { ...AUDIO_SIZE }
		: output.width && output.height
			? { width: Math.round(output.width), height: Math.round(output.height) }
			: undefined;
	const position = size ? centered(world, parent, size) : {};

	const [entity] = editor.insertElement(parent, () => {
		switch (kind) {
			case 'image':
				return <Image name={name} src={src} keepAspectRatio {...position} {...(size ?? {})} {...timing} />;
			case 'video':
				return <Video name={name} src={src} keepAspectRatio {...position} {...(size ?? {})} {...timing} />;
			case 'voice':
				return <Audio name={name} src={src} {...position} {...(size ?? {})} {...timing} />;
		}
	});

	if (entity) editor.select(entity);
	return entity ?? null;
}

/** Where a new element of `size` goes: centered in its parent, as imports are. */
function centered(world: World, parent: Entity, size: { width: number; height: number }): { x: number; y: number } {
	const bounds = store(world, Computed);
	const width = bounds.width[parent.id()] ?? size.width;
	const height = bounds.height[parent.id()] ?? size.height;
	return { x: Math.round((width - size.width) / 2), y: Math.round((height - size.height) / 2) };
}
