/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The two verbs two authors need of each other: *what are you looking at* and
 * *look at this*.
 *
 * A person art-directs by pointing — "make this bigger", "too fast here" — and
 * the words only mean something next to what they have selected and where
 * their playhead is. `look` is that: one call, at the start of a turn, for the
 * scene they are in, the moment they are parked on, what they have selected
 * (with the numbers an edit starts from), and the notes they left on the
 * timeline. `show` is the same gesture the other way round: the agent brings
 * the editor to an element at a moment, so "I changed this" is something the
 * person sees rather than reads.
 */

import {
	Chars, Computed, FrameRate, Marker, Name, Scene, Selected, Source,
	getActiveEntity, getEntityChildren, getParentNode, setPlayhead, store,
} from '@posterract/video-runtime';
import { authoredElement } from '@posterract/video-reconciler';
import { parseSource } from '@posterract/composition';

import { getDocumentEditor } from '@/engine';
import { zoomToSelection } from '@/engine/camera';

import { labelOf } from './check';
import { resolveNode } from './nodes';

import type { Entity } from 'koota';
import type { EditorSession } from './session';

/** A marker whose name starts like this is addressed to the agent. */
const NOTE_PREFIX = /^@(agent|ai|claude|codex)\b[:\s-]*/i;

/** The props an edit usually starts from, as the source spells them. */
const POINTED_PROPS = ['x', 'y', 'width', 'height', 'start', 'end', 'src', 'fontSize', 'color', 'fill', 'opacity', 'rotation', 'scale'] as const;

export type LookResult = {
	scene: { id: string | null; name?: string; width: number; height: number } | null;
	/** Scene-local seconds the playhead is parked on; null with no scene active. */
	playhead: number | null;
	selected: Array<{ id: string | null; kind: string; name?: string; text?: string; props: Record<string, unknown> }>;
	/** Markers addressed to the agent (`@agent …`), nearest the playhead first. */
	notes: Array<{ time: number; text: string }>;
	/** Every other marker of the scene, in order. */
	markers: Array<{ time: number; name: string }>;
};

export type ShowRequest = { id: string; at?: number };
export type ShowResult = { scene: string | null; id: string; at: number | null };

function sourceId(entity: Entity): string | null {
	const source = entity.get(Source)?.value;
	if (!source) return null;
	const locator = parseSource(source)?.locator;
	return typeof locator === 'string' ? locator : null;
}

/** The root scene an element lives in. */
function sceneOf(entity: Entity): Entity | null {
	let current: Entity | null = entity;
	while (current) {
		if (current.has(Scene) && getParentNode(current) === null) return current;
		current = getParentNode(current);
	}
	return null;
}

export function look(session: () => EditorSession): LookResult {
	const { world } = session();
	const scene = getActiveEntity(world);
	const fps = world.get(FrameRate)?.value || 30;
	const computed = store(world, Computed);
	const playhead = scene ? (computed.localTime[scene.id()] ?? 0) / fps : null;

	const selected = [...world.query(Selected, Source)].map((entity) => {
		const authored = authoredElement(entity)?.props ?? {};
		const props: Record<string, unknown> = {};
		for (const name of POINTED_PROPS) {
			const value = authored[name];
			if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') props[name] = value;
		}
		const text = entity.get(Chars)?.value;
		return {
			id: sourceId(entity),
			kind: labelOf(entity),
			...(entity.get(Name)?.value ? { name: entity.get(Name)!.value } : {}),
			...(typeof text === 'string' && text ? { text: text.length > 80 ? `${text.slice(0, 79)}…` : text } : {}),
			props,
		};
	});

	const notes: LookResult['notes'] = [];
	const markers: LookResult['markers'] = [];
	for (const child of scene ? getEntityChildren(world, scene) : []) {
		const marker = child.get(Marker);
		if (!marker) continue;
		const time = Number((marker.time / fps).toFixed(3));
		if (NOTE_PREFIX.test(marker.name)) notes.push({ time, text: marker.name.replace(NOTE_PREFIX, '').trim() });
		else markers.push({ time, name: marker.name });
	}
	// The note nearest where the person is parked is most likely the one they mean.
	notes.sort((a, b) => Math.abs(a.time - (playhead ?? 0)) - Math.abs(b.time - (playhead ?? 0)));
	markers.sort((a, b) => a.time - b.time);

	return {
		scene: scene
			? {
				id: sourceId(scene),
				...(scene.get(Name)?.value ? { name: scene.get(Name)!.value } : {}),
				width: computed.width[scene.id()] ?? 0,
				height: computed.height[scene.id()] ?? 0,
			}
			: null,
		playhead: playhead === null ? null : Number(playhead.toFixed(3)),
		selected,
		notes,
		markers,
	};
}

/**
 * Brings the editor to an element: its scene becomes the active one, the
 * playhead goes to `at` (or to the middle of the element's span, where it is
 * sure to be on screen), the element is selected and the camera frames it.
 * All of it is view: nothing in the source changes.
 */
export function show(session: () => EditorSession, request: ShowRequest): ShowResult {
	const { world } = session();
	const entity = resolveNode(world, request.id);
	const editor = getDocumentEditor(world);
	const scene = sceneOf(entity);
	if (scene && getActiveEntity(world) !== scene) editor.activate(scene);

	let at: number | null = null;
	if (scene) {
		const computed = store(world, Computed);
		const fps = world.get(FrameRate)?.value || 30;
		const sceneStart = computed.start[scene.id()] ?? 0;
		const eid = entity.id();
		const middle = ((computed.start[eid] ?? sceneStart) + (computed.end[eid] ?? sceneStart)) / 2;
		const frame = request.at !== undefined && Number.isFinite(request.at) && request.at >= 0
			? Math.round(request.at * fps)
			: Math.round(middle - sceneStart);
		setPlayhead(world, scene, frame);
		at = Number((frame / fps).toFixed(3));
	}

	if (entity !== scene) {
		editor.select(entity);
		zoomToSelection(world);
	}
	return { scene: scene ? sourceId(scene) : null, id: request.id, at };
}
