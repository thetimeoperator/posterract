/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The voice bar's state, and what it does with a command.
 *
 * Module-level signals, as the Skill Deck keeps its own: the shortcut system
 * (which opens the bar on ⌘K and holds the talk key) and the bar itself (which
 * shows it) both read and drive the same state without passing it around.
 *
 * A command runs as one undo step whatever it does — the history brackets it
 * the way it brackets a drag — so one ⌘Z always takes back one sentence.
 */
import { createSignal } from 'solid-js';
import { Name, Playback, getActiveEntity, getSelection, togglePlayback } from '@posterract/video-runtime';

import { aiTranscribeCommand, requestMicrophoneAccess } from '@/lib/ai-bridge';
import { matchCommand } from '@/lib/command-match';
import { cancelCapture, startCapture, stopCapture, warmMicrophone } from '@/lib/voice-capture';
import { buildVoicePrompt } from '@/lib/voice-vocabulary';
import { getEditHistory } from './history';
import { COMMANDS } from './input/shortcuts';

import type { Accessor } from 'solid-js';
import type { World } from 'koota';
import type { Reading } from '@/context/agent-api/intents/types';
import type { Command } from './input/shortcuts';

export type { Command } from './input/shortcuts';
/** What a sentence in the person's own words was read to mean, before or as it is applied. */
export type { Reading } from '@/context/agent-api/intents/types';

export type VoiceMode = 'idle' | 'typing' | 'listening' | 'transcribing' | 'resolving' | 'confirm' | 'choose' | 'done' | 'error';

export type VoiceLevels = { low: number; mid: number; high: number; level: number };

/** How long a receipt or an error stays up. */
const RECEIPT_MS = 2_500;
const ERROR_MS = 4_000;

/** How long typing pauses before the bar reads what is typed. */
const LIVE_READ_MS = 250;

const APPLY_SETTING = 'posterract.voice.applyAutomatically';

function storedApply(): boolean {
	try {
		return localStorage.getItem(APPLY_SETTING) !== 'off';
	} catch {
		return true;
	}
}

/** Commands a spoken sentence never runs without a yes: what they take away is hard to see go. */
const ASK_FIRST = new Set(['edit.delete', 'edit.ripple-delete']);

export const MIC_DENIED = 'Turn on the microphone for Posterract in System Settings → Privacy & Security → Microphone.';

/** A provider key the voice bar needs and the project does not have. */
export type VoiceKey = 'transcribe' | 'xai' | 'openrouter';

/** What the bar needs from the page it sits on. */
export type VoiceHost = {
	world: World;
	/** The project folder, where the keys are. */
	dir: () => string | undefined;
	/** Whether the project has a provider's key; undefined while that is not known yet. */
	hasKey: (key: VoiceKey) => boolean | undefined;
	/** Which service turns speech into words. */
	voiceProvider: () => 'openai-compatible' | 'xai';
	/** Reads a sentence in the person's own words; `requestId` lets a newer reading call it off. */
	read?: (text: string, requestId: string) => Promise<Reading>;
	/** Calls off a reading in flight. */
	cancelRead?: (requestId: string) => void;
	/** The reading again, with one answer picked by the person. */
	reread?: (reading: Reading, key: string, value: string) => Reading;
	/** Applies a reading's edits (or leaves its note) as one undo step, and says what was done. */
	apply?: (reading: Reading) => Promise<string>;
	/** Selects elements by id: what a command reading names, before the command runs on the selection. */
	select?: (ids: string[]) => void;
	/** The reading again, against the canvas as it is now ("again": bigger than the last time). */
	again?: (reading: Reading) => Reading;
	/** Says in the project's journal what the next write came from ("typed \"split\""). */
	note?: (text: string) => void;
	/** A sentence that is one command word for word, with its value in it ("hide", "play"). */
	readExact?: (said: string) => Reading | null;
	/** Writes one line of what was said and what came of it, in the project folder. */
	log?: (entry: Record<string, unknown>) => void;
	/** What the bar can do, a line per area, for "what can you do". */
	helpLines?: () => string[];
};

/** Commands kept for ↑/↓ in the bar. */
const HISTORY_LIMIT = 50;

const SILENT: VoiceLevels = { low: 0, mid: 0, high: 0, level: 0 };

