/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	ChildOf, Keyframe, KeyframeTrack, IsMask, Geometry, Group,
	AdjustmentLayer, Expanded, Animation, Effect, Paint, Shadow, Stroke, LottieSlot, Component, Live,
} from '../traits';
import { store } from '../world/store';
import { isSequence } from './predicates';
import { sortByItemIndex } from '../utils/sort';

import type { Entity, World } from 'koota';

export type TimelineNodeKind =
	| 'geometry'
	| 'sub-item'
	| 'keyframe-track'
	| 'effect'
	| 'paint'
	| 'stroke'
	| 'shadow'
	| 'animation'
	| 'lottie-slot'
	| 'component'
	| 'live';

/**
 * How much of the document the timeline indexes.
 *
 * `clips` is the classic view: what plays, plus the keyframe tracks under it.
 * `animation` adds preset animations, so everything that moves has a row.
 * `everything` adds the static decoration too — effects, paints, strokes,
 * shadows — which makes the timeline a complete index of the source rather
 * than a summary of it.
 */
export type TimelineDetail = 'clips' | 'animation' | 'everything';

/** Which kinds a detail level admits as rows of their own. */
function admits(detail: TimelineDetail, kind: TimelineNodeKind): boolean {
	switch (kind) {
		case 'geometry':
		case 'keyframe-track':
		// A component row stands for clips that would be shown anyway; hiding
		// it would scatter them, not simplify the view.
		case 'component':
			return true;
		case 'animation':
			return detail !== 'clips';
		case 'effect':
		case 'paint':
		case 'stroke':
		case 'shadow':
		case 'lottie-slot':
			return detail === 'everything';
		// Motion the timeline cannot otherwise show at all. Hiding it in the
		// clips view is what made a moving clip look static; it belongs
		// wherever animation does.
		case 'live':
			return detail !== 'clips';
		case 'sub-item':
			// An entity with no kind of its own is scaffolding — a gradient's
			// container, a text range. It earns a row only by holding tracks,
			// which `expandable` decides separately.
			return false;
	}
}

/** The row kind an entity earns from the traits it carries. */
function subItemKind(entity: Entity): TimelineNodeKind {
	if (entity.has(Animation)) return 'animation';
	if (entity.has(Effect)) return 'effect';
	if (entity.has(Stroke)) return 'stroke';
	if (entity.has(Shadow)) return 'shadow';
	if (entity.has(Paint)) return 'paint';
	if (entity.has(LottieSlot)) return 'lottie-slot';
	return 'sub-item';
}

export type TimelineNode = {
	entity: Entity;
	kind: TimelineNodeKind;
	/** What a `component` row is called; absent on every other kind. */
	name?: string;
	expanded: boolean;
	expandable: boolean;
	children: TimelineNode[];
};

export type TimelineIndexValue = {
	root: Entity | null;
	layers: TimelineNode[];
};

export function buildTimelineLayers(
	world: World,
	parent: Entity,
	detail: TimelineDetail = 'clips',
): TimelineNode[] {
	const sequence = isSequence(parent);

	const tracks: Entity[] = [];
	const geoms: Entity[] = [];
	const masks: Entity[] = [];
	const subitems: Entity[] = [];

	for (const child of world.query(ChildOf(parent))) {
		if (child.has(Keyframe)) continue;
		// Inside a sequence the clips are drawn inline, so only the ones with
		// motion earn a row of their own — unless the caller asked to see
		// everything, where the point is that nothing is left out.
		if (sequence && detail !== 'everything' && !hasKeyframes(world, child)) continue;

		if (child.has(KeyframeTrack)) {
			tracks.push(child);
		} else if (child.has(IsMask)) {
			masks.push(child);
		} else if (child.has(Geometry) || child.has(Group) || child.has(AdjustmentLayer)) {
			geoms.push(child);
		} else {
			subitems.push(child);
		}
	}

	tracks.sort(sortByItemIndex).reverse();
	geoms.sort(sortByItemIndex).reverse();
	masks.sort(sortByItemIndex).reverse();
	subitems.sort(sortByItemIndex).reverse();

	const nodes: TimelineNode[] = [];

	for (const track of tracks) {
		nodes.push({
			entity: track,
			kind: 'keyframe-track',
			expanded: false,
			expandable: false,
			children: [],
		});
	}

	for (const subitem of subitems) {
		const kind = subItemKind(subitem);
		const node = buildNode(world, subitem, kind, detail);
		// A sub-item is worth a row when the detail level admits its kind, or
		// when it holds keyframe tracks that would otherwise have nowhere to
		// hang. Below `everything`, a plain container is neither.
		if (admits(detail, kind) || node.expandable) {
			nodes.push(node);
		}
	}

	for (const group of groupByComponent(world, geoms)) {
		if (group.name === null) {
			for (const geom of group.entities) nodes.push(buildNode(world, geom, 'geometry', detail));
			continue;
		}
		nodes.push({
			// The row stands for the component, and the first element it
			// produced is what it is addressed by: selecting the row selects
			// something real, and the row disappears with its contents.
			entity: group.entities[0]!,
			kind: 'component',
			name: group.name,
			expanded: group.entities.some((entity) => entity.has(Expanded)),
			expandable: true,
			children: group.entities.map((entity) => buildNode(world, entity, 'geometry', detail)),
		});
	}

	for (const mask of masks) {
		nodes.push(buildNode(world, mask, 'geometry', detail));
	}

	return nodes;
}

