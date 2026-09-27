/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Text layout, measurement, and canvas rendering (was engine/utils/text.ts).

import { store } from '../world/store';
import {
	COMPOSITE_OPERATIONS, PaintType, FontStyle,
	TextAlign, TextBaseline, TextCase, TextDecorationType,
} from '../constants';
import {
	Size, Hidden, Paint, Color, Blur, Offset, Opacity, BlendMode,
	Chars, TextStyle, TextRange, TextCache, Cache, Computed, Camera,
	RenderSurface, Root, ChildOf, KeyframeTrack,
	TextAnimator, TextAnimatorUnit, TextAnimatorOrder, TextPath, TextPathAlign,
} from '../traits';
import { sampleTrackAt } from '../systems/motion';
import { textPathSubPaths } from '../queries/vector';
import { placeGlyphsOnPath } from './text-path';
import { boundsOf } from './vector';
import { getStaggerOffset } from './time';
import { clamp } from '../math/common';
import { colorToHex } from './color';
import { applyStrokeStyle, findWidestStroke } from './stroke';
import { createLinearGradient, createRadialGradient } from '../systems/gradients';

import type { Entity, World } from 'koota';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type TokenOptions = {
	/**
	 * Defines the characters to render
	 */
	chars: string;
	/**
	 * Defines the X offset of the token to the left of the line
	 */
	offset: number;
	/**
	 * Defines the metrics of the token
	 */
	metrics: TextMetrics;
	/**
	 * Defines the style of the token (TextRange sub-entities)
	 */
	ranges: Entity[];
}

export type Line = {
	offsetX: number;
	offsetY: number;
	baseline: number;
	height: number;
};

type RenderSplit = {
	words: string[];
	ranges: Entity[];
};

/** Global offscreen canvas used solely for text measurement. */
let measureCanvas: OffscreenCanvas | null = null;
let measureCtx: OffscreenCanvasRenderingContext2D | null = null;

function getMeasureCtx(): OffscreenCanvasRenderingContext2D {
	if (!measureCtx) {
		measureCanvas = new OffscreenCanvas(1, 1);
		measureCtx = measureCanvas.getContext('2d', { willReadFrequently: true, alpha: true })!;
	}
	return measureCtx;
}

export class Token {
	public offset: number;
	public metrics: TextMetrics;
	public ranges: Entity[];
	public chars: string;
	public width: number;
	public height: number;
	public line = { offsetX: 0, offsetY: 0, baseline: 0, height: 0 };

	constructor(options: TokenOptions) {
		this.offset = options.offset;
		this.metrics = options.metrics;
		this.ranges = options.ranges;
		this.width = options.metrics.width;
		this.height = options.metrics.fontBoundingBoxAscent + options.metrics.fontBoundingBoxDescent;
		this.chars = options.chars;
	}

	public get x(): number {
		return (this.offset + this.line.offsetX) | 0;
	}

	public get y(): number {
		return (this.line.offsetY + this.line.baseline) | 0;
	}

	public get left(): number {
		return (
			this.offset +
			this.line.offsetX -
			this.metrics.actualBoundingBoxLeft
		) | 0;
	}

	public get right(): number {
		return (
			this.offset +
			this.line.offsetX +
			this.metrics.actualBoundingBoxRight
		) | 0;
	}

	public get top(): number {
		return (
			this.line.offsetY +
			this.line.baseline -
			this.metrics.actualBoundingBoxAscent
		) | 0
	}

	public get bottom(): number {
		return (
			this.line.offsetY +
			this.line.baseline +
			this.metrics.actualBoundingBoxDescent
		) | 0
	}

	public setLine(line: Line) {
		this.line = { ...line };
	}
}

function applyFont(ctx: Ctx, world: World, entity: Entity, ranges: Entity[]) {
	const size = getFontSize(world, entity, ranges);
	const family = getFontFamily(world, entity, ranges);
	const weight = getFontWeight(world, entity, ranges);
	const style = getFontStyle(world, entity, ranges);
	const baseline = getTextBaseline(world, entity, ranges);
	const spacing = getLetterSpacing(world, entity, ranges);

	const mappedStyle = FontStyle[style]!.toLowerCase();
	const mappedBaseline = TextBaseline[baseline]!.toLowerCase() as CanvasTextBaseline;

	ctx.font = `${mappedStyle} ${weight.toLowerCase()} ${size}px ${family}`.trim();
	ctx.textBaseline = mappedBaseline;
	ctx.letterSpacing = `${spacing}px`;
}

