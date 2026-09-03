/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Relative timing: `after="<id>"`.
 *
 * A shot that plays after another one is the most common thing anybody says
 * about timing, and the hardest to keep true by hand — trim the first clip and
 * every start after it is wrong. `after` states the relationship instead of a
 * number, and this resolves it against what the target's span actually turned
 * out to be, including a duration that only arrived when its media loaded.
 *
 * It resolves to the same `Delay` an authored `start` produces, so nothing
 * downstream needs to know the difference.
 */

import { ChildOf, Cache, Computed, Delay, After, Root, Source, Geometry, Group, AdjustmentLayer } from '../traits';
import { store } from '../world/store';
import { Or } from 'koota';

import type { Entity, World } from 'koota';

/**
 * How many times the pass re-runs to settle a chain.
 *
 * `a` after `b` after `c` needs one round per link. Bounded because a cycle —
 * two elements each after the other — must stop rather than hang; it settles
 * on whatever the last round produced, which is stable and visible, instead of
 * taking the frame down.
 */
const MAX_ROUNDS = 8;

/** The locator part of `index.tsx:someId`, which is what `after` names. */
function locatorOf(world: World, entity: Entity): string | null {
	const source = store(world, Source).value[entity.id()];
	if (!source) return null;
	const colon = source.lastIndexOf(':');
	return colon === -1 ? source : source.slice(colon + 1);
}

/**
 * Resolve every `after` in the world.
 *
 * Run before motion, and re-run until stable within the frame: an export
 * renders each frame once, so a chain that needed a second frame to settle
 * would encode wrong.
 */
export function resolveRelativeTiming(world: World): void {
	const root = world.get(Root);
	if (!root) return;

	const pending = world.query(After);
	if (pending.length === 0) return;

	const computed = store(world, Computed);
	const afters = store(world, After);
	const delays = store(world, Delay);

	// Built once per pass rather than per element: the id a dependent names is
	// looked up many times, and a scene of any size makes that quadratic.
	const byLocator = new Map<string, Entity>();
	const index = (entity: Entity): void => {
		const locator = locatorOf(world, entity);
		if (locator !== null && !byLocator.has(locator)) byLocator.set(locator, entity);
		for (const child of entity.get(Cache)?.children ?? []) index(child);
	};
	for (const entity of world.query(Or(Geometry, Group, AdjustmentLayer), ChildOf(root))) index(entity);

	for (let round = 0; round < MAX_ROUNDS; round += 1) {
		let changed = false;

		for (const entity of pending) {
			const eid = entity.id();
			const target = byLocator.get(afters.id[eid] ?? '');
			// An `after` naming nothing leaves the element where it is: a typo
			// should not silently move a shot to frame zero.
			if (!target || target === entity) continue;

			// The authored gap is kept: `after` says which span this one
			// follows, `gap` says how long after it.
			const wanted = (computed.end[target.id()] ?? 0) + (afters.gap[eid] ?? 0);
			const current = computed.start[eid] ?? 0;
			// Half a frame: below that the difference cannot be rendered, and
			// chasing it would rewrite Delay on every frame forever.
			if (Math.abs(wanted - current) < 0.5) continue;

			const delay = (delays.value[eid] ?? 0) + (wanted - current);
			entity.add(Delay);
			entity.set(Delay, { value: delay });
			changed = true;
		}

		if (!changed) return;
	}
}
