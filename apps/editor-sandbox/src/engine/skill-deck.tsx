/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Skill Deck's state and the one write it makes.
 *
 * A skill is a scene attribute (`<scene skill="…">`), so choosing one goes
 * through the document editor like every other edit: it lands in the source,
 * it is undoable, and the canvas, inspector and agent all read it from the
 * same trait. A marker at the top of the scene records the choice on the
 * timeline too — every edit shows in the code and on the timeline.
 */
import { createSignal } from 'solid-js';
import { ChildOf, Marker, Scene, SceneSkill } from '@posterract/video-runtime';
import { Marker as MarkerElement } from '@posterract/video-reconciler';
import { getDocumentEditor } from './editor';

import type { Entity, World } from 'koota';
import type { SkillCard } from '@/lib/skills';

const SKILL_MARKER_PREFIX = 'Skill: ';

const [deckScene, setDeckScene] = createSignal<Entity | null>(null);

/** The scene the deck is open for, or null when it is closed. */
export const skillDeckScene = deckScene;

export function openSkillDeck(scene: Entity): void {
	if (!scene.isAlive() || !scene.has(Scene)) return;
	setDeckScene(scene);
}

export function closeSkillDeck(): void {
	setDeckScene(null);
}

export function toggleSkillDeck(scene: Entity): void {
	if (deckScene() === scene) closeSkillDeck();
	else openSkillDeck(scene);
}

/** The skill name a scene carries, or null. */
export function sceneSkillName(scene: Entity | null | undefined): string | null {
	const value = scene?.get(SceneSkill)?.value;
	return value ? value : null;
}

/**
 * Give `scene` a skill, or take it away with `null`. The source attribute is
 * the record and the trait follows from it; the marker is the timeline's copy.
 */
export function installSkill(world: World, scene: Entity, skill: SkillCard | null): void {
	if (!scene.isAlive()) return;
	const editor = getDocumentEditor(world);

	// `false` is the writer's spelling for the attribute's absence.
	editor.editProperty(scene, 'skill', skill ? skill.name : false);

	const previous = [...world.query(ChildOf(scene), Marker)].find((entity) =>
		entity.get(Marker)?.name?.startsWith(SKILL_MARKER_PREFIX),
	);
	if (previous) editor.remove(previous);
	if (skill) {
		editor.insertElement(scene, () => <MarkerElement time={0} name={`${SKILL_MARKER_PREFIX}${skill.title}`} />);
	}
}