function shapeTokens(world: World, entity: Entity): void {
	const computed = store(world, Computed);
	const textStyle = store(world, TextStyle);
	const eid = entity.id();
	const lines = store(world, TextCache).tokens[eid];
	const leading = textStyle.leading[eid] ?? 1;
	const textAlign = textStyle.textAlign[eid] ?? TextAlign.LEFT;
	const textBaseline = textStyle.textBaseline[eid] ?? TextBaseline.TOP;
	if (!lines) return;

	// Measure each line's width by summing word widths and spaces
	const lineWidths: number[] = lines.map(line => line.reduce((acc, word) => acc + word.width, 0));
	const lineHeights: number[] = lines.map(line => Math.max(...line.map(word => word.height)));

	// Find the maximum line width
	const maxLineWidth = Math.max(...lineWidths);

	// Calculate total height based on leading
	const totalHeight = lineHeights.reduce((acc, height, i) => acc + height * (i < lineHeights.length - 1 ? leading : 1), 0);

	// When Size is assigned, use Computed for positioning; otherwise set it from text dimensions
	if (!entity.has(Size) || !computed.width[eid] || !computed.height[eid]) {
		computed.width[eid] = Math.ceil(maxLineWidth);
		computed.height[eid] = Math.ceil(totalHeight);
	}

	const containerWidth = computed.width[eid]!;
	const containerHeight = computed.height[eid]!;

	// Calculate initial vertical offset based on text baseline and container height
	let offsetY = 0;
	if (textBaseline === TextBaseline.MIDDLE) {
		offsetY = (containerHeight - totalHeight) / 2;
	} else if (textBaseline === TextBaseline.BOTTOM) {
		offsetY = containerHeight - totalHeight;
	}

	// Calculate coordinates for each word
	const line = {
		offsetX: 0,
		offsetY,
		baseline: 0,
		height: 0,
	};

	for (let l = 0; l < lines.length; l++) {
		line.height = lineHeights[l]!;

		if (textAlign === TextAlign.LEFT) {
			line.offsetX = 0;
		} else if (textAlign === TextAlign.CENTER) {
			line.offsetX = (containerWidth - lineWidths[l]!) / 2;
		} else if (textAlign === TextAlign.RIGHT) {
			line.offsetX = containerWidth - lineWidths[l]!;
		}

		if (textBaseline === TextBaseline.TOP) {
			line.baseline = 0;
		} else if (textBaseline === TextBaseline.MIDDLE) {
			line.baseline = lineHeights[l]! / 2;
		} else if (textBaseline === TextBaseline.BOTTOM) {
			line.baseline = lineHeights[l]!;
		} else if (textBaseline === TextBaseline.ALPHABETIC) {
			const maxAscent = Math.max(...lines[l]!.map(word => word.metrics.fontBoundingBoxAscent));
			line.baseline = maxAscent || lineHeights[l]! * 0.75; // Fallback if no words in line
		}

		for (const word of lines[l]!) {
			word.setLine(line);
		}

		line.offsetY += lineHeights[l]! * leading;
	}
}

function tokenizeText(world: World, entity: Entity) {
	const ctx = getMeasureCtx();

	// Split text into segments based on style overrides first
	const lines: Token[][] = [[]];

	const maxWidth = store(world, Size).width[entity.id()] ?? Number.POSITIVE_INFINITY;

	let offset = 0;
	for (const { words, ranges } of createRenderSplits(world, entity)) {
		applyFont(ctx, world, entity, ranges);

		for (const word of words) {
			const splits = word.split('\n');

			for (let i = 0; i < splits.length; i++) {
				const caseValue = getTextCase(world, entity, ranges);
				const chars = transformText(splits[i]!, caseValue);

				const metrics = ctx.measureText(chars);

				// check if word is too wide for the current line but not the first word
				if (offset + metrics.width > maxWidth && offset > 0) {
					lines.push([]);
					offset = 0;
				}

				// add word to current line
				lines[lines.length - 1]!.push(new Token({ chars, ranges, metrics, offset }));
				offset += metrics.width;

				// add new line if not the last line
				if (i < splits.length - 1) {
					lines.push([]);
					offset = 0;
				}
			}
		}
	}

	if (!entity.has(TextCache)) entity.add(TextCache);
	store(world, TextCache).tokens[entity.id()] = lines;
}

