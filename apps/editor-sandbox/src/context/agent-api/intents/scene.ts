/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The scene in words, as Jev reads it.
 *
 * Jev compares numbers badly and words well, so every number about an element
 * is turned into a name first: how big it is, where it sits, what color it is,
 * where it is in the layer order, when it is on screen, and what is just above
 * or beside it. The numbers stay in the situation for code to work from; no
 * question ever asks Jev to compare them.
 *
 *   #t3 — the text "WILD STORM": large, white, top centre, in front of
 *   everything, on screen the whole video, under the playhead, fades in,
 *   just above the subtitle
 */

import { colorName, ordinal, sizeWord, timecode, whereWord } from './words';

import type { SceneElement, Situation } from './types';

const clip = (text: string, length: number): string => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/** The plain noun for an element, as a person would call it. */
export function nounOf(element: SceneElement): string {
  const { tag, shape, media, text } = element;
  if (tag === 'text') return text ? `the text "${clip(text, 60)}"` : 'a text';
  if (tag === 'captions') return 'the captions';
  if (tag === 'scene') return 'the scene itself (the whole frame and its background)';
  if (tag === 'group') return 'a group of elements';
  if (tag === 'sequence') return 'a sequence of clips, played one after another';
  if (tag === 'audio') return media ? `the sound "${clip(media, 40)}"` : 'a sound';
  if (tag === 'video') return media ? `the video clip "${clip(media, 40)}"` : 'a video clip';
  if (tag === 'image') return media ? `the picture "${clip(media, 40)}"` : 'a picture';
  if (tag === 'lottie') return 'a Lottie animation';
  if (tag === 'adjustmentLayer') return 'an adjustment layer, a filter over everything under it';
  if (tag === 'marker') return 'a marker on the timeline';
  if (tag === 'path') return 'a drawn line';
  if (media) return `a shape filled with "${clip(media, 40)}"`;
  if (shape) return `a ${shape}`;
  if (tag === 'rect') return 'a rectangle';
  if (tag === 'ellipse') return 'an oval';
  if (tag === 'polygon') return 'a shape';
  return `a ${tag}`;
}

/** What a receipt calls an element: its words if it is a text, else its name. */
export function nameOf(element: SceneElement | undefined): string {
  if (!element) return 'it';
  if (element.tag === 'text' && element.text) return clip(element.text, 28);
  if (element.name) return clip(element.name, 32);
  return nounOf(element).replace(/^(a|an|the) /, '');
}

/** The kind of thing an element is, for "all the text", "every picture". */
export function kindWord(element: SceneElement): string {
  if (element.tag === 'text') return 'text';
  if (element.tag === 'image') return 'picture';
  if (element.tag === 'video') return 'video clip';
  if (element.tag === 'audio') return 'sound';
  if (element.tag === 'captions') return 'captions';
  if (element.tag === 'group' || element.tag === 'sequence') return element.tag;
  if (element.media) return 'picture';
  return 'shape';
}

const MOTION_WORDS: Record<string, string> = {
  fade: 'fades', gain: 'fades its sound', grow: 'grows', shrink: 'shrinks', blur: 'blurs',
  slideLeft: 'slides', slideRight: 'slides', slideUp: 'slides', slideDown: 'slides',
  spin: 'spins', twist: 'twists', appearWord: 'appears word by word', appearChar: 'types on', scramble: 'scrambles',
};

