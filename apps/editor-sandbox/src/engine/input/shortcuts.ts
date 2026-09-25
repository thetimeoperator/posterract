/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import {
	AdjustmentLayer,
	ChildOf,
	Computed,
	Culled,
	FrameRate,
	Geometry,
	Group,
	Hidden,
	Position,
	Root,
	Selected,
	Time,
	Tool,
	ToolType,
	getActiveEntity,
	getCameraMatrix,
	getEntityChildren,
	getParentEntity,
	getParentNode,
	getSelection,
	isGroupLike,
	isSequence,
	setPlayhead,
	store,
	togglePlayback,
} from '@posterract/video-runtime';
import { Not, Or } from 'koota';
import { createSignal } from 'solid-js';

import { zoomBy, zoomTo, zoomToFit, zoomToSelection } from '../camera';
import { getDocumentEditor } from '../editor';
import { requestDelete } from '../delete-guard';
import { toggleMarkerAtPlayhead } from '../markers';
import { rippleDeleteSelection } from '../ripple';
import { toggleSnapping } from '../timeline/snapping';
import {
	zoomTimelineIn,
	zoomTimelineOut,
	zoomTimelineToFit,
	zoomTimelineToSelection,
} from '../timeline/zoom';
import {
	clearInOut,
	nudgeSelectionInTime,
	pauseShuttle,
	seekToCut,
	seekToEnd,
	seekToStart,
	setInPoint,
	setOutPoint,
	shuttleBy,
} from '../transport';
import { groupSelection, ungroupSelection, unwrapSequenceSelection, wrapSelectionInScene, wrapSelectionInSequence } from '../group';
import { getEditHistory } from '../history';
import { splitAtPlayhead } from '../split';
import { Keys, MODIFIER_KEYS, Pointer } from '../traits';
import { openVoiceBar, startTalking, stopTalking, voiceTalking } from '../voice';
import { editTransform } from './interactions';

import type { TransformWrite } from './interactions';
import type { CameraMatrix } from '@posterract/video-runtime';
import type { Entity, World } from 'koota';
import type { Accessor } from 'solid-js';

export type CommandGroup = 'Transport' | 'Range' | 'Editing' | 'Canvas' | 'Timeline' | 'Export' | 'Agent';

type Shortcut = {
	keys: string[];
	action: (world: World) => void;
	/** Set on everything that is a command a person could name, say or look up. */
	id?: string;
	label?: string;
	group?: CommandGroup;
	/** Other ways of saying it, for the voice bar. */
	aliases?: string[];
	/** What it needs to do anything: a selection, or an active scene. */
	when?: 'selection' | 'scene';
	/** How the voice bar reports it done, when that reads better than the label ("Duplicated"). */
	done?: string;
}

/** A shortcut with a name: what the voice bar, the shortcut sheet and the agent see. */
export type Command = Shortcut & { id: string; label: string; group: CommandGroup };

/** The node kinds a shortcut selects, hides or seeks around. */
const NODES = Or(Geometry, Group, AdjustmentLayer);

export function undoEdit(world: World): void {
	getEditHistory(world).undo();
}

export function redoEdit(world: World): void {
	getEditHistory(world).redo();
}

export function deleteSelection(world: World): void {
	const selected = [...world.query(Selected)];

	// A scene with content is confirmed first and kept in the project's trash;
	// everything else is removed here and covered by undo.
	if (selected.length) {
		requestDelete(world, selected);
	}
};

export function duplicateSelection(world: World): void {
	const selected = [...world.query(Selected)];

	if (selected.length) {
		getDocumentEditor(world).duplicate(selected);
	}
}

export function copySelection(world: World): void {
	const selected = [...world.query(Selected)];

	if (selected.length) {
		getDocumentEditor(world).copy(selected);
	}
}

/** Copy and delete in one, so the clipboard holds what the stage lost. */
export function cutSelection(world: World): void {
	copySelection(world);
	deleteSelection(world);
}

/**
 * Pastes where the selection points: into a selected container (a scene or
 * group, on top of its children), on top of a selected leaf in that leaf's
 * parent, or, with nothing selected, into the active scene. The editor keeps
 * a paste out of the sequence it was copied from.
 */
