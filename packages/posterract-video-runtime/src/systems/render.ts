/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Render system (was systems/render.ts): draws the document tree onto the
// world's RenderSurface. Runs identically against the editor and capture
// canvases; without a surface it is a no-op. Hit
// regions are pushed callback-less (see HitRegions); the app's input layer
// attaches its handlers.

import { Not, Or } from 'koota';

import { store } from '../world/store';
import {
	COMPOSITE_OPERATIONS, DiagramKindType, EffectType, GeometryType, PaintType, ScaleModeType,
	TransitionType,
} from '../constants';
import {
	ChildOf, Hidden, Culled, Interactive, IsMask,
	ClipsContent, Diagram, Geometry, Group, Lottie, LottieHandle, LottieSlot, Paint, Color, Caption, ScaleMode, Shader,
	BlendMode, Effect, Transition, MixedCornerRadius,
	LocalTransform, WorldTransform, Computed, Cache,
	Host,
	Mode, FrameRate, Camera, Background, RenderSurface,
	HitRegions,
	Root,
} from '../traits';
import { getParentNode } from '../queries/hierarchy';
import { getViewMatrix } from '../queries/camera';
import { colorToHex } from '../utils/color';
import { FAILED_COLOR, getGeneratingColor, getSourceFailure, isGenerating } from '../utils/generating';
import { applyStrokeStyle } from '../utils/stroke';
import { renderText } from '../utils/text';
import { getTransitionWindow } from '../utils/transition';
import { getIntrinsicPaint } from '../utils/time';
import { flattenPath, trimPath, type SubPath } from '../utils/vector';
import { isVectorGeometry, vectorCommands, vectorSubPaths } from '../queries/vector';
import { createLinearGradient, createRadialGradient } from './gradients';
import {
	resolveImageDecoder, resolveVideoDecoder,
	resolveCaptionDecoder, resolveShaderHost, resolveWaveformPeaks,
} from '../media';

import type { Entity, World } from 'koota';
import type { Quad } from '../math/aabb';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const MISSING_ASSET_COLOR = '#5C2828';

function getCtx(world: World): Ctx2D {
	return world.get(RenderSurface)!.ctx!;
}

export function drawRectPath(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const eid = entity.id();
	const w = computed.width[eid]!;
	const h = computed.height[eid]!;

	const hasMixed = entity.has(MixedCornerRadius);
	let tl = hasMixed ? computed.cornerRadiusTopLeft[eid]! : computed.cornerRadius[eid]!;
	let tr = hasMixed ? computed.cornerRadiusTopRight[eid]! : tl;
	let br = hasMixed ? computed.cornerRadiusBottomRight[eid]! : tl;
	let bl = hasMixed ? computed.cornerRadiusBottomLeft[eid]! : tl;

	ctx.beginPath();

	if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
		ctx.rect(0, 0, w, h);
	} else if (tl === tr && tr === br && br === bl) {
		ctx.roundRect(0, 0, w, h, tl);
	} else {
		// Clamp radii so adjacent corners don't exceed the edge length (CSS spec algorithm)
		const scale = Math.min(
			w / (tl + tr || 1),
			h / (tr + br || 1),
			w / (br + bl || 1),
			h / (bl + tl || 1),
			1,
		);
		if (scale < 1) {
			tl *= scale;
			tr *= scale;
			br *= scale;
			bl *= scale;
		}

		ctx.moveTo(tl, 0);
		ctx.lineTo(w - tr, 0);
		if (tr > 0) ctx.arcTo(w, 0, w, tr, tr);
		else ctx.lineTo(w, 0);
		ctx.lineTo(w, h - br);
		if (br > 0) ctx.arcTo(w, h, w - br, h, br);
		else ctx.lineTo(w, h);
		ctx.lineTo(bl, h);
		if (bl > 0) ctx.arcTo(0, h, 0, h - bl, bl);
		else ctx.lineTo(0, h);
		ctx.lineTo(0, tl);
		if (tl > 0) ctx.arcTo(0, 0, tl, 0, tl);
		else ctx.lineTo(0, 0);
	}

	ctx.closePath();
}

function getScaledImageProps(
	mode: number,
	imgW: number,
	imgH: number,
	targetW: number,
	targetH: number,
): [dx: number, dy: number, sw: number, sh: number] {
	if (mode === ScaleModeType.FILL) {
		return [0, 0, targetW, targetH];
	}
	if (mode === ScaleModeType.FIT) {
		const scale = Math.min(targetW / imgW, targetH / imgH);
		const sw = imgW * scale;
		const sh = imgH * scale;
		return [(targetW - sw) / 2, (targetH - sh) / 2, sw, sh];
	}
	if (mode === ScaleModeType.COVER) {
		const scale = Math.max(targetW / imgW, targetH / imgH);
		const sw = imgW * scale;
		const sh = imgH * scale;
		return [(targetW - sw) / 2, (targetH - sh) / 2, sw, sh];
	}
	// ScaleModeType.NONE — original size
	return [0, 0, imgW, imgH];
}

const EPSILON = 1e-4;

/** Build a single CSS filter fragment from an effect sub-entity. Returns null if hidden or no-op. */
function effectFilter(world: World, sub: Entity): string | null {
	if (sub.has(Hidden)) return null;

	const value = store(world, Computed).value[sub.id()]!;
	const type = store(world, Effect).type[sub.id()] ?? 0;

	if (type === EffectType.LAYER_BLUR) {
		const clamped = Math.max(0, value);
		return clamped > EPSILON ? `blur(${clamped}px)` : null;
	}
	if (type === EffectType.BRIGHTNESS) {
		const clamped = Math.min(1, Math.max(0, value));
		return Math.abs(clamped - 1) > EPSILON ? `brightness(${clamped})` : null;
	}
	if (type === EffectType.CONTRAST) {
		const clamped = Math.min(1, Math.max(0, value));
		return Math.abs(clamped - 1) > EPSILON ? `contrast(${clamped})` : null;
	}
	if (type === EffectType.GRAYSCALE) {
		const clamped = Math.min(1, Math.max(0, value));
		return clamped > EPSILON ? `grayscale(${clamped})` : null;
	}
	if (type === EffectType.HUE_ROTATION) {
		return Math.abs(value) > EPSILON ? `hue-rotate(${value}deg)` : null;
	}
	if (type === EffectType.INVERT) {
		const clamped = Math.min(1, Math.max(0, value));
		return clamped > EPSILON ? `invert(${clamped})` : null;
	}
	if (type === EffectType.SATURATE) {
		const clamped = Math.min(1, Math.max(0, value));
		return Math.abs(clamped - 1) > EPSILON ? `saturate(${clamped})` : null;
	}
	if (type === EffectType.SEPIA) {
		const clamped = Math.min(1, Math.max(0, value));
		return clamped > EPSILON ? `sepia(${clamped})` : null;
	}
	return null;
}

