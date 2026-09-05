/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	AdjustmentLayer,
	ChildOf,
	Computed,
	Geometry,
	Group,
	Hovering,
	Sequential,
	buildTimelineLayers,
	store,
} from '@posterract/video-runtime';
import { Or } from 'koota';
import { timelineDetail } from '../detail';

import { getNodeHeight, getRowTransform, getSubtreeHeight } from '../layout';
import { getResolution, getViewport, pixelsToFrames } from '../view';
import { isDragging } from '../drag';
import { getClipAlpha, renderClip } from './clip';
import { renderKeyframeTrack } from './keyframes';

import type { Entity, World } from 'koota';
import type { TimelineNode } from '@posterract/video-runtime';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

// A little either side of the viewport, so a clip does not pop in at the
// moment its edge crosses the boundary.
const VIEWPORT_PADDING = 10;

/**
 * The rows of the scene on show, top to bottom. The tree comes from the
 * runtime; what happens here is the geometry — how tall each row is, where
 * the walk has got to, and which rows are near enough to the viewport to be
 * worth drawing at all.
 */
export function renderLayers(world: World, scene: Entity, surface: TimelineSurfaceState): void {
	const ctx = surface.ctx;
	if (!ctx) return;

	const resolution = getResolution(world, scene);
	const [left, right] = getViewport(world, scene, surface.layout.width);
	const minFrame = pixelsToFrames(left - VIEWPORT_PADDING, resolution);
	const maxFrame = pixelsToFrames(right + VIEWPORT_PADDING, resolution);

	const computed = store(world, Computed);
	const row: RowCursor = { top: 0, height: 0 };

	ctx.save();

	const walk = (nodes: TimelineNode[], parent: Entity | null): void => {
		for (const node of nodes) {
			if (node.kind === 'keyframe-track') {
				row.height = getNodeHeight(node);
				renderKeyframeTrack(world, scene, surface, node.entity, row);
				row.top += row.height;
				continue;
			}

			// A sub-item is a label in the DOM column and nothing on the
			// canvas; what hangs under it is what matters here.
			if (node.kind === 'sub-item') {
				row.top += getNodeHeight(node);
				walk(node.children, parent);
				continue;
			}

			const start = computed.start[node.entity.id()] ?? 0;
			const end = computed.end[node.entity.id()] ?? 0;

			// Off screen in time: the whole subtree can be skipped, since an
			// expanded child is drawn within its parent's row.
			if (end < minFrame || start > maxFrame) {
				row.top += getSubtreeHeight(node);
				continue;
			}

			// The children of a sequence are drawn in the sequence's own row
			// (see `renderRow`), so they are not rows of their own.
			if (parent === null || !parent.has(Sequential)) {
				renderRow(world, scene, surface, node, row);
			}

			row.top += getNodeHeight(node);
			walk(node.children, node.entity);
		}
	};

	// The canvas draws the same index the DOM column lists, so both sides
	// agree about which rows exist at the current detail level.
	walk(buildTimelineLayers(world, scene, timelineDetail()), null);

	ctx.restore();
}

/**
 * One row. A clip is drawn as itself; a sequence is drawn as its children
 * side by side along the row, since a sequence has no time of its own to
 * show and its point is that its children share one line.
 */
function renderRow(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	node: TimelineNode,
	row: RowCursor,
): void {
	const ctx = surface.ctx!;

	const transform = getRowTransform(world, scene, row.top);
	if (!transform) return;

	ctx.setTransform(transform);

	row.height = getNodeHeight(node);
	ctx.globalAlpha = getClipAlpha(node.entity);

	// Each row is a track: a darker strip of glass with a breath of space
	// above and below it, instead of a gridline.
	{
		const [left, right] = getViewport(world, scene, surface.layout.width);
		const inset = Math.min(2, row.height / 8);
		ctx.save();
		ctx.beginPath();
		ctx.roundRect(left, inset, right - left, row.height - inset * 2, Math.min(8, row.height / 2 - inset));
		ctx.fillStyle = node.entity.has(Hovering) ? surface.colors.background.accent : surface.colors.background.muted;
		ctx.fill();
		ctx.restore();
	}

	if (!node.entity.has(Sequential)) {
		renderClip(world, scene, surface, node.entity, row);
		return;
	}

	// A clip being dragged is drawn after the ones it is passing over, so it
	// stays on top of them for as long as it is moving.
	const children = [...world.query(Or(Geometry, Group, AdjustmentLayer), ChildOf(node.entity))];

	for (const child of children) {
		if (!isDragging(child)) renderClip(world, scene, surface, child, row);
	}
	for (const child of children) {
		if (isDragging(child)) renderClip(world, scene, surface, child, row);
	}
}