/** Renders text tokens directly to the given canvas context. */
function renderTokens(ctx: Ctx, world: World, entity: Entity, plan: GlyphPlan | null = null): void {
	const eid = entity.id();
	const lines = store(world, TextCache).tokens[eid];
	if (!lines) return;
	const words = lines.flat();

	// A word is drawn whole, unless it is moving (or laid on a path) a letter at
	// a time — then each of its units is drawn at its own pose.
	const paint = (word: Token, mode: 'fill' | 'stroke') => {
		const units = plan?.units.get(word);
		if (!plan || !units) {
			if (mode === 'fill') ctx.fillText(word.chars, word.x, word.y);
			else ctx.strokeText(word.chars, word.x, word.y);
			return;
		}
		drawUnits(ctx, plan, word, units, mode);
	};

	const computed = store(world, Computed);
	const offsetStore = store(world, Offset);
	const blurStore = store(world, Blur);
	const colorStore = store(world, Color);
	const opacityStore = store(world, Opacity);
	const blendStore = store(world, BlendMode);
	const paintStore = store(world, Paint);

	const savedAlpha = ctx.globalAlpha;

	// Draw all text shadows
	{
		ctx.save();
		ctx.textAlign = 'start';
		ctx.textBaseline = 'top';

		// ctx.shadowBlur/OffsetX/OffsetY are in device-pixel space and are not
		// affected by the current transform, so scale them up to match the
		// content transform (camera * resolution).
		const camera = world.get(Root)!.get(Camera);
		const resolution = world.get(RenderSurface)?.resolution ?? 1;
		const shadowScale = (camera?.a ?? 1) * resolution;

		for (const word of words) {
			applyFont(ctx, world, entity, word.ranges);

			const shadows = getShadows(world, entity, word.ranges);

			// A stroked word's shadow is the widest stroke's silhouette.
			const widest = findWidestStroke(world, getStrokes(world, entity, word.ranges));
			if (widest !== null) {
				applyStrokeStyle(ctx, world, widest);
			}

			// Draw shadows first (if any)
			for (const shadow of shadows) {
				if (shadow.has(Hidden)) continue;
				const sid = shadow.id();

				// Recycled-id safety: optional traits only behind has().
				const hasOffset = shadow.has(Offset);
				ctx.shadowOffsetX = (hasOffset ? offsetStore.x[sid] ?? 0 : 0) * shadowScale;
				ctx.shadowOffsetY = (hasOffset ? offsetStore.y[sid] ?? 0 : 0) * shadowScale;
				ctx.shadowBlur = (shadow.has(Blur) ? blurStore.value[sid] ?? 0 : 0) * shadowScale;
				ctx.shadowColor = colorToHex(colorStore.value[sid] ?? 0x000000);
				ctx.fillStyle = colorToHex(colorStore.value[sid] ?? 0x000000);
				ctx.globalAlpha = savedAlpha * (shadow.has(Opacity) ? opacityStore.value[sid] ?? 1 : 1);

				paint(word, widest !== null ? 'stroke' : 'fill');
			}

			// Reset shadow properties if any shadows are applied
			if (shadows.length) {
				ctx.globalAlpha = savedAlpha;
				ctx.shadowColor = 'transparent';
			}
		}
		ctx.restore();
	}

	// Draw all text strokes
	{
		ctx.save();
		ctx.textAlign = 'start';
		ctx.textBaseline = 'top';

		for (const word of words) {
			const strokes = getStrokes(world, entity, word.ranges);
			if (!strokes.length) continue;

			applyFont(ctx, world, entity, word.ranges);

			const w = computed.width[eid]!;
			const h = computed.height[eid]!;

			// Draw strokes (if any)
			for (const stroke of strokes) {
				if (stroke.has(Hidden)) continue;
				const sid = stroke.id();

				// Recycled-id safety: optional traits only behind has().
				const savedCO = ctx.globalCompositeOperation;
				const blendMode = stroke.has(BlendMode) ? blendStore.value[sid] ?? 0 : 0;
				if (blendMode !== 0) {
					ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[blendMode]!;
				}
				ctx.globalAlpha = savedAlpha * (stroke.has(Opacity) ? opacityStore.value[sid] ?? 1 : 1);
				applyStrokeStyle(ctx, world, stroke);

				const paintType = paintStore.value[sid];
				if (paintType === PaintType.LINEAR_GRADIENT) {
					ctx.strokeStyle = createLinearGradient(world, stroke, ctx, w, h);
				} else if (paintType === PaintType.RADIAL_GRADIENT) {
					ctx.strokeStyle = createRadialGradient(world, stroke, ctx, w, h);
				} else {
					ctx.strokeStyle = colorToHex(colorStore.value[sid] ?? 0x000000);
				}
				paint(word, 'stroke');
				ctx.globalCompositeOperation = savedCO;
			}
		}
		ctx.restore();
	}

	// Draw all text fills
	{
		ctx.save();
		ctx.textAlign = 'start';
		ctx.textBaseline = 'top';

		for (const word of words) {
			// The geometry's own Color is an intrinsic solid fill beneath every
			// paint; a range carrying a Color replaces it over the glyphs it spans.
			const intrinsicFill = getIntrinsicColor(world, entity, word.ranges);
			const fills = getFills(world, entity, word.ranges);
			if (!fills.length && intrinsicFill === null) continue;

			applyFont(ctx, world, entity, word.ranges);

			const w = computed.width[eid]!;
			const h = computed.height[eid]!;

			const decoration = getTextDecoration(world, entity, word.ranges);
			const size = getFontSize(world, entity, word.ranges);

			if (intrinsicFill !== null) {
				ctx.globalAlpha = savedAlpha;
				ctx.fillStyle = intrinsicFill;
				paint(word, 'fill');
				if (!plan) drawDecoration(ctx, word.chars, word.x, word.y, decoration, size);
			}

			for (const fill of fills) {
				if (fill.has(Hidden)) continue;
				const fid = fill.id();

				// Store slots outlive destroyed entities and ids are recycled,
				// so an optional trait's slot is only readable behind has().
				const savedCO = ctx.globalCompositeOperation;
				const blendMode = fill.has(BlendMode) ? blendStore.value[fid] ?? 0 : 0;
				if (blendMode !== 0) {
					ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[blendMode]!;
				}
				ctx.globalAlpha = savedAlpha * (fill.has(Opacity) ? opacityStore.value[fid] ?? 1 : 1);

				const paintType = paintStore.value[fid];
				if (paintType === PaintType.LINEAR_GRADIENT) {
					ctx.fillStyle = createLinearGradient(world, fill, ctx, w, h);
				} else if (paintType === PaintType.RADIAL_GRADIENT) {
					ctx.fillStyle = createRadialGradient(world, fill, ctx, w, h);
				} else {
					ctx.fillStyle = colorToHex(colorStore.value[fid] ?? 0x000000);
				}
				paint(word, 'fill');
				if (!plan) drawDecoration(ctx, word.chars, word.x, word.y, decoration, size);
				ctx.globalCompositeOperation = savedCO;
			}
		}
		ctx.restore();
	}
}

