/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Reading a command in the person's own words, in two steps.
 *
 * Step one asks which areas of the editor the command is about — a yes/no per
 * area, so a sentence may touch two ("add a circle and make it red"). Step two
 * asks, inside each area only, which of its intents is meant and what its
 * slots are: fewer, closer options are read far more accurately than one list
 * of three hundred.
 *
 * Nothing here touches the editor. What is on the canvas comes in as a
 * `Situation` and what is to be done goes out as `Step`s, so the same reading
 * runs in the app, in the unit tests, and in the corpus runner.
 */

import { CREATE_CARRIES, FAMILIES, FAMILY_BY_ID, INTENT_BY_ID, howParticular, runOrder, sameThingAs } from './catalog';
import { compileStep } from './compile';
import { describeElement, nameOf, selectionInWords } from './scene';
import { PALETTE, colorsSaid, findLiterals, givenWords, piecesOf, secondsOf, timecode } from './words';

import type { Literals, NumberLiteral } from './words';
import type {
  Answers, Basis, Chip, Choice, Family, FamilyDef, Ghost, IntentDef, Lane, OptionText,
  Questions, Reading, SceneElement, Situation, SlotSpec, SlotValue, Step, Unit,
} from './types';

// ---------------------------------------------------------------------------
// The lines a reading is drawn along
// ---------------------------------------------------------------------------

export const THRESHOLDS = {
  /** At or above: applied at once. */
  apply: 0.8,
  /** At or above (and below `apply`): shown as chips, applied on Enter. Below: numbered choices. */
  confirm: 0.5,
  /** An area at or above this is read in the second step. */
  area: 0.5,
  /** With no area above `area`, the best one at or above this is read anyway. */
  hunch: 0.2,
  /** An intent of a combining area at or above this is one the command asks for. */
  said: 0.5,
  /** `target_all` at or above this: each element is asked about. */
  targetAll: 0.6,
  /** An element whose `is_*` is at or above this is one of the elements meant. */
  member: 0.5,
  /** Not a command at all, at least this sure: nothing is done. */
  nonsense: 0.8,
  /** In a sentence that joins two, the area's runner-up at or above this is its second half. */
  second: 0.28,
} as const;

/** A sentence that asks for two things: "…, then …", "… and also …". */
const JOINED = /(,|\bthen\b|\band\b|\bafter that\b|\bas well\b|\balso\b)/i;

/** Relative steps by how much: ×size, and moves as a share of the scene's shorter side. */
export const STEPS = { size: [1.15, 1.3, 1.6], move: [0.05, 0.1, 0.2] } as const;

/** The levels of "how much", least first. */
export const AMOUNT_LEVELS = ['a little', 'noticeably', 'a lot'] as const;

/** At most this many elements are described to Jev. */
export const ELEMENT_LIMIT = 80;

/** At most this many numbers in one command are put to Jev. */
const NUMBER_LIMIT = 3;

const clip = (text: string, length: number): string => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// ---------------------------------------------------------------------------
// Step one: which areas
// ---------------------------------------------------------------------------

export const AREAS_REQUEST = 'areas';
export const MEMBERS_REQUEST = 'members';

/** The key an answer is kept under: its request, then its question. */
export const keyOf = (request: string, question: string): string => `${request}:${question}`;

export function areaQuestions(): Questions {
  const questions: Questions = {};
  for (const family of FAMILIES) questions[family.id] = { type: 'noul', instructions: family.ask };
  questions.needs_writing = {
    type: 'noul',
    instructions:
      'Does the command ask the editor to come up with new words or ideas of its own — write a headline, rewrite a line to be punchier, '
      + 'think of a script, suggest something? Words the person gives themselves ("a title that says Summer Sale") do not count, '
      + 'and neither does any ordinary editing.',
  };
  questions.nonsense = {
    type: 'noul',
    instructions:
      'Is this not a request to the video editor at all — small talk, a question about the world, a stray sentence, or noise picked up by the microphone?',
  };
  return questions;
}

/** The state step one carries: the command, the frame, and what is selected — no element list. */
export function areaState(situation: Situation): Record<string, unknown> {
  return {
    command: situation.command,
    video: situation.scene
      ? {
        ...(situation.scene.name ? { name: situation.scene.name } : {}),
        frame: `${situation.scene.width}×${situation.scene.height}`,
        length: `${situation.scene.duration} s`,
        playhead: timecode(situation.playhead),
      }
      : 'no video is open',
    selection: selectionInWords(situation),
  };
}

/** The areas to read in step two, most likely first. */
export function areasChosen(answers: Answers): Family[] {
  const scored = FAMILIES.map((family) => ({ id: family.id, p: yes(answers, keyOf(AREAS_REQUEST, family.id))?.p ?? 0 }))
    .sort((a, b) => b.p - a.p);
  const above = scored.filter((area) => area.p >= THRESHOLDS.area);
  if (above.length) return above.slice(0, 3).map((area) => area.id);
  const writing = yes(answers, keyOf(AREAS_REQUEST, 'needs_writing'))?.p ?? 0;
  const nonsense = yes(answers, keyOf(AREAS_REQUEST, 'nonsense'))?.p ?? 0;
  if (writing >= THRESHOLDS.said || nonsense >= THRESHOLDS.nonsense) return [];
  // Nothing was clear: the best guess is still read, and the reading will say how unsure it is.
  return scored[0] && scored[0].p >= THRESHOLDS.hunch ? [scored[0].id] : [];
}

// ---------------------------------------------------------------------------
// Step two: inside one area
// ---------------------------------------------------------------------------

/** The elements Jev is shown: the selected, then those on screen, then the nearest in time. */
export function boundElements(situation: Situation): SceneElement[] {
  const { elements } = situation;
  if (elements.length <= ELEMENT_LIMIT) return elements;
  const distance = (element: SceneElement): number =>
    situation.playhead < element.start ? element.start - situation.playhead
      : situation.playhead > element.end ? situation.playhead - element.end : 0;
  const selected = elements.filter((element) => situation.selected.includes(element.id));
  const shown = elements.filter((element) => element.shown && !selected.includes(element));
  const rest = elements
    .filter((element) => !selected.includes(element) && !shown.includes(element))
    .sort((a, b) => distance(a) - distance(b));
  return [...selected, ...shown, ...rest].slice(0, ELEMENT_LIMIT);
}

