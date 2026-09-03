/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The resolved geometry of a vector node.
 *
 * `<path>`, `<ellipse>` and `<polygon>` all come down to one command list, so
 * everything downstream — drawing, trimming, bounds, hit-testing — has a
 * single thing to work from. Results are memoised on a signature of what they
 * were built from, because a still frame should not re-parse a path sixty
 * times a second, and a morphing one must re-parse the moment its blend moves.
 */

import { store } from '../world/store';
import { GeometryType } from '../constants';
import { Computed, Geometry, Path, Polygon } from '../traits';
import { flattenPath, morphPath, parsePath, parsePoints, type PathCommand, type SubPath } from '../utils/vector';

import type { Entity, World } from 'koota';

/** Whether a geometry type is one of the free vector figures. */
export function isVectorGeometry(type: GeometryType | undefined): boolean {
	return type === GeometryType.PATH || type === GeometryType.ELLIPSE || type === GeometryType.POLYGON;
}

interface CacheEntry {
	signature: string;
	commands: PathCommand[];
	subpaths?: SubPath[];
}

// Keyed by entity id: koota entities are numbers, so they cannot key a
// WeakMap, and a Map keyed on them is what every other per-entity cache here
// uses. Entries are replaced, never accumulated per frame, and an id that is
// recycled arrives with a different signature.
const cache = new Map<number, CacheEntry>();

/** Forget an entity's cached geometry. Called when one is destroyed. */
export function forgetVectorGeometry(entity: number): void {
	cache.delete(entity);
}

/**
 * The figure as absolute path commands, with any morph already applied.
 *
 * An ellipse is built from four arcs and a polygon from its points, so a
 * `trim` means the same thing on all three and a `<path>` is not a special
 * case with more features than its siblings.
 */
export function vectorCommands(world: World, entity: Entity): PathCommand[] {
	const eid = entity.id();
	const computed = store(world, Computed);
	const type = store(world, Geometry).value[eid];
	const width = computed.width[eid] ?? 0;
	const height = computed.height[eid] ?? 0;

	if (type === GeometryType.ELLIPSE) {
		return read(eid, `e:${width}:${height}`, () => ellipseCommands(width, height));
	}

	if (type === GeometryType.POLYGON) {
		const points = entity.has(Polygon) ? store(world, Polygon).points[eid] ?? '' : '';
		return read(eid, `g:${points}`, () => polygonCommands(points));
	}

	if (!entity.has(Path)) return [];
	const paths = store(world, Path);
	const d = paths.d[eid] ?? '';
	const morphTo = paths.morphTo[eid] ?? '';
	// Rounded: a blend finer than a thousandth of the way across is a frame
	// nobody can see, and rounding is what keeps a slow morph off the parser.
	const morph = morphTo ? Math.round((computed.morph[eid] ?? 0) * 1000) / 1000 : 0;

	return read(eid, `p:${d}|${morphTo}|${morph}`, () => (
		morph > 0 ? morphPath(parsePath(d), parsePath(morphTo), morph) : parsePath(d)
	));
}

/** The same figure, flattened into polylines — what trim and bounds need. */
export function vectorSubPaths(world: World, entity: Entity): SubPath[] {
	const commands = vectorCommands(world, entity);
	const entry = cache.get(entity.id());
	if (entry && entry.commands === commands && entry.subpaths) return entry.subpaths;
	const subpaths = flattenPath(commands);
	if (entry) entry.subpaths = subpaths;
	return subpaths;
}

function read(eid: number, signature: string, build: () => PathCommand[]): PathCommand[] {
	const entry = cache.get(eid);
	if (entry?.signature === signature) return entry.commands;
	const commands = build();
	cache.set(eid, { signature, commands });
	return commands;
}

/**
 * An ellipse inscribed in the node's box, as four arcs.
 *
 * Arcs rather than the canvas `ellipse()` call so that the figure has a path
 * length, which is what makes `trim` work on it.
 */
function ellipseCommands(width: number, height: number): PathCommand[] {
	const rx = width / 2;
	const ry = height / 2;
	if (rx <= 0 || ry <= 0) return [];
	return [
		{ type: 'M', values: [0, ry] },
		{ type: 'A', values: [rx, ry, 0, 0, 1, rx, 0] },
		{ type: 'A', values: [rx, ry, 0, 0, 1, width, ry] },
		{ type: 'A', values: [rx, ry, 0, 0, 1, rx, height] },
		{ type: 'A', values: [rx, ry, 0, 0, 1, 0, ry] },
		{ type: 'Z', values: [] },
	];
}

function polygonCommands(points: string): PathCommand[] {
	const numbers = parsePoints(points);
	if (numbers.length < 4) return [];
	const commands: PathCommand[] = [{ type: 'M', values: [numbers[0]!, numbers[1]!] }];
	for (let i = 2; i < numbers.length; i += 2) {
		commands.push({ type: 'L', values: [numbers[i]!, numbers[i + 1]!] });
	}
	commands.push({ type: 'Z', values: [] });
	return commands;
}