const [mode, setMode] = createSignal<VoiceMode>('idle');
const [text, setText] = createSignal('');
const [reading, setReading] = createSignal<Reading | null>(null);
const [receipt, setReceipt] = createSignal<string | null>(null);
const [error, setError] = createSignal<string | null>(null);
const [levels, setLevels] = createSignal<VoiceLevels>(SILENT);
const [registered, setRegistered] = createSignal<readonly Command[]>([]);
const [history, setHistory] = createSignal<readonly string[]>([]);
const [missingKey, setMissingKey] = createSignal<VoiceKey | null>(null);
const [question, setQuestion] = createSignal<string | null>(null);
const [lastLatency, setLastLatency] = createSignal<number | null>(null);
const [applyAutomatically, setApplyAutomaticallySignal] = createSignal(storedApply());
const [help, setHelp] = createSignal<readonly string[]>([]);

export const voiceMode: Accessor<VoiceMode> = mode;
/** What is in the bar: the typed text, or the transcript of what was said. */
export const voiceText: Accessor<string> = text;
export const voiceReading: Accessor<Reading | null> = reading;
/** "Duplicated Wild storm · ⌘Z" */
export const voiceReceipt: Accessor<string | null> = receipt;
export const voiceError: Accessor<string | null> = error;
export const voiceLevels: Accessor<VoiceLevels> = levels;
/** Commands typed or said this session, newest last. */
export const voiceHistory: Accessor<readonly string[]> = history;
/** The key the bar is asking for, shown above it until it is saved or dismissed. */
export const voiceMissingKey: Accessor<VoiceKey | null> = missingKey;
/** What the bar is asking before it acts ("Delete Title? Enter to confirm · Esc to cancel"). */
export const voiceQuestion: Accessor<string | null> = question;
/** Key-up to words on screen for the last spoken command, in ms. */
export const voiceLatency: Accessor<number | null> = lastLatency;
/** Whether a reading the bar is sure of is applied at once; off, every reading waits for Enter. */
export const voiceAppliesAutomatically: Accessor<boolean> = applyAutomatically;
/** What the bar can do, shown when the person asks. */
export const voiceHelp: Accessor<readonly string[]> = help;

/** Shows what the bar can do, until the next command. */
export function showVoiceHelp(): void {
	setHelp(host?.helpLines?.() ?? []);
}

export function setVoiceAppliesAutomatically(on: boolean): void {
	setApplyAutomaticallySignal(on);
	try {
		localStorage.setItem(APPLY_SETTING, on ? 'on' : 'off');
	} catch {
		// Kept for this session only.
	}
}

/** "Do that again": the last thing the bar carried out, once more, on the canvas as it is now. */
export const AGAIN_COMMAND: Command = {
	id: 'edit.again',
	label: 'Do that again',
	group: 'Editing',
	keys: [],
	aliases: ['again', 'do that again', 'do it again', 'repeat that', 'once more', 'one more time'],
	action: () => undefined,
};

/**
 * Every command the bar can run: the shortcut table's and those the UI
 * registered — all but the bar's own (talking to it, typing into it), which
 * would only open what is already open.
 */
export function barCommands(): readonly Command[] {
	return [...COMMANDS, AGAIN_COMMAND, ...registered()].filter((command) => !command.id.startsWith('voice.'));
}

let host: VoiceHost | null = null;
let receiptTimer: ReturnType<typeof setTimeout> | undefined;
let errorTimer: ReturnType<typeof setTimeout> | undefined;

type Source = 'typed' | 'spoken';

/** What the bar last carried out, for "again": a command by name, or a reading. */
let lastDone: { command: Command } | { reading: Reading } | null = null;

/** Who wants to know the history changed (the page keeps it beside the project). */
const historyListeners = new Set<(entries: readonly string[]) => void>();

/** Hears every change to the history; returns the function that stops it. */
export function onVoiceHistory(listener: (entries: readonly string[]) => void): () => void {
	historyListeners.add(listener);
	return () => historyListeners.delete(listener);
}

/** Takes the history a project kept (↑ in the bar walks back through it). */
export function adoptVoiceHistory(entries: readonly string[]): void {
	setHistory(entries.filter((entry) => typeof entry === 'string' && entry.trim()).slice(-HISTORY_LIMIT));
}

/** The last command that ran, so an undo straight after it is recorded against it. */
let lastRan: { said: string; at: number } | null = null;

/** How long after a command an undo still counts as taking that command back. */
const UNDONE_MS = 15_000;