export function pasteSelection(world: World): void {
	const editor = getDocumentEditor(world);
	const [selected] = world.query(Selected);

	if (selected === undefined) {
		const active = getActiveEntity(world);
		if (active) editor.paste(active);
		return;
	}

	if (isGroupLike(selected)) {
		editor.paste(selected);
		return;
	}

	const parent = getParentEntity(selected);
	if (parent === null) return;
	const siblings = getEntityChildren(world, parent);
	editor.paste(parent, siblings[siblings.indexOf(selected) + 1]);
}

const NUDGE = 1;
const NUDGE_FAST = 10;

/**
 * Moves every selected node by `dx`, `dy` in its own parent's space, the same
 * `x`/`y` a drag writes, so a nudge is a drag of a known distance without the
 * snapping. Measured from where the node is drawn rather than from the prop,
 * and written to the position track as well as the prop, so nudging an
 * animated node moves it from where its keyframes put it (a drag does the
 * same; see `editTransform`).
 */
export function nudgeSelection(world: World, dx: number, dy: number): void {
	const editor = getDocumentEditor(world);
	const computed = store(world, Computed);

	for (const entity of getSelection(world)) {
		if (!entity.has(Position)) continue;
		const eid = entity.id();

		const writes: TransformWrite[] = [];
		if (dx) writes.push(['x', Math.round((computed.positionX[eid] ?? 0) + dx)]);
		if (dy) writes.push(['y', Math.round((computed.positionY[eid] ?? 0) + dy)]);
		editTransform(world, editor, entity, writes);
	}
}

const nudge = (dx: number, dy: number) => (world: World): void => nudgeSelection(world, dx, dy);

/**
 * The keys that can be held to talk to the editor: Q, or one of two others no
 * shortcut uses, picked in the bar's settings and remembered on this machine.
 */
export const TALK_KEYS = ['q', '`', 'g'] as const;
const TALK_KEY_SETTING = 'posterract.voice.talkKey';

function storedTalkKey(): string {
	try {
		const saved = localStorage.getItem(TALK_KEY_SETTING);
		return saved && (TALK_KEYS as readonly string[]).includes(saved) ? saved : TALK_KEYS[0];
	} catch {
		return TALK_KEYS[0];
	}
}

const [talkKey, setTalkKeySignal] = createSignal(storedTalkKey());

/** The key held to talk to the editor. */
export const voiceTalkKey: Accessor<string> = talkKey;

/** How a talk key is written for a person: "Q", "`", "G". */
export const talkKeyName = (key: string): string => key.toUpperCase();

/**
 * What the talk key does by being held, which the tables cannot express: a
 * hold the window loses focus in the middle of never sees its release (`held`
 * is cleared without a lift), so it ends on the first frame the key is no
 * longer down — and what it recorded is thrown away, not sent.
 */
function updateTalkHold(held: Set<string>): void {
	if (voiceTalking() === 'key' && !held.has(talkKey())) void stopTalking('lost-focus');
}

/** Holding the talk key listens; letting go sends what was said. Their key is the one picked. */
const TALK_PRESS: Shortcut = {
	keys: [talkKey(), '!mod', '!alt', '!shift'], action: () => void startTalking('key'),
	id: 'voice.talk', label: 'Talk to the editor', group: 'Agent',
};
const TALK_LIFT: Shortcut = { keys: [talkKey()], action: () => void stopTalking('released') };

/** Makes `key` the talk key, from now on and on this machine. */
export function setTalkKey(key: string): void {
	if (!(TALK_KEYS as readonly string[]).includes(key)) return;
	TALK_PRESS.keys[0] = key;
	TALK_LIFT.keys[0] = key;
	setTalkKeySignal(key);
	try {
		localStorage.setItem(TALK_KEY_SETTING, key);
	} catch {
		// Kept for this session only.
	}
}

/** How long space has to be held to read as a pan and not as a tap. */
const SPACE_HAND_DELAY = 200;

/**
 * The camera as it stood when space went down over the stage; null when
 * space is up, or when the press was one that cannot turn into a pan.
 */
let spaceCamera: CameraMatrix | null = null;

/**
 * The tool space borrowed the hand from, put back on release; null while
 * space does not hold the hand.
 */
let spaceTool: ToolType | null = null;

/**
 * When the space press went down, so a hold long enough to be a pan can be
 * told from a tap; null once the hand has taken over, or once space is up.
 */
let spacePressedAt: number | null = null;

