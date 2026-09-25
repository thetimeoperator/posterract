/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The intents that are settings, worked out as edits.
 *
 * Everything here is code, not Jev: the slots say what was asked for ("bigger",
 * "a little", "red"), and this turns that into the props the element actually
 * takes, from the numbers it has now. The intents that are not settings — a
 * split, an alignment, a keyframe, an export — are carried out by the editor's
 * own functions instead (runs/*.ts), and compile nothing here.
 */

import { propDefinition } from '@posterract/video-compiler/vocabulary';

import { STEPS } from './read';
import { PALETTE, stepColor } from './words';

import type { CanvasEdit } from '@posterract/cli/channels';
import type { SceneElement, Situation, SlotValue, Step } from './types';

type Compiled = { edits?: CanvasEdit[]; removals?: string[]; subs?: Array<{ id: string; props: Record<string, unknown> }> };

/** What a filter is set to when the command gives no number: the value its name suggests. */
const EFFECT_DEFAULTS: Record<string, number> = {
  blur: 8, brightness: 0.6, contrast: 0.6, grayscale: 1, hueRotate: 90, invert: 1, saturate: 0.4, sepia: 1,
};

/** The stroke and shadow the inspector's own buttons make. */
const DEFAULT_STROKE = { color: '#000000', width: 4 };
const DEFAULT_SHADOW = { color: '#000000', opacity: 0.35, blur: 24, offsetY: 8 };

/** The prop a spoken change is written as on a `<tag>`; undefined when that element has no such thing. */
export function propOn(tag: string, prop: string): string | undefined {
  if (prop === 'color') {
    if (propDefinition(tag, 'color')) return 'color';
    return propDefinition(tag, 'fill') ? 'fill' : undefined;
  }
  return propDefinition(tag, prop) ? prop : undefined;
}

const numberOf = (value: SlotValue | undefined): { value: number; unit: string } | null =>
  value?.kind === 'number' ? { value: value.value, unit: value.unit } : null;

const choiceOf = (value: SlotValue | undefined): string | null => (value?.kind === 'choice' ? value.value : null);

const onOf = (value: SlotValue | undefined): boolean | null => (value?.kind === 'onoff' ? value.on : null);

const stepOf = (value: SlotValue | undefined): number => (value?.kind === 'amount' ? value.step : 1);

const wordsOf = (value: SlotValue | undefined): string | null => (value?.kind === 'words' ? value.value : null);

/** A color slot as a hex, from the palette, a step lighter or darker, or another element's color. */
function hexOf(value: SlotValue | undefined, element: SceneElement | undefined, situation: Situation): string | null {
  if (!value) return null;
  if (value.kind === 'color') return value.hex;
  if (value.kind === 'color-step') return stepColor(element?.color ?? '#808080', value.lighter);
  if (value.kind === 'color-of') return situation.elements.find((entry) => entry.id === value.id)?.color ?? null;
  return null;
}

/** A length in the scene's pixels: px as they are, a percentage of the frame's width or height. */
function pixels(number: { value: number; unit: string }, situation: Situation, axis: 'x' | 'y' | 'shorter'): number {
  const width = situation.scene?.width ?? 1080;
  const height = situation.scene?.height ?? 1920;
  const against = axis === 'x' ? width : axis === 'y' ? height : Math.min(width, height);
  return number.unit === '%' ? Math.round((number.value / 100) * against) : number.value;
}

const set = (id: string, properties: Record<string, unknown>): CanvasEdit => ({ op: 'set', id, properties } as CanvasEdit);

/** Every element a step acts on, as the situation has them. */
const targetsOf = (step: Step, situation: Situation): SceneElement[] =>
  step.targets.map((id) => situation.elements.find((element) => element.id === id)).filter((element): element is SceneElement => element !== undefined);

/**
 * The edits a step comes to, or null when the editor's own functions carry it
 * out instead. Only the props the element really takes are written.
 */
export function compileStep(step: Step, situation: Situation): Compiled | null {
  const elements = targetsOf(step, situation);
  const slots = step.slots;
  const edits: CanvasEdit[] = [];
  const removals: string[] = [];
  const subs: Array<{ id: string; props: Record<string, unknown> }> = [];
  const write = (element: SceneElement, props: Record<string, unknown>): void => {
    const kept: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(props)) {
      const prop = propOn(element.tag, name);
      if (prop) kept[prop] = value;
    }
    if (Object.keys(kept).length) edits.push(set(element.id, kept));
  };

  switch (step.intent) {
    case 'arrange.place': {
      const spot = choiceOf(slots.spot);
      if (!spot) return null;
      for (const element of elements) write(element, { place: spot });
      break;
    }
    case 'arrange.move': {
      const direction = choiceOf(slots.direction);
      if (!direction) return null;
      const number = numberOf(slots.by);
      for (const element of elements) {
        const axis = direction === 'left' || direction === 'right' ? 'x' : 'y';
        const distance = number
          ? pixels(number, situation, axis)
          : Math.round(STEPS.move[stepOf(slots.amount)]! * Math.min(situation.scene?.width ?? 1080, situation.scene?.height ?? 1920));
        const sign = direction === 'left' || direction === 'up' ? -1 : 1;
        const now = axis === 'x' ? element.props.x : element.props.y;
        if (now === undefined) continue;
        write(element, { [axis]: Math.round(now + sign * distance) });
      }
      break;
    }
    case 'arrange.position': {
      const x = numberOf(slots.x);
      const y = numberOf(slots.y);
      if (!x && !y) return null;
      for (const element of elements) {
        write(element, {
          ...(x ? { x: pixels(x, situation, 'x') } : {}),
          ...(y ? { y: pixels(y, situation, 'y') } : {}),
        });
      }
      break;
    }
    case 'arrange.next-to': {
      const anchorId = slots.anchor?.kind === 'element' ? slots.anchor.id : null;
      const anchor = situation.elements.find((element) => element.id === anchorId);
      const relation = choiceOf(slots.relation) ?? 'below';
      if (!anchor?.box) return null;
      const gapNumber = numberOf(slots.gap);
      const gap = gapNumber ? pixels(gapNumber, situation, 'shorter') : 24;
      for (const element of elements) {
        if (!element.box) continue;
        const { width, height } = element.box;
        const middleX = anchor.box.x + anchor.box.width / 2 - width / 2;
        const middleY = anchor.box.y + anchor.box.height / 2 - height / 2;
        const spots: Record<string, { x: number; y: number }> = {
          below: { x: middleX, y: anchor.box.y + anchor.box.height + gap },
          above: { x: middleX, y: anchor.box.y - height - gap },
          left: { x: anchor.box.x - width - gap, y: middleY },
          right: { x: anchor.box.x + anchor.box.width + gap, y: middleY },
          center: { x: middleX, y: middleY },
          same: { x: anchor.box.x, y: anchor.box.y },
        };
        const at = spots[relation] ?? spots.below!;
        write(element, { x: Math.round(at.x), y: Math.round(at.y) });
      }
      break;
    }
    case 'arrange.size': {
      const scale = numberOf(slots.scale);
      const width = numberOf(slots.width);
      const height = numberOf(slots.height);
      const direction = choiceOf(slots.size_dir);
      if (!scale && !width && !height && !direction) return null;
      for (const element of elements) {
        if (width || height) {
          write(element, {
            ...(width ? { width: pixels(width, situation, 'x') } : {}),
            ...(height ? { height: pixels(height, situation, 'y') } : {}),
          });
          continue;
        }
        if (scale) {
          const factor = scale.unit === '%' ? scale.value / 100 : scale.value;
          // A text scales by its font size, so the words reflow rather than the box being magnified.
          if (element.tag === 'text' && element.props.fontSize) write(element, { fontSize: Math.round(element.props.fontSize * factor) });
          else write(element, { scale: Math.round(factor * 100) / 100 });
          continue;
        }
        const times = direction === 'smaller' ? 1 / STEPS.size[stepOf(slots.amount)]! : STEPS.size[stepOf(slots.amount)]!;
        if (element.tag === 'text' && element.props.fontSize) write(element, { fontSize: Math.round(element.props.fontSize * times) });
        else write(element, { scale: Math.round((element.props.scale ?? 1) * times * 100) / 100 });
      }
      break;
    }
    case 'arrange.fill-frame': {
      const how = choiceOf(slots.fill_how) ?? 'fill';
      const frame = situation.scene;
      if (!frame) return null;
      const anchorId = slots.anchor?.kind === 'element' ? slots.anchor.id : null;
      const anchor = situation.elements.find((element) => element.id === anchorId);
      for (const element of elements) {
        if (!element.box) continue;
        if (how === 'same' && anchor?.box) {
          write(element, { width: Math.round(anchor.box.width), height: Math.round(anchor.box.height) });
          continue;
        }
        const ratio = element.box.height ? element.box.width / element.box.height : 1;
        if (how === 'fill') write(element, { x: 0, y: 0, width: frame.width, height: frame.height });
        else if (how === 'fit') {
          const width = Math.min(frame.width, frame.height * ratio);
          const height = width / (ratio || 1);
          write(element, { x: Math.round((frame.width - width) / 2), y: Math.round((frame.height - height) / 2), width: Math.round(width), height: Math.round(height) });
        } else if (how === 'full-width') write(element, { x: 0, width: frame.width });
        else if (how === 'full-height') write(element, { y: 0, height: frame.height });
        else if (how === 'half-width') write(element, { width: Math.round(frame.width / 2) });
        else if (how === 'half-height') write(element, { height: Math.round(frame.height / 2) });
      }
      break;
    }
    case 'arrange.rotate': {
      const degrees = numberOf(slots.degrees);
      const how = choiceOf(slots.rotate_how);
      const spin = choiceOf(slots.spin);
      for (const element of elements) {
        const now = element.props.rotation ?? 0;
        let next: number | null = null;
        if (how === 'upside-down') next = 180;
        else if (how === 'quarter-right') next = now + 90;
        else if (how === 'quarter-left') next = now - 90;
        else if (how === 'straight') next = 0;
        else if (degrees) next = now + (spin === 'counterclockwise' ? -Math.abs(degrees.value) : degrees.value);
        else next = now + (spin === 'counterclockwise' ? -1 : 1) * [5, 15, 45][stepOf(slots.amount)]!;
        write(element, { rotation: Math.round(next * 10) / 10 });
      }
      break;
    }
    case 'arrange.rename': {
      const name = wordsOf(slots.words);
      if (!name) return null;
      for (const element of elements) write(element, { name });
      break;
    }
    case 'arrange.visibility': {
      const hide = onOf(slots.hide);
      if (hide === null) return null;
      for (const element of elements) {
        if (Boolean(element.hidden) === hide) continue;
        write(element, { hidden: hide });
      }
      break;
    }
    case 'arrange.lock': {
      const lock = onOf(slots.lock);
      if (lock === null) return null;
      for (const element of elements) {
        if (Boolean(element.locked) === lock) continue;
        write(element, { locked: lock });
      }
      break;
    }
    case 'arrange.keep-ratio': {
      const keep = onOf(slots.keep_ratio);
      if (keep === null) return null;
      for (const element of elements) write(element, { keepAspectRatio: keep });
      break;
    }
    case 'arrange.inset': {
      const number = numberOf(slots.inset);
      if (!number) return null;
      for (const element of elements) write(element, { inset: pixels(number, situation, 'shorter') });
      break;
    }
    case 'time.speed': {
      const rate = numberOf(slots.rate);
      const word = choiceOf(slots.speed_word);
      for (const element of elements) {
        const now = element.props.playbackRate ?? 1;
        let next: number;
        if (rate) next = rate.unit === '%' ? rate.value / 100 : rate.value;
        else if (word === 'normal') next = 1;
        else if (word === 'faster') next = now * [1.25, 1.5, 2][stepOf(slots.amount)]!;
        else if (word === 'slower') next = now / [1.25, 1.5, 2][stepOf(slots.amount)]!;
        else return null;
        write(element, { playbackRate: Math.round(next * 100) / 100 });
      }
      break;
    }
    case 'style.color': {
      for (const element of elements) {
        const hex = hexOf(slots.color, element, situation);
        if (!hex) return null;
        write(element, { color: hex });
      }
      break;
    }
    case 'style.opacity': {
      const number = numberOf(slots.opacity);
      const how = choiceOf(slots.see_through);
      for (const element of elements) {
        const now = element.props.opacity ?? 1;
        let next: number;
        if (number) next = number.unit === '%' || number.value > 1 ? number.value / 100 : number.value;
        else if (how === 'more') next = now * [0.85, 0.6, 0.3][stepOf(slots.amount)]!;
        else if (how === 'less') next = Math.min(1, now / [0.85, 0.6, 0.3][stepOf(slots.amount)]!);
        else return null;
        write(element, { opacity: Math.round(Math.min(1, Math.max(0, next)) * 100) / 100 });
      }
      break;
    }
    case 'style.blend': {
      const blend = choiceOf(slots.blend);
      if (!blend) return null;
      for (const element of elements) write(element, { blendMode: blend });
      break;
    }
    case 'style.corners': {
      const number = numberOf(slots.radius);
      const how = choiceOf(slots.corners_how);
      const which = choiceOf(slots.which_corners) ?? 'all';
      const names: Record<string, string[]> = {
        all: ['cornerRadius'],
        top: ['cornerRadiusTopLeft', 'cornerRadiusTopRight'],
        bottom: ['cornerRadiusBottomLeft', 'cornerRadiusBottomRight'],
        left: ['cornerRadiusTopLeft', 'cornerRadiusBottomLeft'],
        right: ['cornerRadiusTopRight', 'cornerRadiusBottomRight'],
        'top-left': ['cornerRadiusTopLeft'],
        'top-right': ['cornerRadiusTopRight'],
        'bottom-left': ['cornerRadiusBottomLeft'],
        'bottom-right': ['cornerRadiusBottomRight'],
      };
      for (const element of elements) {
        const now = element.props.cornerRadius ?? 0;
        const value = number
          ? pixels(number, situation, 'shorter')
          : how === 'sharper' ? 0 : Math.round(Math.max(8, now || 0) * (now ? [1.5, 2, 3][stepOf(slots.amount)]! : [1, 2, 4][stepOf(slots.amount)]!));
        if (!number && !how) return null;
        write(element, Object.fromEntries((names[which] ?? names.all!).map((name) => [name, value])));
      }
      break;
    }
    case 'style.font': {
      const font = choiceOf(slots.font) ?? wordsOf(slots.words);
      if (!font) return null;
      for (const element of elements) write(element, { fontFamily: font });
      break;
    }
    case 'style.text-size': {
      const number = numberOf(slots.font_size);
      const direction = choiceOf(slots.size_dir);
      for (const element of elements) {
        const now = element.props.fontSize;
        if (number) write(element, { fontSize: Math.round(pixels(number, situation, 'shorter')) });
        else if (direction && now) {
          const times = direction === 'smaller' ? 1 / STEPS.size[stepOf(slots.amount)]! : STEPS.size[stepOf(slots.amount)]!;
          write(element, { fontSize: Math.round(now * times) });
        } else return null;
      }
      break;
    }
    case 'style.bold': {
      const on = onOf(slots.bold);
      if (on === null) return null;
      for (const element of elements) write(element, { fontWeight: on ? 'bold' : 'normal' });
      break;
    }
    case 'style.italic': {
      const on = onOf(slots.italic);
      if (on === null) return null;
      for (const element of elements) write(element, { fontStyle: on ? 'italic' : 'normal' });
      break;
    }
    case 'style.text-align': {
      const align = choiceOf(slots.text_align);
      if (!align) return null;
      for (const element of elements) write(element, { textAlign: align });
      break;
    }
    case 'style.text-case': {
      const value = choiceOf(slots.text_case);
      if (!value) return null;
      for (const element of elements) write(element, { textCase: value });
      break;
    }
    case 'style.decoration': {
      const value = choiceOf(slots.decoration);
      if (!value) return null;
      for (const element of elements) write(element, { textDecoration: value });
      break;
    }
    case 'style.letter-spacing': {
      const number = numberOf(slots.spacing);
      const how = choiceOf(slots.spacing_how);
      for (const element of elements) {
        const now = element.props.letterSpacing ?? 0;
        const value = number ? number.value : how === 'tighter' ? now - [1, 2, 4][stepOf(slots.amount)]! : now + [1, 2, 4][stepOf(slots.amount)]!;
        if (!number && !how) return null;
        write(element, { letterSpacing: Math.round(value * 10) / 10 });
      }
      break;
    }
    case 'style.line-spacing': {
      const number = numberOf(slots.leading);
      const how = choiceOf(slots.leading_how);
      for (const element of elements) {
        const now = element.props.leading ?? 1;
        const value = number
          ? (number.unit === '%' || number.value > 4 ? number.value / 100 : number.value)
          : how === 'less' ? now - [0.1, 0.2, 0.4][stepOf(slots.amount)]! : now + [0.1, 0.2, 0.4][stepOf(slots.amount)]!;
        if (!number && !how) return null;
        write(element, { leading: Math.round(Math.max(0.1, value) * 100) / 100 });
      }
      break;
    }
    case 'style.baseline': {
      const value = choiceOf(slots.baseline);
      if (!value) return null;
      for (const element of elements) write(element, { textBaseline: value });
      break;
    }
    case 'style.text-box': {
      const how = choiceOf(slots.text_box);
      if (!how) return null;
      for (const element of elements) {
        if (how === 'auto') write(element, { width: false, height: false });
        else if (element.box) write(element, { width: Math.round(element.box.width), height: Math.round(element.box.height) });
      }
      break;
    }
    case 'style.words': {
      const words = wordsOf(slots.words);
      if (!words) return null;
      for (const element of elements) {
        if (element.tag === 'text') edits.push({ op: 'text', id: element.id, text: words } as CanvasEdit);
      }
      break;
    }
    case 'style.fit': {
      const fit = choiceOf(slots.fit);
      if (!fit) return null;
      for (const element of elements) write(element, { objectFit: fit });
      break;
    }
    case 'style.filter': {
      const type = choiceOf(slots.effect_type);
      if (!type) return null;
      const number = numberOf(slots.strength);
      const value = number
        ? (type === 'blur' || type === 'hueRotate' ? number.value : number.unit === '%' || number.value > 1 ? number.value / 100 : number.value)
        : EFFECT_DEFAULTS[type] ?? 1;
      for (const element of elements) {
        const already = element.effects?.find((effect) => effect.type === type);
        if (already) subs.push({ id: already.id, props: { value } });
        else edits.push({ op: 'create', parentId: element.id, element: { tag: 'effect', props: { type, value } } } as CanvasEdit);
      }
      break;
    }
    case 'style.filter-remove': {
      const type = choiceOf(slots.effect_type);
      const all = onOf(slots.all_filters);
      for (const element of elements) {
        const effects = element.effects ?? [];
        const wanted = all === false && type ? effects.filter((effect) => effect.type === type) : effects;
        for (const effect of (wanted.length ? wanted : effects)) removals.push(effect.id);
      }
      break;
    }
    case 'style.outline': {
      const how = choiceOf(slots.outline_how) ?? 'add';
      const number = numberOf(slots.stroke_width);
      for (const element of elements) {
        const stroke = element.strokes?.[0];
        const color = hexOf(slots.color, element, situation);
        if (how === 'remove') {
          for (const each of element.strokes ?? []) removals.push(each.id);
        } else if (!stroke) {
          edits.push({
            op: 'create',
            parentId: element.id,
            element: { tag: 'stroke', props: { color: color ?? DEFAULT_STROKE.color, width: number ? number.value : DEFAULT_STROKE.width } },
          } as CanvasEdit);
        } else {
          const width = number
            ? number.value
            : how === 'thicker' ? Math.round((stroke.width ?? DEFAULT_STROKE.width) * [1.5, 2, 3][stepOf(slots.amount)]!)
              : how === 'thinner' ? Math.max(1, Math.round((stroke.width ?? DEFAULT_STROKE.width) / [1.5, 2, 3][stepOf(slots.amount)]!))
                : null;
          const props: Record<string, unknown> = {};
          if (width !== null) props.width = width;
          if (color) props.color = color;
          if (Object.keys(props).length) subs.push({ id: stroke.id, props });
        }
      }
      break;
    }
    case 'style.shadow': {
      const how = choiceOf(slots.shadow_how) ?? 'add';
      for (const element of elements) {
        const shadow = element.shadows?.[0];
        const color = hexOf(slots.color, element, situation);
        if (how === 'remove') {
          for (const each of element.shadows ?? []) removals.push(each.id);
        } else if (!shadow) {
          edits.push({
            op: 'create',
            parentId: element.id,
            element: { tag: 'shadow', props: { ...DEFAULT_SHADOW, ...(color ? { color } : {}) } },
          } as CanvasEdit);
        } else {
          const props: Record<string, unknown> = {};
          if (how === 'softer') props.blur = DEFAULT_SHADOW.blur * [1.5, 2, 3][stepOf(slots.amount)]!;
          if (how === 'harder') props.blur = Math.max(0, DEFAULT_SHADOW.blur / [1.5, 2, 3][stepOf(slots.amount)]!);
          if (color) props.color = color;
          if (Object.keys(props).length) subs.push({ id: shadow.id, props });
        }
      }
      break;
    }
    case 'motion.add': {
      const type = choiceOf(slots.anim_type);
      if (!type) return null;
      const phase = choiceOf(slots.anim_phase) === 'out' ? 'out' : 'in';
      const easing = choiceOf(slots.easing);
      const duration = numberOf(slots.duration);
      const delay = numberOf(slots.delay);
      const distance = numberOf(slots.distance);
      for (const element of elements) {
        edits.push({
          op: 'create',
          parentId: element.id,
          element: {
            tag: 'animation',
            props: {
              type,
              phase,
              ...(easing ? { easing } : {}),
              ...(duration ? { duration: duration.value } : {}),
              ...(delay ? { delay: delay.value } : {}),
              ...(distance ? { distance: distance.value } : {}),
            },
          },
        } as CanvasEdit);
      }
      break;
    }
    case 'motion.remove': {
      const type = choiceOf(slots.anim_type);
      const phase = choiceOf(slots.anim_phase);
      const how = choiceOf(slots.remove_what) ?? 'all';
      for (const element of elements) {
        let wanted = element.animations;
        if (how !== 'all' && type) wanted = wanted.filter((animation) => animation.type === type);
        if (how === 'phase' && phase) wanted = wanted.filter((animation) => animation.phase === phase);
        for (const animation of (wanted.length ? wanted : element.animations)) removals.push(animation.id);
      }
      break;
    }
    case 'motion.change': {
      const phase = choiceOf(slots.anim_phase);
      const type = choiceOf(slots.anim_type);
      const easing = choiceOf(slots.easing);
      const duration = numberOf(slots.duration);
      const delay = numberOf(slots.delay);
      const distance = numberOf(slots.distance);
      const how = choiceOf(slots.speed_how);
      for (const element of elements) {
        const wanted = phase ? element.animations.filter((animation) => animation.phase === phase) : element.animations;
        for (const animation of (wanted.length ? wanted : element.animations)) {
          const props: Record<string, unknown> = {};
          if (type) props.type = type;
          if (easing) props.easing = easing;
          if (duration) props.duration = duration.value;
          if (delay) props.delay = delay.value;
          if (distance) props.distance = distance.value;
          if (!duration && how) {
            const now = animation.duration ?? 0.5;
            props.duration = Math.round(now * (how === 'slower' ? [1.5, 2, 3][stepOf(slots.amount)]! : 1 / [1.5, 2, 3][stepOf(slots.amount)]!) * 100) / 100;
          }
          if (Object.keys(props).length) subs.push({ id: animation.id, props });
        }
      }
      break;
    }
    case 'motion.stagger': {
      const number = numberOf(slots.stagger);
      if (!number) return null;
      for (const element of elements) write(element, { stagger: number.value });
      break;
    }
    case 'sound.volume': {
      const number = numberOf(slots.volume);
      const how = choiceOf(slots.loudness);
      for (const element of elements) {
        const now = element.props.volume ?? 0;
        let next: number;
        if (number) {
          // "down by six dB" is six less, however the number was said.
          if (number.unit === 'db') next = how === 'quieter' ? now - Math.abs(number.value) : how === 'louder' ? now + Math.abs(number.value) : number.value;
          else {
            const fraction = number.unit === '%' || number.value > 1 ? number.value / 100 : number.value;
            next = fraction <= 0 ? -60 : Math.round(20 * Math.log10(fraction) * 10) / 10;
          }
        } else if (how === 'louder') next = now + [2, 4, 8][stepOf(slots.amount)]!;
        else if (how === 'quieter') next = now - [2, 4, 8][stepOf(slots.amount)]!;
        else return null;
        write(element, { volume: Math.round(next * 10) / 10 });
      }
      break;
    }
    case 'sound.mute': {
      const on = onOf(slots.mute);
      if (on === null) return null;
      for (const element of elements) {
        if (Boolean(element.muted) === on) continue;
        write(element, { muted: on });
      }
      break;
    }
    case 'sound.fade': {
      const phase = choiceOf(slots.anim_phase) === 'out' ? 'out' : 'in';
      const duration = numberOf(slots.duration);
      for (const element of elements) {
        // Code picks the preset, not Jev: a sound fades its level, a picture its opacity.
        const type = element.tag === 'audio' || element.tag === 'video' ? 'gain' : 'fade';
        edits.push({
          op: 'create',
          parentId: element.id,
          element: { tag: 'animation', props: { type, phase, ...(duration ? { duration: duration.value } : {}) } },
        } as CanvasEdit);
      }
      break;
    }
    case 'captions.position': {
      const position = choiceOf(slots.position);
      if (!position) return null;
      for (const element of elements) write(element, { verticalAlign: position });
      break;
    }
    case 'captions.style': {
      const preset = choiceOf(slots.preset);
      if (!preset) return null;
      // The color slots are positional per preset, so they go when the preset changes.
      for (const element of elements) write(element, { preset, colors: false });
      break;
    }
    default:
      return null;
  }

  if (!edits.length && !removals.length && !subs.length) return null;
  return {
    ...(edits.length ? { edits } : {}),
    ...(removals.length ? { removals } : {}),
    ...(subs.length ? { subs } : {}),
  };
}

/** The colors a step names, for the intents that take two ("green to blue"). */
export const paletteHex = (name: string): string | undefined => PALETTE[name]?.hex;