/** Writes one line of what was said and what came of it (words only; never audio, never keys). */
function logCommand(entry: Record<string, unknown>): void {
	host?.log?.({ at: Date.now(), ...entry });
}

/** What a reading came to, in the shape the log keeps. */
const loggedSteps = (reading: Reading): Array<Record<string, unknown>> =>
	reading.steps.map((step) => ({
		intent: step.intent,
		...(step.targets.length ? { targets: step.targets } : {}),
		...(Object.keys(step.slots).length ? { slots: Object.fromEntries(Object.entries(step.slots).map(([name, value]) => [name, value])) } : {}),
	}));

/** An undo right after a command is that command taken back: the log says so. */
function noteUndo(said: string): void {
	const last = lastRan;
	if (!last || Date.now() - last.at > UNDONE_MS) return;
	lastRan = null;
	logCommand({ said: last.said, how: 'typed', undone: true, undone_by: said });
}

/** What waits for the person: a command's yes (spoken deletes), or a reading's yes or pick. */
let pending: { command: Command; source: Source } | { reading: Reading; source: Source } | null = null;

/** The live reading's timer, and the request in flight (a live one, or the one Enter is waiting on). */
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let inFlight: string | null = null;
let requests = 0;
const nextRequestId = (): string => `voice-${Date.now().toString(36)}-${++requests}`;

/** The page the bar is on: where commands run and keys are read. Attached on mount; returns the detach. */
export function attachVoiceHost(next: VoiceHost): () => void {
	host = next;
	return () => {
		if (host === next) host = null;
	};
}

export function dismissMissingKey(): void {
	setMissingKey(null);
}

/**
 * Adds a command that needs the UI to run (a workspace, a panel, export),
 * so it can be named like any other. Returns the function that takes it out.
 */
export function registerCommand(command: Command): () => void {
	setRegistered((current) => [...current.filter((entry) => entry.id !== command.id), command]);
	return () => setRegistered((current) => current.filter((entry) => entry !== command));
}

/** What is typed into the bar; a pause in typing reads it (never applies it). */
export function setVoiceText(next: string): void {
	setText(next);
	if (mode() === 'typing') scheduleLiveRead();
}

/** Calls off the live reading, waiting or in flight. */
function cancelLiveRead(): void {
	clearTimeout(liveTimer);
	if (inFlight) host?.cancelRead?.(inFlight);
	inFlight = null;
}

/**
 * Reads what is typed once typing pauses, so what the bar understood shows
 * before Enter. An exact command needs no reading, and nothing is asked of
 * the key the person has not added yet: Enter asks for it.
 */
function scheduleLiveRead(): void {
	cancelLiveRead();
	if (reading()) setReading(null);
	const typed = text().trim();
	if (!host?.read || typed.length < 3 || host.hasKey('openrouter') !== true) return;
	if (matchCommand(barCommands(), typed)) return;
	liveTimer = setTimeout(() => void readLive(typed), LIVE_READ_MS);
}

async function readLive(typed: string): Promise<void> {
	const target = host;
	if (!target?.read) return;
	const requestId = nextRequestId();
	inFlight = requestId;
	try {
		const next = await target.read(typed, requestId);
		// Only the newest reading of what is still typed is shown.
		if (inFlight === requestId && mode() === 'typing' && text().trim() === typed) setReading(next);
	} catch {
		// A live reading that fails says nothing; Enter reads again and says why.
	} finally {
		if (inFlight === requestId) inFlight = null;
	}
}

export function setVoiceLevels(next: VoiceLevels): void {
	setLevels(next);
}

export function setVoiceMode(next: VoiceMode): void {
	setMode(next);
}

export function setVoiceReading(next: Reading | null): void {
	setReading(next);
}

/**
 * Takes down what the bar last said.
 *
 * Whatever the bar does next replaces what it said before, so its words go the
 * moment it is opened, closed, or asks something — leaving them up with their
 * timer cancelled is how "Showed Wild storm" used to sit above the bar until
 * the next command.
 */
function clearTimers(): void {
	clearTimeout(receiptTimer);
	clearTimeout(errorTimer);
	setReceipt(null);
	setError(null);
}

/** Opens the bar for typing (⌘K). */
export function openVoiceBar(): void {
	if (mode() === 'listening') return;
	clearTimers();
	setHelp([]);
	cancelLiveRead();
	pending = null;
	setQuestion(null);
	setReading(null);
	setMode('typing');
}