/** CSS filter string from the entity's own blur plus effect sub-entities. */
function buildEffects(world: World, entity: Entity): string | null {
	const parts: string[] = [];

	const blurVal = store(world, Computed).blur[entity.id()]!;
	if (blurVal > EPSILON) {
		parts.push(`blur(${blurVal}px)`);
	}

	const effects = store(world, Cache).effects[entity.id()] ?? [];
	for (const effect of effects) {
		const f = effectFilter(world, effect);
		if (f) parts.push(f);
	}

	if (parts.length === 0) return null;

	return parts.join(' ');
}

/**
 * The geometry's intrinsic fill: its own Color trait (a solid, read from
 * Computed.color so it animates) and its own Paint trait (see
 * `getIntrinsicPaint`), if any, in that order. Drawn into the current path
 * before the Paint sub-entities so it always sits at the bottom of the fill
 * stack. A shader paint first in the stack takes an intrinsic image/video as
 * its input instead (see `renderShaderFill`), in which case the media is not
 * drawn here. Media paints and the surface paint (a `<surface>`, whose host
 * lives on the geometry) are intrinsic; a waveform (an audio clip's) has no
 * picture on the canvas.
 */
export function renderIntrinsicFill(world: World, entity: Entity): void {
	if (entity.has(Color)) {
		const ctx = getCtx(world);
		const computed = store(world, Computed);
		const eid = entity.id();
		ctx.fillStyle = colorToHex(computed.color[eid] ?? 0);
		ctx.fill();
	}

	const intrinsic = getIntrinsicPaint(entity);
	if (intrinsic === PaintType.SURFACE) {
		const canvas = entity.get(Host)?.element;
		if (canvas instanceof HTMLCanvasElement) {
			const ctx = getCtx(world);
			const computed = store(world, Computed);
			const eid = entity.id();
			ctx.save();
			ctx.clip();
			ctx.drawImage(canvas, 0, 0, computed.width[eid]!, computed.height[eid]!);
			ctx.restore();
		}
		return;
	}
	if (intrinsic === PaintType.HTML) {
		renderHtmlFill(world, entity, entity);
		return;
	}

	const kind = mediaKind(intrinsic);
	if (kind === null) return;
	if (shaderInput(world, entity, store(world, Cache).fills[entity.id()] ?? [], 0) === entity) return;
	renderMedia(world, entity, entity, kind);
}

type MediaKind = 'IMAGE' | 'VIDEO';

function mediaKind(paint: PaintType | undefined): MediaKind | null {
	if (paint === PaintType.IMAGE) return 'IMAGE';
	if (paint === PaintType.VIDEO) return 'VIDEO';
	return null;
}

/** What the image and video decoders hand out to draw. */
type MediaFrame = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

// html-in-canvas (https://github.com/WICG/html-in-canvas). Chromium only,
// behind chrome://flags/#canvas-draw-element; the API surface is still
// moving, so every touchpoint is typed and isolated here.
type DrawElementContext = Ctx2D & {
	drawElementImage(source: Element | unknown, dx: number, dy: number, dw: number, dh: number): DOMMatrix;
};


// Roots whose last drawElementImage threw, so a persistent failure logs once
// rather than flooding the console; drawing again clears the entry.
const failedHtmlRoots = new WeakSet<HTMLElement>();

function renderHtmlFill(world: World, entity: Entity, source: Entity): void {
	const root = source.get(Host)?.element;
	const surface = world.get(RenderSurface);
	const ctx = surface?.ctx;
	if (!(ctx instanceof CanvasRenderingContext2D)) return;
	if (!(root instanceof HTMLElement)) return;

	const computed = store(world, Computed);
	const eid = entity.id();

	ctx.save();
	ctx.clip();

	const width = computed.width[eid]!;
	const height = computed.height[eid]!;
	root.style.width = `${width}px`;
	root.style.height = `${height}px`;

	try {
		(ctx as DrawElementContext).drawElementImage(root, 0, 0, width, height);
	} catch (error) {
		if (!failedHtmlRoots.has(root)) {
			failedHtmlRoots.add(root);
			console.error(`Error drawing <HtmlPaint> content: ${error instanceof Error ? `${error.name}: ${error.message}` : error}`);
		}
	}

	ctx.restore();
}

/**
 * Draws the current frame of `source` (an image or video paint, or the
 * geometry itself for intrinsic media) into `entity`'s box, fitted by the
 * source's ScaleMode; a failed decoder paints the missing-asset color.
 */
function renderMedia(world: World, entity: Entity, source: Entity, kind: MediaKind): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const eid = entity.id();
	const w = computed.width[eid]!;
	const h = computed.height[eid]!;

	let frame: MediaFrame | null | undefined;
	let failed = false;
	if (kind === 'IMAGE') {
		const decoder = resolveImageDecoder(world, source)?.decoder;
		frame = decoder?.getBitmap(w, h);
		failed = decoder?.failed ?? false;
	} else {
		const decoder = resolveVideoDecoder(world, source);
		frame = decoder?.toBitmap();
		failed = decoder?.errored ?? false;
	}

	if (frame) {
		ctx.save();
		ctx.clip();

		const mode = store(world, ScaleMode).value[source.id()] ?? 0;
		const [dx, dy, sw, sh] = getScaledImageProps(mode, frame.width, frame.height, w, h);
		ctx.drawImage(frame, dx, dy, sw, sh);

		ctx.restore();
	} else if (failed) {
		ctx.fillStyle = MISSING_ASSET_COLOR;
		ctx.fill();
	}
}

