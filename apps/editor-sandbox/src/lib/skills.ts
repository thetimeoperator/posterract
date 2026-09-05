/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The skills the deck can offer, as the renderer sees them: one shared list
 * fetched from desktop main, plus the pieces every card needs — a sigil for
 * skills without a cover, and a check of the keys a skill asks for.
 */
import { createSignal } from 'solid-js';
import { MAIN_CHANNELS, type SkillCard } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';
import { aiKeysStatus } from '@/lib/ai-bridge';

export type { SkillCard };

const [skills, setSkills] = createSignal<SkillCard[]>([]);
const [loading, setLoading] = createSignal(false);
const [availableKeys, setAvailableKeys] = createSignal<Set<string>>(new Set());

/** Every skill known right now: project first, then library, then bundled. */
export const skillCards = skills;
export const skillsLoading = loading;

let refreshedFor: string | null | undefined;

/** Re-read the skill folders for `dir`; cheap enough to call on every open. */
export async function refreshSkills(dir: string | null): Promise<void> {
	if (!window.desktop) return;
	refreshedFor = dir;
	setLoading(true);
	try {
		const [cards, keys] = await Promise.all([
			mainBridge.call(MAIN_CHANNELS.SKILLS_LIST, { dir }),
			dir ? aiKeysStatus(dir).catch(() => null) : Promise.resolve(null),
		]);
		if (refreshedFor !== dir) return;
		setSkills(cards);
		setAvailableKeys(new Set(keys ? Object.entries(keys).filter(([, present]) => present).map(([key]) => key.toLowerCase()) : []));
	} finally {
		if (refreshedFor === dir) setLoading(false);
	}
}

export function findSkill(name: string | null | undefined): SkillCard | null {
	if (!name) return null;
	return skills().find((card) => card.name === name) ?? null;
}

/** The provider keys a skill asks for that the project has not been given. */
export function missingKeys(card: SkillCard): string[] {
	const have = availableKeys();
	return card.requires.filter((key) => !have.has(key));
}

export async function addSkillFolder(dir: string | null): Promise<SkillCard | null> {
	const card = await mainBridge.call(MAIN_CHANNELS.SKILLS_ADD_FOLDER, {});
	if (card) await refreshSkills(dir);
	return card;
}

export function revealSkill(card: SkillCard): Promise<void> {
	return mainBridge.call(MAIN_CHANNELS.SKILLS_REVEAL, { path: card.path });
}

/** "lead-with-animations" → "Lead With Animations"; manifests may override. */
export function skillTitle(name: string): string {
	return name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()).trim();
}

export type Sigil = {
	/** Two letters standing for the skill. */
	monogram: string;
	/** Which of the two brand lights the mark is drawn in. */
	tone: 'neon' | 'cyan';
	/** How far in the cut corners go, as a fraction of the mark's size. */
	cut: number;
	/** The mark's tilt, in degrees. */
	tilt: number;
};

function hash(text: string): number {
	let value = 2166136261;
	for (let index = 0; index < text.length; index += 1) {
		value ^= text.charCodeAt(index);
		value = Math.imul(value, 16777619);
	}
	return value >>> 0;
}

/**
 * The generated mark for a skill without a cover. Deterministic on the name,
 * so the same skill wears the same sigil on every machine: a cut-cornered
 * glyph with a monogram, in neon or cyan, tilted by a few degrees.
 */
export function sigilFor(name: string): Sigil {
	const words = name.split(/[-_\s]+/).filter(Boolean);
	const monogram = ((words[0]?.[0] ?? 's') + (words[1]?.[0] ?? words[0]?.[1] ?? 'k')).toUpperCase();
	const seed = hash(name);
	return {
		monogram,
		tone: seed % 5 === 0 ? 'cyan' : 'neon',
		cut: 0.12 + ((seed >>> 8) % 24) / 100,
		tilt: (((seed >>> 16) % 13) - 6),
	};
}

export function formatDuration(range: [number, number] | null): string | null {
	if (!range) return null;
	return `${range[0]}–${range[1]}s`;
}