/**
 * Lays a text out without drawing it: the half of `renderText` that decides
 * how big the text is. A text's size otherwise exists only once it has been
 * painted, so one that has not been on screen yet — it plays later, or the
 * window is hidden — has no box for anyone measuring the layout to read.
 */
export function measureText(world: World, entity: Entity): void {
	tokenizeText(world, entity);
	shapeTokens(world, entity);
	fitPathBox(world, entity);
}

/**
 * A text on a path takes the path's box, not the box its words would fill in
 * a line: that is where it is drawn, so it is what selecting, measuring and
 * `inspect` have to see.
 */
function fitPathBox(world: World, entity: Entity): void {
	if (!entity.has(TextPath)) return;
	const eid = entity.id();
	const computed = store(world, Computed);
	const subpaths = textPathSubPaths(world, entity, store(world, TextPath).d[eid] ?? '');
	const bounds = subpaths ? boundsOf(subpaths) : null;
	if (!bounds) return;
	if (entity.has(Size) && computed.width[eid] && computed.height[eid]) return;
	computed.width[eid] = Math.max(1, Math.ceil(bounds.x + bounds.width));
	computed.height[eid] = Math.max(1, Math.ceil(bounds.y + bounds.height));
}

/** Render text tokens directly to the world's render surface. */
export function renderText(world: World, entity: Entity) {
	const ctx = world.get(RenderSurface)?.ctx;
	if (!ctx) return;
	tokenizeText(world, entity);
	shapeTokens(world, entity);
	renderTokens(ctx, world, entity, planGlyphs(world, entity));
}

// ── Letters that move on their own, and text on a path ──────