/** Closes the bar back to its resting pill. */
export function closeVoiceBar(): void {
	clearTimers();
	setHelp([]);
	cancelLiveRead();
	pending = null;
	setQuestion(null);
	setText('');
	setReading(null);
	setLevels(SILENT);
	setMode('idle');
}

/** Shows a receipt above the bar for a moment; a spoken command goes back to the pill after it. */
export function showReceipt(message: string, source: Source): void {
	clearTimers();
	setReceipt(message);
	if (source === 'spoken') setMode('done');
	receiptTimer = setTimeout(() => {
		clearTimers();
		if (mode() === 'done') closeVoiceBar();
	}, RECEIPT_MS);
}

/** Says what went wrong in plain words; the bar goes back to the pill after it, unless someone is typing. */
export function showVoiceError(message: string, source: Source = 'spoken'): void {
	clearTimers();
	setError(message);
	if (source === 'spoken') setMode('error');
	errorTimer = setTimeout(() => {
		clearTimers();
		if (mode() === 'error') closeVoiceBar();
	}, ERROR_MS);
}

function remember(entry: string): void {
	const trimmed = entry.trim();
	if (!trimmed) return;
	const next = [...history().filter((item) => item !== trimmed), trimmed].slice(-HISTORY_LIMIT);
	setHistory(next);
	for (const listener of historyListeners) listener(next);
}

/** What the journal says the next write came from. */
const noteFor = (text: string, source: Source): string => `${source === 'spoken' ? 'said' : 'typed'} "${text.trim()}"`;

/** The name a receipt gives what a command acted on: the selection's, when there is one. */
export function subjectOf(target: World, command: Command): string {
	if (command.when !== 'selection') return '';
	const selected = getSelection(target);
	if (selected.length === 0) return '';
	if (selected.length > 1) return ` ${selected.length} elements`;
	const name = selected[0]!.get(Name)?.value?.trim();
	return name ? ` ${name}` : '';
}

/** A command's label as a receipt says it: without its explanation. */
const plainLabel = (command: Command): string => command.label.split(' — ')[0]!;

/**
 * Commands that change the video, and what to say when one changes nothing:
 * the bar never claims a split that did not happen. Commands that only move
 * the view (zoom, tools, the playhead) are not here — they change no video.
 */
const NOTHING: Record<string, { what: string; why: string; fix?: string }> = {
	'edit.split': { what: 'split', why: "the playhead isn't over a clip", fix: 'Move the playhead onto a clip, or say "split at 5 seconds".' },
	'edit.delete': { what: 'delete', why: 'nothing selected could be deleted' },
	'edit.ripple-delete': { what: 'delete', why: 'nothing selected could be deleted' },
	'edit.duplicate': { what: 'duplicate', why: 'nothing selected could be copied' },
	'edit.group': { what: 'group', why: 'the selection could not be grouped' },
	'edit.ungroup': { what: 'ungroup', why: "the selection isn't a group" },
	'edit.wrap-scene': { what: 'wrap', why: 'the selection could not be put in a scene' },
	'edit.wrap-sequence': { what: 'wrap', why: 'the selection could not be put in a sequence' },
	'edit.unwrap-sequence': { what: 'unwrap', why: "the selection isn't a sequence" },
	'edit.paste': { what: 'paste', why: 'nothing has been copied', fix: 'Copy something first.' },
	'edit.cut': { what: 'cut', why: 'nothing selected could be cut' },
	'edit.hide': { what: 'hide', why: 'nothing selected could be hidden' },
	'edit.bring-front': { what: 'bring forward', why: "it's already in front" },
	'edit.send-back': { what: 'send back', why: "it's already at the back" },
	'range.in': { what: 'mark', why: "the in point is already there" },
	'range.out': { what: 'mark', why: "the out point is already there" },
	'range.clear': { what: 'clear', why: 'no range is marked' },
	'range.marker': { what: 'mark', why: 'no video is open' },
	'canvas.nudge-left': { what: 'move', why: "it didn't move — it may be locked" },
	'canvas.nudge-right': { what: 'move', why: "it didn't move — it may be locked" },
	'canvas.nudge-up': { what: 'move', why: "it didn't move — it may be locked" },
	'canvas.nudge-down': { what: 'move', why: "it didn't move — it may be locked" },
	'canvas.nudge-left-far': { what: 'move', why: "it didn't move — it may be locked" },
	'canvas.nudge-right-far': { what: 'move', why: "it didn't move — it may be locked" },
	'canvas.nudge-up-far': { what: 'move', why: "it didn't move — it may be locked" },
	'canvas.nudge-down-far': { what: 'move', why: "it didn't move — it may be locked" },
	'edit.nudge-earlier': { what: 'move', why: "it didn't move in time — it may be locked or at the start" },
	'edit.nudge-later': { what: 'move', why: "it didn't move in time — it may be locked" },
	'edit.nudge-earlier-far': { what: 'move', why: "it didn't move in time — it may be locked or at the start" },
	'edit.nudge-later-far': { what: 'move', why: "it didn't move in time — it may be locked" },
};

