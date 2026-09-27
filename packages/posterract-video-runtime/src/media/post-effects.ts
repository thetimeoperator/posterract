/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The finishing effects: grain, vignette, glow, colour fringe and directional
 * blur. None of them is a CSS filter, so each works on a rendered layer — the
 * element (or the whole scene) drawn alone into a canvas the size of the
 * frame — and hands the result back to be composited where the element was.
 *
 * Everything is canvas 2D, and deterministic: the grain is seeded by the
 * frame, so the same frame always has the same grain, in the preview and in
 * the export.
 */

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type Layer = { canvas: Canvas; ctx: Ctx };

function makeCanvas(width: number, height: number): Canvas {
	if (typeof document !== 'undefined') {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
	return new OffscreenCanvas(width, height);
}

function makeLayer(width: number, height: number): Layer {
	const canvas = makeCanvas(width, height);
	return { canvas, ctx: canvas.getContext('2d') as Ctx };
}

/**
 * Canvases the size of the frame, handed out by depth: an effect inside an
 * effect needs a layer of its own. Kept between frames, so an effect does not
 * allocate a frame-sized canvas every time it draws.
 */
const pools = new WeakMap<object, Layer[]>();

/** The layer at `depth` for `owner`, cleared and sized to `width`×`height`. */
export function acquireLayer(owner: object, depth: number, width: number, height: number): Layer {
	let pool = pools.get(owner);
	if (!pool) {
		pool = [];
		pools.set(owner, pool);
	}
	let layer = pool[depth];
	if (!layer) {
		layer = makeLayer(width, height);
		pool[depth] = layer;
	}
	if (layer.canvas.width !== width || layer.canvas.height !== height) {
		layer.canvas.width = width;
		layer.canvas.height = height;
	}
	reset(layer.ctx);
	layer.ctx.clearRect(0, 0, width, height);
	return layer;
}

/** Scratch canvases the effects work in, shared: an effect is done with its scratch before the next one starts. */
const scratch: Layer[] = [];

function scratchLayer(index: number, width: number, height: number): Layer {
	let layer = scratch[index];
	if (!layer) {
		layer = makeLayer(width, height);
		scratch[index] = layer;
	}
	if (layer.canvas.width !== width || layer.canvas.height !== height) {
		layer.canvas.width = width;
		layer.canvas.height = height;
	}
	reset(layer.ctx);
	layer.ctx.clearRect(0, 0, width, height);
	return layer;
}

function reset(ctx: Ctx): void {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
	ctx.filter = 'none';
	ctx.imageSmoothingEnabled = true;
}

// ── Grain ─────────────────────────────────────────────────

const GRAIN_TILE = 256;
const GRAIN_TILES = 4;
const grainTiles: Canvas[] = [];

/** A small deterministic PRNG (mulberry32): the grain must be the same on every run. */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6D2B79F5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function grainTile(index: number): Canvas {
	const cached = grainTiles[index];
	if (cached) return cached;
	const canvas = makeCanvas(GRAIN_TILE, GRAIN_TILE);
	const ctx = canvas.getContext('2d') as Ctx;
	const image = ctx.createImageData(GRAIN_TILE, GRAIN_TILE);
	const next = random(0x9E3779B9 ^ (index * 7919));
	for (let i = 0; i < image.data.length; i += 4) {
		// Around mid grey, so overlay both lightens and darkens; the sum of
		// three uniforms leans toward the middle the way film grain does.
		const value = Math.round(((next() + next() + next()) / 3) * 255);
		image.data[i] = value;
		image.data[i + 1] = value;
		image.data[i + 2] = value;
		image.data[i + 3] = 255;
	}
	ctx.putImageData(image, 0, 0);
	grainTiles[index] = canvas;
	return canvas;
}

/**
 * Film grain over what the layer holds (never over its transparent parts):
 * a noise tile, shifted and flipped by the frame so it changes every frame
 * without being random, blended in with overlay.
 */
export function applyGrain(layer: Layer, amount: number, size: number, frame: number): void {
	if (amount <= 0) return;
	const { canvas, ctx } = layer;
	const { width, height } = canvas;

	const keep = scratchLayer(0, width, height);
	keep.ctx.drawImage(canvas, 0, 0);

	const index = Math.abs(Math.floor(frame)) % GRAIN_TILES;
	const next = random(Math.floor(frame) * 2654435761);
	const pattern = ctx.createPattern(grainTile(index), 'repeat');
	if (!pattern) return;
	const scale = Math.max(0.25, size);
	pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, next() * GRAIN_TILE * scale, next() * GRAIN_TILE * scale]));

	ctx.save();
	reset(ctx);
	ctx.globalCompositeOperation = 'overlay';
	ctx.globalAlpha = Math.min(1, amount);
	ctx.fillStyle = pattern;
	ctx.fillRect(0, 0, width, height);
	// Overlay paints the transparent parts too; the layer's own coverage is
	// put back so grain lies only on what was drawn.
	ctx.globalCompositeOperation = 'destination-in';
	ctx.globalAlpha = 1;
	ctx.drawImage(keep.canvas, 0, 0);
	ctx.restore();
}