/** An element in one line, as an option of a question about which element is meant. */
export function describeElement(element: SceneElement, situation: Situation): string {
  const parts: string[] = [nounOf(element)];
  const scene = situation.scene;

  if (element.name && element.tag !== 'text') parts.push(`the layer called "${clip(element.name, 40)}"`);
  else if (element.name && element.tag === 'text') parts.push(`the layer "${clip(element.name, 40)}"`);

  if (element.color && element.tag !== 'video' && element.tag !== 'image') parts.push(colorName(element.color));

  if (element.box && scene && scene.width > 0) {
    const area = Math.max(0, element.box.width) * Math.max(0, element.box.height);
    if (element.tag !== 'scene' && element.tag !== 'audio') {
      parts.push(sizeWord(area, scene.width * scene.height));
      parts.push(whereWord(element.box.x + element.box.width / 2, element.box.y + element.box.height / 2, scene.width, scene.height));
    }
  }

  if (element.place) parts.push(`placed ${element.place.replace(/-/g, ' ')}`);

  // Layer order, among everything drawn in the scene.
  const drawn = situation.elements.filter((other) => other.tag !== 'scene' && other.tag !== 'audio');
  if (drawn.length > 1 && element.tag !== 'scene' && element.tag !== 'audio') {
    const orders = drawn.map((other) => other.order);
    if (element.order === Math.max(...orders)) parts.push('in front of everything');
    else if (element.order === Math.min(...orders)) parts.push('behind everything');
  }

  // Which one of its kind, in time order, when there are several.
  const sameKind = situation.elements.filter((other) => kindWord(other) === kindWord(element) && other.tag !== 'scene');
  if (sameKind.length > 1) {
    const index = [...sameKind].sort((a, b) => a.start - b.start || a.order - b.order).indexOf(element);
    if (index >= 0) parts.push(`the ${ordinal(index + 1)} ${kindWord(element)}`);
  }

  // When it is on screen.
  const duration = scene?.duration ?? 0;
  if (element.tag !== 'scene') {
    if (element.start <= 0.05 && duration > 0 && element.end >= duration - 0.05) parts.push('on screen the whole video');
    else parts.push(`on screen ${timecode(element.start)}–${timecode(element.end)}`);
    if (element.shown) parts.push('under the playhead now');
    else if (element.end <= situation.playhead) parts.push('before the playhead');
    else parts.push('after the playhead');
  }

  for (const animation of element.animations) {
    const word = MOTION_WORDS[animation.type] ?? 'animates';
    parts.push(`${word} ${animation.phase === 'out' ? 'out' : 'in'}`);
  }
  if (element.effects?.length) parts.push(`has a ${element.effects.map((effect) => effect.type).join(' and ')} filter`);
  if (element.hidden) parts.push('hidden right now');
  if (element.muted) parts.push('its sound is off');
  if (element.locked) parts.push('locked');
  if (element.parent) {
    const parent = situation.elements.find((other) => other.id === element.parent);
    if (parent) parts.push(`inside ${nameOf(parent)}`);
  }

  const near = neighbours(element, situation);
  if (near) parts.push(near);

  return parts.join(', ');
}

/** "just below the title" — what an element sits against, so "the line under the title" resolves. */
function neighbours(element: SceneElement, situation: Situation): string | null {
  const box = element.box;
  const scene = situation.scene;
  if (!box || !scene) return null;
  const others = situation.elements.filter((other) =>
    other.id !== element.id && other.box && other.tag !== 'scene' && other.tag !== 'audio'
    && !(other.end <= element.start || other.start >= element.end));

  const said: string[] = [];
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const gap = Math.max(scene.height * 0.25, 200);

  const above = others
    .filter((other) => other.box!.y + other.box!.height <= box.y + 2 && overlaps(box.x, box.width, other.box!.x, other.box!.width))
    .sort((a, b) => (box.y - (b.box!.y + b.box!.height)) - (box.y - (a.box!.y + a.box!.height)))[0];
  if (above && box.y - (above.box!.y + above.box!.height) < gap) said.push(`just below ${nameOf(above)}`);

  const below = others
    .filter((other) => other.box!.y >= box.y + box.height - 2 && overlaps(box.x, box.width, other.box!.x, other.box!.width))
    .sort((a, b) => (a.box!.y - (box.y + box.height)) - (b.box!.y - (box.y + box.height)))[0];
  if (below && below.box!.y - (box.y + box.height) < gap) said.push(`just above ${nameOf(below)}`);

  if (!said.length) {
    const beside = others
      .filter((other) => Math.abs(other.box!.y + other.box!.height / 2 - centerY) < Math.max(box.height, 40))
      .sort((a, b) => Math.abs(a.box!.x - centerX) - Math.abs(b.box!.x - centerX))[0];
    if (beside) said.push(`${beside.box!.x + beside.box!.width / 2 < centerX ? 'to the right of' : 'to the left of'} ${nameOf(beside)}`);
  }
  return said.slice(0, 2).join(', ') || null;
}

const overlaps = (x: number, width: number, otherX: number, otherWidth: number): boolean =>
  x < otherX + otherWidth && otherX < x + width;

/** The whole scene in words, as the state a request carries. */
export function sceneInWords(situation: Situation, elements: SceneElement[]): string[] {
  return elements.map((element) => `#${element.id} — ${describeElement(element, situation)}`);
}

/** What is selected, in a line: "the title and the logo". */
export function selectionInWords(situation: Situation): string {
  const names = situation.selected
    .map((id) => situation.elements.find((element) => element.id === id))
    .filter((element): element is SceneElement => element !== undefined)
    .map((element) => nameOf(element));
  if (!names.length) return 'nothing is selected';
  if (names.length === 1) return `${names[0]} is selected`;
  return `${names.length} elements are selected: ${clip(names.join(', '), 160)}`;
}