export function renderFills(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const paintStore = store(world, Paint);
	const blendMode = store(world, BlendMode);
	const eid = entity.id();
	const fills = store(world, Cache).fills[eid] ?? [];

	for (let index = 0; index < fills.length; index++) {
		const fill = fills[index]!;
		if (fill.has(Hidden) || shaderConsumesFill(world, entity, fills, index)) continue;
		const fid = fill.id();
		const savedAlpha = ctx.globalAlpha;
		const savedCO = ctx.globalCompositeOperation;
		const bi = blendMode.value[fid] ?? 0;

		if (bi !== 0) {
			ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[bi]!;
		}

		ctx.globalAlpha = savedAlpha * computed.opacity[fid]!;

		const paint = paintStore.value[fid];
		if (paint === PaintType.IMAGE) {
			renderMedia(world, entity, fill, 'IMAGE');
		} else if (paint === PaintType.VIDEO) {
			renderMedia(world, entity, fill, 'VIDEO');
		} else if (paint === PaintType.HTML) {
			renderHtmlFill(world, entity, fill);
		} else if (paint === PaintType.SURFACE) {
			const canvas = fill.get(Host)?.element;
			if (canvas instanceof HTMLCanvasElement) {
				ctx.save();
				ctx.clip();
				ctx.drawImage(canvas, 0, 0, computed.width[eid]!, computed.height[eid]!);
				ctx.restore();
			}
		} else if (paint === PaintType.SOLID) {
			ctx.fillStyle = colorToHex(computed.color[fid]!);
			ctx.fill();
		} else if (paint === PaintType.LINEAR_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.fillStyle = createLinearGradient(world, fill, ctx, w, h);
			ctx.fill();
		} else if (paint === PaintType.RADIAL_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.fillStyle = createRadialGradient(world, fill, ctx, w, h);
			ctx.fill();
		} else if (paint === PaintType.WAVEFORM) {
			renderWaveform(world, entity, fill);
		} else if (paint === PaintType.SHADER) {
			renderShaderFill(world, entity, fills, index);
		}

		ctx.globalCompositeOperation = savedCO;
		ctx.globalAlpha = savedAlpha;
	}
}

/**
 * Whether `source` is a picture a shader can sample: an image/video paint,
 * be it a paint sub-entity or the geometry's own intrinsic paint.
 */
function shaderMediaKind(world: World, source: Entity): 'IMAGE' | 'VIDEO' | null {
	if (!source.has(Paint)) return null;
	const paint = store(world, Paint).value[source.id()];
	if (paint === PaintType.IMAGE) return 'IMAGE';
	if (paint === PaintType.VIDEO) return 'VIDEO';
	return null;
}

/** The current frame of a video/image source, as a GPU-uploadable source. */
function shaderSourceBitmap(
	world: World,
	source: Entity,
	w: number,
	h: number,
): { source: GPUCopyExternalImageSource; width: number; height: number } | null {
	const kind = shaderMediaKind(world, source);

	if (kind === 'IMAGE') {
		const bitmap = resolveImageDecoder(world, source)?.decoder?.getBitmap(w, h);
		return bitmap ? { source: bitmap, width: bitmap.width, height: bitmap.height } : null;
	}
	if (kind === 'VIDEO') {
		const frame = resolveVideoDecoder(world, source)?.toBitmap();
		return frame ? { source: frame, width: frame.width, height: frame.height } : null;
	}
	return null;
}

/**
 * The media directly below the fill at `index`, if it is one a shader could
 * take as input: the visible image/video paint right before it, or, for the
 * first fill, the geometry's own intrinsic image/video. Only the immediate
 * neighbor counts (a hidden paint in between decouples the pair).
 */
function mediaBelow(world: World, entity: Entity, fills: Entity[], index: number): Entity | null {
	const source = index === 0 ? entity : fills[index - 1]!;
	if (source.has(Hidden)) return null;
	return shaderMediaKind(world, source) === null ? null : source;
}

/**
 * The media the shader paint at `index` will sample this frame, or null when
 * it has none to (there is no shader there, it is not ready, nothing samplable
 * sits below it, or that has no frame yet). Whatever it returns is drawn by
 * the shader and not on its own — a consumed media that the shader then fails
 * to draw would blank the element, so this checks pipeline readiness and frame
 * availability, and `renderShaderFill` draws exactly what it says.
 */
function shaderInput(world: World, entity: Entity, fills: Entity[], index: number): Entity | null {
	const shader = fills[index];
	if (shader === undefined || store(world, Paint).value[shader.id()] !== PaintType.SHADER) return null;
	if (shader.has(Hidden)) return null;
	if (!resolveShaderHost(world, shader)?.ready) return null;

	const media = mediaBelow(world, entity, fills, index);
	if (media === null) return null;

	const computed = store(world, Computed);
	const w = computed.width[entity.id()]!;
	const h = computed.height[entity.id()]!;
	return shaderSourceBitmap(world, media, w, h) === null ? null : media;
}

/**
 * Whether the fill at `index` is the input of a ready shader paint directly
 * above it (see `shaderInput`).
 */
function shaderConsumesFill(world: World, entity: Entity, fills: Entity[], index: number): boolean {
	return shaderInput(world, entity, fills, index + 1) === fills[index];
}

/**
 * Draws a shader paint: the media directly below it — the image/video paint
 * before it in the fill stack, or the geometry's intrinsic media under the
 * first fill — is sampled as the shader's `source` texture and its output
 * lands in the parent's box in the media's place. Without media below the
 * shader runs procedurally over a transparent source; before the pipeline is
 * ready it draws nothing and the media, if any, draws normally.
 */
function renderShaderFill(world: World, entity: Entity, fills: Entity[], index: number): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const host = resolveShaderHost(world, fills[index]!);
	if (!host?.ready) return;

	const eid = entity.id();
	const w = computed.width[eid]!;
	const h = computed.height[eid]!;

	// Anything but samplable media below (no fill below, a hidden one, a
	// solid/gradient) runs the shader procedurally over a transparent source,
	// stacking like a normal paint.
	const media = mediaBelow(world, entity, fills, index);
	let input: ReturnType<typeof shaderSourceBitmap> = null;
	if (media !== null) {
		input = shaderSourceBitmap(world, media, w, h);
		if (!input) return;
	}

	const fit = input
		? getScaledImageProps(store(world, ScaleMode).value[media!.id()] ?? 0, input.width, input.height, w, h)
		: [0, 0, w, h] as [number, number, number, number];
	const fps = world.get(FrameRate)?.value ?? 30;
	const time = (computed.localTime[eid] ?? 0) / fps;

	ctx.save();
	ctx.clip();
	host.draw(ctx, w, h, input?.source ?? null, input?.width ?? 1, input?.height ?? 1, fit, time, store(world, Shader).uniforms[fills[index]!.id()] ?? null);
	ctx.restore();
}