/** "Nothing to split — the playhead isn't over a clip. Move the playhead onto a clip, or say …" */
const nothingSaid = ({ what, why, fix }: { what: string; why: string; fix?: string }): string =>
	`Nothing to ${what} — ${why}.${fix ? ` ${fix}` : ''}`;

/**
 * Runs `command` as one undo step. Returns the receipt, or throws what the
 * person has to know ("Select something first", "Nothing to split — …"): a
 * command that should change the video and changed nothing never reports
 * that it worked.
 */
export function runCommand(target: World, command: Command): string {
	if (command.when === 'selection' && getSelection(target).length === 0) {
		throw new Error('Select something first.');
	}
	if (command.when === 'scene' && !getActiveEntity(target)) {
		throw new Error('Open a video first.');
	}

	const subject = subjectOf(target, command);
	const history = getEditHistory(target);
	// Undo and redo replay a step rather than record one: whether there was
	// one to replay is what says they did something.
	if (command.id === 'edit.undo' && !history.canUndo()) throw new Error('Nothing to undo.');
	if (command.id === 'edit.redo' && !history.canRedo()) throw new Error('Nothing to redo.');

	history.beginGesture();
	let changed = false;
	try {
		command.action(target);
	} finally {
		changed = history.endGesture();
	}
	const nothing = NOTHING[command.id];
	if (!changed && nothing) throw new Error(nothingSaid(nothing));
	return `${command.done ?? plainLabel(command)}${subject}${changed ? ' · ⌘Z' : ''}`;
}

/** Runs the command picked from the bar's list, as if its name had been typed. */
export function runListedCommand(command: Command): void {
	if (!host) return;
	const name = command.label.split(' — ')[0]!;
	remember(name);
	if (command.id === AGAIN_COMMAND.id) {
		setText('');
		void repeatLast('typed');
		return;
	}
	try {
		setText('');
		const message = runCommand(host.world, command);
		lastDone = { command };
		host.note?.(noteFor(name, 'typed'));
		showReceipt(message, 'typed');
	} catch (reason) {
		showVoiceError(reason instanceof Error ? reason.message : String(reason), 'typed');
	}
}

/** "Delete Card? Enter to confirm · Esc to cancel" */
function deleteQuestion(target: World, command: Command): string {
	const subject = subjectOf(target, command).trim() || 'the selection';
	const verb = command.id === 'edit.ripple-delete' ? 'Ripple delete' : 'Delete';
	return `${verb} ${subject}? Enter to confirm · Esc to cancel`;
}

/** Puts a command on hold for a yes: the bar asks, Enter answers. */
function ask(target: World, command: Command, source: Source): void {
	clearTimers();
	pending = { command, source };
	setQuestion(deleteQuestion(target, command));
	setMode('confirm');
}

/** Whether the bar is waiting on a yes. */
export function voiceIsAsking(): boolean {
	return mode() === 'confirm' && pending !== null;
}

/** Whether the bar is offering numbered choices. */
export function voiceIsChoosing(): boolean {
	return mode() === 'choose' && pending !== null;
}

/** A typed sentence goes back to the bar it was typed in; a spoken one ends on the pill. */
function settleBack(source: Source): void {
	if (source === 'typed') setMode('typing');
}

/** The person said yes (Enter): runs what was waiting. */
export function confirmVoice(): void {
	const waiting = pending;
	pending = null;
	setQuestion(null);
	if (!waiting || !host) {
		closeVoiceBar();
		return;
	}
	if ('reading' in waiting) {
		void applyReadingNow(waiting.reading, waiting.source);
		return;
	}
	try {
		const message = runCommand(host.world, waiting.command);
		lastDone = { command: waiting.command };
		host.note?.(noteFor(text() || waiting.command.label.split(' — ')[0]!, waiting.source));
		showReceipt(message, 'spoken');
	} catch (reason) {
		showVoiceError(reason instanceof Error ? reason.message : String(reason));
	}
}