/** One piece of a word drawn at its own pose: a letter, or the whole word. */
type Unit = {
	chars: string;
	/** Where it starts inside its word, px. */
	dx: number;
	advance: number;
	/** Which pose it takes (see GlyphPlan.poses). */
	pose: number;
	/** Where it sits on the path, when there is one (see GlyphPlan.placements). */
	glyph: number;
};

type Pose = { x: number; y: number; rotation: number; scaleX: number; scaleY: number; opacity: number; blur: number };

type GlyphPlan = {
	units: Map<Token, Unit[]>;
	poses: Pose[];
	placements: { x: number; y: number; angle: number; visible: boolean }[] | null;
};

const REST: Pose = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, blur: 0 };

/** A deterministic shuffle of 0..n-1, for the random order. */
function shuffledRanks(count: number): number[] {
	const order = Array.from({ length: count }, (_, i) => i);
	let state = 0x2545F491 ^ count;
	for (let i = count - 1; i > 0; i--) {
		state = (Math.imul(state ^ (state >>> 15), 0x2C1B3C6D) + 0x6D2B79F5) >>> 0;
		const j = state % (i + 1);
		[order[i], order[j]] = [order[j]!, order[i]!];
	}
	const ranks: number[] = [];
	order.forEach((unit, rank) => { ranks[unit] = rank; });
	return ranks;
}

function rankOf(index: number, count: number, order: TextAnimatorOrder, shuffled: number[] | null): number {
	const middle = (count - 1) / 2;
	switch (order) {
		case TextAnimatorOrder.REVERSE: return count - 1 - index;
		case TextAnimatorOrder.CENTER: return Math.abs(index - middle);
		case TextAnimatorOrder.EDGES: return middle - Math.abs(index - middle);
		case TextAnimatorOrder.RANDOM: return shuffled?.[index] ?? index;
		default: return index;
	}
}

/**
 * Works out, for a text with a `<textAnimator>` or a `path`, how its words
 * break into units and where each unit is this frame. Null for an ordinary
 * text, which draws word by word as it always has.
 */
function planGlyphs(world: World, entity: Entity): GlyphPlan | null {
	const eid = entity.id();
	const animator = [...world.query(TextAnimator, ChildOf(entity))][0] ?? null;
	const onPath = entity.has(TextPath);
	if (!animator && !onPath) return null;

	const lines = store(world, TextCache).tokens[eid];
	if (!lines) return null;

	const by = animator ? store(world, TextAnimator).by[animator.id()] ?? TextAnimatorUnit.LETTER : TextAnimatorUnit.LETTER;
	const splitLetters = onPath || by === TextAnimatorUnit.LETTER;
	const measure = getMeasureCtx();

	const units = new Map<Token, Unit[]>();
	const advances: number[] = [];
	let poseCount = 0;
	lines.forEach((line, lineIndex) => {
		const lineUnit = by === TextAnimatorUnit.LINE ? poseCount + lineIndex : -1;
		for (const word of line) {
			const blank = word.chars.trim() === '';
			applyFont(measure, world, entity, word.ranges);
			const list: Unit[] = [];
			if (splitLetters) {
				const letters = Array.from(word.chars);
				let before = 0;
				let prefix = '';
				// A whole word's unit is shared by its letters when the animator
				// moves words, but each letter still sits on the path alone.
				const wordUnit = by === TextAnimatorUnit.WORD && !blank ? poseCount++ : -1;
				for (const letter of letters) {
					prefix += letter;
					const after = measure.measureText(prefix).width;
					const advance = after - before;
					const letterBlank = letter.trim() === '';
					const pose = by === TextAnimatorUnit.LINE
						? lineUnit
						: by === TextAnimatorUnit.WORD
							? wordUnit
							: letterBlank ? -1 : poseCount++;
					list.push({ chars: letter, dx: before, advance, pose, glyph: advances.length });
					advances.push(advance);
					before = after;
				}
			} else {
				const pose = by === TextAnimatorUnit.LINE ? lineUnit : blank ? -1 : poseCount++;
				list.push({ chars: word.chars, dx: 0, advance: word.width, pose, glyph: -1 });
			}
			units.set(word, list);
		}
	});
	if (by === TextAnimatorUnit.LINE) poseCount += lines.length;

	// Poses: each unit samples the animator's tracks at its own delayed clock.
	const poses: Pose[] = Array.from({ length: poseCount }, () => ({ ...REST }));
	if (animator) {
		const keyframeTrack = store(world, KeyframeTrack);
		const tracks = (store(world, Cache).keyframeTracks[eid] ?? [])
			.filter((track) => keyframeTrack.target[track.id()] === animator);
		const settings = store(world, TextAnimator);
		const stagger = settings.stagger[animator.id()] ?? 0;
		const order = settings.order[animator.id()] ?? TextAnimatorOrder.FORWARD;
		const shuffled = order === TextAnimatorOrder.RANDOM ? shuffledRanks(poseCount) : null;
		const localFrame = (store(world, Computed).localTime[eid] ?? 0) - getStaggerOffset(entity);
		for (let i = 0; i < poseCount; i++) {
			const frame = localFrame - rankOf(i, poseCount, order, shuffled) * stagger;
			const pose = poses[i]!;
			for (const track of tracks) {
				const value = sampleTrackAt(world, track, frame);
				if (value === null) continue;
				switch (keyframeTrack.property[track.id()]) {
					case 'offset.x': case 'position.x': pose.x = value; break;
					case 'offset.y': case 'position.y': pose.y = value; break;
					case 'rotation': pose.rotation = value; break;
					case 'scale': pose.scaleX = value; pose.scaleY = value; break;
					case 'scale.x': pose.scaleX = value; break;
					case 'scale.y': pose.scaleY = value; break;
					case 'opacity': pose.opacity = clamp(value, 0, 1); break;
					case 'blur': pose.blur = Math.max(0, value); break;
				}
			}
		}
	}

	let placements: GlyphPlan['placements'] = null;
	if (onPath) {
		const settings = store(world, TextPath);
		const computed = store(world, Computed);
		const subpaths = textPathSubPaths(world, entity, settings.d[eid] ?? '');
		if (subpaths) {
			const align = settings.align[eid] ?? TextPathAlign.START;
			placements = placeGlyphsOnPath(subpaths, advances, {
				offset: computed.pathOffset[eid] ?? 0,
				align: align === TextPathAlign.CENTER ? 'center' : align === TextPathAlign.END ? 'end' : 'start',
				baselineShift: computed.pathShift[eid] ?? 0,
			});
			// The box is the path's, so selecting the text selects the ring.
			fitPathBox(world, entity);
		}
	}

	return { units, poses, placements };
}

