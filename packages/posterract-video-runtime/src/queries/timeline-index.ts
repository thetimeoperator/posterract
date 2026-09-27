/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	ChildOf, Keyframe, KeyframeTrack, IsMask, Geometry, Group,
	AdjustmentLayer, Expanded, Animation, Effect, Paint, Shadow, Stroke, LottieSlot, Component, Live,
	Knobs, Loop, Host, Scene, MotionBlur, Tempo, Repeater, Shader, TextAnimator,
} from '../traits';
import { isKnobPath, knobName } from '../systems/motion';
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
	| 'live'
	| 'knob'
	| 'setting'
	| 'animator';

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
		// A knob is motion waiting to happen: canvas code reads it, so it is a
		// row wherever animation is, keyframed or not.
		case 'knob':
		case 'animator':
			return detail !== 'clips';
		// How the scene is finished — its motion blur, its tempo — is part of
		// the complete index, not of the motion summary.
		case 'setting':
			return detail === 'everything';
		case 'sub-item':
			// An entity with no kind of its own is scaffolding — a gradient's
			// container, a text range. It earns a row only by holding tracks,
			// which `expandable` decides separately.
			return false;
	}
}

/** The row kind an entity earns from the traits it carries. */
function subItemKind(entity: Entity): TimelineNodeKind {
	if (entity.has(TextAnimator)) return 'animator';
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
		if (sequence && detail !== 'everything' && !hasMotion(world, child, detail)) continue;

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

	if (parent.has(Scene) && admits(detail, 'setting')) nodes.push(...settingRows(parent));

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
		if (group.loop) {
			// Copies a loop in the code made: one row for all of them, opened
			// to reach any one.
			nodes.push({
				entity: group.entities[0]!,
				kind: 'component',
				name: group.name,
				expanded: group.entities.some((entity) => entity.has(Expanded)),
				expandable: true,
				children: group.entities.map((entity) => buildNode(world, entity, 'geometry', detail)),
			});
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
): Array<{ name: string | null; entities: Entity[]; loop?: boolean }> {
	const runs: Array<{ name: string | null; entities: Entity[]; loop?: string }> = [];

	for (const entity of entities) {
		// Iterations of one loop in the code group first: forty dots made by a
		// `.map` are one thing on the timeline, not forty rows.
		const loop = entity.has(Loop) ? store(world, Loop).value[entity.id()] || undefined : undefined;
		const name = entity.has(Component) ? store(world, Component).name[entity.id()] || null : null;
		const last = runs.at(-1);
		if (loop !== undefined) {
			if (last && last.loop === loop) {
				last.entities.push(entity);
			} else {
				runs.push({ name, entities: [entity], loop });
			}
			continue;
		}
		if (last && last.loop === undefined && last.name === name) {
			last.entities.push(entity);
		} else {
			runs.push({ name, entities: [entity] });
		}
	}

	// A loop that made one element is just that element.
	return runs.map((run) => {
		if (run.loop === undefined) return { name: run.name, entities: run.entities };
		if (run.entities.length < 2) return { name: run.name, entities: run.entities };
		const tag = run.entities[0]!.get(Host)?.tag || 'element';
		return { name: `${run.entities.length} × ${tag} · made by code`, entities: run.entities, loop: true };
	});
}

/** The scene's own settings as rows: motion blur and tempo, when it has them. */
function settingRows(scene: Entity): TimelineNode[] {
	const rows: TimelineNode[] = [];
	const blur = scene.get(MotionBlur);
	if (blur) {
		rows.push({ entity: scene, kind: 'setting', name: `Motion blur · ${Math.round(blur.shutter)}° · ${blur.samples} samples`, expanded: false, expandable: false, children: [] });
	}
	const tempo = scene.get(Tempo);
	if (tempo && tempo.bpm > 0) {
		rows.push({ entity: scene, kind: 'setting', name: `Tempo · ${tempo.bpm} BPM · ${tempo.meter}/4`, expanded: false, expandable: false, children: [] });
	}
	return rows;
}

/**
 * A row for each knob no track drives yet — a knob with a track shows as that
 * track. Numbers only: a colour knob is set in the inspector.
 */
function knobRows(world: World, entity: Entity, detail: TimelineDetail): TimelineNode[] {
	if (!entity.has(Knobs) || !admits(detail, 'knob')) return [];
	const authored = store(world, Knobs).authored[entity.id()] ?? {};
	const keyframeTrack = store(world, KeyframeTrack);
	const driven = new Set<string>();
	for (const track of world.query(KeyframeTrack, ChildOf(entity))) {
		const path = keyframeTrack.property[track.id()] ?? '';
		if (isKnobPath(path)) driven.add(knobName(path));
	}
	const repeater = entity.has(Repeater);
	const prefix = repeater ? '' : entity.has(Shader) ? 'uniform.' : 'knob.';
	return Object.entries(authored)
		.filter(([name, value]) => typeof value === 'number' && !driven.has(name))
		// A repeater's untouched numbers would be twenty rows of defaults; its
		// count, layout blend and camera are what it is animated by.
		.filter(([name]) => !repeater || REPEATER_ROWS.has(name))
		.map(([name]) => ({ entity, kind: 'knob' as const, name: `${prefix}${name}`, expanded: false, expandable: false, children: [] }));
}

/** The repeater numbers that get a row of their own before they are keyframed. */
const REPEATER_ROWS = new Set(['count', 'morph', 'ripplePhase', 'tiltX', 'tiltY', 'zoom', 'cameraZ']);

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

	const children = liveRow(world, entity, detail)
		.concat(knobRows(world, entity, detail))
		.concat(paintKnobRows(world, entity, detail))
		.concat(buildTimelineLayers(world, entity, detail));
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

/** Knob rows of the shader paints directly on `entity`: their uniforms. */
function paintKnobRows(world: World, entity: Entity, detail: TimelineDetail): TimelineNode[] {
	if (!admits(detail, 'knob')) return [];
	const rows: TimelineNode[] = [];
	for (const paint of world.query(ChildOf(entity), Paint, Shader)) rows.push(...knobRows(world, paint, detail));
	return rows;
}

/**
 * Early-exit probe: check if a layer could be expanded.
 */
function isExpandable(world: World, parent: Entity, detail: TimelineDetail = 'clips'): boolean {
	if (liveRow(world, parent, detail).length) return true;
	if (knobRows(world, parent, detail).length || paintKnobRows(world, parent, detail).length) return true;
	const sequence = isSequence(parent);

	for (const child of world.query(ChildOf(parent))) {
		if (child.has(Keyframe)) continue;
		if (sequence && detail !== 'everything' && !hasMotion(world, child, detail)) continue;
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
 * Include a sequence child when it contains motion admitted by this view.
 * Presets and live props need rows even when they have no keyframe tracks.
 */
function hasMotion(world: World, entity: Entity, detail: TimelineDetail): boolean {
	if (entity.has(KeyframeTrack)) return true;
	if (detail !== 'clips' && (entity.has(Animation) || entity.has(Live))) return true;
	for (const child of world.query(ChildOf(entity))) {
		if (hasMotion(world, child, detail)) return true;
	}

	return false;
}