/** Puts the hand in the toolbar for as long as space holds it. */
function takeHandTool(world: World): void {
	spacePressedAt = null;
	if (spaceTool !== null) return;
	spaceTool = world.get(Tool)?.value ?? ToolType.MOVE;
	world.set(Tool, { value: ToolType.HAND });
}

/** Gives back whatever tool space borrowed the hand from. */
function releaseHandTool(world: World): void {
	spacePressedAt = null;
	if (spaceTool === null) return;
	world.set(Tool, { value: spaceTool });
	spaceTool = null;
}

function toggleActivePlayback(world: World): void {
	const scene = getActiveEntity(world);
	if (scene) togglePlayback(world, scene);
}

function onSpacePressed(world: World): void {
	// The hand waits out the delay wherever the pointer is; what the pointer
	// decides is only when playback gets its toggle. Over the stage the press
	// could still become a pan, so playback waits for a release that left the
	// camera where it was; anywhere else it toggles here and now.
	spacePressedAt = world.get(Time)?.now ?? 0;

	if (world.get(Pointer)?.over) {
		spaceCamera = getCameraMatrix(world);
	} else {
		spaceCamera = null;
		toggleActivePlayback(world);
	}
}

function onSpaceLifted(world: World): void {
	const camera = getCameraMatrix(world);
	if (spaceCamera?.every((value, index) => value === camera[index])) {
		toggleActivePlayback(world);
	}
	spaceCamera = null;
	releaseHandTool(world);
}

/**
 * What space does by being held rather than by moving, which the tables
 * cannot express: the hand takes over once the press outlasts
 * `SPACE_HAND_DELAY`, and a hold the window loses focus mid-way through
 * never sees a release (`held` is cleared without a lift), so the borrowed
 * tool goes back on the first frame the key is no longer down.
 */
function updateSpaceHold(world: World, held: Set<string>): void {
	if (!held.has(' ')) {
		spaceCamera = null;
		releaseHandTool(world);
		return;
	}

	if (spacePressedAt === null) return;
	if ((world.get(Time)?.now ?? 0) - spacePressedAt >= SPACE_HAND_DELAY) {
		takeHandTool(world);
	}
}

/**
 * Picks a tool. While space holds the hand the pick is what the release
 * goes back to, so the hand keeps the stage until the key is up.
 */
const selectTool = (value: ToolType) => (world: World): void => {
	if (spaceTool !== null) {
		spaceTool = value;
		return;
	}
	world.set(Tool, { value });
};

/**
 * Moves the active scene's playhead by `frames`, the same seek a scrub of the
 * ruler comes to. Nothing to seek without an active scene.
 */
export function seekBy(world: World, frames: number): void {
	const scene = getActiveEntity(world);
	if (!scene) return;

	setPlayhead(world, scene, (store(world, Computed).localTime[scene.id()] ?? 0) + frames);
}

const seekFrames = (frames: number) => (world: World): void => seekBy(world, frames);

const seekSeconds = (seconds: number) => (world: World): void =>
	seekBy(world, Math.round(seconds * (world.get(FrameRate)?.value ?? 30)));

/** How much of the zoom a step takes, in or out. */
const ZOOM_STEP = 1.25;

const zoom = (factor: number) => (world: World): void => zoomBy(world, factor);

const zoomActualSize = (world: World): void => zoomTo(world, 1);

/**
 * Hides the selection, or brings it back once all of it is hidden — the same
 * property the eye in the layer list writes, one write per node.
 */
export function toggleSelectionHidden(world: World): void {
	const editor = getDocumentEditor(world);
	const selected = [...world.query(Selected, NODES)];
	if (!selected.length) return;

	const hide = selected.some(entity => !entity.has(Hidden));
	for (const entity of selected) editor.editProperty(entity, 'hidden', hide);
}

/**
 * Sends the selection to the front or the back of its siblings. Which of two
 * nodes is drawn on top is which of them the file lists last, so a restack is
 * a move through the document rather than an index written to the node. A
 * selection spanning parents is restacked inside each of them, and the moved
 * nodes keep the order they had among themselves.
 */