/** The intents of an area that could apply here: ones needing a kind of element nothing in the scene is are left out. */
export function intentsOn(family: FamilyDef, situation: Situation): IntentDef[] {
  return family.intents.filter((intent) => {
    if (!intent.tags) return true;
    return situation.elements.some((element) => intent.tags!.includes(element.tag));
  });
}

/** An option as Jev is shown it: what it is, what it is not, and how people say it. */
const optionText = (text: OptionText): OptionText => ({
  what: text.what,
  ...(text.notFor ? { notFor: text.notFor } : {}),
  examples: text.examples,
});

function elementOptions(situation: Situation, only?: (element: SceneElement) => boolean): Record<string, string> {
  const options: Record<string, string> = {};
  for (const element of boundElements(situation)) {
    if (only && !only(element)) continue;
    options[element.id] = describeElement(element, situation);
  }
  return options;
}

/** The colors on offer: the ones the command names, or the whole palette when it names none. */
function colorOptions(command: string): Record<string, string> {
  const said = colorsSaid(command);
  const names = said.length ? said : Object.keys(PALETTE);
  const options: Record<string, string> = {};
  for (const name of names) options[name] = `${name[0]!.toUpperCase()}${name.slice(1)}.`;
  options.lighter = 'A lighter shade of what it is now.';
  options.darker = 'A darker shade of what it is now.';
  options.same = 'The same color as another element in the scene.';
  return options;
}

/** The library, narrowed to the files the command's own words name. */
export function assetOptions(situation: Situation, types?: string[]): Record<string, string> {
  const words = situation.command.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
  const kept = situation.assets.filter((asset) => !types || types.includes(asset.type));
  const named = kept.filter((asset) => {
    const name = asset.name.toLowerCase();
    return words.some((word) => name.includes(word));
  });
  const offered = (named.length ? named : kept).slice(0, 40);
  const options: Record<string, string> = {};
  for (const asset of offered) {
    const length = asset.duration ? `, ${Math.round(asset.duration)} s long` : '';
    const size = asset.width && asset.height ? `, ${asset.width}×${asset.height}` : '';
    options[asset.path] = `The ${asset.type} "${asset.name}"${length}${size}.`;
  }
  return options;
}

const whenOptions = (situation: Situation): Record<string, string> => ({
  playhead: 'Where the playhead is now: "here", "now", "at the playhead", or the command gives no moment at all.',
  start: 'The very start of the video.',
  end: 'The very end of the video.',
  ...(situation.markers.length ? { marker: 'At a marker: the command names one, or means the one nearby.' } : {}),
  'element-start': 'When another element starts, comes in or appears.',
  'element-end': 'When another element ends, leaves or disappears.',
});

/** Whether the command sounds like it points at another element's look ("same color as the title"). */
const saysSameAs = (command: string): boolean => /\b(same|as the|like the|match(es|ing)?)\b/i.test(command);

/** Every question about the command inside one area. */
export function familyQuestions(
  family: FamilyDef,
  situation: Situation,
  literals: Literals,
  options: { creating?: boolean } = {},
): Questions {
  const questions: Questions = {};
  const intents = intentsOn(family, situation);
  if (!intents.length) return questions;

  if (family.exclusive) {
    const criteria: Record<string, string | OptionText> = {};
    for (const intent of intents) criteria[intent.id] = optionText(intent.text);
    criteria.none = 'None of these: the command asks for something else in this area, or for nothing here at all.';
    questions.intent = {
      type: 'choice',
      instructions: `Which of these does the command ask for?`,
      criteria,
    };
  } else {
    for (const intent of intents) {
      const text = intent.text;
      questions[`do_${short(intent.id)}`] = {
        type: 'noul',
        instructions: `Does the command ask to ${lower(text.what)}${text.notFor ? ` ${text.notFor}` : ''} For example: ${text.examples.map((example) => `"${example}"`).join(', ')}.`,
      };
    }
  }

  // What it acts on.
  const needsTarget = intents.some((intent) => intent.target !== 'none');
  if (needsTarget && situation.elements.length) {
    const criteria: Record<string, string> = elementOptions(situation);
    if (situation.selected.length) {
      criteria.selection = `${upper(selectionInWords(situation))}: pick this when the command says this, it, these, them, or names nothing.`;
    }
    if (options.creating) {
      criteria.new = 'The new element this same command adds ("add a circle and make it red").';
    }
    criteria.none = 'No element: the command is about the whole video, the editor, or something else.';
    questions.target = { type: 'choice', instructions: 'Which element is this part of the command about?', criteria };
    questions.target_all = {
      type: 'noul',
      instructions: 'Does the command mean several elements at once — "all the text", "every picture", "these", "them"?',
    };
  }

  // The area's own slots.
  const used = new Set(intents.flatMap((intent) => intent.uses ?? []));
  for (const [name, slot] of Object.entries(family.slots)) {
    if (!used.has(name)) continue;
    const question = slotQuestion(name, slot, situation, literals);
    if (question) questions[name] = question;
    if (slot.kind === 'when') {
      if (situation.elements.length) {
        questions[`${name}_element`] = {
          type: 'choice',
          instructions: 'If that moment is when another element starts or ends, which element is it?',
          criteria: elementOptions(situation),
        };
      }
      if (situation.markers.length) {
        questions[`${name}_marker`] = {
          type: 'choice',
          instructions: 'If that moment is a marker, which marker is it?',
          criteria: markerOptions(situation),
        };
      }
    }
    if (slot.kind === 'color' && saysSameAs(situation.command) && situation.elements.length) {
      questions.color_of = {
        type: 'choice',
        instructions: 'If the command asks for the same color as another element, which element is that?',
        criteria: elementOptions(situation),
      };
    }
  }

  // Numbers the command says: which setting each belongs to.
  const numbered = numberSlots(family, used);
  if (Object.keys(numbered).length) {
    literals.numbers.slice(0, NUMBER_LIMIT).forEach((literal, index) => {
      questions[`number_${index + 1}`] = {
        type: 'choice',
        instructions: `Which setting does "${literal.raw}" in the command belong to?`,
        criteria: { ...numbered, none: 'None of these: that number is part of a name or of the words, not a setting in this area.' },
      };
    });
  }

  // Words the command gives, when code could not find them by their quotes or by "says".
  const wordsSlot = Object.entries(family.slots).find(([name, slot]) => slot.kind === 'words' && used.has(name));
  if (wordsSlot && !givenWords(situation.command, literals)) {
    const words = situation.command.split(/\s+/).filter(Boolean).slice(0, 40);
    if (words.length >= 3) {
      questions.text_start = {
        type: 'choice',
        instructions: `If the command gives ${(wordsSlot[1] as { text: string }).text}, at which of its words do they begin?`,
        criteria: {
          ...Object.fromEntries(words.map((word, index) => [String(index + 1), `Word ${index + 1}: "${word}"`])),
          none: 'The command gives none.',
        },
      };
    }
  }
  return questions;
}