function renderShadows(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const shadows = store(world, Cache).shadows[entity.id()];
	if (!shadows) return;

	ctx.save();
	const savedAlpha = ctx.globalAlpha;

	// ctx.shadowBlur/OffsetX/OffsetY are in device-pixel space and are not
	// affected by the current transform, so scale them up to match the
	// content transform (camera * resolution).
	const camera = world.get(Root)!.get(Camera);
	const resolution = world.get(RenderSurface)?.resolution ?? 1;
	const shadowScale = (camera?.a ?? 1) * resolution;

	for (const shadow of shadows) {
		if (shadow.has(Hidden)) continue;
		const sid = shadow.id();
		const color = colorToHex(computed.color[sid]!);
		ctx.shadowColor = color;
		ctx.fillStyle = color;
		ctx.globalAlpha = savedAlpha * computed.opacity[sid]!;
		ctx.shadowBlur = computed.blur[sid]! * shadowScale;
		ctx.shadowOffsetX = computed.offsetX[sid]! * shadowScale;
		ctx.shadowOffsetY = computed.offsetY[sid]! * shadowScale;
		ctx.fill();
	}

	ctx.restore();
}

function renderStrokes(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const eid = entity.id();
	const strokes = store(world, Cache).strokes[eid];
	if (!strokes) return;

	const computed = store(world, Computed);
	const blendMode = store(world, BlendMode);
	const paintStore = store(world, Paint);

	for (const stroke of strokes) {
		if (stroke.has(Hidden)) continue;
		const sid = stroke.id();
		const savedAlpha = ctx.globalAlpha;
		const savedCO = ctx.globalCompositeOperation;
		const bi = blendMode.value[sid] ?? 0;

		if (bi !== 0) {
			ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[bi]!;
		}

		applyStrokeStyle(ctx, world, stroke);
		ctx.globalAlpha = savedAlpha * computed.opacity[sid]!;

		const paintType = paintStore.value[sid];
		if (paintType === PaintType.LINEAR_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.strokeStyle = createLinearGradient(world, stroke, ctx, w, h);
		} else if (paintType === PaintType.RADIAL_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.strokeStyle = createRadialGradient(world, stroke, ctx, w, h);
		} else {
			ctx.strokeStyle = colorToHex(computed.color[sid]!);
		}
		ctx.stroke();

		ctx.globalCompositeOperation = savedCO;
		ctx.globalAlpha = savedAlpha;
	}
}

/**
 * The pulse a node waiting on a generation is filled with
 */
function renderGenerating(world: World, entity: Entity): void {
	const errored = getSourceFailure(entity) !== undefined;
	if (!errored && !isGenerating(entity)) return;

	const ctx = getCtx(world);
	ctx.fillStyle = errored ? FAILED_COLOR : getGeneratingColor(world);
	ctx.fill();
}

// ── WAVEFORM paint ─────────────────────────────────────
//
// Renders an audio asset's pre-computed peaks as a bar chart inside the
// parent geometry's bounds. Sourced from the paint's own AssetId — the paint
// carries its asset reference, exactly like IMAGE and VIDEO paints.

const WAVEFORM_BAR_WIDTH = 6;
const WAVEFORM_BAR_GAP = 6;
const WAVEFORM_BAR_RADIUS = WAVEFORM_BAR_WIDTH / 2;
const WAVEFORM_MIN_BAR_HEIGHT = 4;
const WAVEFORM_PADDING = 12;
const WAVEFORM_BG_COLOR = '#202020';
const WAVEFORM_BG_RADIUS = 12;

function renderWaveform(world: World, entity: Entity, fill: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const peaks = resolveWaveformPeaks(world, fill);
	if (!peaks || peaks.length === 0) return;

	const w = computed.width[entity.id()]!;
	const h = computed.height[entity.id()]!;

	ctx.save();
	ctx.clip();

	// Background
	ctx.fillStyle = WAVEFORM_BG_COLOR;
	ctx.beginPath();
	ctx.roundRect(0, 0, w, h, WAVEFORM_BG_RADIUS);
	ctx.fill();

	// Bars
	const step = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;
	const availableWidth = w - WAVEFORM_PADDING * 2;
	const barCount = Math.floor(availableWidth / step);
	const maxBarHeight = h - WAVEFORM_PADDING * 2;
	if (barCount <= 0 || maxBarHeight <= 0) {
		ctx.restore();
		return;
	}

	const startX = WAVEFORM_PADDING + (availableWidth - barCount * step + WAVEFORM_BAR_GAP) / 2;

	ctx.fillStyle = '#ffffff';

	for (let i = 0; i < barCount; i++) {
		const peakIndex = Math.floor((i / barCount) * peaks.length);
		const value = (peaks[peakIndex] ?? 0) / 255;
		const barHeight = Math.max(value * maxBarHeight, WAVEFORM_MIN_BAR_HEIGHT);
		const x = startX + i * step;
		const y = (h - barHeight) / 2;

		ctx.beginPath();
		ctx.roundRect(x, y, WAVEFORM_BAR_WIDTH, barHeight, WAVEFORM_BAR_RADIUS);
		ctx.fill();
	}

	ctx.restore();
}

function renderShapeNode(world: World, entity: Entity): void {
	drawRectPath(world, entity);
	renderShadows(world, entity);
	renderIntrinsicFill(world, entity);
	renderFills(world, entity);
	renderGenerating(world, entity);
	renderStrokes(world, entity);
}

/**
 * Draw a vector figure — `<path>`, `<ellipse>` or `<polygon>` — into the
 * current path, then paint it like any other shape.
 *
 * Untrimmed figures are laid down as true curves, which is both crisper and
 * cheaper than a polyline. A trimmed one is drawn from the flattened form
 * instead, because a fraction of a curve is only knowable once it has a
 * length. Both come from the same commands, so the two agree where they meet
 * (`trim` 0–1 draws the whole figure and takes the curve path).
 */
