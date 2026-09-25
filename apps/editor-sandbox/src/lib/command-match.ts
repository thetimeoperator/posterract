/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Finding the command a person typed or said among the editor's own: an exact
// name or alias first, then a name that starts with what was said, then
// cmdk's fuzzy score. A command runs only when it wins clearly — a near tie
// is a question, not an answer.

import { defaultFilter } from 'cmdk-solid';

export interface Matchable {
	id: string;
	label: string;
	aliases?: string[];
}

export interface CommandMatch<T extends Matchable> {
	command: T;
	score: number;
}

/** The score a command needs to run, and how far it has to lead the next one. */
export const MATCH_THRESHOLD = 0.85;
export const MATCH_MARGIN = 0.15;

/** Lowercase, trimmed, without `.,!?`, single spaces: how a command is compared. */
export function normalizeCommand(text: string): string {
	return text.toLowerCase().trim().replace(/[.,!?]/g, '').replace(/\s+/g, ' ');
}

/** A label is said without its explanation: "Undo — survives a reload" is "undo". */
const spokenLabel = (label: string): string => normalizeCommand(label.split(' — ')[0]!);

function namesOf(command: Matchable): string[] {
	return [spokenLabel(command.label), normalizeCommand(command.label), ...(command.aliases ?? []).map(normalizeCommand)];
}

function scoreOne(command: Matchable, text: string): number {
	const names = namesOf(command);
	if (names.includes(text)) return 1;
	if (names.some((name) => name.startsWith(text))) return 0.9;
	return Math.max(0, ...names.map((name) => defaultFilter(name, text)));
}

/** Every command that could be what `text` means, best first. */
export function rankCommands<T extends Matchable>(commands: readonly T[], text: string): CommandMatch<T>[] {
	const needle = normalizeCommand(text);
	if (!needle) return [];
	return commands
		.map((command) => ({ command, score: scoreOne(command, needle) }))
		.filter((match) => match.score > 0)
		.sort((a, b) => b.score - a.score);
}

/** The command `text` names, when one wins clearly; null when none does. */
export function matchCommand<T extends Matchable>(commands: readonly T[], text: string): T | null {
	const [best, next] = rankCommands(commands, text);
	if (!best || best.score < MATCH_THRESHOLD) return null;
	// A command's exact name is the command, even when it also starts a longer
	// one ("delete" and "delete and close the gap"); only two commands with the
	// same exact name are a tie.
	if (best.score === 1) return next?.score === 1 ? null : best.command;
	if (next && best.score - next.score < MATCH_MARGIN) return null;
	return best.command;
}

const KEY_NAMES: Record<string, string> = {
	mod: '⌘',
	shift: '⇧',
	alt: '⌥',
	ctrl: '⌃',
	' ': 'Space',
	arrowleft: '←',
	arrowright: '→',
	arrowup: '↑',
	arrowdown: '↓',
	backspace: 'Delete',
	delete: 'Delete',
	enter: 'Enter',
	escape: 'Esc',
	home: 'Home',
	end: 'End',
	'-': '−',
};

/** Modifiers in the order the Mac prints them. */
const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'mod'];

/** A shortcut's keys as a keyboard shows them: `['b', 'mod']` is `['⌘', 'B']`. `!` keys are left out. */
export function displayKeys(keys: readonly string[]): string[] {
	const pressed = keys.filter((key) => !key.startsWith('!'));
	const modifiers = MODIFIER_ORDER.filter((key) => pressed.includes(key));
	const rest = pressed.filter((key) => !MODIFIER_ORDER.includes(key));
	return [...modifiers, ...rest].map((key) => KEY_NAMES[key] ?? key.toUpperCase());
}