const markerOptions = (situation: Situation): Record<string, string> =>
  Object.fromEntries(situation.markers.map((marker) => [
    marker.id,
    `The marker${marker.name ? ` "${marker.name}"` : ''} at ${timecode(marker.time)}.`,
  ]));

/** The settings a number in the command could belong to, in this area. */
function numberSlots(family: FamilyDef, used: Set<string>): Record<string, string> {
  const options: Record<string, string> = {};
  for (const [name, slot] of Object.entries(family.slots)) {
    if (!used.has(name)) continue;
    if (slot.kind === 'number') options[name] = slot.text;
    if (slot.kind === 'when') options[name] = `${slot.ask} A number of seconds or frames, or a time like 0:12.`;
  }
  return options;
}

function slotQuestion(name: string, slot: SlotSpec, situation: Situation, literals: Literals): Questions[string] | null {
  switch (slot.kind) {
    case 'choice': {
      const options = name === 'font'
        ? Object.fromEntries(situation.fonts.slice(0, 60).map((font) => [font, `The ${font} typeface.`]))
        : name === 'voice'
          ? Object.fromEntries((situation.voices ?? []).map((voice) => [voice.id, voice.label]))
          : name === 'skill'
            ? Object.fromEntries((situation.skills ?? []).map((skill) => [skill.name, skill.what]))
            : slot.options;
      if (!Object.keys(options).length) return null;
      const criteria: Record<string, string | OptionText> = { ...options };
      if (!slot.noUnstated) criteria.unstated = 'The command does not say.';
      return { type: 'choice', instructions: slot.ask, criteria };
    }
    case 'onoff':
      return { type: 'noul', instructions: slot.ask };
    case 'amount':
      return { type: 'score', instructions: slot.ask, criteria: [...AMOUNT_LEVELS] };
    case 'color': {
      if (literals.colors.length) return null;
      return { type: 'choice', instructions: slot.ask, criteria: { ...colorOptions(situation.command), unstated: 'The command names no color.' } };
    }
    case 'when':
      return { type: 'choice', instructions: slot.ask, criteria: { ...whenOptions(situation), unstated: 'The command gives no moment; use whatever it usually is.' } };
    case 'asset': {
      const options = assetOptions(situation, slot.types);
      if (!Object.keys(options).length) return null;
      return { type: 'choice', instructions: slot.ask, criteria: { ...options, unstated: 'The command names no file.' } };
    }
    case 'element': {
      const options = elementOptions(situation, slot.containers
        ? (element) => element.tag === 'group' || element.tag === 'sequence' || element.tag === 'scene'
        : undefined);
      // The other scenes of the project are containers too, and they are not
      // among the elements of the one that is open.
      if (slot.containers) {
        for (const scene of situation.scenes) {
          if (options[scene.id]) continue;
          options[scene.id] = `The scene${scene.name ? ` "${scene.name}"` : ''} (${scene.width}×${scene.height})${scene.active ? ', the one open now' : ''}.`;
        }
      }
      if (!Object.keys(options).length) return null;
      return { type: 'choice', instructions: slot.ask, criteria: { ...options, unstated: 'The command names no other element.' } };
    }
    case 'marker': {
      const options = markerOptions(situation);
      if (!Object.keys(options).length) return null;
      return { type: 'choice', instructions: slot.ask, criteria: { ...options, unstated: 'The command names no marker.' } };
    }
    case 'scene': {
      if (situation.scenes.length < 2) return null;
      return {
        type: 'choice',
        instructions: slot.ask,
        criteria: {
          ...Object.fromEntries(situation.scenes.map((scene) => [
            scene.id,
            `The scene${scene.name ? ` "${scene.name}"` : ''} (${scene.width}×${scene.height})${scene.active ? ', the one open now' : ''}.`,
          ])),
          unstated: 'The command names no scene.',
        },
      };
    }
    case 'variable': {
      if (!situation.variables.length) return null;
      return {
        type: 'choice',
        instructions: slot.ask,
        criteria: {
          ...Object.fromEntries(situation.variables.map((variable) => [
            variable.key,
            `"${variable.name}", a ${variable.type}${variable.value !== undefined ? `, now ${String(variable.value)}` : ''}.`,
          ])),
          unstated: 'The command names no variable.',
        },
      };
    }
    default:
      return null;
  }
}

/** The state a second-step request carries: the command, the frame, and the scene in words. */
export function familyState(family: FamilyDef, situation: Situation): Record<string, unknown> {
  const needsElements = intentsOn(family, situation).some((intent) => intent.target !== 'none');
  return {
    command: situation.command,
    video: situation.scene
      ? { ...(situation.scene.name ? { name: situation.scene.name } : {}), frame: `${situation.scene.width}×${situation.scene.height}`, length: `${situation.scene.duration} s` }
      : 'no video is open',
    playhead: timecode(situation.playhead),
    selection: selectionInWords(situation),
    ...(needsElements
      ? { elements: boundElements(situation).map((element) => `#${element.id} — ${describeElement(element, situation)}`) }
      : {}),
  };
}

