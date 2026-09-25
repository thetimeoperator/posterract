/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The shapes the Component tool draws and the Shape picker turns one into.
// A rectangle and an ellipse are elements of their own and follow their box;
// the rest are `<polygon>`s whose points are worked out for the box they are
// drawn in, and scaled with it when it is resized (see `resizeNode`).

import { Ellipse, Polygon, Rect, SolidPaint, authoredElement } from '@posterract/video-reconciler';
import { Computed, Polygon as PolygonTrait, Size, store as traitStore } from '@posterract/video-runtime';
import { createStoredSignal } from '@/lib/store';
import { store } from '@/init';

import { getDocumentEditor } from './editor';

import type { Entity, World } from 'koota';

export type ShapeKind = 'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'pentagon' | 'hexagon' | 'star' | 'arrow';

type Corner = readonly [x: number, y: number];

export interface Shape {
	kind: ShapeKind;
	label: string;
	icon: string;
	/** A polygon's corners, fitted to a unit box; none for the two that are elements of their own. */
	outline?: readonly Corner[];
}

/** The corners of a regular figure around a circle, starting at `from` degrees, fitted to a unit box. */
function around(count: number, from: number, radius: (index: number) => number = () => 1): Corner[] {
	const corners = Array.from({ length: count }, (_, index): Corner => {
		const angle = ((from + (index * 360) / count) * Math.PI) / 180;
		return [Math.cos(angle) * radius(index), Math.sin(angle) * radius(index)];
	});
	const xs = corners.map(([x]) => x);
	const ys = corners.map(([, y]) => y);
	const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
	const [spanX, spanY] = [Math.max(...xs) - minX, Math.max(...ys) - minY];
	return corners.map(([x, y]) => [(x - minX) / spanX, (y - minY) / spanY]);
}

/** Inner corners of a five-pointed star, as a fraction of the outer ones: a pentagram's. */
const STAR_INNER = 0.382;

export const SHAPES: readonly Shape[] = [
	{ kind: 'rectangle', label: 'Rectangle', icon: 'tool.rectangle' },
	{ kind: 'ellipse', label: 'Ellipse', icon: 'tool.ellipse' },
	{ kind: 'triangle', label: 'Triangle', icon: 'tool.polygon', outline: [[0.5, 0], [1, 1], [0, 1]] },
	{ kind: 'diamond', label: 'Diamond', icon: 'tool.diamond', outline: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] },
	{ kind: 'pentagon', label: 'Pentagon', icon: 'tool.pentagon', outline: around(5, -90) },
	{ kind: 'hexagon', label: 'Hexagon', icon: 'tool.hexagon', outline: around(6, 0) },
	{ kind: 'star', label: 'Star', icon: 'tool.star', outline: around(10, -90, (index) => (index % 2 ? STAR_INNER : 1)) },
	{
		kind: 'arrow', label: 'Arrow', icon: 'tool.arrow',
		outline: [[0, 0.28], [0.58, 0.28], [0.58, 0], [1, 0.5], [0.58, 1], [0.58, 0.72], [0, 0.72]],
	},
];

export const shapeOfKind = (kind: ShapeKind): Shape => SHAPES.find((shape) => shape.kind === kind) ?? SHAPES[0]!;

/** The shape the Component tool draws next; the last one picked, across projects. */
export const [drawnShape, setDrawnShape] = createStoredSignal<ShapeKind>(
	store.define<ShapeKind>('canvas.drawnShape', 'rectangle'),
);

const round = (value: number): number => Math.round(value * 10) / 10;

/** A polygon shape's `points` for a `width`×`height` box. */
export function pointsFor(kind: ShapeKind, width: number, height: number): string {
	const outline = shapeOfKind(kind).outline ?? [];
	return outline.map(([x, y]) => `${round(x * width)},${round(y * height)}`).join(' ');
}

function parsePoints(points: string): Corner[] {
	const numbers = points.trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
	const corners: Corner[] = [];
	for (let index = 0; index + 1 < numbers.length; index += 2) corners.push([numbers[index]!, numbers[index + 1]!]);
	return corners;
}