function renderVectorNode(world: World, entity: Entity): void {
	drawVectorPath(world, entity);
	renderShadows(world, entity);
	renderIntrinsicFill(world, entity);
	renderFills(world, entity);
	renderGenerating(world, entity);
	renderStrokes(world, entity);
}

export function drawVectorPath(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const eid = entity.id();
	const start = computed.trimStart[eid] ?? 0;
	const end = computed.trimEnd[eid] ?? 1;
	const offset = computed.trimOffset[eid] ?? 0;

	ctx.beginPath();

	// A trimmed figure is drawn from its flattened form: a fraction of a curve
	// is only knowable once the curve has a length.
	if (start > 0 || end < 1 || offset !== 0) {
		for (const subpath of trimPath(vectorSubPaths(world, entity), start, end, offset)) {
			drawSubPath(ctx, subpath);
		}
		return;
	}

	let penX = 0;
	let penY = 0;
	for (const command of vectorCommands(world, entity)) {
		const v = command.values;
		switch (command.type) {
			case 'M':
				ctx.moveTo(v[0]!, v[1]!);
				[penX, penY] = [v[0]!, v[1]!];
				break;
			case 'L':
				ctx.lineTo(v[0]!, v[1]!);
				[penX, penY] = [v[0]!, v[1]!];
				break;
			case 'C':
				ctx.bezierCurveTo(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!);
				[penX, penY] = [v[4]!, v[5]!];
				break;
			case 'Q':
				ctx.quadraticCurveTo(v[0]!, v[1]!, v[2]!, v[3]!);
				[penX, penY] = [v[2]!, v[3]!];
				break;
			case 'A': {
				// Canvas has no elliptical-arc-to, so this one command is
				// flattened on its own; the rest of the figure stays curved.
				const [flattened] = flattenPath([{ type: 'M', values: [penX, penY] }, command]);
				const points = flattened?.points ?? [];
				for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!);
				[penX, penY] = [v[5]!, v[6]!];
				break;
			}
			case 'Z':
				ctx.closePath();
				break;
		}
	}
}

function drawSubPath(ctx: Ctx2D, subpath: SubPath): void {
	const { points } = subpath;
	if (points.length < 4) return;
	ctx.moveTo(points[0]!, points[1]!);
	for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!);
	if (subpath.closed) ctx.closePath();
}

function renderTextNode(world: World, entity: Entity): void {
	renderText(world, entity);
}

function renderCaptionNode(world: World, entity: Entity): void {
	resolveCaptionDecoder(world, entity)?.draw(world, entity);
}

/**
 * Draw a Lottie animation at the node's own local time.
 *
 * The player is seeked rather than played, so this is a pure function of
 * composition time — the same frame in preview and in export. A player that
 * has not finished loading draws nothing this frame; the export path waits on
 * its `ready` promise through `FramePromises`, so an export never captures the
 * blank.
 */
function renderLottieNode(world: World, entity: Entity): void {
	const player = entity.get(LottieHandle);
	if (!player) return;

	const eid = entity.id();
	const computed = store(world, Computed);
	const settings = entity.get(Lottie)!;
	// `Computed.localTimeInSeconds` is written for the composition root only;
	// per-node local time lives in `Computed.localTime`, in frames (see
	// `updateVisibility` in systems/playback.ts). Reading the seconds field
	// here pinned every clip to frame 0.
	const fps = world.get(FrameRate)?.value ?? 30;
	const seconds = ((computed.localTime[eid] ?? 0) / fps) * (settings.speed || 1);

	// Slots are pushed before the seek so the frame that comes back already
	// carries them. A keyframed slot reads its value from `Computed`, which
	// the motion system has filled for this frame; an un-keyframed one reads
	// the same channel, seeded from what the source authored.
	const slots = store(world, LottieSlot);
	for (const slot of world.query(LottieSlot, ChildOf(entity))) {
		const sid = slot.id();
		player.applySlot({
			name: slots.name[sid] ?? '',
			value: computed.value[sid] ?? 0,
			text: slots.text[sid] ?? '',
			isColor: slots.isColor[sid] ?? false,
		});
	}

	const frame = player.drawAt(seconds, settings.loop);

	if (!frame) return;

	const ctx = getCtx(world);
	if (!ctx) return;
	const width = computed.width[eid] || player.width;
	const height = computed.height[eid] || player.height;
	ctx.drawImage(frame, 0, 0, width, height);
}

type DiagramPoint = readonly [number, number];

function diagramPath(ctx: Ctx2D, kind: DiagramKindType, shape: string, width: number, height: number, radius: number): void {
	ctx.beginPath();
	if (kind === DiagramKindType.NODE) {
		if (shape === 'circle') {
			ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
		} else if (shape === 'diamond') {
			ctx.moveTo(width / 2, 0);
			ctx.lineTo(width, height / 2);
			ctx.lineTo(width / 2, height);
			ctx.lineTo(0, height / 2);
			ctx.closePath();
		} else if (shape === 'hexagon') {
			const inset = width * 0.18;
			ctx.moveTo(inset, 0);
			ctx.lineTo(width - inset, 0);
			ctx.lineTo(width, height / 2);
			ctx.lineTo(width - inset, height);
			ctx.lineTo(inset, height);
			ctx.lineTo(0, height / 2);
			ctx.closePath();
		} else {
			ctx.roundRect(0, 0, width, height, shape === 'pill' ? height / 2 : radius);
		}
		return;
	}

	if (kind === DiagramKindType.CALLOUT) {
		ctx.roundRect(0, 0, width, height, radius);
		return;
	}

	ctx.rect(0, 0, width, height);
}

function drawArrowHead(ctx: Ctx2D, x: number, y: number, angle: number, size: number): void {
	ctx.beginPath();
	ctx.moveTo(x, y);
	ctx.lineTo(x - Math.cos(angle - Math.PI / 6) * size, y - Math.sin(angle - Math.PI / 6) * size);
	ctx.lineTo(x - Math.cos(angle + Math.PI / 6) * size, y - Math.sin(angle + Math.PI / 6) * size);
	ctx.closePath();
	ctx.fill();
}