/** The second request, when a command is about several elements: one yes/no per element. */
export function memberQuestions(situation: Situation): Questions {
  const questions: Questions = {};
  boundElements(situation).forEach((element, index) => {
    questions[`is_${index}`] = {
      type: 'noul',
      instructions: `Is #${element.id} (${describeElement(element, situation)}) one of the elements the command refers to?`,
    };
  });
  return questions;
}

/** Whether the answers so far say the command is about several elements. */
export function wantsMembers(answers: Answers, families: Family[]): boolean {
  return families.some((family) => (yes(answers, keyOf(family, 'target_all'))?.p ?? 0) >= THRESHOLDS.targetAll);
}

// ---------------------------------------------------------------------------
// Reading the answers
// ---------------------------------------------------------------------------

type Chosen = { value: string; confidence: number; p: number | null; alternatives: Array<{ value: string; p: number }> };

function chosen(answers: Answers, key: string): Chosen | null {
  const answer = answers[key];
  if (!answer || typeof answer.choice !== 'string') return null;
  const probabilities = answer.probabilities ?? {};
  const p = typeof probabilities[answer.choice] === 'number' ? probabilities[answer.choice]! : null;
  const confidence = typeof answer.confidence === 'number' ? answer.confidence : p ?? 0.5;
  const alternatives = Object.entries(probabilities)
    .filter(([value, chance]) => value !== answer.choice && typeof chance === 'number')
    .map(([value, chance]) => ({ value, p: chance }))
    .sort((a, b) => b.p - a.p);
  return { value: answer.choice, confidence: clamp01(confidence), p, alternatives };
}

function yes(answers: Answers, key: string): { p: number; confidence: number } | null {
  const answer = answers[key];
  const p = typeof answer?.noul === 'number' ? answer.noul : null;
  if (p === null) return null;
  return { p: clamp01(p), confidence: Math.max(clamp01(p), 1 - clamp01(p)) };
}

/** A level of a score answer, least first. */
function level(answers: Answers, key: string, levels: readonly string[]): { index: number; confidence: number } | null {
  const answer = answers[key];
  if (!answer) return null;
  const confidence = typeof answer.confidence === 'number' ? clamp01(answer.confidence) : 0.5;
  const named = typeof answer.choice === 'string' ? answer.choice : typeof answer.score === 'string' ? answer.score : null;
  if (named !== null) {
    const index = levels.indexOf(named);
    return index === -1 ? null : { index, confidence };
  }
  const score = answer.score;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  const legend = answer.legend?.[String(score)];
  if (typeof legend === 'string' && levels.includes(legend)) return { index: levels.indexOf(legend), confidence };
  if (Number.isInteger(score)) return { index: Math.min(levels.length - 1, Math.max(0, score)), confidence };
  return { index: Math.round(clamp01(score) * (levels.length - 1)), confidence };
}

const lower = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);
const upper = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
/** `style.text-align` → `text_align`, for a question's key. */
const short = (id: string): string => id.split('.')[1]!.replace(/-/g, '_');

export function literalsOf(situation: Situation): Literals {
  const known = situation.elements.flatMap((element) => [element.name, element.text]).filter((phrase): phrase is string => Boolean(phrase));
  return findLiterals(situation.command, known);
}

/** Puts a person's pick in place of an answer: they are sure of it. */
export function withAnswer(basis: Basis, key: string, value: string): Basis {
  const answers = { ...basis.answers };
  const question = key.split(':')[1] ?? '';
  const isYesNo = answers[key]?.type === 'noul' || /^(do_|is_|target_all)/.test(question)
    || FAMILY_BY_ID.get(key.split(':')[0] as Family)?.slots[question]?.kind === 'onoff';
  if (isYesNo) answers[key] = { type: 'noul', noul: value === 'yes' ? 1 : 0 };
  else answers[key] = { type: 'choice', choice: value, confidence: 1, probabilities: { ...answers[key]?.probabilities, [value]: 1 } };
  return { ...basis, answers };
}

/** The basis with a chip's alternative picked: another option, or ("…=no") leaving that part out. */
export function pick(basis: Basis, key: string, value: string): Basis {
  const leave = /^(.+)=no$/.exec(value);
  return leave ? withAnswer(basis, leave[1]!, 'no') : withAnswer(basis, key, value);
}

// ---------------------------------------------------------------------------
// Filling an intent's slots
// ---------------------------------------------------------------------------

type Filled = { slots: Record<string, SlotValue>; weights: number[]; picked: Array<{ key: string; slot: string; value: string }> };

/** Which number belongs to which slot, from the `number_*` answers. */
function numbersFor(family: Family, answers: Answers, literals: Literals): Map<string, NumberLiteral> {
  const found = new Map<string, NumberLiteral>();
  literals.numbers.slice(0, NUMBER_LIMIT).forEach((literal, index) => {
    const answer = chosen(answers, keyOf(family, `number_${index + 1}`));
    if (!answer || answer.value === 'none' || found.has(answer.value)) return;
    found.set(answer.value, literal);
  });
  return found;
}

function numberValue(literal: NumberLiteral, units: Unit[], fps: number): { value: number; unit: Unit | '' } {
  const unit = literal.unit === '' ? '' : (literal.unit as Unit);
  if (unit === 'frames' && units.includes('s') && !units.includes('frames')) return { value: literal.value / (fps || 30), unit: 's' };
  return { value: literal.value, unit: unit === '' ? '' : unit };
}