// ── Vignette ──────────────────────────────────────────────

/** Darkens toward the edges of `box` (device px), over what the layer holds. */
export function applyVignette(
	layer: Layer,
	amount: number,
	reach: number,
	box: { x: number; y: number; width: number; height: number },
): void {
	if (amount <= 0) return;
	const { ctx } = layer;
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	const outer = Math.hypot(box.width, box.height) / 2;
	const inner = outer * Math.max(0, Math.min(0.95, 1 - (reach > 0 ? reach : 0.5)));
	const gradient = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
	gradient.addColorStop(0, 'rgba(0,0,0,0)');
	gradient.addColorStop(1, `rgba(0,0,0,${Math.min(1, amount)})`);

	ctx.save();
	reset(ctx);
	ctx.globalCompositeOperation = 'source-atop';
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
	ctx.restore();
}

// ── Glow ──────────────────────────────────────────────────

/** Adds a blurred copy of the layer's own light on top of it. */
export function applyGlow(layer: Layer, strength: number, radius: number): void {
	if (strength <= 0 || radius <= 0) return;
	const { canvas, ctx } = layer;
	const blurred = scratchLayer(0, canvas.width, canvas.height);
	blurred.ctx.filter = `blur(${radius}px)`;
	blurred.ctx.drawImage(canvas, 0, 0);
	blurred.ctx.filter = 'none';

	ctx.save();
	reset(ctx);
	ctx.globalCompositeOperation = 'lighter';
	let remaining = strength;
	while (remaining > 0) {
		ctx.globalAlpha = Math.min(1, remaining);
		ctx.drawImage(blurred.canvas, 0, 0);
		remaining -= 1;
	}
	ctx.restore();
}

// ── Chromatic aberration ──────────────────────────────────

function channel(source: Canvas, index: number, color: string): Layer {
	const { width, height } = source;
	const layer = scratchLayer(index, width, height);
	const { ctx } = layer;
	ctx.drawImage(source, 0, 0);
	// Multiplying by a pure primary keeps that channel alone; the source's
	// coverage is then put back, since multiply paints transparent parts.
	ctx.globalCompositeOperation = 'multiply';
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, width, height);
	ctx.globalCompositeOperation = 'destination-in';
	ctx.drawImage(source, 0, 0);
	ctx.globalCompositeOperation = 'source-over';
	return layer;
}

/** Pulls red one way and blue the other by `offset` device px along `angle` (radians). */
export function applyChromaticAberration(layer: Layer, offset: number, angle = 0): void {
	if (offset === 0) return;
	const { canvas, ctx } = layer;
	const red = channel(canvas, 1, '#ff0000');
	const green = channel(canvas, 2, '#00ff00');
	const blue = channel(canvas, 3, '#0000ff');
	const dx = Math.cos(angle) * offset;
	const dy = Math.sin(angle) * offset;

	ctx.save();
	reset(ctx);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.globalCompositeOperation = 'lighter';
	ctx.drawImage(red.canvas, -dx, -dy);
	ctx.drawImage(green.canvas, 0, 0);
	ctx.drawImage(blue.canvas, dx, dy);
	ctx.restore();
}

// ── Directional blur ──────────────────────────────────────

/** Smears the layer along `angle` (radians) over `length` device px, centred on where it is. */
export function applyDirectionalBlur(layer: Layer, length: number, angle: number): void {
	const span = Math.abs(length);
	if (span < 0.5) return;
	const { canvas, ctx } = layer;
	const samples = Math.max(4, Math.min(32, Math.ceil(span / 2)));
	const copy = scratchLayer(0, canvas.width, canvas.height);
	copy.ctx.drawImage(canvas, 0, 0);

	const dx = Math.cos(angle);
	const dy = Math.sin(angle);
	ctx.save();
	reset(ctx);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.globalCompositeOperation = 'lighter';
	ctx.globalAlpha = 1 / samples;
	for (let i = 0; i < samples; i++) {
		const t = (i / (samples - 1) - 0.5) * span;
		ctx.drawImage(copy.canvas, dx * t, dy * t);
	}
	ctx.restore();
}