function buildArrowPath(ctx: Ctx2D, route: string, width: number, height: number, progress: number): { start: number; end: number } {
	const p = Math.max(0, Math.min(1, progress));
	ctx.beginPath();
	ctx.moveTo(0, 0);
	if (route === 'elbow') {
		const mx = width / 2;
		if (p <= 1 / 3) ctx.lineTo(mx * p * 3, 0);
		else {
			ctx.lineTo(mx, 0);
			if (p <= 2 / 3) ctx.lineTo(mx, height * (p - 1 / 3) * 3);
			else {
				ctx.lineTo(mx, height);
				ctx.lineTo(mx + (width - mx) * (p - 2 / 3) * 3, height);
			}
		}
		return { start: 0, end: 0 };
	}
	if (route === 'curve') {
		const ex = width * p;
		const ey = height * p;
		ctx.bezierCurveTo(width * 0.38 * p, 0, width * 0.62 * p, ey, ex, ey);
		return { start: Math.atan2(height, width), end: Math.atan2(height, width) };
	}
	ctx.lineTo(width * p, height * p);
	const angle = Math.atan2(height, width);
	return { start: angle, end: angle };
}

const SUPER: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ' };
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', i: 'ᵢ', n: 'ₙ', o: 'ₒ', r: 'ᵣ', u: 'ᵤ', x: 'ₓ' };

function mathText(input: string): string {
	const commands: Record<string, string> = {
		'\\times': '×', '\\cdot': '·', '\\rightarrow': '→', '\\leftarrow': '←', '\\leq': '≤', '\\geq': '≥',
		'\\neq': '≠', '\\approx': '≈', '\\infty': '∞', '\\sum': '∑', '\\int': '∫', '\\pi': 'π', '\\theta': 'θ',
		'\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\Delta': 'Δ', '\\lambda': 'λ', '\\mu': 'μ', '\\sigma': 'σ',
	};
	let value = input;
	for (const [command, glyph] of Object.entries(commands)) value = value.replaceAll(command, glyph);
	value = value.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)⁄($2)');
	value = value.replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');
	value = value.replace(/\^\{([^{}]+)\}|\^([\w+\-=()])/g, (_all, block: string | undefined, one: string | undefined) =>
		[...(block ?? one ?? '')].map((char) => SUPER[char] ?? char).join(''));
	value = value.replace(/_\{([^{}]+)\}|_([\w+\-=()])/g, (_all, block: string | undefined, one: string | undefined) =>
		[...(block ?? one ?? '')].map((char) => SUB[char] ?? char).join(''));
	return value.replace(/[{}]/g, '');
}

function drawCenteredLabel(
	ctx: Ctx2D,
	label: string,
	subtitle: string,
	width: number,
	height: number,
	d: { textColor: number; fontSize: number; fontFamily: string; fontWeight: string; padding: number },
): void {
	ctx.save();
	ctx.fillStyle = colorToHex(d.textColor);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.font = `${d.fontWeight} ${d.fontSize}px ${d.fontFamily}`;
	ctx.fillText(label, width / 2, subtitle ? height / 2 - d.fontSize * 0.28 : height / 2, Math.max(0, width - d.padding * 2));
	if (subtitle) {
		ctx.globalAlpha *= 0.68;
		ctx.font = `400 ${Math.max(12, d.fontSize * 0.48)}px ${d.fontFamily}`;
		ctx.fillText(subtitle, width / 2, height / 2 + d.fontSize * 0.65, Math.max(0, width - d.padding * 2));
	}
	ctx.restore();
}

function diagramPoints(json: string): DiagramPoint[] {
	try {
		const parsed = JSON.parse(json) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((point): point is [number, number] => Array.isArray(point)
			&& point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]));
	} catch {
		return [];
	}
}

function mapDiagramPoint(point: DiagramPoint, width: number, height: number, padding: number, domain: [number, number], range: [number, number]): DiagramPoint {
	const x = padding + ((point[0] - domain[0]) / (domain[1] - domain[0])) * Math.max(1, width - padding * 2);
	const y = height - padding - ((point[1] - range[0]) / (range[1] - range[0])) * Math.max(1, height - padding * 2);
	return [x, y];
}