function drawUnits(ctx: Ctx, plan: GlyphPlan, word: Token, units: Unit[], mode: 'fill' | 'stroke'): void {
	const draw = (chars: string, x: number, y: number) => {
		if (mode === 'fill') ctx.fillText(chars, x, y);
		else ctx.strokeText(chars, x, y);
	};
	const middle = word.metrics.fontBoundingBoxAscent / 2;

	for (const unit of units) {
		if (unit.chars.trim() === '') continue;
		const pose = unit.pose >= 0 ? plan.poses[unit.pose] ?? REST : REST;
		if (pose.opacity <= 0 || pose.scaleX === 0 || pose.scaleY === 0) continue;

		ctx.save();
		if (pose.opacity < 1) ctx.globalAlpha *= pose.opacity;
		if (pose.blur > 0) ctx.filter = `${ctx.filter === 'none' ? '' : `${ctx.filter} `}blur(${pose.blur}px)`;

		const placed = plan.placements && unit.glyph >= 0 ? plan.placements[unit.glyph] : null;
		if (plan.placements) {
			// On a path: the glyph's baseline centre sits on the curve, turned
			// to follow it; the animator's pose moves it from there.
			if (!placed || !placed.visible) {
				ctx.restore();
				continue;
			}
			ctx.translate(placed.x, placed.y);
			ctx.rotate(placed.angle);
			ctx.translate(pose.x, pose.y);
			ctx.rotate((pose.rotation * Math.PI) / 180);
			ctx.scale(pose.scaleX, pose.scaleY);
			ctx.textBaseline = 'alphabetic';
			draw(unit.chars, -unit.advance / 2, 0);
		} else {
			// In its line: the unit turns and scales about its own middle.
			const cx = word.x + unit.dx + unit.advance / 2;
			const cy = word.y + middle;
			ctx.translate(cx + pose.x, cy + pose.y);
			ctx.rotate((pose.rotation * Math.PI) / 180);
			ctx.scale(pose.scaleX, pose.scaleY);
			ctx.translate(-cx, -cy);
			draw(unit.chars, word.x + unit.dx, word.y);
		}
		ctx.restore();
	}
}

/**
 * Splits text into segments based on overlapping text range entities.
 * Handles overlapping ranges by merging them.
 * @returns Array of RenderSplit objects with words and contributing ranges
 */