function fillSlots(family: FamilyDef, intent: IntentDef, basis: Basis, literals: Literals): Filled {
  const { answers, situation } = basis;
  const slots: Record<string, SlotValue> = {};
  const weights: number[] = [];
  const picked: Filled['picked'] = [];
  const numbers = numbersFor(family.id, answers, literals);
  const fps = situation.scene?.fps ?? 30;

  for (const name of intent.uses ?? []) {
    const spec = family.slots[name];
    if (!spec) continue;
    const key = keyOf(family.id, name);

    if (spec.kind === 'number') {
      const literal = numbers.get(name);
      if (!literal) continue;
      const { value, unit } = numberValue(literal, spec.units, fps);
      slots[name] = { kind: 'number', value, unit };
      const answer = chosen(answers, keyOf(family.id, `number_${literals.numbers.indexOf(literal) + 1}`));
      if (answer) weights.push(answer.confidence);
      continue;
    }

    if (spec.kind === 'when') {
      const literal = numbers.get(name);
      if (literal) {
        const seconds = secondsOf(literal, fps);
        if (seconds !== null) {
          slots[name] = { kind: 'time', seconds, word: literal.raw };
          continue;
        }
      }
      const answer = chosen(answers, key);
      // "The playhead" is also what Jev picks when the command names no moment
      // at all, so it only counts as one when the person actually said here or
      // now: a new shape follows the tool's own timing otherwise.
      const said = answer && answer.value !== 'unstated' && (answer.value !== 'playhead' || literals.here);
      const moment = said ? momentOf(answer!.value, family.id, name, basis) : null;
      if (moment) {
        slots[name] = moment;
        weights.push(answer!.confidence);
        picked.push({ key, slot: name, value: answer!.value });
      } else if (literals.here) {
        slots[name] = { kind: 'time', seconds: situation.playhead, word: 'here' };
      }
      continue;
    }

    if (spec.kind === 'words') {
      const words = givenWords(situation.command, literals) ?? fromTextStart(basis, family.id);
      if (words) slots[name] = { kind: 'words', value: words };
      continue;
    }

    if (spec.kind === 'amount') {
      const said = level(answers, key, AMOUNT_LEVELS);
      if (said) {
        slots[name] = { kind: 'amount', step: Math.min(2, Math.max(0, said.index)) as 0 | 1 | 2 };
        weights.push(said.confidence);
      }
      continue;
    }

    if (spec.kind === 'onoff') {
      const said = yes(answers, key);
      if (said) {
        slots[name] = { kind: 'onoff', on: said.p >= 0.5 };
        weights.push(said.confidence);
        picked.push({ key, slot: name, value: said.p >= 0.5 ? 'yes' : 'no' });
      }
      continue;
    }

    if (spec.kind === 'color') {
      const hex = literals.colors[0];
      if (hex) {
        slots[name] = { kind: 'color', hex, word: hex };
        continue;
      }
      const answer = chosen(answers, key);
      if (!answer || answer.value === 'unstated') continue;
      if (answer.value === 'lighter' || answer.value === 'darker') {
        slots[name] = { kind: 'color-step', lighter: answer.value === 'lighter' };
      } else if (answer.value === 'same') {
        const of = chosen(answers, keyOf(family.id, 'color_of'));
        if (of && of.value !== 'unstated') slots[name] = { kind: 'color-of', id: of.value };
        else continue;
      } else if (PALETTE[answer.value]) {
        slots[name] = { kind: 'color', hex: PALETTE[answer.value]!.hex, word: answer.value };
      } else continue;
      weights.push(answer.confidence);
      picked.push({ key, slot: name, value: answer.value });
      continue;
    }

    const answer = chosen(answers, key);
    if (!answer || answer.value === 'unstated') continue;
    weights.push(answer.confidence);
    picked.push({ key, slot: name, value: answer.value });

    if (spec.kind === 'choice') slots[name] = { kind: 'choice', value: answer.value };
    else if (spec.kind === 'asset') {
      const asset = situation.assets.find((entry) => entry.path === answer.value);
      if (asset) slots[name] = { kind: 'asset', path: asset.path, name: asset.name, type: asset.type };
    } else if (spec.kind === 'element') slots[name] = { kind: 'element', id: answer.value };
    else if (spec.kind === 'marker') {
      const marker = situation.markers.find((entry) => entry.id === answer.value);
      if (marker) slots[name] = { kind: 'marker', id: marker.id, ...(marker.name ? { name: marker.name } : {}), time: marker.time };
    } else if (spec.kind === 'scene') slots[name] = { kind: 'scene', id: answer.value };
    else if (spec.kind === 'variable') slots[name] = { kind: 'variable', key: answer.value };
  }

  // A second number the command gives for the same pair ("200 by 400").
  return { slots, weights, picked };
}

/** A moment from a `when` answer that is not a spoken time. */
function momentOf(value: string, family: Family, name: string, basis: Basis): SlotValue | null {
  const { situation, answers } = basis;
  if (value === 'playhead') return { kind: 'time', seconds: situation.playhead, word: 'here' };
  if (value === 'start') return { kind: 'time', seconds: 0, word: 'the start' };
  if (value === 'end') return { kind: 'time', seconds: situation.scene?.duration ?? 0, word: 'the end' };
  if (value === 'marker') {
    const answer = chosen(answers, keyOf(family, `${name}_marker`));
    const marker = situation.markers.find((entry) => entry.id === answer?.value) ?? situation.markers[0];
    return marker ? { kind: 'time', seconds: marker.time, word: marker.name ? `the ${marker.name} marker` : 'the marker' } : null;
  }
  if (value === 'element-start' || value === 'element-end') {
    const answer = chosen(answers, keyOf(family, `${name}_element`));
    const element = situation.elements.find((entry) => entry.id === answer?.value);
    if (!element) return null;
    const at = value === 'element-start' ? element.start : element.end;
    return { kind: 'time', seconds: at, word: `${value === 'element-start' ? 'when' : 'after'} ${nameOf(element)}` };
  }
  return null;
}

