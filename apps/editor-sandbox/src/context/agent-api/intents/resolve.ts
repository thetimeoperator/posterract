/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What is on the canvas, as the reader is given it — and the two requests that
 * read a command: which areas it is about, then, inside each of those areas
 * only, which intent and which slots.
 *
 * The scene comes out of the world in numbers here; `scene.ts` turns those
 * numbers into the words Jev actually reads.
 */

import {
  Animation, AnimationPhase, Cache, Chars, Color, Computed, Fonts, FrameRate, Library, Locked, Marker, Name,
  Playback, Scene, Selected, Sequential, Source, TextStyle, Workarea,
  colorToHex, getActiveEntity, getEntityChildren, getParentEntity, store,
} from '@posterract/video-runtime';
import { ANIMATION_TYPES, authoredElement } from '@posterract/video-reconciler';
import { parseSource } from '@posterract/composition';

import { getInspectEntries } from '@/engine/inspect';
import { shapeKindOf } from '@/engine/shapes';
import { snappingEnabled } from '@/engine/timeline/snapping';
import { aiCancelDecision, aiDecide } from '@/lib/ai-bridge';
import { assetName } from '@posterract/video-assets';

import { getDocumentEditor } from '@/engine/editor';

import { labelOf } from '../check';
import { isNode, resolveNode } from '../nodes';
import { requireEditorSession } from '../session';
import {
  AREAS_REQUEST, MEMBERS_REQUEST, areaQuestions, areaState, areasChosen, familyQuestions, familyState,
  keyOf, literalsOf, memberQuestions, mergeReadings, pick, piecesOf, readPlan, wantsMembers,
} from './read';
import { FAMILIES, FAMILY_BY_ID, INTENT_BY_ID, exactIntent } from './catalog';
import { compileStep } from './compile';

import type { Entity, World } from 'koota';
import type { Asset } from '@posterract/video-assets';
import type { Answers, AssetType, Basis, Family, Reading, SceneAsset, SceneElement, Situation, Step } from './types';

/** Source-level animation names, as the vocabulary spells them. */
const ANIMATION_NAMES = new Map<number, string>(Object.entries(ANIMATION_TYPES).map(([name, type]) => [type, name]));

/** What an edit calls an entity: its id, or its source stamp when it has none. */
function addressOf(entity: Entity): string | null {
  const stamp = entity.get(Source)?.value;
  if (!stamp) return null;
  const locator = parseSource(stamp)?.locator;
  return typeof locator === 'string' ? locator : stamp;
}