/** The person said no (Escape): a typed sentence stays in the bar, to be said another way. */
export function cancelVoice(): void {
	const waiting = pending;
	if (waiting && 'reading' in waiting && waiting.source === 'typed') {
		pending = null;
		setQuestion(null);
		setReading(null);
		setMode('typing');
		return;
	}
	closeVoiceBar();
}

/** Picks numbered choice `index` (the keys 1–3): the reading is read again with that answer, and goes on from there. */
export async function pickVoiceChoice(index: number): Promise<void> {
	const waiting = pending;
	if (mode() !== 'choose' || !waiting || !('reading' in waiting) || !host?.reread) return;
	const choice = waiting.reading.choices[index];
	if (!choice) return;
	pending = null;
	setQuestion(null);
	await takeReading(host.reread(waiting.reading, choice.key, choice.value), waiting.source);
}

/** Picks another option on one of the reading's chips. Nothing is applied until Enter. */
export function pickVoiceAlternative(key: string, value: string): void {
	const current = reading();
	if (!current || !host?.reread) return;
	logCommand({ said: current.basis.situation.command, how: 'typed', corrected: { key, to: value } });
	const next = host.reread(current, key, value);
	setReading(next);
	if (pending && 'reading' in pending) pending = { reading: next, source: pending.source };
}

/**
 * Carries out a command typed into the bar or said to it. An exact command
 * name runs at once; anything else is read in the person's own words.
 */
export async function submitCommand(input: string, source: Source): Promise<void> {
	const said = input.trim();
	if (!said) return;
	remember(said);
	setText(said);
	clearTimeout(liveTimer);

	if (!host) {
		showVoiceError('Open a project first.', source);
		return;
	}
	const world = host.world;

	// A sentence that is one command word for word, with its value in it:
	// "hide" never means "show", so it never runs a toggle.
	const exact = host.readExact?.(said);
	if (exact) {
		cancelLiveRead();
		setReading(null);
		await takeReading(exact, source);
		return;
	}

	const command = matchCommand(barCommands(), said);
	if (!command) {
		await readOwnWords(said, source);
		return;
	}
	cancelLiveRead();
	setReading(null);

	if (command.id === AGAIN_COMMAND.id) {
		await repeatLast(source);
		return;
	}

	if (source === 'spoken' && ASK_FIRST.has(command.id)) {
		if (command.when === 'selection' && getSelection(world).length === 0) {
			showVoiceError('Select something first.', source);
			return;
		}
		ask(world, command, source);
		return;
	}

	try {
		if (command.id === 'edit.undo') noteUndo(said);
		const message = runCommand(world, command);
		lastDone = { command };
		host.note?.(noteFor(said, source));
		if (source === 'typed') setText('');
		showReceipt(message, source);
		lastRan = { said, at: Date.now() };
		logCommand({ said, how: source, steps: [{ intent: `command:${command.id}` }], lane: 'apply', ran: true, said_back: message });
	} catch (reason) {
		const message = reason instanceof Error ? reason.message : String(reason);
		logCommand({ said, how: source, steps: [{ intent: `command:${command.id}` }], lane: 'apply', ran: false, said_back: message });
		showVoiceError(message, source);
	}
}

/**
 * "Again": the last thing the bar carried out, once more. A command runs as
 * it did; a reading is read again against the canvas as it is now, from the
 * answers it had (no new request), so "bigger" again is bigger than before.
 */
async function repeatLast(source: Source): Promise<void> {
	const last = lastDone;
	const target = host;
	if (!last || !target) {
		showVoiceError('Nothing to do again yet.', source);
		return;
	}
	if ('reading' in last) {
		await takeReading(target.again ? target.again(last.reading) : last.reading, source);
		return;
	}
	if (source === 'spoken' && ASK_FIRST.has(last.command.id)) {
		ask(target.world, last.command, source);
		return;
	}
	try {
		const message = runCommand(target.world, last.command);
		target.note?.(noteFor(`again: ${last.command.label.split(' — ')[0]!}`, source));
		if (source === 'typed') setText('');
		showReceipt(message, source);
	} catch (reason) {
		showVoiceError(reason instanceof Error ? reason.message : String(reason), source);
	}
}

/**
 * A sentence that names no command: read by Jev, then applied, shown to
 * confirm, or offered as choices, by how sure the reading is.
 */