/** The words a command gives, when Jev had to say at which word they begin. */
function fromTextStart(basis: Basis, family: Family): string | null {
  const answer = chosen(basis.answers, keyOf(family, 'text_start'));
  if (!answer || answer.value === 'none') return null;
  const words = basis.situation.command.split(/\s+/).filter(Boolean);
  const from = Number(answer.value);
  if (!Number.isFinite(from) || from < 1) return null;
  const said = words.slice(from - 1).join(' ').replace(/[.!?]+$/, '').trim();
  return said || null;
}

// ---------------------------------------------------------------------------
// What the command acts on
// ---------------------------------------------------------------------------

type Targets = { ids: string[]; how: Step['targetHow']; confidence: number; key: string; value: string; alternatives: Array<{ value: string; p: number }> };

function targetsOf(family: Family, basis: Basis): Targets {
  const { answers, situation } = basis;
  const bounded = boundElements(situation);
  const all = yes(answers, keyOf(family, 'target_all'));
  const members = bounded.map((_, index) => yes(answers, keyOf(MEMBERS_REQUEST, `is_${index}`)));
  if (all && all.p >= THRESHOLDS.targetAll && members.some((member) => member !== null)) {
    const ids = bounded.filter((_, index) => (members[index]?.p ?? 0) >= THRESHOLDS.member).map((element) => element.id);
    if (ids.length) {
      const confidence = Math.min(all.confidence, ...members.map((member) => member?.confidence ?? 1));
      return { ids, how: 'all', confidence, key: keyOf(family, 'target_all'), value: 'yes', alternatives: [] };
    }
  }

  const answer = chosen(answers, keyOf(family, 'target'));
  const key = keyOf(family, 'target');
  if (!answer) return { ids: situation.selected, how: situation.selected.length ? 'selection' : 'none', confidence: 1, key, value: 'selection', alternatives: [] };
  const how: Step['targetHow'] = answer.value === 'selection' ? 'selection' : answer.value === 'new' ? 'new' : answer.value === 'none' ? 'none' : 'named';
  const ids = how === 'selection' ? situation.selected : how === 'named' ? [answer.value] : [];
  return { ids, how, confidence: answer.confidence, key, value: answer.value, alternatives: answer.alternatives };
}

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

const laneOf = (confidence: number): Lane =>
  confidence >= THRESHOLDS.apply ? 'apply' : confidence >= THRESHOLDS.confirm ? 'confirm' : 'choose';

function slotText(value: SlotValue): string {
  switch (value.kind) {
    case 'choice': return value.value.replace(/-/g, ' ');
    case 'onoff': return value.on ? 'yes' : 'no';
    case 'number': return `${Math.round(value.value * 100) / 100}${value.unit === 'px' ? ' px' : value.unit === '%' ? '%' : value.unit ? ` ${value.unit}` : ''}`;
    case 'amount': return AMOUNT_LEVELS[value.step]!;
    case 'words': return `“${clip(value.value, 24)}”`;
    case 'time': return value.word;
    case 'color': return value.word;
    case 'color-step': return value.lighter ? 'lighter' : 'darker';
    case 'color-of': return 'the same color';
    case 'asset': return value.name;
    case 'element': return value.id;
    case 'marker': return value.name ?? 'the marker';
    case 'scene': return value.id;
    case 'variable': return value.key;
    default: return '';
  }
}

/** What the bar says a step will do, in a few words. */
export function stepReceipt(step: Step, situation: Situation): string {
  const intent = INTENT_BY_ID.get(step.intent);
  const who = step.targets.length === 1
    ? nameOf(situation.elements.find((element) => element.id === step.targets[0]))
    : step.targets.length > 1 ? `${step.targets.length} elements` : '';
  const parts = Object.entries(step.slots)
    .filter(([, value]) => value.kind !== 'element')
    .map(([, value]) => slotText(value))
    .filter(Boolean)
    .slice(0, 3);
  return [intent?.label ?? step.intent, who, parts.length ? `(${parts.join(', ')})` : ''].filter(Boolean).join(' ');
}