function createRenderSplits(world: World, entity: Entity): RenderSplit[] {
	const eid = entity.id();
	const chars = store(world, Computed).chars[eid] ?? store(world, Chars).value[eid] ?? '';

	const textRanges = store(world, Cache).textRanges[eid] ?? [];

	// Fast path: no styles
	if (textRanges.length === 0) {
		return [{
			words: tokenize(chars),
			ranges: [],
		}];
	}

	// Fast path: empty text
	if (chars.length === 0) {
		return [{
			words: [],
			ranges: [],
		}];
	}

	const rangeStore = store(world, TextRange);

	// Collect all unique boundary points
	const boundaries = new Set<number>();
	boundaries.add(0);
	boundaries.add(chars.length);

	for (const range of textRanges) {
		let start = rangeStore.start[range.id()] ?? 0;
		let end = rangeStore.end[range.id()] ?? chars.length;

		// Clamp boundaries to valid text range
		start = clamp(start, 0, chars.length);
		end = clamp(end, 0, chars.length);

		boundaries.add(start);
		boundaries.add(end);
	}

	// Sort boundaries in ascending order
	const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

	// Create segments between each pair of boundaries
	const segments: RenderSplit[] = [];

	for (let i = 0; i < sortedBoundaries.length - 1; i++) {
		const segStart = sortedBoundaries[i]!;
		const segEnd = sortedBoundaries[i + 1]!;

		// Skip empty segments
		if (segStart >= segEnd) continue;

		// Find all active styles for this segment
		const ranges: Entity[] = [];

		for (const range of textRanges) {
			let start = rangeStore.start[range.id()] ?? 0;
			let end = rangeStore.end[range.id()] ?? chars.length;

			// Clamp boundaries to valid text range
			start = clamp(start, 0, chars.length);
			end = clamp(end, 0, chars.length);

			// A style is active if segment falls within its range [start, end)
			// Using < for end to treat ranges as [start, end)
			if (start <= segStart && end > segStart) {
				ranges.push(range);
			}
		}

		segments.push({
			words: tokenize(chars.slice(segStart, segEnd)),
			ranges: ranges,
		});
	}

	return segments;
}

function tokenize(input: string): string[] {
	// Fast path for inputs without spaces
	if (input.indexOf(' ') === -1) {
		return [input];
	}

	// Use regex to match:
	// 1. Any characters up to and including a space
	// 2. OR any remaining characters to the end
	return input.match(/[^]*? |[^]+$/g) || [input];
}

export function transformText(text: string, textCase?: number): string {
	if (textCase == TextCase.LOWER) {
		return text.toLocaleLowerCase();
	}

	if (textCase == TextCase.UPPER) {
		return text.toUpperCase();
	}

	return text;
}

/**
 * The intrinsic glyph color for a run: the last of `ranges` carrying a Color
 * wins over the text's own, as a hex string; null when neither has one.
 */
function getIntrinsicColor(world: World, entity: Entity, ranges: Entity[]): string | null {
	const computed = store(world, Computed);
	let value: number | undefined = entity.has(Color) ? computed.color[entity.id()] ?? 0 : undefined;

	for (const range of ranges) {
		if (range.has(Color)) {
			value = computed.color[range.id()] ?? store(world, Color).value[range.id()] ?? 0;
		}
	}

	return value === undefined ? null : colorToHex(value);
}

function getFills(world: World, entity: Entity, ranges: Entity[]): Entity[] {
	const cache = store(world, Cache);
	let value = cache.fills[entity.id()] ?? [];

	for (const range of ranges) {
		const rangeValue = cache.fills[range.id()];
		if (rangeValue?.length) {
			value = rangeValue;
		}
	}

	return value;
}

function getStrokes(world: World, entity: Entity, ranges: Entity[]): Entity[] {
	const cache = store(world, Cache);
	let value = cache.strokes[entity.id()] ?? [];

	for (const range of ranges) {
		const rangeValue = cache.strokes[range.id()];
		if (rangeValue?.length) {
			value = rangeValue;
		}
	}

	return value;
}

function getShadows(world: World, entity: Entity, ranges: Entity[]): Entity[] {
	const cache = store(world, Cache);
	let value = cache.shadows[entity.id()] ?? [];

	for (const range of ranges) {
		const rangeValue = cache.shadows[range.id()];
		if (rangeValue?.length) {
			value = rangeValue;
		}
	}

	return value;
}

