/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Showing a change made to the file without mounting the file again.
 *
 * An agent edits the way agents edit everything: it changes the text. The
 * editor has always met a changed source by remounting it, which is never
 * wrong and always costly — the person's undo history goes, the canvas
 * flashes, and one changed number feels like the app restarting.
 *
 * When main can say exactly what the change comes to (a `SourcePatch`: set
 * this prop of this element, make this text say that), it is applied here
 * through the same `DocumentEditor` commands a drag goes through. So the
 * canvas changes the way any edit changes it, and the undo history records it
 * as one step — the person can take an agent's edit back with ⌘Z, which a
 * remount never offered.
 *
 * It is all or nothing, and it checks itself. Every op has to name exactly one
 * live element before any is applied; afterwards every prop is read back from
 * the document. Anything short of that and the caller remounts, as before: a
 * patch is a faster way to the same canvas, never a different one.
 */

import { Source } from '@posterract/video-runtime';
import { authoredElement } from '@posterract/video-reconciler';

import { getDocumentEditor, isLooped, isPendingSource } from '@/engine/editor';
import { getEditHistory } from '@/engine/history';

import type { PatchOp } from '@desktop/main-channels';
import type { PropValue } from '@posterract/composition';
import type { Entity, World } from 'koota';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Applies `ops` to the mounted project as one undo step. Returns false —
 * having changed nothing, or having found the result is not what was asked —
 * when the caller should remount instead.
 *
 * `muted` brackets the part during which the editor reports edits: they are
 * already in the file, so whoever writes edits to the file must not hear them.
 */
export function applySourcePatch(
	world: World,
	ops: PatchOp[],
	muted: (apply: () => void) => void,
	options: { record?: boolean } = {},
): boolean {
	if (!ops.length) return true;

	// Every op's element, before anything changes. A name that more than one
	// entity answers to (a component used twice, a loop) names none here.
	const bySource = new Map<string, Entity | null>();
	for (const entity of world.query(Source)) {
		const source = entity.get(Source)?.value;
		if (!source || isPendingSource(source) || isLooped(entity)) continue;
		bySource.set(source, bySource.has(source) ? null : entity);
	}
	const holds = (entity: Entity, op: PatchOp): boolean => {
		const authored = authoredElement(entity);
		if (!authored) return false;
		if (op.kind === 'text') return (authored.text ?? '') === op.value;
		const held = authored.props[op.name];
		return op.value === false ? held === undefined || held === false : same(held, op.value);
	};

	const all: Entity[] = [];
	for (const op of ops) {
		const entity = bySource.get(op.source);
		if (!entity || !entity.isAlive() || !authoredElement(entity)) return false;
		all.push(entity);
	}
	// What the canvas already shows is not a change to it. The file can be ahead
	// of the canvas by the person's own edit (written on top of someone else's,
	// see the editor page): applying that again would be a step that undoes nothing.
	const targets = all.filter((entity, index) => !holds(entity, ops[index]!));
	ops = ops.filter((op, index) => !holds(all[index]!, op));
	if (!ops.length) return true;

	const editor = getDocumentEditor(world);
	const history = getEditHistory(world);
	const apply = (): void =>
		muted(() => {
			ops.forEach((op, index) => {
				const entity = targets[index]!;
				if (op.kind === 'text') editor.editText(entity, op.value);
				// As written: the file is what has to be shown, not reinterpreted.
				else editor.editProperty(entity, op.name, op.value as PropValue, { asWritten: true });
			});
		});

	if (options.record === false) {
		// Already a step of the history (see the caller): shown, not recorded twice.
		history.unrecorded(apply);
	} else {
		// A gesture is one step and never merges into its neighbours: the agent's
		// edit is its own entry in the person's undo history.
		history.beginGesture();
		try {
			apply();
		} finally {
			history.endGesture();
		}
	}

	// Read it back: what the document now holds is what the file says, or this
	// was not a patch worth trusting.
	return ops.every((op, index) => holds(targets[index]!, op));
}