/** What the answers come to. */
export function readPlan(basis: Basis): Reading {
  const { situation, answers } = basis;
  const literals = literalsOf(situation);
  const families = basis.families;

  const writing = yes(answers, keyOf(AREAS_REQUEST, 'needs_writing'));
  const nonsense = yes(answers, keyOf(AREAS_REQUEST, 'nonsense'));

  const steps: Step[] = [];
  const chips: Chip[] = [];
  let weakest: { key: string; alternatives: Array<{ value: string; p: number }>; kind: 'intent' | 'target'; p: number } | null = null;

  for (const id of families) {
    const family = FAMILY_BY_ID.get(id);
    if (!family) continue;
    const area = yes(answers, keyOf(AREAS_REQUEST, id));
    const areaWeight = area ? Math.max(area.p, 0.01) : 1;
    const intents: Array<{ intent: IntentDef; confidence: number; key: string; alternatives: Array<{ value: string; p: number }> }> = [];

    if (family.exclusive) {
      const answer = chosen(answers, keyOf(id, 'intent'));
      if (answer && answer.value !== 'none') {
        const intent = INTENT_BY_ID.get(answer.value);
        if (intent) intents.push({ intent, confidence: answer.confidence, key: keyOf(id, 'intent'), alternatives: answer.alternatives });
        // "Split it here, then jump to the next cut" asks this area for two
        // things: the runner-up is taken too when the sentence joins two.
        if (JOINED.test(situation.command)) {
          const second = answer.alternatives.find((alternative) => alternative.value !== 'none' && alternative.p >= THRESHOLDS.second);
          const other = second ? INTENT_BY_ID.get(second.value) : undefined;
          if (other) intents.push({ intent: other, confidence: second!.p, key: keyOf(id, 'intent'), alternatives: [] });
        }
      }
    } else {
      for (const intent of intentsOn(family, situation)) {
        const key = keyOf(id, `do_${short(intent.id)}`);
        const said = yes(answers, key);
        if (said && said.p >= THRESHOLDS.said) intents.push({ intent, confidence: said.confidence, key, alternatives: [] });
      }
    }

    for (const { intent, confidence, key, alternatives } of intents) {
      const filled = fillSlots(family, intent, basis, literals);
      // An intent nobody gave a value for is not what the command asked: "make
      // it red" with no color named is not a color change.
      if (intent.needs && !intent.needs.some((slot) => filled.slots[slot] !== undefined)) continue;
      const targets = intent.target === 'none'
        ? { ids: [], how: 'none' as const, confidence: 1, key: keyOf(id, 'target'), value: 'none', alternatives: [] }
        : targetsOf(id, basis);
      let ids = targets.ids;
      let how = targets.how;
      // Nothing named: what is selected is what it means.
      if (!ids.length && how !== 'new' && intent.target !== 'optional' && situation.selected.length) {
        ids = situation.selected;
        how = 'selection';
      }
      if (intent.tags && how !== 'new' && ids.length) {
        const kept = ids.filter((elementId) => {
          const element = situation.elements.find((entry) => entry.id === elementId);
          return !element || intent.tags!.includes(element.tag);
        });
        // The element the sentence named is not the kind this intent is about:
        // "the subtitle should read …" is the text, not the captions.
        if (!kept.length && how === 'named') continue;
        if (kept.length) ids = kept;
      }
      const used = [areaWeight, confidence, ...filled.weights];
      if (intent.target !== 'none' && how !== 'none') used.push(targets.confidence);
      const step: Step = {
        intent: intent.id,
        family: id,
        label: intent.label,
        targets: ids,
        targetHow: how,
        slots: filled.slots,
        confidence: Math.min(...used),
        risk: intent.risk ?? 'safe',
      };
      const compiled = compileStep(step, situation);
      if (compiled) Object.assign(step, compiled);
      steps.push(step);

      chips.push({
        key,
        text: intent.label,
        sure: confidence >= THRESHOLDS.apply,
        alternatives: family.exclusive
          ? alternatives.filter((alternative) => alternative.value !== 'none').slice(0, 5).map((alternative) => ({
            value: alternative.value,
            text: INTENT_BY_ID.get(alternative.value)?.label ?? alternative.value,
            p: alternative.p,
          }))
          : [{ value: `${key}=no`, text: 'Leave this out', p: null }],
      });
      if (!family.exclusive) chips[chips.length - 1]!.key = key;
      if (!weakest || confidence < weakest.p) weakest = { key, alternatives, kind: 'intent', p: confidence };

      if (ids.length && intent.target !== 'none') {
        chips.push({
          key: targets.key,
          text: ids.length === 1 ? nameOf(situation.elements.find((element) => element.id === ids[0])) : `${ids.length} elements`,
          sure: targets.confidence >= THRESHOLDS.apply,
          alternatives: targets.alternatives.filter((alternative) => alternative.value !== 'none').slice(0, 5).map((alternative) => ({
            value: alternative.value,
            text: alternative.value === 'selection' ? 'The selection' : nameOf(situation.elements.find((element) => element.id === alternative.value)),
            p: alternative.p,
          })),
        });
        if (targets.confidence < (weakest?.p ?? 1)) weakest = { key: targets.key, alternatives: targets.alternatives, kind: 'target', p: targets.confidence };
      }
      for (const part of filled.picked.slice(0, 3)) {
        const answer = chosen(answers, part.key);
        chips.push({
          key: part.key,
          text: slotText(step.slots[part.slot]!),
          sure: (answer?.confidence ?? 1) >= THRESHOLDS.apply,
          alternatives: (answer?.alternatives ?? []).filter((alternative) => alternative.value !== 'unstated').slice(0, 5)
            .map((alternative) => ({ value: alternative.value, text: alternative.value.replace(/-/g, ' '), p: alternative.p })),
        });
      }
    }
  }

  // Words to be written are a note for the agent; words that are no command are nothing.
  if (!steps.length) {
    if ((writing?.p ?? 0) >= THRESHOLDS.said) {
      return empty(basis, 'note', `@agent ${situation.command.trim()}`, writing!.confidence);
    }
    if ((nonsense?.p ?? 0) >= THRESHOLDS.nonsense) {
      return empty(basis, 'nothing', "That isn't something the editor can do.", nonsense!.confidence);
    }
    return empty(basis, 'nothing', "I couldn't tell what to do. Try saying it another way.", 0);
  }

  // A step with nothing to act on, beside steps that do have something, is a
  // misreading of the same words: it goes rather than asking about it.
  const standing = steps.filter((step) => {
    const intent = INTENT_BY_ID.get(step.intent);
    return !intent || intent.target === 'none' || intent.target === 'optional' || step.targets.length || step.targetHow === 'new';
  });
  if (standing.length) {
    steps.length = 0;
    steps.push(...standing);
  }

  const kept = settle(steps, basis);
  steps.length = 0;
  steps.push(...kept);
  if (!steps.length) return empty(basis, 'nothing', "I couldn't tell what to do. Try saying it another way.", 0);

  steps.sort((a, b) => runOrder(a.intent) - runOrder(b.intent));

  // A step that needs an element and has none is the one thing to ask about.
  const missing = steps.find((step) => {
    const intent = INTENT_BY_ID.get(step.intent);
    return intent && (intent.target === 'one' || intent.target === 'many') && !step.targets.length && step.targetHow !== 'new';
  });

  const confidence = Math.min(...steps.map((step) => step.confidence));
  const destructive = steps.some((step) => step.risk === 'confirm');
  let lane: Lane = missing ? 'choose' : laneOf(confidence);
  if (destructive && lane === 'apply') lane = 'confirm';

  const choices: Choice[] = lane === 'choose'
    ? (missing
      ? choicesFrom(basis, keyOf(missing.family, 'target'), 'target')
      : weakest ? choicesFrom(basis, weakest.key, weakest.kind) : [])
    : [];

  return {
    lane,
    steps,
    confidence,
    chips: chips.slice(0, 6),
    choices,
    ghost: ghostOf(steps, situation),
    destructive,
    ...(missing ? { message: 'Which element?' } : {}),
    basis,
  };
}