function getTextCase(world: World, entity: Entity, ranges: Entity[]) {
	const textStyle = store(world, TextStyle);
	let value = textStyle.textCase[entity.id()] ?? 0;

	for (const range of ranges) {
		const rangeValue = textStyle.textCase[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}

function getFontSize(world: World, entity: Entity, ranges: Entity[]) {
	const textStyle = store(world, TextStyle);
	let value = textStyle.fontSize[entity.id()] ?? 16;

	for (const range of ranges) {
		const rangeValue = textStyle.fontSize[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}

function getFontFamily(world: World, entity: Entity, ranges: Entity[]) {
	const textStyle = store(world, TextStyle);
	let value = textStyle.fontFamily[entity.id()] || 'Inter';

	for (const range of ranges) {
		const rangeValue = textStyle.fontFamily[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}

function getFontWeight(world: World, entity: Entity, ranges: Entity[]) {
	const textStyle = store(world, TextStyle);
	let value = textStyle.fontWeight[entity.id()] ?? '400';

	for (const range of ranges) {
		const rangeValue = textStyle.fontWeight[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}

/**
 * The decoration a run carries, as a bitmask.
 *
 * Resolved like every other text style: the element's own, overridden by each
 * `<textRange>` that covers this run.
 */
function getTextDecoration(world: World, entity: Entity, ranges: Entity[]): number {
	const textStyle = store(world, TextStyle);
	let value = textStyle.textDecoration[entity.id()] ?? TextDecorationType.NONE;

	for (const range of ranges) {
		const rangeValue = textStyle.textDecoration[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}

/**
 * Draw the rules a run's decoration asks for, in whatever the glyphs were
 * just painted with.
 *
 * Drawn per fill rather than once, so an underline under gradient text is the
 * same gradient — a rule in a different colour from the word above it reads as
 * a mistake.
 *
 * Finding where to put them takes two measurements. Canvas reports a font's
 * ascent from the current `textBaseline` anchor, not from the alphabetic
 * baseline, so measuring once under a `top` baseline gives an ascent of about
 * zero and puts both rules through the tops of the letters. Measuring the same
 * run under `alphabetic` as well gives the distance between the two anchors,
 * and with it the real baseline — which is the only line either rule can be
 * positioned from, whatever baseline mode the element uses.
 */
function drawDecoration(ctx: Ctx, chars: string, x: number, y: number, decoration: number, size: number): void {
	if (decoration === TextDecorationType.NONE) return;

	const anchored = ctx.measureText(chars);
	if (anchored.width <= 0) return;

	const savedBaseline = ctx.textBaseline;
	ctx.textBaseline = 'alphabetic';
	const alphabetic = ctx.measureText(chars);
	ctx.textBaseline = savedBaseline;

	// Both metrics measure to the same top of the font box, from different
	// anchors, so their difference is the gap between the anchors.
	const baseline = y + (alphabetic.fontBoundingBoxAscent - anchored.fontBoundingBoxAscent);
	const thickness = Math.max(1, size / 14);
	// The ink of this particular run, so a strike crosses the letters that are
	// actually there rather than a hypothetical full-height line.
	const ink = alphabetic.actualBoundingBoxAscent || alphabetic.fontBoundingBoxAscent || size * 0.7;

	if (decoration & TextDecorationType.UNDERLINE) {
		ctx.fillRect(x, baseline + thickness * 2, anchored.width, thickness);
	}
	if (decoration & TextDecorationType.LINE_THROUGH) {
		ctx.fillRect(x, baseline - ink * 0.45 - thickness / 2, anchored.width, thickness);
	}
}

function getFontStyle(world: World, entity: Entity, ranges: Entity[]) {
	const textStyle = store(world, TextStyle);
	let value = textStyle.fontStyle[entity.id()] ?? FontStyle.NORMAL;

	for (const range of ranges) {
		const rangeValue = textStyle.fontStyle[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}

function getTextBaseline(world: World, entity: Entity, ranges: Entity[]) {
	const textStyle = store(world, TextStyle);
	let value = textStyle.textBaseline[entity.id()] ?? TextBaseline.TOP;

	for (const range of ranges) {
		const rangeValue = textStyle.textBaseline[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}

function getLetterSpacing(world: World, entity: Entity, ranges: Entity[]) {
	const textStyle = store(world, TextStyle);
	let value = textStyle.letterSpacing[entity.id()] ?? 0;

	for (const range of ranges) {
		const rangeValue = textStyle.letterSpacing[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}