export function restackSelection(world: World, target: 'front' | 'back'): void {
	const editor = getDocumentEditor(world);
	const selected = new Set([...world.query(Selected, NODES)]);
	if (!selected.size) return;

	const parents = new Set<Entity>();
	for (const entity of selected) {
		const parent = getParentEntity(entity);
		if (parent !== null) parents.add(parent);
	}

	for (const parent of parents) {
		const siblings = getEntityChildren(world, parent);
		const moving = siblings.filter(entity => selected.has(entity));

		if (target === 'front') {
			// Appended one after the other, each lands on top of the last, so
			// the order they were in is the order they end up in.
			for (const entity of moving) editor.reparent(entity, parent);
			continue;
		}

		// All of them go before the backmost sibling that is staying put —
		// the one node the whole block has to end up behind.
		const anchor = siblings.find(entity => !selected.has(entity));
		if (anchor === undefined) continue;
		for (const entity of moving) editor.reparent(entity, parent, anchor);
	}
}

const restack = (target: 'front' | 'back') => (world: World): void => restackSelection(world, target);

/**
 * Selects everything the stage holds directly — the scenes and whatever else
 * sits loose on it, rather than what is inside them.
 */
export function selectAll(world: World): void {
	const root = world.get(Root);
	if (!root) return;

	const entities = [...world.query(NODES, ChildOf(root), Not(Hidden), Not(Culled))];
	if (entities.length) getDocumentEditor(world).select(entities);
}

/**
 * Selects what holds the selection. A sequence is a container the timeline
 * draws rather than a node the canvas selects, so the walk goes on through
 * it; a node the stage holds directly has nothing to go up to.
 */
export function selectParents(world: World): void {
	const selected = [...world.query(Selected, NODES)];
	if (!selected.length) return;

	const parents = new Set<Entity>();

	for (const entity of selected) {
		let parent = getParentNode(entity);
		while (parent !== null && isSequence(parent)) {
			parent = getParentNode(parent);
		}
		if (parent !== null) parents.add(parent);
	}

	if (parents.size) getDocumentEditor(world).select([...parents]);
}

/**
 * Selects what the selection holds, one level down, sequences seen through
 * the same way `selectParents` sees through them. What is hidden or out of
 * range is not there to be stepped into.
 */
export function selectChildren(world: World): void {
	const selected = [...world.query(Selected, NODES)];
	if (!selected.length) return;

	const children = new Set<Entity>();

	const collect = (parent: Entity): void => {
		for (const child of world.query(NODES, ChildOf(parent), Not(Hidden), Not(Culled))) {
			if (isSequence(child)) collect(child);
			else children.add(child);
		}
	};

	for (const entity of selected) collect(entity);

	if (children.size) getDocumentEditor(world).select([...children]);
}

/** Drops the selection, and whatever tool was drawing with it. */
function deselect(world: World): void {
	getDocumentEditor(world).clearSelection();

	const tool = world.get(Tool)?.value ?? ToolType.MOVE;
	if (tool !== ToolType.MOVE && tool !== ToolType.HAND) selectTool(ToolType.MOVE)(world);
}