/**
 * One wish, one step.
 *
 * A sentence that adds a red circle is about adding *and* about color, and Jev
 * says yes to both areas — honestly, since it was asked about each on its own.
 * So the steps are settled against each other here: of two intents that say the
 * same thing only the surer runs, and a part the adding already carries (the
 * spot, the size, the color it is made with) is not done a second time.
 */
function settle(steps: Step[], basis: Basis): Step[] {
  const made = steps.find((step) => step.family === 'create');
  let kept = steps.filter((step) => {
    if (!made || step === made) return true;
    // What the new element is made with is not a change to make afterwards.
    const carried = CREATE_CARRIES[step.intent];
    if (!carried) return true;
    const already = made.slots[carried] !== undefined;
    const aboutTheNewOne = step.targetHow === 'new' || step.targetHow === 'none' || !step.targets.length;
    return !(already && aboutTheNewOne);
  });

  for (const step of [...kept]) {
    if (!kept.includes(step)) continue;
    for (const other of sameThingAs(step.intent)) {
      const twin = kept.find((entry) => entry.intent === other);
      if (!twin) continue;
      // The one made for the kind of element it acts on wins outright: the
      // captions' own color, not an element's, when the target is the captions.
      const fitted = (entry: Step): boolean => {
        const tags = INTENT_BY_ID.get(entry.intent)?.tags;
        if (!tags || !entry.targets.length) return false;
        return entry.targets.every((id) => tags.includes(kindOfTarget(basis, id)));
      };
      const twinFits = fitted(twin);
      const stepFits = fitted(step);
      // Otherwise the surer one — but a close call goes to the more particular
      // reading, whose words ("close the hole") have nowhere else to go.
      const close = Math.abs(twin.confidence - step.confidence) < 0.15;
      const beaten = twinFits !== stepFits
        ? twinFits
        : close
          ? howParticular(twin.intent) < howParticular(step.intent)
          : twin.confidence > step.confidence;
      const loser = beaten ? step : twin;
      kept = kept.filter((entry) => entry !== loser);
    }
  }

  // Two things in one sentence is ordinary; five is a misreading.
  return kept.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

/** What kind of element a target is, for the reading that fits it. */
const kindOfTarget = (basis: Basis, id: string): string =>
  basis.situation.elements.find((element) => element.id === id)?.tag ?? '';

function choicesFrom(basis: Basis, key: string, kind: 'intent' | 'target'): Choice[] {
  const answer = chosen(basis.answers, key);
  if (!answer) return [];
  const options = [{ value: answer.value, p: answer.p ?? answer.confidence }, ...answer.alternatives]
    .filter((option) => option.value !== 'none' && option.value !== 'unstated')
    .slice(0, 3);
  return options.map((option) => {
    const element = kind === 'target' ? basis.situation.elements.find((entry) => entry.id === option.value) : undefined;
    const text = kind === 'intent'
      ? INTENT_BY_ID.get(option.value)?.label ?? option.value
      : option.value === 'selection' ? 'The selection' : nameOf(element);
    return { key, value: option.value, text, p: option.p, ...(element ? { elementId: element.id } : {}) };
  });
}

function ghostOf(steps: Step[], situation: Situation): Ghost | null {
  if (steps.length !== 1) return null;
  const step = steps[0]!;
  if (step.targets.length !== 1) return null;
  const id = step.targets[0]!;
  const set = step.edits?.find((edit) => edit.op === 'set' && edit.id === id);
  if (!set || set.op !== 'set') return null;
  const element = situation.elements.find((entry) => entry.id === id);
  const props = set.properties as Record<string, unknown>;
  const ghost: Ghost = { id };
  if (typeof props.place === 'string') ghost.place = props.place;
  if (typeof props.x === 'number' && element?.props.x !== undefined) ghost.dx = props.x - element.props.x;
  if (typeof props.y === 'number' && element?.props.y !== undefined) ghost.dy = props.y - element.props.y;
  if (typeof props.scale === 'number' && element?.props.scale !== undefined) ghost.scale = props.scale / (element.props.scale || 1);
  return ghost.place || ghost.dx || ghost.dy || ghost.scale ? ghost : null;
}

function empty(basis: Basis, lane: Lane, message: string, confidence: number): Reading {
  return { lane, steps: [], confidence, chips: [], choices: [], ghost: null, destructive: false, message, basis };
}

/** Reads a command from a situation and its answers in one call: what the tests and the corpus runner use. */
export function readCommand(situation: Situation, families: Family[], answers: Answers): Reading {
  return readPlan({ situation, commands: [], answers, families });
}

/**
 * A sentence that holds two commands, read as one.
 *
 * Each piece was read on its own (`piecesOf`), so each has its own intent, its
 * own element and its own slots; they run in the order they were said, as one
 * undo step. The whole sentence is what the bar shows and what the log keeps.
 */
export function mergeReadings(command: string, pieces: Reading[]): Reading {
  const real = pieces.filter((piece) => piece.steps.length);
  // Nothing in any piece: the first piece's answer is the honest one.
  if (!real.length) return pieces[0]!;

  const worst: Lane[] = ['nothing', 'choose', 'note', 'confirm', 'apply'];
  const lane = real.map((piece) => piece.lane).sort((a, b) => worst.indexOf(a) - worst.indexOf(b))[0]!;
  const basis: Basis = {
    ...real[0]!.basis,
    situation: { ...real[0]!.basis.situation, command },
    families: [...new Set(real.flatMap((piece) => piece.basis.families))],
  };
  return {
    lane,
    steps: real.flatMap((piece) => piece.steps),
    confidence: Math.min(...real.map((piece) => piece.confidence)),
    chips: real.flatMap((piece) => piece.chips).slice(0, 6),
    choices: real.find((piece) => piece.choices.length)?.choices ?? [],
    ghost: real.length === 1 ? real[0]!.ghost : null,
    destructive: real.some((piece) => piece.destructive),
    ...(real.find((piece) => piece.message)?.message ? { message: real.find((piece) => piece.message)!.message } : {}),
    basis,
  };
}

export { piecesOf };