/** `points` stretched by `scaleX` and `scaleY` about the element's own origin. */
export function scalePoints(points: string, scaleX: number, scaleY: number): string {
	return parsePoints(points).map(([x, y]) => `${round(x * scaleX)},${round(y * scaleY)}`).join(' ');
}

/** The element a shape is drawn as, with a solid fill of `color`. */
export function ShapeElement(props: {
	kind: ShapeKind; name: string; x: number; y: number; width: number; height: number; color: string;
}) {
	const box = { name: props.name, x: props.x, y: props.y, width: props.width, height: props.height };
	if (props.kind === 'rectangle') return <Rect {...box}><SolidPaint color={props.color} /></Rect>;
	if (props.kind === 'ellipse') return <Ellipse {...box}><SolidPaint color={props.color} /></Ellipse>;
	return (
		<Polygon {...box} points={pointsFor(props.kind, props.width, props.height)}>
			<SolidPaint color={props.color} />
		</Polygon>
	);
}

/** The element tags a shape can be turned into another from. */
const SHAPE_TAGS = new Set(['rect', 'ellipse', 'polygon']);

/** Whether `entity` is an element the Shape picker can turn into another shape. */
export function isReshapeable(entity: Entity): boolean {
	return SHAPE_TAGS.has(authoredElement(entity)?.tag ?? '');
}

/** The box `entity` is drawn in: its own size, else what it measures. */
function boxOf(entity: Entity): { width: number; height: number } {
	const size = entity.get(Size);
	const computed = entity.get(Computed);
	return { width: size?.width || computed?.width || 100, height: size?.height || computed?.height || 100 };
}

/**
 * Which shape `entity` is: a rectangle or an ellipse by its element, a polygon
 * by whether its corners are one of the shapes' (fitted to its box). Null for
 * a polygon of someone's own making.
 */
export function shapeKindOf(world: World, entity: Entity): ShapeKind | null {
	const tag = authoredElement(entity)?.tag;
	if (tag === 'rect') return 'rectangle';
	if (tag === 'ellipse') return 'ellipse';
	if (tag !== 'polygon') return null;

	const corners = parsePoints(traitStore(world, PolygonTrait).points[entity.id()] ?? '');
	if (!corners.length) return null;
	const xs = corners.map(([x]) => x);
	const ys = corners.map(([, y]) => y);
	const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
	const [spanX, spanY] = [Math.max(...xs) - minX || 1, Math.max(...ys) - minY || 1];
	const fitted = corners.map(([x, y]) => [(x - minX) / spanX, (y - minY) / spanY] as const);

	const match = SHAPES.find(({ outline }) => outline?.length === fitted.length && outline.every(([x, y], index) => (
		Math.abs(x - fitted[index]![0]) < 0.02 && Math.abs(y - fitted[index]![1]) < 0.02
	)));
	return match?.kind ?? null;
}

/** Props that belong to one kind of figure and mean nothing on the others. */
const FIGURE_PROPS = ['points', 'd', 'morphTo', 'morph', 'radius'] as const;
const TRIM_PROPS = ['trimStart', 'trimEnd', 'trimOffset'] as const;

/**
 * Turns `entity` into `kind`, keeping everything else about it: its box, its
 * timing, its fills, strokes and animations. Between two polygon shapes that
 * is a new outline; otherwise the element is rewritten as the other one (see
 * `DocumentEditor.retag`). Returns the element the shape now is.
 */
export function changeShape(world: World, entity: Entity, kind: ShapeKind): Entity | null {
	const editor = getDocumentEditor(world);
	const tag = authoredElement(entity)?.tag;
	const { width, height } = boxOf(entity);
	const target = kind === 'rectangle' ? 'rect' : kind === 'ellipse' ? 'ellipse' : 'polygon';

	if (tag === target) {
		if (target === 'polygon') editor.editProperty(entity, 'points', pointsFor(kind, width, height));
		return entity;
	}

	return editor.retag(entity, target, (props) => {
		for (const name of FIGURE_PROPS) delete props[name];
		// A rect has no trim; the vectors all do.
		if (target === 'rect') for (const name of TRIM_PROPS) delete props[name];
		if (target === 'polygon') props.points = pointsFor(kind, width, height);
	});
}