const PRESSED_SHORTCUTS: readonly Shortcut[] = [
	{ keys: ['z', 'mod', '!shift'], action: undoEdit, id: 'edit.undo', label: 'Undo — survives a reload', group: 'Editing', aliases: ['undo', 'undo that', 'take that back'], done: 'Undone' },
	{ keys: ['z', 'mod', 'shift'], action: redoEdit, id: 'edit.redo', label: 'Redo', group: 'Editing', aliases: ['redo', 'redo that'], done: 'Redone' },
	{ keys: ['backspace'], action: deleteSelection, id: 'edit.delete', label: 'Delete — a scene with content asks first', group: 'Editing', aliases: ['delete', 'remove', 'delete this', 'remove this'], when: 'selection', done: 'Deleted' },
	{ keys: ['delete'], action: deleteSelection },
	{ keys: ['d', 'mod', '!shift'], action: duplicateSelection, id: 'edit.duplicate', label: 'Duplicate', group: 'Editing', aliases: ['duplicate', 'duplicate this', 'clone', 'make a copy'], when: 'selection', done: 'Duplicated' },
	{ keys: ['g', 'mod', '!shift'], action: groupSelection, id: 'edit.group', label: 'Group', group: 'Editing', aliases: ['group', 'group these', 'group them'], when: 'selection', done: 'Grouped' },
	{ keys: ['g', 'mod', 'shift'], action: ungroupSelection, id: 'edit.ungroup', label: 'Ungroup', group: 'Editing', aliases: ['ungroup', 'break apart'], when: 'selection', done: 'Ungrouped' },
	{ keys: ['enter', 'mod', '!shift', '!alt'], action: wrapSelectionInScene, id: 'edit.wrap-scene', label: 'Wrap in a scene', group: 'Editing', aliases: ['wrap in a scene', 'make a scene from this'], when: 'selection', done: 'Wrapped in a scene' },
	{ keys: ['enter', 'mod', 'alt', '!shift'], action: wrapSelectionInSequence, id: 'edit.wrap-sequence', label: 'Wrap in a sequence', group: 'Editing', aliases: ['wrap in a sequence', 'make a sequence'], when: 'selection', done: 'Wrapped in a sequence' },
	{ keys: ['enter', 'mod', 'alt', 'shift'], action: unwrapSequenceSelection, id: 'edit.unwrap-sequence', label: 'Unwrap the sequence', group: 'Editing', aliases: ['unwrap', 'unwrap the sequence'], when: 'selection', done: 'Unwrapped' },
	{ keys: ['b', 'mod'], action: splitAtPlayhead, id: 'edit.split', label: 'Split at the playhead', group: 'Editing', aliases: ['split', 'cut', 'cut here', 'blade', 'split here'], when: 'scene', done: 'Split at the playhead' },
	{ keys: ['c', 'mod'], action: copySelection, id: 'edit.copy', label: 'Copy', group: 'Editing', aliases: ['copy', 'copy this'], when: 'selection', done: 'Copied' },
	{ keys: ['v', 'mod'], action: pasteSelection, id: 'edit.paste', label: 'Paste', group: 'Editing', aliases: ['paste', 'paste it'], done: 'Pasted' },
	{ keys: ['x', 'mod'], action: cutSelection, id: 'edit.cut', label: 'Cut to the clipboard', group: 'Editing', aliases: ['cut to clipboard'], when: 'selection', done: 'Cut to the clipboard' },
	{ keys: ['h', 'mod', 'shift'], action: toggleSelectionHidden, id: 'edit.hide', label: 'Hide or show the selection', group: 'Editing', aliases: ['hide', 'hide this', 'show', 'unhide'], when: 'selection' },
	{ keys: ['a', 'mod'], action: selectAll, id: 'edit.select-all', label: 'Select all', group: 'Editing', aliases: ['select all', 'select everything'] },
	{ keys: ['=', 'mod'], action: zoom(ZOOM_STEP), id: 'canvas.zoom-in', label: 'Zoom in', group: 'Canvas', aliases: ['zoom in', 'closer'] },
	{ keys: ['+', 'mod'], action: zoom(ZOOM_STEP) },
	{ keys: ['-', 'mod'], action: zoom(1 / ZOOM_STEP), id: 'canvas.zoom-out', label: 'Zoom out', group: 'Canvas', aliases: ['zoom out', 'further'] },
	{ keys: ['0', 'mod'], action: zoomActualSize, id: 'canvas.actual-size', label: 'Actual size', group: 'Canvas', aliases: ['actual size', 'zoom to 100', '100 percent'] },
	{ keys: ['1', 'mod'], action: zoomToFit, id: 'canvas.zoom-fit', label: 'Zoom to fit', group: 'Canvas', aliases: ['zoom to fit', 'fit', 'fit to screen', 'show everything'] },
	{ keys: ['2', 'mod'], action: zoomToSelection, id: 'canvas.zoom-selection', label: 'Zoom to selection', group: 'Canvas', aliases: ['zoom to selection', 'zoom to this', 'focus on this'], when: 'selection' },
	{ keys: ['v', '!mod'], action: selectTool(ToolType.MOVE), id: 'canvas.move-tool', label: 'Move tool', group: 'Canvas', aliases: ['move tool', 'select tool', 'pointer'] },
	{ keys: ['h', '!mod'], action: selectTool(ToolType.HAND), id: 'canvas.hand-tool', label: 'Hand tool', group: 'Canvas', aliases: ['hand tool', 'hand', 'pan tool'] },
	{ keys: ['f', '!mod'], action: selectTool(ToolType.SCENE), id: 'canvas.frame-tool', label: 'Frame', group: 'Canvas', aliases: ['frame tool', 'draw a frame', 'new frame', 'scene tool'] },
	{ keys: ['t', '!mod'], action: selectTool(ToolType.TEXT), id: 'canvas.text-tool', label: 'Text', group: 'Canvas', aliases: ['text tool', 'add text', 'type text'] },
	{ keys: ['r', '!mod'], action: selectTool(ToolType.RECT), id: 'canvas.component-tool', label: 'Component — draw a shape', group: 'Canvas', aliases: ['component', 'shape', 'draw a shape', 'rectangle', 'shape tool'] },
	{ keys: ['a', '!mod'], action: seekFrames(-1), id: 'transport.frame-back', label: 'Back one frame', group: 'Transport', aliases: ['back one frame', 'previous frame', 'step back'] },
	{ keys: ['d', '!mod'], action: seekFrames(1), id: 'transport.frame-forward', label: 'Forward one frame', group: 'Transport', aliases: ['forward one frame', 'next frame', 'step forward'] },
	{ keys: ['w', '!mod'], action: seekSeconds(1), id: 'transport.second-forward', label: 'Forward one second', group: 'Transport', aliases: ['forward one second', 'skip ahead'] },
	{ keys: ['s', '!mod'], action: seekSeconds(-1), id: 'transport.second-back', label: 'Back one second', group: 'Transport', aliases: ['back one second', 'skip back'] },
	{ keys: [']', '!mod'], action: restack('front'), id: 'edit.bring-front', label: 'Bring to front', group: 'Editing', aliases: ['bring to front', 'to the front', 'on top'], when: 'selection', done: 'Brought to front' },
	{ keys: ['[', '!mod'], action: restack('back'), id: 'edit.send-back', label: 'Send to back', group: 'Editing', aliases: ['send to back', 'to the back', 'behind everything'], when: 'selection', done: 'Sent to back' },
	{ keys: ['\\', '!mod'], action: selectParents, id: 'edit.select-parents', label: 'Select the parent', group: 'Editing', aliases: ['select parent', 'select the parent', 'go up a level'], when: 'selection' },
	{ keys: ['enter', '!mod'], action: selectChildren, id: 'edit.select-children', label: 'Select the children', group: 'Editing', aliases: ['select children', 'select the children', 'go inside'], when: 'selection' },
	{ keys: ['escape'], action: deselect, id: 'edit.deselect', label: 'Deselect', group: 'Editing', aliases: ['deselect', 'clear selection', 'select nothing'] },
	{ keys: ['arrowleft', '!shift'], action: nudge(-NUDGE, 0), id: 'canvas.nudge-left', label: 'Nudge left', group: 'Canvas', aliases: ['nudge left'], when: 'selection' },
	{ keys: ['arrowright', '!shift'], action: nudge(NUDGE, 0), id: 'canvas.nudge-right', label: 'Nudge right', group: 'Canvas', aliases: ['nudge right'], when: 'selection' },
	{ keys: ['arrowup', '!shift'], action: nudge(0, -NUDGE), id: 'canvas.nudge-up', label: 'Nudge up', group: 'Canvas', aliases: ['nudge up'], when: 'selection' },
	{ keys: ['arrowdown', '!shift'], action: nudge(0, NUDGE), id: 'canvas.nudge-down', label: 'Nudge down', group: 'Canvas', aliases: ['nudge down'], when: 'selection' },
	{ keys: ['arrowleft', 'shift'], action: nudge(-NUDGE_FAST, 0), id: 'canvas.nudge-left-far', label: 'Nudge left ten pixels', group: 'Canvas', aliases: ['nudge left ten'], when: 'selection' },
	{ keys: ['arrowright', 'shift'], action: nudge(NUDGE_FAST, 0), id: 'canvas.nudge-right-far', label: 'Nudge right ten pixels', group: 'Canvas', aliases: ['nudge right ten'], when: 'selection' },
	{ keys: ['arrowup', 'shift'], action: nudge(0, -NUDGE_FAST), id: 'canvas.nudge-up-far', label: 'Nudge up ten pixels', group: 'Canvas', aliases: ['nudge up ten'], when: 'selection' },
	{ keys: ['arrowdown', 'shift'], action: nudge(0, NUDGE_FAST), id: 'canvas.nudge-down-far', label: 'Nudge down ten pixels', group: 'Canvas', aliases: ['nudge down ten'], when: 'selection' },
	{ keys: [' '], action: onSpacePressed },

	// Transport and range. `J`/`K`/`L` shuttle, `I`/`O` mark the work area —
	// which is what an export renders, so marking a range is choosing what to
	// export rather than a second concept beside it.
	{ keys: ['home'], action: seekToStart, id: 'transport.start', label: 'Go to the start, or the in point', group: 'Transport', aliases: ['go to the start', 'go to start', 'beginning', 'rewind to start'] },
	{ keys: ['end'], action: seekToEnd, id: 'transport.end', label: 'Go to the end, or the out point', group: 'Transport', aliases: ['go to the end', 'go to end'] },
	{ keys: ['arrowup', '!mod', '!shift', 'alt'], action: seekToCut(-1), id: 'transport.previous-cut', label: 'Previous cut', group: 'Transport', aliases: ['previous cut', 'last cut'] },
	{ keys: ['arrowdown', '!mod', '!shift', 'alt'], action: seekToCut(1), id: 'transport.next-cut', label: 'Next cut', group: 'Transport', aliases: ['next cut'] },
	{ keys: ['j', '!mod'], action: shuttleBy(-1), id: 'transport.shuttle-back', label: 'Shuttle back — press again for 2× and 4×', group: 'Transport', aliases: ['shuttle back', 'play backwards', 'reverse'] },
	{ keys: ['k', '!mod'], action: pauseShuttle, id: 'transport.pause-shuttle', label: 'Pause the shuttle', group: 'Transport', aliases: ['pause the shuttle', 'stop the shuttle'] },
	{ keys: ['k', 'mod'], action: () => openVoiceBar(), id: 'voice.type', label: 'Type a command', group: 'Agent', aliases: ['type a command'] },
	TALK_PRESS,
	{ keys: ['l', '!mod'], action: shuttleBy(1), id: 'transport.shuttle-forward', label: 'Shuttle forward — press again for 2× and 4×', group: 'Transport', aliases: ['shuttle forward', 'fast forward'] },
	{ keys: ['i', '!mod'], action: setInPoint, id: 'range.in', label: 'Mark in — sets the work area an export renders', group: 'Range', aliases: ['mark in', 'set the in point', 'in point'], when: 'scene', done: 'Marked in' },
	{ keys: ['o', '!mod'], action: setOutPoint, id: 'range.out', label: 'Mark out', group: 'Range', aliases: ['mark out', 'set the out point', 'out point'], when: 'scene', done: 'Marked out' },
	{ keys: ['x', 'alt', '!mod'], action: clearInOut, id: 'range.clear', label: 'Clear the range', group: 'Range', aliases: ['clear the range', 'clear in and out'], when: 'scene', done: 'Cleared the range' },
	{ keys: ['n', '!mod'], action: toggleSnapping, id: 'edit.snapping', label: 'Snapping on or off — hold ⌘ while dragging to invert', group: 'Editing', aliases: ['snapping', 'toggle snapping', 'turn snapping off', 'turn snapping on'] },
	{ keys: ['m', '!mod'], action: toggleMarkerAtPlayhead, id: 'range.marker', label: 'Marker at the playhead — press again to remove it', group: 'Range', aliases: ['marker', 'add a marker', 'drop a marker'], when: 'scene' },
	{ keys: ['arrowleft', 'alt', '!shift'], action: nudgeSelectionInTime(-1), id: 'edit.nudge-earlier', label: 'Nudge the selection one frame earlier', group: 'Editing', aliases: ['one frame earlier', 'nudge earlier'], when: 'selection' },
	{ keys: ['arrowright', 'alt', '!shift'], action: nudgeSelectionInTime(1), id: 'edit.nudge-later', label: 'Nudge the selection one frame later', group: 'Editing', aliases: ['one frame later', 'nudge later'], when: 'selection' },
	{ keys: ['arrowleft', 'alt', 'shift'], action: nudgeSelectionInTime(-10), id: 'edit.nudge-earlier-far', label: 'Nudge ten frames earlier', group: 'Editing', aliases: ['ten frames earlier'], when: 'selection' },
	{ keys: ['arrowright', 'alt', 'shift'], action: nudgeSelectionInTime(10), id: 'edit.nudge-later-far', label: 'Nudge ten frames later', group: 'Editing', aliases: ['ten frames later'], when: 'selection' },
	{ keys: ['=', 'alt', '!mod'], action: zoomTimelineIn, id: 'timeline.zoom-in', label: 'Zoom the timeline in', group: 'Timeline', aliases: ['zoom the timeline in'] },
	{ keys: ['+', 'alt', '!mod'], action: zoomTimelineIn },
	{ keys: ['-', 'alt', '!mod'], action: zoomTimelineOut, id: 'timeline.zoom-out', label: 'Zoom the timeline out', group: 'Timeline', aliases: ['zoom the timeline out'] },
	{ keys: ['z', 'shift', '!mod'], action: zoomTimelineToFit, id: 'timeline.fit', label: 'Fit the whole video', group: 'Timeline', aliases: ['fit the whole video', 'fit the timeline', 'show the whole video'] },
	{ keys: ['z', 'alt', '!mod'], action: zoomTimelineToSelection, id: 'timeline.zoom-selection', label: 'Zoom the timeline to the selection', group: 'Timeline', aliases: ['zoom the timeline to this'], when: 'selection' },
	{ keys: ['backspace', 'shift'], action: rippleDeleteSelection, id: 'edit.ripple-delete', label: 'Ripple delete — closes the gap', group: 'Editing', aliases: ['ripple delete', 'delete and close the gap'], when: 'selection', done: 'Ripple deleted' },
	{ keys: ['delete', 'shift'], action: rippleDeleteSelection },
];

