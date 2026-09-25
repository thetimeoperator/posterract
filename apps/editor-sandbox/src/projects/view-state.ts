/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Where the author is looking, kept beside the project instead of inside it.
 *
 * Selection, the active scene, the workspace camera and the timeline's row
 * state are editor state: nothing rendered or exported depends on them. They
 * used to travel to the project's TSX like any other prop, which made every
 * click a revision of the document — the file was rewritten, its revision id
 * moved, and the source history filled with snapshots one `selected` apart.
 * With an agent editing the same file, a revision that moves when someone
 * looks around is a conflict check that cannot be trusted.
 *
 * So the edits still flow through the one funnel (`DocumentEditor.onEdit`),
 * but `splitViewEdit` takes the view out of them before the writer sees them,
 * and this store remembers it in `.posterract/view.json` instead (main owns
 * the path; see the desktop's view-state.ts). The store never accumulates
 * edits: what it writes is read off the world, so renames, removals and a
 * remount cannot leave it holding names that mean nothing.
 */

import {
	ClipHeight,
	Expanded,
	Scene,
	Selected,
	Source,
	Stage,
	getActiveEntity,
	getCameraMatrix,
	getParentNode,
	setActive,
	setCameraMatrix,
} from '@posterract/video-runtime';
import { MAIN_CHANNELS } from '@desktop/main-channels';

import { isLooped, isPendingSource } from '@/engine/editor';
import { adoptVoiceHistory, voiceHistory } from '@/engine/voice';
import { mainBridge } from '@/lib/ipc';

import type { EntityEdit } from '@/engine/editor';
import type { CameraMatrix } from '@posterract/video-runtime';
import type { Entity, World } from 'koota';

/** Props that say where the author is looking rather than what the video is. */
export const VIEW_PROPS: ReadonlySet<string> = new Set(['selected', 'active', 'camera', 'expanded', 'clipHeight']);

/** How long view changes pile up before they are remembered: a pan is one write. */
const DEBOUNCE = 300;

export type ViewState = {
	version: 1;
	camera: number[] | null;
	active: string | null;
	selected: string[];
	expanded: string[];
	clipHeight: Record<string, number>;
	/** What was typed or said to the voice bar here, newest last (↑ in the bar). */
	voice?: string[];
};

function withoutViewProps<T>(props: Record<string, T>): { props: Record<string, T>; stripped: boolean } {
	let stripped = false;
	const kept: Record<string, T> = {};
	for (const [name, value] of Object.entries(props)) {
		if (VIEW_PROPS.has(name)) stripped = true;
		else kept[name] = value;
	}
	return { props: stripped ? kept : props, stripped };
}

/**
 * Splits what an edit says about the view from what it says about the video.
 * `edit` is what is left for the file (null when the edit was only about the
 * view); `view` says the view changed and is worth remembering. An element
 * that is inserted — a duplicate, a paste, an undo putting one back — is
 * authored with whatever its original carried, so the view props come off it
 * here too rather than reaching the file as attributes.
 */
export function splitViewEdit(edit: EntityEdit): { edit: EntityEdit | null; view: boolean } {
	if (edit.kind === 'prop') {
		return VIEW_PROPS.has(edit.name) ? { edit: null, view: true } : { edit, view: false };
	}

	if (edit.kind === 'insert') {
		const { props, stripped } = withoutViewProps(edit.props);
		return { edit: stripped ? { ...edit, props } : edit, view: stripped };
	}

	if (edit.kind === 'unroll') {
		let changed = false;
		const iterations = edit.iterations.map((iteration) => {
			const next: typeof iteration = {};
			for (const [source, entry] of Object.entries(iteration)) {
				const { props, stripped } = withoutViewProps(entry.props);
				if (stripped) changed = true;
				next[source] = stripped ? { ...entry, props } : entry;
			}
			return next;
		});
		return { edit: changed ? { ...edit, iterations } : edit, view: false };
	}

	// A removed or moved element may have been selected or expanded: what the
	// world now says is what is worth remembering.
	return { edit, view: edit.kind === 'remove' };
}

/**
 * The name the sidecar can remember an entity by, or undefined: an element the
 * file has not named yet has nothing durable to be remembered by, and one a
 * loop rendered shares its name with every other iteration.
 */
function nameOf(entity: Entity | null): string | undefined {
	if (!entity?.isAlive() || entity.has(Stage) || isLooped(entity)) return undefined;
	const source = entity.get(Source)?.value;
	return source && !isPendingSource(source) ? source : undefined;
}

function collect(world: World): ViewState {
	const names = (entities: Iterable<Entity>): string[] => {
		const found: string[] = [];
		for (const entity of entities) {
			const name = nameOf(entity);
			if (name !== undefined) found.push(name);
		}
		return [...new Set(found)].sort();
	};

	const clipHeight: Record<string, number> = {};
	for (const entity of world.query(ClipHeight, Source)) {
		const name = nameOf(entity);
		const height = entity.get(ClipHeight)?.value;
		if (name !== undefined && typeof height === 'number' && height > 0) clipHeight[name] = height;
	}

	const voice = voiceHistory();
	return {
		version: 1,
		camera: [...getCameraMatrix(world)],
		active: nameOf(getActiveEntity(world)) ?? null,
		selected: names(world.query(Selected, Source)),
		expanded: names(world.query(Expanded, Source)),
		clipHeight,
		...(voice.length ? { voice: [...voice] } : {}),
	};
}

/** Every addressable entity by name; a name more than one entity answers to names none. */
function entitiesByName(world: World): Map<string, Entity> {
	const found = new Map<string, Entity | null>();
	for (const entity of world.query(Source)) {
		const name = nameOf(entity);
		if (name === undefined) continue;
		found.set(name, found.has(name) ? null : entity);
	}
	const unique = new Map<string, Entity>();
	for (const [name, entity] of found) if (entity) unique.set(name, entity);
	return unique;
}

function sync(world: World, state: ViewState): void {
	const byName = entitiesByName(world);
	const resolve = (names: string[]): Set<Entity> =>
		new Set(names.flatMap((name) => byName.get(name) ?? []));

	const selected = resolve(state.selected);
	for (const entity of [...world.query(Selected)]) if (!selected.has(entity)) entity.remove(Selected);
	for (const entity of selected) if (!entity.has(Selected)) entity.add(Selected);

	const expanded = resolve(state.expanded);
	for (const entity of [...world.query(Expanded)]) if (!expanded.has(entity)) entity.remove(Expanded);
	for (const entity of expanded) if (!entity.has(Expanded)) entity.add(Expanded);

	const heights = new Map<Entity, number>();
	for (const [name, height] of Object.entries(state.clipHeight)) {
		const entity = byName.get(name);
		if (entity) heights.set(entity, height);
	}
	for (const entity of [...world.query(ClipHeight)]) if (!heights.has(entity)) entity.remove(ClipHeight);
	for (const [entity, value] of heights) {
		if (!entity.has(ClipHeight)) entity.add(ClipHeight);
		entity.set(ClipHeight, { value });
	}

	// Only a root scene can be the active one (see `setActive`); a name that
	// now means something else leaves the choice to whoever mounted the project.
	const active = state.active === null ? undefined : byName.get(state.active);
	if (active && active.has(Scene) && getParentNode(active) === null && getActiveEntity(world) !== active) {
		setActive(world, active);
	}

	if (state.camera?.length === 6) setCameraMatrix(world, state.camera as unknown as CameraMatrix);
}

export interface ViewStateStore {
	/** Reads what was remembered. Safe to call again: a second read only fills in a first that found nothing. */
	load(): Promise<void>;
	/** Makes the freshly mounted world look where the author was looking. */
	attach(): void;
	/** Takes a last look at the world before its entities go. */
	detach(): void;
	/** The view changed; remember it once changes stop arriving. */
	touch(): void;
	dispose(): void;
}

/**
 * Remembers the view of the project in `dir` for the world it is mounted in.
 * Mounts come and go under one store: `attach` after each, `detach` before
 * the next, so what is remembered spans a recompile the way the attributes in
 * the file used to.
 */
export function createViewStateStore(dir: string, world: World): ViewStateStore {
	let state: ViewState | null = null;
	let attached = false;
	let disposed = false;
	let written = '';
	let timer: ReturnType<typeof setTimeout> | undefined;
	let reading: Promise<void> | undefined;

	const capture = (): void => {
		// An empty stage between two mounts says nothing about the view.
		if (attached) state = collect(world);
	};

	const write = (): void => {
		if (!state || !window.desktop) return;
		const serialized = JSON.stringify(state);
		if (serialized === written) return;
		written = serialized;
		void mainBridge
			.call(MAIN_CHANNELS.PROJECTS_VIEW_WRITE, { dir, value: state })
			// Losing this costs a selection and a zoom level, nothing more.
			.catch(() => { written = ''; });
	};

	return {
		load(): Promise<void> {
			if (state || !window.desktop) return Promise.resolve();
			reading ??= mainBridge
				.call(MAIN_CHANNELS.PROJECTS_VIEW_READ, { dir })
				.then((value) => {
					// The voice bar's history is this project's: another's does not carry over.
					if (!disposed) adoptVoiceHistory((value as ViewState | null)?.voice ?? []);
					// What the author did while the read was out is newer than it.
					if (value && !state && !disposed) {
						state = value as ViewState;
						written = JSON.stringify(state);
					}
				})
				.catch(() => undefined)
				.finally(() => { reading = undefined; });
			return reading;
		},

		attach(): void {
			attached = true;
			if (state) sync(world, state);
		},

		detach(): void {
			capture();
			attached = false;
		},

		touch(): void {
			if (disposed) return;
			clearTimeout(timer);
			timer = setTimeout(() => {
				timer = undefined;
				capture();
				write();
			}, DEBOUNCE);
		},

		dispose(): void {
			clearTimeout(timer);
			capture();
			write();
			attached = false;
			disposed = true;
		},
	};
}
