import { Animation, AnimationPhase, Computed, Selected, findClosestParentGeometry, getLocalWindow, getStaggerOffset } from '@posterract/video-runtime';
import type { TimelineNode } from '@posterract/video-runtime';
import type { Entity, World } from 'koota';
import { getDocumentEditor } from '../../editor';
import { getRowTransform } from '../layout';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';
import { getResolution, getViewport } from '../view';
import { truncateText } from '../text';
import { liveCurve } from '../../live-history';

const CURVE_COLORS = ['#65ff9a', '#7cf7ff', '#ffc15e', '#ff7a6b', '#c9d4ff'];

/**
 * One line per live prop across the row, each scaled to its own range, from
 * the values recorded as the editor showed each frame (see live-history).
 */
function drawLiveCurves(ctx: CanvasRenderingContext2D, node: TimelineNode, resolution: number, left: number, right: number, height: number): void {
	const names = (node.name ?? '').split(',').map((name) => name.trim()).filter(Boolean);
	names.forEach((name, index) => {
		const curve = liveCurve(node.entity, name);
		if (curve.length < 2) return;
		let min = Infinity;
		let max = -Infinity;
		for (const [, value] of curve) {
			if (value < min) min = value;
			if (value > max) max = value;
		}
		const span = max - min || 1;
		ctx.save();
		ctx.beginPath();
		ctx.rect(left, 3, right - left, height);
		ctx.clip();
		ctx.strokeStyle = CURVE_COLORS[index % CURVE_COLORS.length]!;
		ctx.globalAlpha = 0.8;
		ctx.lineWidth = 1.25;
		ctx.beginPath();
		let started = false;
		let previous = -Infinity;
		for (const [frame, value] of curve) {
			const x = frame * resolution;
			const y = 3 + height - 2 - ((value - min) / span) * (height - 4);
			// A gap in what has been seen breaks the line rather than bridging it.
			if (!started || frame - previous > 2) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
			started = true;
			previous = frame;
		}
		ctx.stroke();
		ctx.restore();
	});
}

/** Parts share their layer's clock, but never use media trim gestures. */
export function renderPart(world: World, scene: Entity, surface: TimelineSurfaceState, node: TimelineNode, row: RowCursor): void {
	const { ctx, pointer } = surface;
	const owner = node.kind === 'live' || node.kind === 'component' ? node.entity : findClosestParentGeometry(node.entity);
	const computed = owner?.get(Computed);
	const transform = getRowTransform(world, scene, row.top);
	if (!ctx || !pointer || !owner || !computed || !transform) return;
	let start = computed.start;
	let end = computed.end;
	let label = node.name || node.kind.replace('-', ' ');
	// A knob row is named by its path; the bar says the knob.
	if (node.kind === 'knob') label = label.split('.').pop() ?? label;
	const animation = node.entity.get(Animation);
	if (animation) {
		const source = getLocalWindow(owner);
		const rate = computed.playbackRate || 1;
		const offset = getStaggerOffset(owner);
		const out = animation.phase === AnimationPhase.OUT;
		const local = out ? source.out - animation.duration - animation.delay : source.in + animation.delay;
		start = Math.max(computed.start, computed.origin + (local + offset) / rate);
		end = Math.min(computed.end, computed.origin + (local + offset + animation.duration) / rate);
		label = out ? 'Exit' : 'Entrance';
	}
	const resolution = getResolution(world, scene);
	const [viewportLeft, viewportRight] = getViewport(world, scene, surface.layout.width);
	const left = Math.max(viewportLeft, start * resolution);
	const right = Math.min(viewportRight, end * resolution);
	if (right <= left) return;
	ctx.save();
	ctx.setTransform(transform);
	ctx.globalAlpha = 1;
	const height = Math.max(12, row.height - 6);
	const selected = node.entity.has(Selected);
	ctx.beginPath();
	ctx.roundRect(left, 3, right - left, height, 4);
	ctx.fillStyle = animation ? 'rgba(118, 181, 255, 0.20)' : 'rgba(179, 186, 201, 0.10)';
	ctx.fill();
	ctx.strokeStyle = selected ? surface.colors.border.ring : animation ? 'rgba(118, 181, 255, 0.6)' : 'rgba(179, 186, 201, 0.22)';
	ctx.lineWidth = 1;
	ctx.stroke();
	ctx.font = '10px Inter, sans-serif';
	ctx.fillStyle = '#cbd8e9';
	ctx.textBaseline = 'middle';
	// Motion from code: draw what it did, as far as the editor has seen it.
	if (node.kind === 'live') drawLiveCurves(ctx, node, resolution, left, right, height);
	const fitted = truncateText(ctx, label, right - left - 12, ctx.font);
	if (fitted) ctx.fillText(fitted, left + 6, row.height / 2);
	pointer.scope(`part-${node.kind}-${node.entity.id()}`);
	const hit = pointer.region(left, 3, right - left, height);
	if (hit.hovering) surface.cursor = 'pointer';
	if (hit.clicked) getDocumentEditor(world)?.select([node.entity]);
	ctx.restore();
}