/**
 * Commands a key reaches through a handler of its own rather than this
 * table — play/pause is Space's press and lift above — listed so they can be
 * named and looked up all the same. Never matched against key presses.
 */
const LISTED_ONLY: readonly Command[] = [
	{ keys: [' '], action: toggleActivePlayback, id: 'transport.play', label: 'Play / pause', group: 'Transport', aliases: ['play', 'pause', 'stop', 'resume', 'play pause'] },
];

/**
 * Every command the table names, once each, in the table's order: what the
 * voice bar matches against and the shortcut sheet lists. Commands with no
 * key of their own (workspaces, panels, export) belong to the UI and are
 * registered from there (see `registerCommand` in `engine/voice.tsx`).
 */
export const COMMANDS: readonly Command[] = (() => {
	const seen = new Set<string>();
	const commands: Command[] = [];
	for (const shortcut of [...PRESSED_SHORTCUTS, ...LISTED_ONLY]) {
		if (!shortcut.id || !shortcut.label || !shortcut.group || seen.has(shortcut.id)) continue;
		seen.add(shortcut.id);
		commands.push(shortcut as Command);
	}
	return commands;
})();

const LIFTED_SHORTCUTS: readonly Shortcut[] = [
	{ keys: [' '], action: onSpaceLifted },
	TALK_LIFT,
];