async function readOwnWords(said: string, source: Source): Promise<void> {
	const target = host;
	if (!target?.read) {
		showVoiceError("I don't know that command yet.", source);
		return;
	}
	if (target.hasKey('openrouter') === false) {
		cancelLiveRead();
		setMissingKey('openrouter');
		showVoiceError('Add your OpenRouter key to use your own words.', source);
		return;
	}

	// The live reading of this very sentence is the reading; anything else is read now.
	let next = reading();
	if (!next || next.basis.situation.command !== said) {
		cancelLiveRead();
		setReading(null);
		setMode('resolving');
		const requestId = nextRequestId();
		inFlight = requestId;
		try {
			next = await target.read(said, requestId);
		} catch (reason) {
			// Called off (Escape) while it was read: the bar has already moved on.
			if (mode() !== 'resolving') return;
			const message = reason instanceof Error ? reason.message : String(reason);
			if (/OpenRouter key/.test(message)) setMissingKey('openrouter');
			settleBack(source);
			showVoiceError(message, source);
			return;
		} finally {
			if (inFlight === requestId) inFlight = null;
		}
		if (mode() !== 'resolving') return;
		settleBack(source);
	}
	await takeReading(next, source);
}

/** Goes on with a reading by its lane: applied, held for a yes, offered as choices, or said to be nothing. */
async function takeReading(next: Reading, source: Source): Promise<void> {
	if (next.lane === 'nothing' || (next.lane === 'choose' && !next.choices.length)) {
		setReading(null);
		const message = next.message ?? "I couldn't tell which one you mean.";
		logCommand({ said: next.basis.situation.command, how: source, lane: next.lane, confidence: next.confidence, ran: false, said_back: message });
		showVoiceError(message, source);
		return;
	}
	setReading(next);
	if (next.lane === 'choose') {
		clearTimers();
		pending = { reading: next, source };
		setQuestion(`${next.message ?? 'Which one?'} Press 1–${next.choices.length} · Esc to cancel`);
		setMode('choose');
		return;
	}
	// Off in the bar's settings, every reading waits for Enter, however sure.
	if (next.lane === 'confirm' || next.destructive || (next.lane === 'apply' && !applyAutomatically())) {
		askAbout(next, source);
		return;
	}
	await applyReadingNow(next, source);
}

/** Holds a reading for a yes: the chips show what it will do, Enter applies it. */
function askAbout(next: Reading, source: Source): void {
	clearTimers();
	pending = { reading: next, source };
	// What it will act on is selected first: the canvas shows it, and the
	// question can name it.
	const targets = next.steps.flatMap((step) => step.targets);
	if (targets.length) host?.select?.(targets);
	const risky = next.steps.find((step) => step.risk === 'confirm');
	setQuestion(risky ? `${risky.label}${targets.length ? ` ${targets.length === 1 ? '1 element' : `${targets.length} elements`}` : ''}? Enter to confirm · Esc to cancel` : 'Enter to apply · Esc to cancel');
	setMode('confirm');
}

/** Applies a reading: a command runs as itself; edits and notes go through the page, as one undo step. */
async function applyReadingNow(next: Reading, source: Source): Promise<void> {
	const target = host;
	if (!target) return;
	if (next.steps.some((step) => step.intent === 'project.again')) {
		setReading(null);
		await repeatLast(source);
		return;
	}
	try {
		if (!target.apply) throw new Error("I don't know that command yet.");
		if (next.steps.some((step) => step.intent === 'project.undo')) noteUndo(next.basis.situation.command);
		const message = await target.apply(next);
		lastDone = { reading: next };
		target.note?.(noteFor(next.basis.situation.command, source));
		lastRan = { said: next.basis.situation.command, at: Date.now() };
		logCommand({
			said: next.basis.situation.command,
			how: source,
			steps: loggedSteps(next),
			lane: next.lane,
			confidence: next.confidence,
			ran: true,
			said_back: message,
		});
		setReading(null);
		if (source === 'typed') {
			setText('');
			settleBack(source);
		}
		showReceipt(message, source);
	} catch (reason) {
		setReading(null);
		settleBack(source);
		const message = reason instanceof Error ? reason.message : String(reason);
		logCommand({
			said: next.basis.situation.command,
			how: source,
			steps: loggedSteps(next),
			lane: next.lane,
			confidence: next.confidence,
			ran: false,
			said_back: message,
		});
		showVoiceError(message, source);
	}
}

