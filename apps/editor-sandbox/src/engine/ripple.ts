/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Ripple delete: remove a clip and close the hole it leaves.
 *
 * An ordinary delete leaves a gap, which is right when the timeline is a
 * layout and wrong when it is a cut. Ripple pulls every later sibling back by
 * the removed span, so the rest of the edit keeps its rhythm. The removal and
 * every shift are pushed in one synchronous burst, so the edit history takes
 * them as a single step and one undo puts the whole thing back.
 */
import {
	ChildOf, Computed, FrameRate, Selected,
	getActiveEntity, getParentEntity, store,
} from '@posterract/video-runtime';

import { getDocumentEditor } from './editor';

import type { Entity, World } from 'koota';

type Span = { start: number; end: number };

function spanOf(world: World, entity: Entity): Span | null {
	const computed = store(world, Computed);
	const eid = entity.id();
	const start = computed.start[eid];
	const end = computed.end[eid];
	return start === undefined || end === undefined ? null : { start, end };
}

/**
 * Delete the selection and pull later siblings back over the gap.
 *
 * Only siblings that begin at or after the removed clip's end move: a clip
 * that overlaps it was never in the same rhythm, and dragging it would be a
 * guess about intent rather than a ripple.
 */
export function rippleDeleteSelection(world: World): void {
	const selected = [...world.query(Selected)];
	if (!selected.length) return;

	const scene = getActiveEntity(world);
	if (!scene) return;

	const editor = getDocumentEditor(world);

	// Group by parent: a ripple is a statement about one track's ordering,
	// and a multi-parent selection is several independent ripples.
	const byParent = new Map<Entity, Entity[]>();
	for (const entity of selected) {
		const parent = getParentEntity(entity);
		if (!parent) continue;
		byParent.set(parent, [...(byParent.get(parent) ?? []), entity]);
	}

	const shifts: Array<{ entity: Entity; span: Span; by: number }> = [];
	for (const [parent, removed] of byParent) {
		const spans = removed.map((entity) => spanOf(world, entity)).filter((span): span is Span => span !== null);
		if (!spans.length) continue;
		const gapStart = Math.min(...spans.map((span) => span.start));
		const gapEnd = Math.max(...spans.map((span) => span.end));
		const by = gapEnd - gapStart;
		if (by <= 0) continue;

		const removedSet = new Set(removed);
		for (const sibling of siblingsOf(world, parent)) {
			if (removedSet.has(sibling)) continue;
			const span = spanOf(world, sibling);
			if (!span || span.start < gapEnd) continue;
			shifts.push({ entity: sibling, span, by });
		}
	}

	editor.remove(selected);

	const rate = worldFrameRate(world);
	for (const { entity, span, by } of shifts) {
		editor.editProperty(entity, 'start', (span.start - by) / rate);
		editor.editProperty(entity, 'end', (span.end - by) / rate);
	}
}

/** The clips sharing a parent — the track a ripple closes up. */
function siblingsOf(world: World, parent: Entity): Entity[] {
	return [...world.query(ChildOf(parent))];
}

function worldFrameRate(world: World): number {
	return (world.get(FrameRate)?.value ?? 30);
}
