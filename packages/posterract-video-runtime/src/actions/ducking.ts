/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Sidechain ducking: hold the music down while the voice is talking.
 *
 * The envelope is derived from the ducking clip's own span rather than
 * accumulated as the player runs, so it is a pure function of the frame. That
 * is what lets a scrub into the middle of a duck show the level an export
 * writes there — and it is why this works at all in an offline render, which
 * never "plays" anything.
 */

import { Cache, Computed, Duck, DuckGain, Root, Source } from '../traits';
import { store } from '../world/store';

import type { Entity, World } from 'koota';

/** The locator part of `index.tsx:someId` — what `target` and `by` name. */
function locatorOf(world: World, entity: Entity): string | null {
	const source = store(world, Source).value[entity.id()];
	if (!source) return null;
	const colon = source.lastIndexOf(':');
	return colon === -1 ? source : source.slice(colon + 1);
}

/**
 * How far into the duck we are at `frame`, 0–1.
 *
 * Ramps in over `attack` frames from where the ducking clip starts, holds
 * while it plays, and ramps back out over `release` frames after it ends. The
 * ramps are smoothstep rather than linear: a level that arrives and leaves at
 * a constant rate is audible as a move, and the point of a duck is to not be
 * noticed.
 */
export function envelopeAt(frame: number, start: number, end: number, attack: number, release: number): number {
	// Strict, so a zero-length attack still ducks fully on the clip's first
	// frame rather than reading as "already past the ramp".
	if (frame < start - attack || frame > end + release) return 0;

	const smooth = (t: number) => {
		const clamped = Math.min(1, Math.max(0, t));
		return clamped * clamped * (3 - 2 * clamped);
	};

	// The duck leads the clip: the music is already down when the first word
	// lands, which is what a person does with a fader.
	if (frame < start) return smooth((frame - (start - attack)) / Math.max(1, attack));
	if (frame <= end) return 1;
	return smooth(1 - (frame - end) / Math.max(1, release));
}

/**
 * Write each duck's current contribution onto its target.
 *
 * Run once per frame, after visibility is known and before the audio buses
 * sync. Targets that no duck names are cleared, so removing a `<duck>` from
 * the source lets the level back up rather than leaving it pinned down.
 */
export function applyDucking(world: World, globalFrame: number): void {
	const ducks = world.query(Duck);
	if (ducks.length === 0) {
		// Nothing to apply, but a duck may have just been deleted.
		for (const entity of world.query(DuckGain)) {
			store(world, DuckGain).db[entity.id()] = 0;
		}
		return;
	}

	const root = world.get(Root);
	if (!root) return;

	// One index per frame: several ducks in a scene each name two elements,
	// and walking the tree for every one of them would be quadratic.
	const byLocator = new Map<string, Entity>();
	const index = (entity: Entity): void => {
		const locator = locatorOf(world, entity);
		if (locator !== null && !byLocator.has(locator)) byLocator.set(locator, entity);
		for (const child of entity.get(Cache)?.children ?? []) index(child);
	};
	for (const child of root.get(Cache)?.children ?? []) index(child);

	const computed = store(world, Computed);
	const settings = store(world, Duck);
	// Accumulated first, then written: two ducks on the same music should add
	// up rather than the last one winning.
	const applied = new Map<number, number>();

	for (const duck of ducks) {
		const did = duck.id();
		const target = byLocator.get(settings.target[did] ?? '');
		const by = byLocator.get(settings.by[did] ?? '');
		if (!target || !by || target === by) continue;

		const envelope = envelopeAt(
			globalFrame,
			computed.start[by.id()] ?? 0,
			computed.end[by.id()] ?? 0,
			Math.max(0, settings.attack[did] ?? 0),
			Math.max(0, settings.release[did] ?? 0),
		);

		const db = (settings.amount[did] ?? 0) * envelope;
		applied.set(target.id(), (applied.get(target.id()) ?? 0) + db);
		if (!target.has(DuckGain)) target.add(DuckGain);
	}

	const gains = store(world, DuckGain);
	for (const entity of world.query(DuckGain)) {
		gains.db[entity.id()] = applied.get(entity.id()) ?? 0;
	}
}