const round = (value: number, places = 3): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function numberProp(entity: Entity, name: string): number | undefined {
  const value = authoredElement(entity)?.props[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** An element's color as a person sees it: its own, or its first fill's. */
function colorOf(world: World, entity: Entity): string | undefined {
  const computed = store(world, Computed);
  if (entity.has(Color)) return colorToHex(computed.color[entity.id()] ?? 0);
  const fill = entity.get(Cache)?.fills?.[0];
  if (fill && fill.has(Color)) return colorToHex(computed.color[fill.id()] ?? 0);
  return undefined;
}

/** The file a clip, picture or sound plays, by its name. */
function mediaOf(entity: Entity): string | undefined {
  const props = authoredElement(entity)?.props ?? {};
  const own = typeof props.src === 'string' ? props.src : undefined;
  if (own) return own.split('/').pop();
  for (const child of entity.get(Cache)?.fills ?? []) {
    const src = authoredElement(child)?.props.src;
    if (typeof src === 'string') return src.split('/').pop();
  }
  return undefined;
}

/** A shape's kind as a person would name it: a circle rather than an ellipse when its sides are equal. */
function shapeOf(world: World, entity: Entity, width: number, height: number): string | undefined {
  const kind = shapeKindOf(world, entity);
  if (!kind) return undefined;
  const equal = width > 0 && height > 0 && Math.abs(width - height) / Math.max(width, height) < 0.06;
  if (kind === 'ellipse') return equal ? 'circle' : 'oval';
  if (kind === 'rectangle') return equal ? 'square' : 'rectangle';
  return kind;
}

/** One element of the situation: what it is, where and when, and the numbers a step starts from. */
function elementOf(world: World, entity: Entity, sceneStart: number, fps: number, order: number): SceneElement | null {
  const id = addressOf(entity);
  if (!id) return null;
  const computed = store(world, Computed);
  const eid = entity.id();
  const authored = authoredElement(entity)?.props ?? {};
  const text = entity.get(Chars)?.value;
  const fontSize = numberProp(entity, 'fontSize') ?? entity.get(TextStyle)?.fontSize;
  const cache = entity.get(Cache);

  const animations: SceneElement['animations'] = [];
  for (const child of cache?.animations ?? getEntityChildren(world, entity)) {
    const animation = child.get(Animation);
    const address = animation ? addressOf(child) : null;
    if (!animation || !address) continue;
    animations.push({
      id: address,
      type: ANIMATION_NAMES.get(animation.type) ?? String(animation.type),
      phase: animation.phase === AnimationPhase.OUT ? 'out' : 'in',
      ...(typeof authoredElement(child)?.props.duration === 'number' ? { duration: authoredElement(child)!.props.duration as number } : {}),
    });
  }

  const children = (kind: 'effects' | 'strokes' | 'shadows' | 'keyframeTracks'): Array<{ entity: Entity; id: string }> =>
    (cache?.[kind] ?? []).flatMap((child) => {
      const address = addressOf(child);
      return address ? [{ entity: child, id: address }] : [];
    });

  const width = round(computed.width[eid] ?? 0, 1);
  const height = round(computed.height[eid] ?? 0, 1);
  const x = computed.positionX[eid];
  const y = computed.positionY[eid];

  const props: SceneElement['props'] = {};
  if (typeof x === 'number') props.x = round(x, 1);
  if (typeof y === 'number') props.y = round(y, 1);
  if (width) props.width = width;
  if (height) props.height = height;
  props.scale = numberProp(entity, 'scale') ?? 1;
  if (typeof fontSize === 'number') props.fontSize = fontSize;
  for (const name of ['rotation', 'opacity', 'volume', 'playbackRate', 'cornerRadius', 'letterSpacing', 'leading'] as const) {
    const value = numberProp(entity, name);
    if (value !== undefined) props[name] = value;
  }

  const parent = getParentEntity(entity);
  const name = entity.get(Name)?.value?.trim();
  return {
    id,
    tag: labelOf(entity),
    ...(shapeOf(world, entity, width, height) ? { shape: shapeOf(world, entity, width, height) } : {}),
    ...(name ? { name } : {}),
    ...(typeof text === 'string' && text ? { text } : {}),
    ...(mediaOf(entity) ? { media: mediaOf(entity) } : {}),
    start: round(((computed.start[eid] ?? sceneStart) - sceneStart) / fps),
    end: round(((computed.end[eid] ?? sceneStart) - sceneStart) / fps),
    shown: computed.visibility[eid] === 1,
    ...(typeof authored.place === 'string' ? { place: authored.place } : {}),
    ...(width && height ? { box: { x: round(x ?? 0, 1), y: round(y ?? 0, 1), width, height } } : {}),
    ...(colorOf(world, entity) ? { color: colorOf(world, entity) } : {}),
    order,
    ...(parent && !parent.has(Scene) ? { parent: addressOf(parent) ?? undefined } : {}),
    ...(parent?.has(Sequential) ? { inSequence: true } : {}),
    props,
    animations,
    ...(children('effects').length
      ? { effects: children('effects').map(({ entity: child, id: address }) => ({ id: address, type: String(authoredElement(child)?.props.type ?? 'blur') })) }
      : {}),
    ...(children('strokes').length
      ? {
        strokes: children('strokes').map(({ entity: child, id: address }) => ({
          id: address,
          ...(typeof authoredElement(child)?.props.color === 'string' ? { color: authoredElement(child)!.props.color as string } : {}),
          ...(typeof authoredElement(child)?.props.width === 'number' ? { width: authoredElement(child)!.props.width as number } : {}),
        })),
      }
      : {}),
    ...(children('shadows').length ? { shadows: children('shadows').map(({ id: address }) => ({ id: address })) } : {}),
    ...(children('keyframeTracks').length
      ? {
        tracks: children('keyframeTracks').map(({ entity: child, id: address }) => ({
          id: address,
          property: String(authoredElement(child)?.props.property ?? ''),
          ...(typeof authoredElement(child)?.props.loop === 'string' ? { loop: authoredElement(child)!.props.loop as string } : {}),
        })),
      }
      : {}),
    ...(typeof authored.transition === 'object' && authored.transition
      ? { transition: String((authored.transition as { type?: string }).type ?? 'dissolve') }
      : {}),
    ...(typeof authored.preset === 'string' ? { preset: authored.preset } : {}),
    ...(authored.hidden === true ? { hidden: true } : {}),
    ...(authored.muted === true ? { muted: true } : {}),
    ...(entity.has(Locked) || authored.locked === true ? { locked: true } : {}),
  };
}

const ASSET_TYPES: Record<string, AssetType> = {
  IMAGE: 'image', VIDEO: 'video', AUDIO: 'audio', TRANSCRIPT: 'transcript', LOTTIE: 'lottie', SEQUENCE: 'sequence',
};

function assetOf(asset: Asset): SceneAsset | null {
  const type = ASSET_TYPES[asset.type];
  if (!type) return null;
  const sized = asset as { width?: number; height?: number; duration?: number };
  return {
    path: asset.path,
    name: assetName(asset),
    type,
    ...(typeof sized.duration === 'number' ? { duration: round(sized.duration, 1) } : {}),
    ...(typeof sized.width === 'number' ? { width: sized.width } : {}),
    ...(typeof sized.height === 'number' ? { height: sized.height } : {}),
  };
}

/** What the last command made or changed, so "it" and "that" mean them. */
let lastMade: string[] = [];

export function rememberLastMade(ids: string[]): void {
  lastMade = ids;
}

/** What is on the canvas, in the shape the reader reads. */
export function situationOf(command: string, extra: Partial<Situation> = {}): Situation {
  const { world } = requireEditorSession();
  const scene = getActiveEntity(world);
  const fps = world.get(FrameRate)?.value || 30;
  const computed = store(world, Computed);
  const sceneStart = scene ? computed.start[scene.id()] ?? 0 : 0;

  const elements: SceneElement[] = [];
  let order = 0;
  if (scene) {
    const own = elementOf(world, scene, sceneStart, fps, order++);
    if (own) elements.push({ ...own, shown: true });
    const walk = (parent: Entity): void => {
      for (const child of getEntityChildren(world, parent)) {
        if (!isNode(child) || child.has(Scene)) continue;
        const element = elementOf(world, child, sceneStart, fps, order++);
        if (element) elements.push(element);
        walk(child);
      }
    };
    walk(scene);
  }

  const selected = [...world.query(Selected, Source)]
    .filter((entity) => entity !== scene)
    .map(addressOf)
    .filter((id): id is string => id !== null);

  const markers = scene
    ? [...world.query(Marker)]
      .filter((entity) => getParentEntity(entity) === scene)
      .flatMap((entity) => {
        const id = addressOf(entity);
        const marker = entity.get(Marker);
        if (!id || !marker) return [];
        const name = entity.get(Name)?.value?.trim() ?? (authoredElement(entity)?.props.name as string | undefined);
        return [{ id, ...(name ? { name } : {}), time: round(marker.time / fps) }];
      })
      .sort((a, b) => a.time - b.time)
    : [];

  const scenes = [...world.query(Scene, Source)].flatMap((entity) => {
    const id = addressOf(entity);
    if (!id) return [];
    return [{
      id,
      ...(entity.get(Name)?.value ? { name: entity.get(Name)!.value } : {}),
      width: Math.round(computed.width[entity.id()] ?? 0),
      height: Math.round(computed.height[entity.id()] ?? 0),
      active: entity === scene,
    }];
  });

  const assets = (world.get(Library)?.assets() ?? []).flatMap((asset: Asset) => {
    const mapped = assetOf(asset);
    return mapped ? [mapped] : [];
  });

  const workarea = scene?.get(Workarea);

  return {
    command,
    scene: scene
      ? {
        id: addressOf(scene),
        ...(scene.get(Name)?.value ? { name: scene.get(Name)!.value } : {}),
        width: Math.round(computed.width[scene.id()] ?? 0),
        height: Math.round(computed.height[scene.id()] ?? 0),
        duration: round(((computed.end[scene.id()] ?? 0) - sceneStart) / fps),
        fps,
      }
      : null,
    playhead: scene ? round((computed.localTime[scene.id()] ?? 0) / fps) : 0,
    selected,
    elements,
    fonts: [...new Set(['Inter', ...(world.get(Fonts)?.list ?? []).map((font) => font.family)])],
    markers,
    assets,
    scenes,
    variables: getInspectEntries(world).map((entry) => ({
      key: `${entry.file}#${entry.name}`,
      name: entry.label || entry.name,
      type: entry.type,
      ...(entry.options ? { options: entry.options } : {}),
      ...(typeof entry.committed() === 'string' || typeof entry.committed() === 'number' || typeof entry.committed() === 'boolean'
        ? { value: entry.committed() as string | number | boolean }
        : {}),
    })),
    view: {
      playing: Boolean(scene?.get(Playback)?.playing),
      snapping: snappingEnabled(),
    },
    range: workarea && workarea.end > workarea.start ? { start: round(workarea.start / fps), end: round(workarea.end / fps) } : null,
    ...(lastMade.length ? { last: lastMade } : {}),
    ...extra,
  };
}

/**
 * Reads `command`: one small request for which areas it is about, then one
 * request per area, in parallel — and, when it is about several elements at
 * once, one more asking about each. `requestId` lets a newer reading call this
 * one off (the person kept typing).
 */
export async function resolveIntent(
  command: string,
  options: { dir: string; requestId: string; extra?: Partial<Situation> },
): Promise<Reading> {
  // "Trim the start and stop it at ten" is two commands: each is read on its
  // own, so each gets its own intent and its own element, and they run as one
  // undo step.
  const pieces = piecesOf(command);
  if (pieces.length > 1) {
    const read = await Promise.all(pieces.map((piece, index) => readOne(piece, {
      ...options,
      requestId: `${options.requestId}:p${index}`,
      creating: index > 0,
    })));
    return mergeReadings(command, read);
  }
  return readOne(command, options);
}

async function readOne(
  command: string,
  options: { dir: string; requestId: string; extra?: Partial<Situation>; creating?: boolean },
): Promise<Reading> {
  const situation = situationOf(command, options.extra ?? {});
  const literals = literalsOf(situation);

  const first = await aiDecide(options.dir, areaState(situation), areaQuestions(), `${options.requestId}:areas`);
  let answers: Answers = prefix(AREAS_REQUEST, first.answers as Answers);

  const families = areasChosen(answers);
  if (!families.length) return readPlan({ situation, commands: [], answers, families: [] });

  const creating = families.includes('create') || Boolean(options.creating);
  const asked = await Promise.all(families.map(async (id) => {
    const family = FAMILY_BY_ID.get(id);
    if (!family) return {} as Answers;
    const questions = familyQuestions(family, situation, literals, { creating: creating && id !== 'create' });
    if (!Object.keys(questions).length) return {} as Answers;
    const answer = await aiDecide(options.dir, familyState(family, situation), questions, `${options.requestId}:${id}`);
    return prefix(id, answer.answers as Answers);
  }));
  for (const answer of asked) answers = { ...answers, ...answer };

  if (wantsMembers(answers, families)) {
    const members = await aiDecide(options.dir, familyState(FAMILY_BY_ID.get(families[0]!)!, situation), memberQuestions(situation), `${options.requestId}:members`);
    answers = { ...answers, ...prefix(MEMBERS_REQUEST, members.answers as Answers) };
  }

  return readPlan({ situation, commands: [], answers, families });
}

const prefix = (request: string, answers: Answers): Answers =>
  Object.fromEntries(Object.entries(answers).map(([key, answer]) => [keyOf(request, key), answer]));

/** Calls off a reading in flight. */
export function cancelIntent(requestId: string): void {
  const off = (id: string): void => void aiCancelDecision(id).catch(() => undefined);
  off(`${requestId}:areas`);
  off(`${requestId}:members`);
  for (const family of FAMILY_BY_ID.keys()) off(`${requestId}:${family}`);
}

/** The reading with one answer picked by the person: a chip's alternative, or a numbered choice. */
export function rereadIntent(basis: Basis, key: string, value: string): Reading {
  return readPlan(pick(basis, key, value));
}

/**
 * The same reading made again on the canvas as it is now — the same answers,
 * the situation read afresh, no new request — for "again".
 */
export function readIntentAgain(reading: Reading): Reading {
  const situation = situationOf(reading.basis.situation.command);
  return readPlan({ ...reading.basis, situation });
}

/** The areas a reading was read from, for the log. */
export const familiesOf = (reading: Reading): Family[] => reading.basis.families;

/**
 * A sentence that is one intent word for word, with its value already in it
 * ("hide", "play", "snapping off"): read without asking Jev anything, because
 * the editor's own toggles would otherwise flip whatever they found.
 */
export function exactReading(said: string): Reading | null {
  const exact = exactIntent(said);
  if (!exact) return null;
  const intent = INTENT_BY_ID.get(exact.intent);
  if (!intent) return null;
  const situation = situationOf(said);
  const step: Step = {
    intent: intent.id,
    family: intent.id.split('.')[0] as Family,
    label: exact.label,
    targets: intent.target === 'none' ? [] : situation.selected,
    targetHow: intent.target === 'none' ? 'none' : situation.selected.length ? 'selection' : 'none',
    slots: exact.slots,
    confidence: 1,
    risk: intent.risk ?? 'safe',
  };
  const compiled = compileStep(step, situation);
  if (compiled) Object.assign(step, compiled);
  return {
    lane: step.risk === 'confirm' ? 'confirm' : 'apply',
    steps: [step],
    confidence: 1,
    chips: [],
    choices: [],
    ghost: null,
    destructive: step.risk === 'confirm',
    basis: { situation, commands: [], answers: {}, families: [step.family] },
  };
}

/** What the bar can do, in a handful of sentences — one from each area. */
export function helpLines(): string[] {
  return FAMILIES.flatMap((family) => {
    const intent = family.intents.find((entry) => entry.text.examples.length);
    return intent ? [`${family.label}: “${intent.text.examples[0]}”`] : [];
  });
}

/** Selects elements by id: what a reading names, before it is applied. */
export function selectForReading(ids: string[]): void {
  const { world } = requireEditorSession();
  const entities: Entity[] = [];
  for (const id of ids) {
    try {
      entities.push(resolveNode(world, id));
    } catch {
      // Gone since the command was read.
    }
  }
  if (entities.length) getDocumentEditor(world).select(entities);
}
