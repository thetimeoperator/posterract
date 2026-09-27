/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Where a repeater's copies are, and how large each one is drawn.
 *
 * A repeater is one element drawn many times over, its copies placed by a
 * rule rather than one by one: a ring of eight dots, a sunflower of four
 * hundred, a grid with a wave running through it, the same grid leaning back
 * into a floor, a cloud of points folding from a sheet into a sphere into a
 * donut while the camera flies through it. Every one of those is a list of
 * positions seen through a camera, and those two things are all this module
 * works out. What is copied, and how a copy is painted, belong to the
 * renderer.
 *
 * Space is the screen's with depth added: x runs right, y runs down, z runs
 * away from the viewer, all in px, with the repeater's centre at the origin.
 * A copy goes through four steps, always in this order:
 *
 *   1. its place in the layout, or between two layouts while they morph;
 *   2. the ripple, a wave spreading from a centre point, which pushes the
 *      copy off its place or grows and shrinks it;
 *   3. the camera: roll, then tiltY, then tiltX, then perspective and dolly;
 *   4. zoom.
 *
 * Nothing here draws, and nothing is random unless it is seeded, so a frame
 * comes out the same in the preview and in the export. A layout depends on a
 * handful of numbers and is kept once worked out, so a frame costs one pass
 * over the copies, plus a sort when they stand at different depths.
 */

/**
 * How the copies are laid out, centred on the origin, before the camera:
 *
 * - `line`: along x, `spacing` apart.
 * - `grid`: rows of `columns`, `spacing` apart, filled left to right and top
 *   to bottom.
 * - `plane`: the grid laid flat in x–z, the grid's y becoming z, so row 0 is
 *   nearest the viewer. Seen straight on it is edge-on; tipped 90° by `tiltX`
 *   it is the grid again.
 * - `circle`: evenly round a circle of `radius`, from 12 o'clock, clockwise.
 * - `sunflower`: copy i `spacing` × √i out, a golden angle (137.5°) round
 *   from the one before — the seed head of a sunflower.
 * - `spiral`: an Archimedean spiral from the centre out to `radius`, its
 *   turns `spacing` apart, its copies evenly spaced along the curve.
 * - `sphere`: evenly over a sphere of `radius` (a Fibonacci sphere).
 * - `torus`: a donut whose ring, of `radius`, lies flat in x–z, and whose
 *   tube has a radius of `tube`.
 * - `cube`: dots along the twelve edges of a cube `radius` from its centre to
 *   each face.
 * - `random`: scattered evenly through a ball of `radius`, the same way for
 *   the same `seed`.
 */
export type RepeaterLayout =
	'line' | 'grid' | 'plane' | 'circle' | 'sunflower' | 'spiral' | 'sphere' | 'torus' | 'cube' | 'random';

/** Every layout a repeater knows. */
export const REPEATER_LAYOUTS: readonly RepeaterLayout[] = [
	'line', 'grid', 'plane', 'circle', 'sunflower', 'spiral', 'sphere', 'torus', 'cube', 'random',
];

export const isRepeaterLayout = (value: unknown): value is RepeaterLayout =>
	typeof value === 'string' && (REPEATER_LAYOUTS as readonly string[]).includes(value);