/**
 * Gather runs of siblings that came from the same component.
 *
 * Runs rather than a grouping by name: order on the timeline is the order in
 * the file, and pulling apart elements that sit between two uses of a
 * component to put them together would move rows away from where they were
 * written. Elements from no component pass through as a run of their own.
 *
 * Two adjacent uses of the same component read as one group — the stamp names
 * a definition, not a call (see `COMPONENT_ATTR`). It costs a row heading,
 * never an edit: each element still writes to its own source.
 */
function groupByComponent(
	world: World,
	entities: readonly Entity[],
): Array<{ name: string | null; entities: Entity[] }> {
	const runs: Array<{ name: string | null; entities: Entity[] }> = [];

	for (const entity of entities) {
		const name = entity.has(Component) ? store(world, Component).name[entity.id()] || null : null;
		const last = runs.at(-1);
		if (last && last.name === name) {
			last.entities.push(entity);
		} else {
			runs.push({ name, entities: [entity] });
		}
	}

	return runs;
}

/**
 * Build one row node. Expanded nodes get their subtree; collapsed ones stay
 * empty and only probe whether a subtree exists.
 */
function buildNode(
	world: World,
	entity: Entity,
	kind: TimelineNodeKind,
	detail: TimelineDetail,
): TimelineNode {
	if (!entity.has(Expanded)) {
		return {
			entity,
			kind,
			expanded: false,
			expandable: isExpandable(world, entity, detail),
			children: [],
		};
	}

	const children = liveRow(world, entity, detail).concat(buildTimelineLayers(world, entity, detail));
	return {
		entity,
		kind,
		expanded: true,
		expandable: children.length > 0,
		children,
	};
}

/**
 * The row for props this element gets from code, if it has any.
 *
 * It hangs under the element like a keyframe track does, because that is what
 * it stands in for: motion that exists, drives the canvas, and has no track.
 */
function liveRow(world: World, entity: Entity, detail: TimelineDetail): TimelineNode[] {
	if (!entity.has(Live) || !admits(detail, 'live')) return [];
	const props = store(world, Live).props[entity.id()];
	if (!props) return [];
	return [{ entity, kind: 'live', name: props, expanded: false, expandable: false, children: [] }];
}

/**
 * Early-exit probe: check if a layer could be expanded.
 */
function isExpandable(world: World, parent: Entity, detail: TimelineDetail = 'clips'): boolean {
	if (liveRow(world, parent, detail).length) return true;
	const sequence = isSequence(parent);

	for (const child of world.query(ChildOf(parent))) {
		if (child.has(Keyframe)) continue;
		if (sequence && detail !== 'everything' && !hasKeyframes(world, child)) continue;
		if (
			child.has(IsMask) ||
			child.has(Geometry) ||
			child.has(Group) ||
			child.has(AdjustmentLayer) ||
			child.has(KeyframeTrack) ||
			admits(detail, subItemKind(child)) ||
			isExpandable(world, child, detail)
		) {
			return true;
		}
	}

	return false;
}

/**
 * Deep probe: does the subtree contain a live KeyframeTrack? Tracks are
 * deleted with their last keyframe, so track presence implies keyframes.
 */
function hasKeyframes(world: World, entity: Entity): boolean {
	for (const child of world.query(ChildOf(entity))) {
		if (child.has(KeyframeTrack)) return true;
		if (hasKeyframes(world, child)) return true;
	}

	return false;
}