/**
 * Whether `moved` — the keys that went down, or up, this frame — spells the
 * shortcut: one of its keys has to be the one that moved, the rest have to
 * be held, and a '!' key has to be up. The key that moved is matched
 * against `moved` rather than `held` because a lift takes it out of `held`,
 * and a tap shorter than a frame is over before the frame runs.
 *
 * Only a non-modifier can be the trigger: ⌘Z means Z pressed under ⌘, not ⌘
 * pressed over a Z — and `held` can hold a stale letter, since macOS drops
 * the key-up of a key released while ⌘ is down, so a fresh ⌘ press must not
 * complete a shortcut on its own.
 */
function matches(shortcut: Shortcut, moved: Set<string>, held: Set<string>): boolean {
	let triggered = false;

	for (const key of shortcut.keys) {
		if (key.startsWith('!')) {
			if (held.has(key.slice(1))) return false;
		} else if (moved.has(key) && !MODIFIER_KEYS.has(key)) {
			triggered = true;
		} else if (!held.has(key)) {
			return false;
		}
	}

	return triggered;
}

/** On a frame with a fresh press or release, runs the shortcut it spells. */
export function shortcutSystem(world: World): void {
	const keys = world.get(Keys);
	if (!keys) return;

	if (keys.pressed.size) {
		PRESSED_SHORTCUTS.find(shortcut => matches(shortcut, keys.pressed, keys.held))?.action(world);
	}

	if (keys.lifted.size) {
		LIFTED_SHORTCUTS.find(shortcut => matches(shortcut, keys.lifted, keys.held))?.action(world);
	}

	updateSpaceHold(world, keys.held);
	updateTalkHold(keys.held);
}