function renderDiagram(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const width = computed.width[entity.id()]!;
	const height = computed.height[entity.id()]!;
	const d = entity.get(Diagram)!;
	// The resolved reveal, not the authored one: a `progress` keyframe track
	// writes it here, and the motion system falls back to the prop when no
	// track is running (see resetAnimatedValues).
	const progress = Math.max(0, Math.min(1, computed.progress[entity.id()] ?? d.progress));
	const stroke = colorToHex(d.strokeColor);

	if (d.kind === DiagramKindType.NODE || d.kind === DiagramKindType.CALLOUT) {
		diagramPath(ctx, d.kind, d.shape, width, height, Math.min(24, height / 4));
		renderShadows(world, entity);
		renderIntrinsicFill(world, entity);
		renderFills(world, entity);
		renderGenerating(world, entity);
		ctx.save();
		ctx.strokeStyle = stroke;
		ctx.lineWidth = d.strokeWidth;
		ctx.stroke();
		ctx.restore();
		renderStrokes(world, entity);
		if (d.kind === DiagramKindType.CALLOUT && (d.targetX !== 0 || d.targetY !== 0)) {
			const sx = Math.max(0, Math.min(width, d.targetX));
			const sy = d.targetY < 0 ? 0 : height;
			ctx.save();
			ctx.strokeStyle = stroke;
			ctx.fillStyle = stroke;
			ctx.lineWidth = d.strokeWidth;
			ctx.beginPath();
			ctx.moveTo(sx, sy);
			ctx.lineTo(d.targetX, d.targetY);
			ctx.stroke();
			drawArrowHead(ctx, d.targetX, d.targetY, Math.atan2(d.targetY - sy, d.targetX - sx), d.headSize);
			ctx.restore();
		}
		drawCenteredLabel(ctx, d.label, d.subtitle, width, height, d);
		return;
	}

	if (d.kind === DiagramKindType.ARROW) {
		ctx.save();
		ctx.strokeStyle = stroke;
		ctx.fillStyle = stroke;
		ctx.lineWidth = d.strokeWidth;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		const angles = buildArrowPath(ctx, d.route, width, height, progress);
		ctx.stroke();
		if (progress >= 0.999 && d.arrowEnd) drawArrowHead(ctx, width, height, angles.end, d.headSize);
		if (d.arrowStart) drawArrowHead(ctx, 0, 0, angles.start + Math.PI, d.headSize);
		if (d.label) {
			ctx.fillStyle = colorToHex(d.textColor);
			ctx.textAlign = 'center';
			ctx.textBaseline = 'bottom';
			ctx.font = `${d.fontWeight} ${Math.max(12, d.fontSize * 0.55)}px ${d.fontFamily}`;
			ctx.fillText(d.label, width / 2, height / 2 - 8);
		}
		ctx.restore();
		return;
	}

	if (d.kind === DiagramKindType.EQUATION) {
		ctx.save();
		ctx.fillStyle = colorToHex(d.textColor);
		ctx.textAlign = d.align === 'left' ? 'left' : d.align === 'right' ? 'right' : 'center';
		ctx.textBaseline = 'middle';
		ctx.font = `${d.fontWeight} ${d.fontSize}px ${d.fontFamily}`;
		const x = d.align === 'left' ? d.padding : d.align === 'right' ? width - d.padding : width / 2;
		ctx.fillText(mathText(d.expression), x, d.label ? height * 0.43 : height / 2, Math.max(0, width - d.padding * 2));
		if (d.label) {
			ctx.globalAlpha *= 0.65;
			ctx.font = `400 ${Math.max(12, d.fontSize * 0.42)}px ${d.fontFamily}`;
			ctx.fillText(d.label, x, height * 0.77, Math.max(0, width - d.padding * 2));
		}
		ctx.restore();
		return;
	}

	const padding = Math.max(12, Math.min(d.padding, Math.min(width, height) / 3));
	const domain: [number, number] = [d.domainMin, d.domainMax];
	const range: [number, number] = [d.rangeMin, d.rangeMax];
	if (d.kind === DiagramKindType.AXIS) {
		const ticks = Math.max(2, Math.min(20, Math.round(d.tickCount)));
		ctx.save();
		ctx.strokeStyle = stroke;
		ctx.fillStyle = colorToHex(d.textColor);
		ctx.lineWidth = d.strokeWidth;
		ctx.font = `400 ${Math.max(11, d.fontSize * 0.38)}px ${d.fontFamily}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		for (let i = 0; i <= ticks; i += 1) {
			const t = i / ticks;
			const x = padding + t * (width - padding * 2);
			const y = height - padding - t * (height - padding * 2);
			if (d.grid) {
				ctx.save();
				ctx.globalAlpha *= 0.16;
				ctx.beginPath(); ctx.moveTo(x, padding); ctx.lineTo(x, height - padding); ctx.stroke();
				ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke();
				ctx.restore();
			}
			ctx.fillText((domain[0] + t * (domain[1] - domain[0])).toFixed(1).replace(/\.0$/, ''), x, height - padding + 10);
			ctx.save();
			ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
			ctx.fillText((range[0] + t * (range[1] - range[0])).toFixed(1).replace(/\.0$/, ''), padding - 10, y);
			ctx.restore();
		}
		ctx.beginPath();
		ctx.moveTo(padding, padding); ctx.lineTo(padding, height - padding); ctx.lineTo(width - padding, height - padding);
		ctx.stroke();
		if (d.xLabel) { ctx.font = `${d.fontWeight} ${Math.max(12, d.fontSize * 0.48)}px ${d.fontFamily}`; ctx.fillText(d.xLabel, width / 2, height - 22); }
		if (d.yLabel) {
			ctx.save(); ctx.translate(18, height / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'top';
			ctx.font = `${d.fontWeight} ${Math.max(12, d.fontSize * 0.48)}px ${d.fontFamily}`; ctx.fillText(d.yLabel, 0, 0); ctx.restore();
		}
		ctx.restore();
		return;
	}

	if (d.kind === DiagramKindType.PLOT) {
		const points = diagramPoints(d.points).map((point) => mapDiagramPoint(point, width, height, padding, domain, range));
		if (!points.length) return;
		const visible = Math.max(1, Math.ceil(points.length * progress));
		ctx.save();
		ctx.strokeStyle = stroke;
		ctx.fillStyle = stroke;
		ctx.lineWidth = d.strokeWidth;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo(points[0]![0], points[0]![1]);
		for (let i = 1; i < visible; i += 1) {
			const point = points[i]!;
			if (d.smooth) {
				const previous = points[i - 1]!;
				const midX = (previous[0] + point[0]) / 2;
				ctx.bezierCurveTo(midX, previous[1], midX, point[1], point[0], point[1]);
			} else ctx.lineTo(point[0], point[1]);
		}
		ctx.stroke();
		if (d.markers) for (const [x, y] of points.slice(0, visible)) { ctx.beginPath(); ctx.arc(x, y, Math.max(3, d.strokeWidth * 1.4), 0, Math.PI * 2); ctx.fill(); }
		if (d.label) {
			ctx.fillStyle = colorToHex(d.textColor); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
			ctx.font = `${d.fontWeight} ${Math.max(12, d.fontSize * 0.48)}px ${d.fontFamily}`; ctx.fillText(d.label, padding, 4);
		}
		ctx.restore();
	}
}

// ── Transition rendering ─────────────────────────────────────

function renderTransition(world: World, scene: Entity, left: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const currentTime = computed.localTime[scene.id()]!;

	const children = store(world, Cache).children[scene.id()] ?? [];
	const right = children.find(sibling => computed.start[sibling.id()] === computed.end[left.id()]);
	if (!right) return;

	const win = getTransitionWindow(world, left, right);

	if (currentTime < win.start || currentTime >= win.end) return;

	// we are transitioning
	const duration = win.end - win.start;
	const completion = (currentTime - win.start) / duration;

	const type = store(world, Transition).type[left.id()] ?? TransitionType.DISSOLVE;

	const parent = getParentNode(left);
	if (parent === null) return;
	const width = computed.width[parent.id()]!;
	const height = computed.height[parent.id()]!;

	switch (type) {
		case TransitionType.SLIDE_FROM_RIGHT: {
			renderNode(world, left);
			ctx.save();
			ctx.translate(((1 - completion) ** 2 * width) | 0, 0);
			renderNode(world, right);
			ctx.restore();
			break;
		}
		case TransitionType.SLIDE_FROM_LEFT: {
			renderNode(world, left);
			ctx.save();
			ctx.translate(((1 - completion) ** 2 * width * -1) | 0, 0);
			renderNode(world, right);
			ctx.restore();
			break;
		}
		case TransitionType.FADE_TO_BLACK: {
			if (completion < 0.5) {
				renderNode(world, left);
			} else {
				renderNode(world, right);
			}
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, width, height);
			ctx.closePath();
			ctx.fillStyle = '#000000';
			ctx.globalAlpha = completion < 0.5 ? 2 * completion : 2 * (1 - completion);
			ctx.fill();
			ctx.restore();
			break;
		}
		case TransitionType.FADE_TO_WHITE: {
			if (completion < 0.5) {
				renderNode(world, left);
			} else {
				renderNode(world, right);
			}
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, width, height);
			ctx.closePath();
			ctx.fillStyle = '#FFFFFF';
			ctx.globalAlpha = completion < 0.5 ? 2 * completion : 2 * (1 - completion);
			ctx.fill();
			ctx.restore();
			break;
		}
		default: {
			// Dissolve (default)
			renderNode(world, left);
			ctx.save();
			ctx.globalAlpha = completion;
			renderNode(world, right);
			ctx.restore();
			break;
		}
	}

	// Mark both partners as already drawn this frame so the parent's
	// children loop skips its plain renderNode pass for them.
	computed.visibility[left.id()] = 0;
	computed.visibility[right.id()] = 0;
}

export function renderNode(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const eid = entity.id();

	if (computed.visibility[eid] === 0 || entity.has(Culled)) return;

	if (entity.has(Interactive)) {
		world.get(HitRegions)?.list.push({
			target: { kind: 'entity', id: entity },
		});
	}

	if (entity.has(IsMask) || entity.has(Hidden)) return;

	ctx.save();

	const local = store(world, LocalTransform);
	ctx.transform(
		local.a[eid]!,
		local.b[eid]!,
		local.c[eid]!,
		local.d[eid]!,
		local.e[eid]!,
		local.f[eid]!,
	);

	const worldTransform = store(world, WorldTransform);
	for (const mask of store(world, Cache).masks[eid] ?? []) {
		if (computed.visibility[mask.id()] === 0) continue;
		ctx.save();
		ctx.setTransform(
			worldTransform.a[mask.id()]!,
			worldTransform.b[mask.id()]!,
			worldTransform.c[mask.id()]!,
			worldTransform.d[mask.id()]!,
			worldTransform.e[mask.id()]!,
			worldTransform.f[mask.id()]!,
		);
		// A mask clips by its own shape: a `<path mask>` is how a figure that
		// is not a rectangle gets to be one.
		if (isVectorGeometry(store(world, Geometry).value[mask.id()])) {
			drawVectorPath(world, mask);
		} else {
			drawRectPath(world, mask);
		}
		ctx.restore();
		ctx.clip();
	}

	// Opacity and blend mode. The store slot may hold a destroyed entity's
	// value (ids are recycled), so it is only readable behind has().
	ctx.globalAlpha *= computed.opacity[eid]!;
	const bi = entity.has(BlendMode) ? store(world, BlendMode).value[eid] ?? 0 : 0;
	if (bi !== 0) ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[bi]!;

	const effects = buildEffects(world, entity);
	let initialFilter = 'none';

	if (effects !== null) {
		initialFilter = ctx.filter;
		ctx.filter = effects;
	}


	if (entity.has(Lottie)) {
		renderLottieNode(world, entity);
	} else if (entity.has(Caption)) {
		renderCaptionNode(world, entity);
	} else if (entity.has(Diagram)) {
		renderDiagram(world, entity);
	} else if (store(world, Geometry).value[eid] === GeometryType.TEXT) {
		renderTextNode(world, entity);
	} else if (store(world, Geometry).value[eid] === GeometryType.RECT) {
		renderShapeNode(world, entity);
	} else if (isVectorGeometry(store(world, Geometry).value[eid])) {
		renderVectorNode(world, entity);
	}

	// Clip and render children
	const children = store(world, Cache).children[eid] ?? [];
	if (children.length) {
		if (entity.has(ClipsContent)) {
			ctx.save();
			ctx.clip();
		}

		for (const child of children) {
			// Edge case: Child with transition
			if (child.has(Transition)) {
				renderTransition(world, entity, child);
				// Note: we are not breaking here since the transition handler will hide/unhide the children
			}

			renderNode(world, child);
		}

		if (entity.has(ClipsContent)) {
			ctx.restore();
		}
	}

	// Reset filter after drawing
	if (initialFilter !== 'none') {
		ctx.filter = initialFilter;
	}

	ctx.restore();
}

/**
 * Render system entry point. Call after transformSystem.
 *
 * Reads camera, background, and canvas size from world state and applies
 * DPR * Camera as the base canvas transform before drawing top-level nodes.
 * Without a render surface (headless world) this is a no-op.
 */
export function renderSystem(world: World): void {
	const surface = world.get(RenderSurface);
	const ctx = surface?.ctx;
	const canvas = surface?.canvas;
	if (!ctx || !canvas) return;

	const cw = canvas.width;
	const ch = canvas.height;

	// Clear + background (identity transform for full-canvas clear)
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, cw, ch);

	// The stage background is a preview-only affordance; offline encoding
	// renders just the scene onto a transparent canvas (the scene paints its
	// own fill if it has one).
	if (world.get(Mode)?.value === 'realtime') {
		const base = colorToHex(world.get(Root)!.get(Background)?.value ?? 0);
		const workspace = ctx.createLinearGradient(0, 0, 0, ch);
		workspace.addColorStop(0, '#0b0e0d');
		workspace.addColorStop(0.46, base);
		workspace.addColorStop(0.72, '#06110a');
		workspace.addColorStop(1, '#0d2a16');
		ctx.fillStyle = workspace;
		ctx.fillRect(0, 0, cw, ch);
		world.get(HitRegions)?.list.push({
			target: { kind: 'hud', id: 'canvas', quad: getCanvasQuad(cw, ch) },
		});
	}

	// Apply camera transform: DPR * Camera
	const view = getViewMatrix(world);
	ctx.setTransform(view.a, view.b, view.c, view.d, view.e, view.f);

	// Render top-level nodes.
	const stage = world.get(Root)!;
	for (const entity of world.query(Or(Geometry, Group), ChildOf(stage), Not(Culled))) {
		renderNode(world, entity);
	}
}

function getCanvasQuad(width: number, height: number): Quad {
	return [
		{ x: 0, y: 0 },
		{ x: width, y: 0 },
		{ x: width, y: height },
		{ x: 0, y: height },
	];
}