// ---------------------------------------------------------------------------
// Talking: hold the key (or the wave), speak, let go.
// ---------------------------------------------------------------------------

/** Who is holding: the talk key, or the pointer on the wave. */
let talking: 'key' | 'pointer' | null = null;
/** Let go while the microphone was still opening: nothing is recorded. */
let letGo = false;
/** The scene talking paused, to be played again afterwards. */
let pausedScene: ReturnType<typeof getActiveEntity> = null;
let askedForMicrophone = false;

/** Whether a hold is in progress, and whose. */
export function voiceTalking(): 'key' | 'pointer' | null {
	return talking;
}

function pauseForTalking(target: World): void {
	const scene = getActiveEntity(target);
	if (scene && scene.get(Playback)?.playing) {
		togglePlayback(target, scene);
		pausedScene = scene;
	}
}

function resumeAfterTalking(target: World): void {
	const scene = pausedScene;
	pausedScene = null;
	if (scene && scene.isAlive() && !scene.get(Playback)?.playing) togglePlayback(target, scene);
}

/**
 * The talk key went down (or the wave was held): opens the microphone and
 * listens. The wave only appears once the microphone is live — it is the cue
 * to speak.
 */
export async function startTalking(by: 'key' | 'pointer' = 'key'): Promise<void> {
	if (!host || talking || mode() === 'listening' || mode() === 'transcribing') return;
	const target = host;

	const key: VoiceKey = target.voiceProvider() === 'xai' ? 'xai' : 'transcribe';
	if (target.hasKey(key) === false) {
		setMissingKey(key);
		showVoiceError(key === 'xai' ? 'Add your xAI key to talk to the editor.' : 'Add your Groq key to talk to the editor.');
		return;
	}

	talking = by;
	letGo = false;
	clearTimers();
	cancelLiveRead();
	setReading(null);
	pending = null;
	setQuestion(null);
	setReceipt(null);
	setError(null);

	if (!askedForMicrophone) {
		askedForMicrophone = true;
		const access = await requestMicrophoneAccess().catch(() => ({ status: 'granted' as const }));
		if (access.status !== 'granted') {
			talking = null;
			askedForMicrophone = false;
			showVoiceError(MIC_DENIED);
			return;
		}
	}

	const ready = await warmMicrophone();
	if (ready !== 'ready') {
		talking = null;
		showVoiceError(ready === 'no-device' ? 'No microphone is connected.' : MIC_DENIED);
		return;
	}
	if (letGo || talking === null) {
		talking = null;
		return;
	}

	pauseForTalking(target.world);
	setText('');
	setMode('listening');
	startCapture(setLevels, () => void stopTalking('released'));
}

/**
 * The hold ended. Released: the clip is sent and what was said is carried
 * out. Lost focus or cancelled: the clip is thrown away and nothing is sent.
 */
export async function stopTalking(reason: 'released' | 'lost-focus' | 'cancelled'): Promise<void> {
	if (!talking || !host) return;
	if (mode() !== 'listening') {
		// Still opening the microphone: startTalking sees this and stops there.
		letGo = true;
		talking = null;
		return;
	}
	talking = null;
	const target = host;
	const releasedAt = performance.now();

	if (reason !== 'released') {
		await cancelCapture();
		setLevels(SILENT);
		resumeAfterTalking(target.world);
		closeVoiceBar();
		return;
	}

	const clip = await stopCapture();
	setLevels(SILENT);
	if (!clip) {
		resumeAfterTalking(target.world);
		closeVoiceBar();
		return;
	}

	setMode('transcribing');
	const dir = target.dir();
	try {
		if (!dir) throw new Error('Open a project first.');
		const prompt = buildVoicePrompt(target.world, barCommands().map((command) => command.label));
		const { text: said } = await aiTranscribeCommand(dir, clip.bytes, clip.mime, prompt);
		setLastLatency(Math.round(performance.now() - releasedAt));
		if (!said.trim()) {
			showVoiceError("I didn't catch that.");
			return;
		}
		setText(said);
		await submitCommand(said, 'spoken');
	} catch (reason) {
		const message = reason instanceof Error ? reason.message : String(reason);
		if (/Add your (Groq|xAI) key/.test(message)) setMissingKey(target.voiceProvider() === 'xai' ? 'xai' : 'transcribe');
		showVoiceError(message);
	} finally {
		resumeAfterTalking(target.world);
	}
}