export interface RepeaterInput {
	/** Copies: clamped to 0–5000 and rounded down to a whole number. */
	count: number;
	layout: RepeaterLayout;
	/** The layout `morph` blends toward, copy for copy; null for none. */
	layoutTo: RepeaterLayout | null;
	/** 0–1, from `layout` to `layoutTo`, copy i to copy i. Ignored without a `layoutTo`. */
	morph: number;
	/** Grid and plane columns; 0 for as square as the count allows, ceil(√count). */
	columns: number;
	/** Px between neighbours on a line, grid or plane; the scale of a sunflower; the gap between a spiral's turns. */
	spacing: number;
	/** Circle and sphere radius, torus ring radius, cube half-edge, random extent, spiral outer radius. */
	radius: number;
	/** Torus tube radius. */
	tube: number;
	/** Seed of the random layout and the random stagger (a whole number). */
	seed: number;
	/** Wave amplitude: px of displacement in 'z' mode, a fraction of size in 'scale' mode. */
	ripple: number;
	/** Wave cycles per 1000 px of distance from the ripple centre. */
	rippleFrequency: number;
	/** Radians. Keyframe it and the wave travels outward. */
	ripplePhase: number;
	/** 'z' pushes copies off their layout (along z; along y for a 'plane'); 'scale' grows and shrinks them. */
	rippleMode: 'z' | 'scale';
	/** The ripple's centre, in px, in layout space (before the camera turns anything). For a 'plane' it is (x, z). */
	rippleCenterX: number;
	rippleCenterY: number;
	/**
	 * Degrees about the horizontal. Positive tips the top away from the
	 * viewer, as CSS `rotateX` does, so a 'grid' leans back into a floor.
	 * A 'plane' or 'torus' lies flat already and starts edge-on: negative
	 * tiltX looks down onto it, positive looks up at it from beneath.
	 */
	tiltX: number;
	/** Degrees about the vertical. Positive swings the right side away, as CSS `rotateY` does. */
	tiltY: number;
	/** Degrees about the view axis. Positive turns clockwise on screen, as a 2D rotation does. */
	roll: number;
	/** Scales positions and copy size together, after projection. Never below 0. */
	zoom: number;
	/** The viewer's distance from the centre in px, a focal length: shorter is a wider lens. 0 or less is orthographic. */
	perspective: number;
	/** Dolly, px: positive moves the viewer toward the copies, which grow; far enough and it passes through them. Needs perspective. */
	cameraZ: number;
}

export interface RepeaterInstance {
	/** Which copy this is, 0 … count − 1. */
	index: number;
	/** Where it is drawn, px from the repeater's centre. */
	x: number;
	y: number;
	/** How far from the viewer, larger is farther. Orthographic: the turned z, which only orders copies. */
	depth: number;
	/** Its size as a multiple of the template's: zoom × perspective × ripple. Never negative; 0 when not visible. */
	scale: number;
	/** The ripple's value at this copy, −1 … 1, whatever the amplitude, for colouring by. */
	wave: number;
	/** False when at or behind the lens. */
	visible: boolean;
}

/** A repeater with nothing about it authored: twelve copies in a ring, seen straight on. */
export const REPEATER_DEFAULTS: RepeaterInput = Object.freeze<RepeaterInput>({
	count: 12,
	layout: 'circle',
	layoutTo: null,
	morph: 0,
	columns: 0,
	spacing: 40,
	radius: 200,
	tube: 60,
	seed: 1,
	ripple: 0,
	rippleFrequency: 2,
	ripplePhase: 0,
	rippleMode: 'z',
	rippleCenterX: 0,
	rippleCenterY: 0,
	tiltX: 0,
	tiltY: 0,
	roll: 0,
	zoom: 1,
	perspective: 0,
	cameraZ: 0,
});

export type StaggerOrder = 'index' | 'reverse' | 'center' | 'edges' | 'random' | 'radial';

/** Every order a stagger can run in. */
export const STAGGER_ORDERS: readonly StaggerOrder[] = ['index', 'reverse', 'center', 'edges', 'random', 'radial'];

export const isStaggerOrder = (value: unknown): value is StaggerOrder =>
	typeof value === 'string' && (STAGGER_ORDERS as readonly string[]).includes(value);

const MAX_COUNT = 5000;
/** Px (or degrees) past which a number means nothing on a frame, and only risks overflowing the arithmetic. */
const LIMIT = 1e6;
/** How close to the lens a copy may come, in px, before it counts as behind it. */
const NEAR = 1;
const TO_RADIANS = Math.PI / 180;
/** 137.50776°: the turn between a sunflower's seeds, and between a Fibonacci sphere's points. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
/** The tightest a spiral winds; past this many turns it is a disc anyway. */
const MAX_TURNS = 1000;
/** Layouts kept worked out: room for two per repeater (a morph's both ends) in a busy scene. */
const CACHE_SIZE = 64;
/** Sets the random stagger's stream apart from the random layout's, though they share a seed. */
const SHUFFLE_SALT = 0x9e3779b9;

/** A number as a setting: its default when missing or not finite, and otherwise kept inside [min, max]. */
function setting(value: unknown, fallback: number, min = -LIMIT, max = LIMIT): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

