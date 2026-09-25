/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The words a spoken command is likely to use, handed to speech-to-text as a
// hint so it spells them the way the editor does: the names and text on
// screen first (they are what "the title" or "Wild storm" refers to), then
// the commands, then the editor's own vocabulary spoken aloud — "lower third",
// "slide up", "fade in". Built fresh for every utterance, cut at 800
// characters (Groq's prompt limit is 224 tokens).

import { Chars, Name, getActiveEntity, getEntityChildren } from '@posterract/video-runtime';
import { vocabulary } from '@posterract/video-compiler/vocabulary';

import type { Entity, World } from 'koota';

const PROMPT_LIMIT = 800;
const TEXT_LIMIT = 40;

/** "slideUp" is said "slide up", "lower-third" is "lower third". */
export function spoken(value: string): string {
	return value
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[-_]/g, ' ')
		.toLowerCase();
}

/** Every value an enumerated prop takes, spoken; the first definition's values when it has several. */
function valuesOf(prop: string, tag?: string): string[] {
	const definitions = vocabulary.props[prop] ?? [];
	const definition = tag ? definitions.find((entry) => entry.tags.includes(tag)) : definitions[0];
	return (definition?.values ?? []).map(spoken);
}

/** The editor's words, as a person says them. */
export function editorWords(): string[] {
	const animations = valuesOf('type', 'animation');
	return [
		...valuesOf('place'),
		...animations,
		// The two animations everyone names by phase.
		'fade in', 'fade out', 'slide in', 'slide out',
		...valuesOf('easing', 'animation'),
		...valuesOf('preset', 'captions'),
	];
}

/** The active scene's elements, all the way down, in the file's order. */
function sceneElements(world: World): Entity[] {
	const scene = getActiveEntity(world);
	if (!scene) return [];
	const found: Entity[] = [];
	const walk = (parent: Entity) => {
		for (const child of getEntityChildren(world, parent)) {
			found.push(child);
			walk(child);
		}
	};
	walk(scene);
	return found;
}

/** The hint for one utterance: names and on-screen text, command names, editor words. */
export function buildVoicePrompt(world: World | null, commandLabels: readonly string[]): string {
	const words: string[] = [];
	if (world) {
		for (const entity of sceneElements(world)) {
			const name = entity.get(Name)?.value?.trim();
			if (name) words.push(name.slice(0, TEXT_LIMIT));
			const text = entity.get(Chars)?.value?.trim();
			if (text) words.push(text.replace(/\s+/g, ' ').slice(0, TEXT_LIMIT));
		}
	}
	words.push(...commandLabels.map((label) => label.split(' — ')[0]!));
	words.push(...editorWords());

	const seen = new Set<string>();
	let prompt = '';
	for (const word of words) {
		const key = word.toLowerCase();
		if (!word || seen.has(key)) continue;
		const next = prompt ? `${prompt}, ${word}` : word;
		if (next.length > PROMPT_LIMIT) break;
		seen.add(key);
		prompt = next;
	}
	return prompt;
}