/**
 * A whole number of something from a value that may be keyframed: 11.9999999
 * is 12, but 11.5 is still 11, so a copy appears as the count passes its number.
 */
const whole = (value: number): number => Math.floor(value + 1e-6);

/**
 * The input made safe to compute with. Settings arrive from authored source
 * and from keyframe tracks, so a number can be missing, NaN or absurd, and a
 * layout misspelled; each takes its default before it reaches the arithmetic,
 * which is why nothing downstream ever comes out NaN.
 */
function resolve(input: RepeaterInput): RepeaterInput {
	const defaults = REPEATER_DEFAULTS;
	const seed = setting(input.seed, defaults.seed, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
	return {
		count: whole(setting(input.count, defaults.count, 0, MAX_COUNT)),
		layout: isRepeaterLayout(input.layout) ? input.layout : defaults.layout,
		layoutTo: isRepeaterLayout(input.layoutTo) ? input.layoutTo : null,
		morph: setting(input.morph, defaults.morph, 0, 1),
		columns: whole(setting(input.columns, defaults.columns, 0, MAX_COUNT)),
		spacing: setting(input.spacing, defaults.spacing),
		radius: setting(input.radius, defaults.radius),
		tube: setting(input.tube, defaults.tube),
		seed: Math.floor(seed) >>> 0,
		ripple: setting(input.ripple, defaults.ripple),
		rippleFrequency: setting(input.rippleFrequency, defaults.rippleFrequency),
		ripplePhase: setting(input.ripplePhase, defaults.ripplePhase),
		rippleMode: input.rippleMode === 'scale' ? 'scale' : 'z',
		rippleCenterX: setting(input.rippleCenterX, defaults.rippleCenterX),
		rippleCenterY: setting(input.rippleCenterY, defaults.rippleCenterY),
		tiltX: setting(input.tiltX, defaults.tiltX),
		tiltY: setting(input.tiltY, defaults.tiltY),
		roll: setting(input.roll, defaults.roll),
		zoom: setting(input.zoom, defaults.zoom, 0),
		perspective: setting(input.perspective, defaults.perspective),
		cameraZ: setting(input.cameraZ, defaults.cameraZ),
	};
}

/**
 * mulberry32: a small generator whose whole state is one 32-bit number, so a
 * seed replays the same sequence on every machine. Values are in [0, 1).
 */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Worked-out layouts, the most recently used last. */
const layouts = new Map<string, Float64Array>();

/** The settings a layout depends on and nothing else, so a zoom or a tilt never works one out again. */
function layoutKey(layout: RepeaterLayout, s: RepeaterInput): string {
	switch (layout) {
		case 'line':
		case 'sunflower':
			return `${layout} ${s.count} ${s.spacing}`;
		case 'grid':
		case 'plane':
			return `${layout} ${s.count} ${s.columns} ${s.spacing}`;
		case 'spiral':
			return `${layout} ${s.count} ${s.radius} ${s.spacing}`;
		case 'torus':
			return `${layout} ${s.count} ${s.radius} ${s.tube}`;
		case 'random':
			return `${layout} ${s.count} ${s.radius} ${s.seed}`;
		case 'circle':
		case 'sphere':
		case 'cube':
			return `${layout} ${s.count} ${s.radius}`;
	}
}

/**
 * A layout's points, worked out once and then kept. The array is shared by
 * every frame that asks for the same layout, so it never leaves this module.
 */
function pointsOf(layout: RepeaterLayout, s: RepeaterInput): Float64Array {
	const key = layoutKey(layout, s);
	let points = layouts.get(key);
	if (points) {
		layouts.delete(key);
	} else {
		points = build(layout, s);
		if (layouts.size >= CACHE_SIZE) layouts.delete(layouts.keys().next().value!);
	}
	layouts.set(key, points);
	return points;
}

function build(layout: RepeaterLayout, s: RepeaterInput): Float64Array {
	const n = s.count;
	const out = new Float64Array(n * 3);
	if (n === 0) return out;

	switch (layout) {
		case 'line':
			for (let i = 0; i < n; i += 1) out[i * 3] = (i - (n - 1) / 2) * s.spacing;
			break;

		case 'grid':
		case 'plane': {
			// More columns than copies would leave the one row off-centre.
			const columns = s.columns > 0 ? Math.min(s.columns, n) : Math.ceil(Math.sqrt(n));
			const rows = Math.ceil(n / columns);
			// The grid's y is the plane's z.
			const down = layout === 'grid' ? 1 : 2;
			for (let i = 0; i < n; i += 1) {
				out[i * 3] = ((i % columns) - (columns - 1) / 2) * s.spacing;
				out[i * 3 + down] = (Math.floor(i / columns) - (rows - 1) / 2) * s.spacing;
			}
			break;
		}

		case 'circle':
			for (let i = 0; i < n; i += 1) polar(out, i, s.radius, (2 * Math.PI * i) / n);
			break;

		case 'sunflower':
			for (let i = 0; i < n; i += 1) polar(out, i, s.spacing * Math.sqrt(i), i * GOLDEN_ANGLE);
			break;

		case 'spiral':
			spiral(out, n, s.radius, s.spacing);
			break;

		case 'sphere':
			// Evenly spaced heights cut a sphere into bands of equal area, and a
			// golden angle between neighbours keeps any two from lining up.
			for (let i = 0; i < n; i += 1) {
				const height = (2 * i + 1) / n - 1;
				const ring = Math.sqrt(Math.max(0, 1 - height * height));
				const angle = i * GOLDEN_ANGLE;
				out[i * 3] = s.radius * ring * Math.cos(angle);
				out[i * 3 + 1] = s.radius * height;
				out[i * 3 + 2] = s.radius * ring * Math.sin(angle);
			}
			break;

		case 'torus':
			// Round the ring in index order, round the tube by the golden ratio:
			// a lattice with no two copies in one spot and no bunching.
			for (let i = 0; i < n; i += 1) {
				const around = (2 * Math.PI * i) / n;
				const tube = 2 * Math.PI * ((i * GOLDEN_RATIO) % 1);
				const reach = s.radius + s.tube * Math.cos(tube);
				out[i * 3] = reach * Math.cos(around);
				out[i * 3 + 1] = s.tube * Math.sin(tube);
				out[i * 3 + 2] = reach * Math.sin(around);
			}
			break;

		case 'cube':
			cube(out, n, s.radius);
			break;

		case 'random': {
			// A uniform height gives a uniform direction, and a cube root
			// spreads distance by volume: uniform through the ball. Three draws a
			// copy, so copy i depends on the seed and i alone, and adding copies
			// leaves the others where they were.
			const next = mulberry32(s.seed);
			for (let i = 0; i < n; i += 1) {
				const height = 1 - 2 * next();
				const angle = 2 * Math.PI * next();
				const reach = s.radius * Math.cbrt(next());
				const ring = Math.sqrt(Math.max(0, 1 - height * height));
				out[i * 3] = reach * ring * Math.cos(angle);
				out[i * 3 + 1] = reach * height;
				out[i * 3 + 2] = reach * ring * Math.sin(angle);
			}
			break;
		}
	}
	return out;
}

/** Copy i placed `radius` out at `angle` radians clockwise from 12 o'clock, as on a clock face. */
function polar(out: Float64Array, i: number, radius: number, angle: number): void {
	out[i * 3] = radius * Math.sin(angle);
	out[i * 3 + 1] = -radius * Math.cos(angle);
}

/**
 * An Archimedean spiral, r = a·θ, from the centre out to `radius`, with its
 * turns `spacing` apart. Its copies are an equal distance apart along the
 * curve rather than an equal angle, which would crowd them into the middle.
 */
function spiral(out: Float64Array, n: number, radius: number, spacing: number): void {
	const reach = Math.abs(radius);
	if (reach === 0) return;
	const sign = radius < 0 ? -1 : 1;
	const a = Math.max(Math.abs(spacing), reach / MAX_TURNS) / (2 * Math.PI);
	const end = reach / a;
	const length = spiralLength(end);
	for (let i = 0; i < n; i += 1) {
		let angle = 0;
		if (i === n - 1 && n > 1) {
			// The last copy exactly on the rim, not wherever the solver stopped.
			angle = end;
		} else if (i > 0) {
			angle = spiralAngle((length * i) / (n - 1));
		}
		polar(out, i, sign * a * angle, angle);
	}
}

/** How far along r = a·θ the curve has run by angle θ, in units of a. */
const spiralLength = (angle: number): number => (angle * Math.sqrt(1 + angle * angle) + Math.asinh(angle)) / 2;

/**
 * The angle at which the spiral has run `length` (in units of a), by Newton's
 * method. The start is above the answer — the curve is at least as long as
 * both θ and θ²/2 — and from above, on a curve that only bends upward, each
 * step lands closer without overshooting.
 */
function spiralAngle(length: number): number {
	if (length <= 0) return 0;
	let angle = Math.min(length, Math.sqrt(2 * length));
	for (let step = 0; step < 50; step += 1) {
		const change = (spiralLength(angle) - length) / Math.sqrt(1 + angle * angle);
		angle -= change;
		if (change <= 1e-12 * angle) break;
	}
	return angle;
}

type Point = [number, number, number];

/**
 * Which edges take a spare copy first when the copies do not share out evenly:
 * edges round the cube from one another rather than bunched on one side.
 * Numbered as `cube` walks them: bottom square 0–3, uprights 4–7, top square 8–11.
 */
const CUBE_SPARES = [0, 6, 11, 10, 4, 1, 2, 3, 7, 8, 9, 5];

/**
 * A wireframe cube in dots, `half` from its centre to each face.
 *
 * The edges are walked as a pen would draw the cube — round the bottom
 * square, up the four uprights, round the top square — so a stagger in index
 * order draws it. Each corner is placed once, by the square edge that starts
 * there; the other copies share out between the twelve edges, evenly spaced
 * along each. Under eight copies there are only corners, and not all of them.
 */
function cube(out: Float64Array, n: number, half: number): void {
	// A square's corners in drawing order, as [x, z]: front left, front right, back right, back left.
	const square = [[-half, -half], [half, -half], [half, half], [-half, half]] as const;
	const corner = (j: number, y: number): Point => {
		const [x, z] = square[j % 4]!;
		return [x, y, z];
	};
	// y runs down, so the bottom square is at +half.
	const edges: Array<{ from: Point; to: Point; ownsStart: boolean }> = [];
	for (let j = 0; j < 4; j += 1) edges.push({ from: corner(j, half), to: corner(j + 1, half), ownsStart: true });
	for (let j = 0; j < 4; j += 1) edges.push({ from: corner(j, half), to: corner(j, -half), ownsStart: false });
	for (let j = 0; j < 4; j += 1) edges.push({ from: corner(j, -half), to: corner(j + 1, -half), ownsStart: true });

	const between = Math.max(0, n - 8);
	const each = Math.floor(between / 12);
	const spares = between % 12;

	let i = 0;
	const place = (x: number, y: number, z: number): void => {
		if (i >= n) return;
		out[i * 3] = x;
		out[i * 3 + 1] = y;
		out[i * 3 + 2] = z;
		i += 1;
	};
	edges.forEach(({ from, to, ownsStart }, edge) => {
		if (ownsStart) place(from[0], from[1], from[2]);
		const along = each + (CUBE_SPARES.indexOf(edge) < spares ? 1 : 0);
		for (let k = 1; k <= along; k += 1) {
			const t = k / (along + 1);
			place(
				from[0] + (to[0] - from[0]) * t,
				from[1] + (to[1] - from[1]) * t,
				from[2] + (to[2] - from[2]) * t,
			);
		}
	});
}

/**
 * The copies' positions in `layout`, before the ripple and the camera: x, y, z
 * for each copy in turn, centred on the origin.
 *
 * The array is a fresh copy on every call. The layout it was copied from is
 * kept for the next frame and never handed out, so nothing done to this one
 * can disturb a later frame.
 */
export function layoutPoints(layout: RepeaterLayout, input: RepeaterInput): Float64Array {
	const settings = resolve(input);
	return pointsOf(isRepeaterLayout(layout) ? layout : settings.layout, settings).slice();
}

/**
 * Every copy, projected, in the order to draw them: farthest first, so nearer
 * copies paint over farther ones. Copies at the same depth keep index order,
 * which is all a flat repeater ever has.
 *
 * Morphing blends each copy's position in `layout` with its position in
 * `layoutTo`, index for index. The ripple is then measured at the blended
 * position: `wave` = sin(2π × rippleFrequency × d / 1000 − ripplePhase), d
 * being the distance from the ripple's centre in x–y, or across the floor
 * (x–z) for a 'plane'. In 'z' mode a copy moves `ripple × wave` along z (a
 * plane's copies along y, bobbing like a floor); in 'scale' mode its scale is
 * multiplied by 1 + ripple × wave, and never goes below 0.
 *
 * The camera then turns the copies about the centre by `roll`, then `tiltY`,
 * then `tiltX` — the turn CSS gives `rotateX(tiltX) rotateY(tiltY)
 * rotateZ(roll)` — and projects them:
 *
 * - Orthographic (`perspective` ≤ 0): x and y as turned, times `zoom`. The
 *   turned z is the depth, good only for ordering; every copy is visible and
 *   `cameraZ` changes nothing.
 * - Perspective: the viewer stands `perspective` px in front of the centre,
 *   `cameraZ` px nearer when dollied, so a copy's depth is
 *   perspective − cameraZ + z, and it is seen at perspective / depth of its
 *   size, pulled toward the centre by the same factor, then times `zoom`. A
 *   copy at depth 1 or less is at or behind the lens: not visible, scale 0,
 *   and its other numbers still finite, so a renderer that forgets to check
 *   draws nothing rather than something enormous.
 *
 * Together that is CSS's `perspective(p) translateZ(cameraZ) rotateX(…)
 * rotateY(…) rotateZ(…)` followed by `scale(zoom)`.
 */
export function computeInstances(input: RepeaterInput): RepeaterInstance[] {
	const s = resolve(input);
	const n = s.count;
	if (n === 0) return [];

	const target = s.layoutTo ?? s.layout;
	const t = target === s.layout ? 0 : s.morph;
	const from = pointsOf(s.layout, s);
	const to = t > 0 ? pointsOf(target, s) : from;

	// A 'plane' measures its ripple across the floor and bobs along y; every
	// other layout measures in x–y and bobs along z. Mid-morph between the two
	// kinds, each has its share of the wave.
	const fromFloor = s.layout === 'plane';
	const toFloor = target === 'plane';
	const floor = fromFloor === toFloor ? (fromFloor ? 1 : 0) : fromFloor ? 1 - t : t;
	const upright = 1 - floor;
	const perPx = (2 * Math.PI * s.rippleFrequency) / 1000;
	const { ripple, ripplePhase: phase, rippleCenterX: centerX, rippleCenterY: centerY } = s;
	const bob = s.rippleMode === 'z';

	const cosRoll = Math.cos(s.roll * TO_RADIANS);
	const sinRoll = Math.sin(s.roll * TO_RADIANS);
	const cosYaw = Math.cos(s.tiltY * TO_RADIANS);
	const sinYaw = Math.sin(s.tiltY * TO_RADIANS);
	const cosPitch = Math.cos(s.tiltX * TO_RADIANS);
	const sinPitch = Math.sin(s.tiltX * TO_RADIANS);
	const focal = s.perspective;
	const eye = focal - s.cameraZ;

	const instances: RepeaterInstance[] = [];
	let nearest = Infinity;
	let farthest = -Infinity;
	for (let i = 0; i < n; i += 1) {
		const j = i * 3;
		const x = from[j]! * (1 - t) + to[j]! * t;
		let y = from[j + 1]! * (1 - t) + to[j + 1]! * t;
		let z = from[j + 2]! * (1 - t) + to[j + 2]! * t;

		let upWave = 0;
		let floorWave = 0;
		if (upright > 0) {
			const dx = x - centerX;
			const dy = y - centerY;
			upWave = upright * Math.sin(perPx * Math.sqrt(dx * dx + dy * dy) - phase);
		}
		if (floor > 0) {
			const dx = x - centerX;
			const dz = z - centerY;
			floorWave = floor * Math.sin(perPx * Math.sqrt(dx * dx + dz * dz) - phase);
		}
		const wave = upWave + floorWave;
		let grow = 1;
		if (bob) {
			z += ripple * upWave;
			y += ripple * floorWave;
		} else {
			grow = Math.max(0, 1 + ripple * wave);
		}

		// Roll, about the view axis: clockwise on screen.
		const x1 = x * cosRoll - y * sinRoll;
		const y1 = x * sinRoll + y * cosRoll;
		// tiltY, about the vertical: the right side swings away.
		const x2 = x1 * cosYaw - z * sinYaw;
		const z2 = x1 * sinYaw + z * cosYaw;
		// tiltX, about the horizontal: the top tips away.
		const y3 = y1 * cosPitch + z2 * sinPitch;
		const z3 = z2 * cosPitch - y1 * sinPitch;

		let depth = z3;
		let factor = s.zoom;
		let visible = true;
		if (focal > 0) {
			depth = eye + z3;
			visible = depth > NEAR;
			// At or behind the lens there is no true projection; the near
			// plane's stands in, to keep the numbers finite.
			factor = (focal / Math.max(depth, NEAR)) * s.zoom;
		}

		instances.push({ index: i, x: x2 * factor, y: y3 * factor, depth, scale: visible ? factor * grow : 0, wave, visible });
		if (depth < nearest) nearest = depth;
		if (depth > farthest) farthest = depth;
	}

	if (farthest > nearest) instances.sort((a, b) => b.depth - a.depth || a.index - b.index);
	return instances;
}

/**
 * When each copy starts, as a rank to multiply by the stagger: copy i starts
 * `rank[i] × stagger` after the first. Ranks start at 0, so something always
 * starts at once.
 *
 * - `index`: 0, 1, 2 … in copy order; `reverse`: the other way round.
 * - `center`: from the middle copy outward, both ways at once, one step a
 *   copy; `edges`: from both ends inward. With an even count the middle two
 *   start together.
 * - `random`: a shuffle of 0 … count − 1, the same for the same `seed`.
 * - `radial`: by distance from the layout's centre, in proportion — nearest
 *   0, farthest count − 1 — so the start spreads outward at an even speed.
 *   Copies at one distance start together, so a ring starts all at once.
 *   Measured on `layout` alone, never a morph's in-between, so the ranks hold
 *   still while the copies move.
 */
export function staggerRanks(input: RepeaterInput, order: StaggerOrder): Float64Array {
	const s = resolve(input);
	const n = s.count;
	const ranks = new Float64Array(n);
	const middle = (n - 1) / 2;

	switch (isStaggerOrder(order) ? order : 'index') {
		case 'index':
			for (let i = 0; i < n; i += 1) ranks[i] = i;
			break;

		case 'reverse':
			for (let i = 0; i < n; i += 1) ranks[i] = n - 1 - i;
			break;

		case 'center':
			// With an even count the middle falls between two copies, half a step from each.
			for (let i = 0; i < n; i += 1) ranks[i] = Math.abs(i - middle) - (middle % 1);
			break;

		case 'edges':
			for (let i = 0; i < n; i += 1) ranks[i] = middle - Math.abs(i - middle);
			break;

		case 'random': {
			// Fisher–Yates.
			const next = mulberry32(s.seed ^ SHUFFLE_SALT);
			for (let i = 0; i < n; i += 1) ranks[i] = i;
			for (let i = n - 1; i > 0; i -= 1) {
				const j = Math.floor(next() * (i + 1));
				const swap = ranks[i]!;
				ranks[i] = ranks[j]!;
				ranks[j] = swap;
			}
			break;
		}

		case 'radial': {
			const points = pointsOf(s.layout, s);
			let nearest = Infinity;
			let farthest = 0;
			for (let i = 0; i < n; i += 1) {
				const distance = Math.hypot(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!);
				ranks[i] = distance;
				if (distance < nearest) nearest = distance;
				if (distance > farthest) farthest = distance;
			}
			// A ring or a sphere is all at one distance, give or take float dust.
			const span = farthest - nearest;
			const together = span <= farthest * 1e-9;
			for (let i = 0; i < n; i += 1) ranks[i] = together ? 0 : ((ranks[i]! - nearest) / span) * (n - 1);
			break;
		}
	}
	return ranks;
}
