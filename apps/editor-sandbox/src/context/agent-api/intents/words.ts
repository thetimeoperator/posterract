/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What code finds in a command before Jev is asked anything: numbers as they
 * are said ("nine", "one point five", "half a second", "0:12", "to seconds"
 * for "two seconds"), quoted words, #hex colors, "here" — and the words the
 * scene is described in: named colors, sizes, places in the frame.
 *
 * Jev picks; it cannot produce a number or a word. So whatever a person says
 * that is a value is read here, in code, and Jev is only asked which setting
 * it belongs to.
 */

import type { Unit } from './types';

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export type NumberLiteral = {
  value: number;
  /** '' when the command gives no unit: the slot's own unit is meant. */
  unit: '' | Unit | 'ms' | 'min';
  /** As it was said ("nine seconds", "0:12"). */
  raw: string;
  /** Where it starts in the command. */
  at: number;
};

export type Literals = {
  numbers: NumberLiteral[];
  /** Words in quotes: the words a text is to say, a name. */
  quotes: string[];
  /** #hex colors said or typed. */
  colors: string[];
  /** "here", "now", "right here": the playhead. */
  here: boolean;
};

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const FRACTIONS: Record<string, number> = { half: 0.5, quarter: 0.25, third: 1 / 3 };

/** Unit words, as they are said, to the unit they are. */
const UNIT_WORDS: Record<string, NumberLiteral['unit']> = {
  px: 'px', pixel: 'px', pixels: 'px', pt: 'px', points: 'px',
  '%': '%', percent: '%', pct: '%',
  s: 's', sec: 's', secs: 's', second: 's', seconds: 's',
  ms: 'ms', millisecond: 'ms', milliseconds: 'ms',
  min: 'min', mins: 'min', minute: 'min', minutes: 'min',
  f: 'frames', frame: 'frames', frames: 'frames', fps: 'frames',
  deg: 'deg', degree: 'deg', degrees: 'deg', '°': 'deg',
  x: 'x', times: 'x',
  db: 'db', decibel: 'db', decibels: 'db',
};

/** Homophones a speech model writes for a number, trusted only right before a unit ("to seconds", "for frames"). */
const SOUNDS_LIKE: Record<string, number> = { to: 2, too: 2, for: 4, fore: 4, ate: 8, won: 1, tree: 3, free: 3 };

/** Words after "a second" / "a frame" that make it an amount of time rather than "another". */
const AFTER_AN_AMOUNT = /^(later|earlier|longer|shorter|forward|forwards|back|backward|backwards|ahead|before|after|in|out|of|and|or|more|less)?$/;

/** Words that make a level go down: a decibel after one of these is a cut, not a boost. */
const LOWERING = /^(down|lower|drop|dropped|reduce|cut|quieter|softer|duck|attenuate|less)$/;

/** Words before a bare "one" that make it a number ("at one", "to one") rather than a pronoun ("this one", "the red one"). */
const BEFORE_A_NUMBER = /^(at|to|by|from|until|till|is|be|of|point|minus|negative|x|times)$/;

type Token = { word: string; start: number; end: number };

function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const match of text.matchAll(/[a-z]+|\d+(?:[.:]\d+)*|%|°/gi)) {
    out.push({ word: match[0].toLowerCase(), start: match.index!, end: match.index! + match[0].length });
  }
  return out;
}

/** A unit at token `index`, and how many tokens it takes ("per cent" is two). */
function unitAt(list: Token[], index: number): { unit: NumberLiteral['unit']; length: number } | null {
  const word = list[index]?.word;
  if (!word) return null;
  if (word === 'per' && list[index + 1]?.word === 'cent') return { unit: '%', length: 2 };
  const unit = UNIT_WORDS[word];
  return unit ? { unit, length: 1 } : null;
}

/** Single digits said one after another ("five", "two five"), for what follows "point". */
function digitsAt(list: Token[], index: number): { text: string; length: number } | null {
  let text = '';
  let length = 0;
  for (;;) {
    const word = list[index + length]?.word;
    if (word === undefined) break;
    const one = ONES[word];
    if (one !== undefined && one < 10) text += String(one);
    else if (/^\d+$/.test(word)) text += word;
    else break;
    length += 1;
  }
  return length ? { text, length } : null;
}

/**
 * A number said in words or digits, starting at token `index`: "nine",
 * "twenty five", "one hundred", "one point five", "two and a half",
 * "a half", "half a", "point two", "12". Returns its value and how many
 * tokens it took.
 */
function spelledAt(list: Token[], index: number): { value: number; length: number } | null {
  const word = (at: number): string => list[at]?.word ?? '';
  let i = index;
  let value: number | null = null;

  if (word(i) === 'point') {
    const digits = digitsAt(list, i + 1);
    return digits ? { value: Number(`0.${digits.text}`), length: 1 + digits.length } : null;
  }

  if (TENS[word(i)] !== undefined) {
    value = TENS[word(i)]!;
    i += 1;
    const one = ONES[word(i)];
    if (one !== undefined && one > 0 && one < 10) {
      value += one;
      i += 1;
    }
  } else if (ONES[word(i)] !== undefined) {
    value = ONES[word(i)]!;
    i += 1;
  } else if (/^\d+(?:\.\d+)?$/.test(word(i))) {
    value = Number(word(i));
    i += 1;
  } else if (word(i) === 'hundred' || (word(i) === 'a' && word(i + 1) === 'hundred')) {
    value = 1;
    if (word(i) === 'a') i += 1;
  }

  if (value !== null && word(i) === 'hundred') {
    value *= 100;
    i += 1;
    if (word(i) === 'and') i += 1;
    const rest = spelledAt(list, i);
    if (rest && rest.value < 100 && Number.isInteger(rest.value)) {
      value += rest.value;
      i += rest.length;
    }
  }

  // "one point five"
  if (value !== null && Number.isInteger(value) && word(i) === 'point') {
    const digits = digitsAt(list, i + 1);
    if (digits) {
      value = Number(`${value}.${digits.text}`);
      i += 1 + digits.length;
    }
  }

  // "two and a half", "one and a quarter"
  if (value !== null && word(i) === 'and' && word(i + 1) === 'a' && FRACTIONS[word(i + 2)] !== undefined) {
    value += FRACTIONS[word(i + 2)]!;
    i += 3;
  }

  if (value !== null) return { value, length: i - index };

  // "a half", "a quarter", "a third" — "the third" is an order, not a fraction.
  if ((word(i) === 'a' || word(i) === 'one') && FRACTIONS[word(i + 1)] !== undefined) {
    return { value: FRACTIONS[word(i + 1)]!, length: 2 };
  }
  // "half", "half a", "half an"
  if (word(i) === 'half') return { value: 0.5, length: word(i + 1) === 'a' || word(i + 1) === 'an' ? 2 : 1 };
  return null;
}

/**
 * Every number in `text`, with its unit: digits ("9s", "12 px", "50%"),
 * spelled ("nine seconds", "one point five"), timecodes ("0:12", "1:05:00"),
 * and the words for a few ("half a second", "a second later", "twice", "double").
 */
export function findNumbers(text: string): NumberLiteral[] {
  const list = tokens(text);
  const found: NumberLiteral[] = [];
  const raw = (from: number, to: number): string => text.slice(list[from]!.start, list[Math.max(from, to - 1)]!.end);
  const negative = (token: Token): boolean =>
    text[token.start - 1] === '-' && !/[\w]/.test(text[token.start - 2] ?? ' ');

  for (let index = 0; index < list.length; index += 1) {
    const token = list[index]!;
    const previous = list[index - 1]?.word ?? '';
    const next = list[index + 1]?.word ?? '';

    // A timecode: minutes and seconds, or hours, minutes and seconds.
    if (/^\d+:\d{1,2}(?::\d{1,2})?(?:\.\d+)?$/.test(token.word)) {
      const seconds = token.word.split(':').map(Number).reduce((sum, part) => sum * 60 + part, 0);
      found.push({ value: seconds, unit: 's', raw: token.word, at: token.start });
      continue;
    }

    if (token.word === 'twice' || token.word === 'double') {
      found.push({ value: 2, unit: 'x', raw: token.word, at: token.start });
      continue;
    }
    if (token.word === 'triple') {
      found.push({ value: 3, unit: 'x', raw: token.word, at: token.start });
      continue;
    }

    // "a second later", "a frame earlier", "a minute" — one of the unit.
    if ((token.word === 'a' || token.word === 'an') && (next === 'second' || next === 'frame' || next === 'minute')) {
      // "add a frame", "a new second title": another one, not an amount of time.
      const another = /^(add|new|draw|create|make|insert|another|put|place)$/.test(previous);
      if (!another && (next === 'minute' || AFTER_AN_AMOUNT.test(list[index + 2]?.word ?? ''))) {
        const unit = UNIT_WORDS[next]!;
        let value = unit === 'min' ? 60 : 1;
        let end = index + 2;
        if (list[end]?.word === 'and' && list[end + 1]?.word === 'a' && FRACTIONS[list[end + 2]?.word ?? ''] !== undefined) {
          value += (unit === 'min' ? 60 : 1) * FRACTIONS[list[end + 2]!.word]!;
          end += 3;
        }
        found.push({ value, unit: unit === 'min' ? 's' : unit, raw: raw(index, end), at: token.start });
        index = end - 1;
      }
      continue;
    }

    // A word that sounds like a number, right before a unit word: "to seconds", "for frames".
    const soundsLike = SOUNDS_LIKE[token.word];
    if (soundsLike !== undefined) {
      const unit = unitAt(list, index + 1);
      if (unit && (unit.unit === 's' || unit.unit === 'frames' || unit.unit === 'min' || unit.unit === 'px' || unit.unit === 'deg')
        && next !== 's' && next !== 'f' && next !== 'x') {
        const value = unit.unit === 'min' ? soundsLike * 60 : soundsLike;
        found.push({ value, unit: unit.unit === 'min' ? 's' : unit.unit, raw: raw(index, index + 1 + unit.length), at: token.start });
        index += unit.length;
      }
      continue;
    }

    // Digits glued to a unit: "9s", "12px", "2x", "10f".
    const glued = /^(\d+(?:\.\d+)?)(px|s|ms|x|f|db|deg)$/.exec(token.word);
    if (glued) {
      const unit = UNIT_WORDS[glued[2]!] ?? '';
      const value = Number(glued[1]) * (negative(token) ? -1 : 1);
      found.push({ value: unit === 'ms' ? value / 1000 : value, unit: unit === 'ms' ? 's' : unit, raw: token.word, at: token.start });
      continue;
    }

    const number = spelledAt(list, index);
    if (!number) continue;

    let end = index + number.length;
    let value = number.value;
    // "three quarters of a second", "two thirds of a second"
    const parts = list[end]?.word ?? '';
    if (/^(quarters|thirds|halves|fifths)$/.test(parts)) {
      value *= { quarters: 0.25, thirds: 1 / 3, halves: 0.5, fifths: 0.2 }[parts]!;
      end += 1;
    }
    // "half a second", "a quarter of a second"
    if (list[end]?.word === 'of' && list[end + 1]?.word === 'a') end += 2;
    const unit = unitAt(list, end);
    // A bare "one" is a pronoun more often than a number: "this one", "the red one".
    if (!unit && list[index]!.word === 'one' && number.length === 1 && !BEFORE_A_NUMBER.test(previous)) continue;
    let unitValue: NumberLiteral['unit'] = unit?.unit ?? '';
    if (unit) end += unit.length;
    // "three seconds and a half"
    if (unit && list[end]?.word === 'and' && list[end + 1]?.word === 'a' && FRACTIONS[list[end + 2]?.word ?? ''] !== undefined) {
      value += FRACTIONS[list[end + 2]!.word]!;
      end += 3;
    }
    // "1 minute 30", "two minutes and ten seconds"
    if (unitValue === 'min') {
      value *= 60;
      unitValue = 's';
      let more = end;
      if (list[more]?.word === 'and') more += 1;
      const seconds = spelledAt(list, more);
      if (seconds) {
        value += seconds.value;
        end = more + seconds.length;
        if (unitAt(list, end)?.unit === 's') end += 1;
      }
    }
    if (unitValue === 'ms') {
      value /= 1000;
      unitValue = 's';
    }
    if (negative(token) || previous === 'minus' || previous === 'negative') value = -value;
    // Decibels take their sign from the command: "down 6 dB" is six less.
    if (unitValue === 'db' && value > 0) {
      const before = list.slice(Math.max(0, index - 6), index).map((entry) => entry.word);
      if (before.some((word) => LOWERING.test(word))) value = -value;
    }
    found.push({ value: Math.round(value * 1000) / 1000, unit: unitValue, raw: raw(index, end), at: token.start });
    index = end - 1;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Quotes, #hex, "here"
// ---------------------------------------------------------------------------

const QUOTED = /["“]([^"“”]{1,200})["”]|(?<![\w'’])['‘]([^'‘’]{1,200})['’](?![\w'’])/g;
const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/gi;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Numbers, quoted words, #hex colors, and whether the command says "here".
 * `known` are words the scene uses to name its elements ("Tonight at 9"): a
 * number inside one of them is part of a name, not a setting.
 */
export function findLiterals(text: string, known: readonly string[] = []): Literals {
  const quotes: string[] = [];
  let rest = text.replace(QUOTED, (whole, double?: string, single?: string) => {
    const quoted = (double ?? single ?? '').trim();
    if (quoted) quotes.push(quoted);
    return ' '.repeat(whole.length);
  });
  for (const phrase of known) {
    if (phrase.length >= 3 && /\d/.test(phrase)) {
      rest = rest.replace(new RegExp(escape(phrase), 'gi'), (whole) => ' '.repeat(whole.length));
    }
  }
  const colors = [...rest.matchAll(HEX)].map((match) => match[0].toLowerCase());
  rest = rest.replace(HEX, (whole) => ' '.repeat(whole.length));
  return {
    numbers: findNumbers(rest),
    quotes,
    colors,
    here: /\b(here|now|right now|this point|this moment|where the playhead is|at the playhead)\b/i.test(rest),
  };
}

/** A number in seconds, when it is a time: seconds, frames, or bare (bare is taken as seconds). */
export function secondsOf(literal: NumberLiteral, fps: number): number | null {
  switch (literal.unit) {
    case 's':
    case '':
      return literal.value;
    case 'frames':
      return literal.value / (fps || 30);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The words a text is to say
// ---------------------------------------------------------------------------

/**
 * The words the command gives for a text to say, by code: quoted words, or
 * what follows "says", "saying", "that reads", "reading", "called", "named",
 * "with the words", "to" (in "change the title to …"). Null when the command
 * gives none this way — Jev is then asked at which word they begin.
 */
export function givenWords(text: string, literals: Literals): string | null {
  if (literals.quotes[0]) return literals.quotes[0];
  const said = /\b(?:that says|which says|saying|says|say|that reads|which reads|reads|reading|with the words|with the text|the words|called|named|titled|labelled|labeled)\s+(.+)$/i.exec(text)
    // "rename the badge to Live", "change the headline to eye of the storm"
    ?? /\b(?:rename|renamed|call|change|set)\b[^,]*?\bto\s+(.+)$/i.exec(text);
  if (!said) return null;
  return tidyWords(endOfClause(said[1]!));
}

/**
 * Where the words the person gave stop and the rest of the sentence starts
 * again: "a title that says LIVE NOW across the top, in bold" gives "LIVE
 * NOW". Quoted words are never cut — the quotes already said where they end.
 */
export function endOfClause(words: string): string {
  const cuts = [
    /,/,
    /\s+and then\s/i,
    /\s+and (?:make|set|put|move|turn|give|lock|hide|show|add|switch|centre|center|align)\b/i,
    /\s+(?:switch|lock|hide|show|move|turn) the\b/i,
    /\s+(?:across|at|in|on|over|under|near|beside|inside|down|up) the\b/i,
    /\s+in (?:bold|italics|caps|capitals)\b/i,
  ];
  let end = words.length;
  for (const cut of cuts) {
    const at = cut.exec(words)?.index;
    if (at !== undefined && at > 0) end = Math.min(end, at);
  }
  return words.slice(0, end);
}

/** Spoken words as a text should say them: no trailing full stop, no filler at the end. */
export function tidyWords(words: string): string | null {
  const tidy = words.trim().replace(/[.!?,;:]+$/, '').replace(/\s+(please|thanks|thank you)$/i, '').trim();
  return tidy || null;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export type NamedColor = { hex: string; words: string[] };

/** The colors a command can name, and the words people use for each. Longest names are matched first. */
export const PALETTE: Record<string, NamedColor> = {
  red: { hex: '#ff3b30', words: ['red'] },
  'dark red': { hex: '#8b0000', words: ['dark red', 'maroon', 'burgundy', 'wine'] },
  crimson: { hex: '#dc143c', words: ['crimson', 'scarlet', 'cherry'] },
  coral: { hex: '#ff7f50', words: ['coral', 'salmon'] },
  orange: { hex: '#ff9500', words: ['orange'] },
  'burnt orange': { hex: '#cc5500', words: ['burnt orange', 'rust'] },
  peach: { hex: '#ffcba4', words: ['peach', 'apricot'] },
  gold: { hex: '#ffd700', words: ['gold', 'golden'] },
  yellow: { hex: '#ffcc00', words: ['yellow'] },
  'light yellow': { hex: '#fff59d', words: ['light yellow', 'pale yellow', 'lemon', 'butter'] },
  beige: { hex: '#f5f0e1', words: ['beige', 'cream', 'ivory', 'off white', 'off-white'] },
  lime: { hex: '#a4de02', words: ['lime', 'lime green', 'chartreuse'] },
  green: { hex: '#34c759', words: ['green'] },
  'dark green': { hex: '#0b6623', words: ['dark green', 'forest green', 'forest', 'emerald'] },
  'light green': { hex: '#90ee90', words: ['light green', 'mint', 'mint green', 'pale green'] },
  olive: { hex: '#808000', words: ['olive', 'khaki', 'army green'] },
  teal: { hex: '#30b0c7', words: ['teal', 'turquoise', 'aqua'] },
  cyan: { hex: '#00d4ff', words: ['cyan', 'electric blue'] },
  'light blue': { hex: '#9fd3ff', words: ['light blue', 'sky blue', 'baby blue', 'pale blue'] },
  blue: { hex: '#0a84ff', words: ['blue'] },
  'royal blue': { hex: '#2346d8', words: ['royal blue', 'cobalt'] },
  navy: { hex: '#1c2a6b', words: ['navy', 'navy blue', 'dark blue', 'midnight blue'] },
  indigo: { hex: '#4b0082', words: ['indigo'] },
  purple: { hex: '#af52de', words: ['purple', 'violet'] },
  lavender: { hex: '#c3b1e1', words: ['lavender', 'lilac', 'light purple'] },
  magenta: { hex: '#ff00c8', words: ['magenta', 'fuchsia', 'hot pink'] },
  pink: { hex: '#ff2d55', words: ['pink'] },
  'light pink': { hex: '#ffc0cb', words: ['light pink', 'pale pink', 'baby pink', 'blush', 'rose'] },
  brown: { hex: '#a2845e', words: ['brown'] },
  'dark brown': { hex: '#5c4033', words: ['dark brown', 'chocolate', 'coffee'] },
  tan: { hex: '#d2b48c', words: ['tan', 'sand', 'camel'] },
  white: { hex: '#ffffff', words: ['white'] },
  'light gray': { hex: '#d1d1d6', words: ['light gray', 'light grey', 'silver', 'pale gray', 'pale grey'] },
  gray: { hex: '#8e8e93', words: ['gray', 'grey'] },
  'dark gray': { hex: '#3a3a3c', words: ['dark gray', 'dark grey', 'charcoal', 'graphite', 'slate'] },
  black: { hex: '#000000', words: ['black', 'jet black'] },
  'neon green': { hex: '#39ff14', words: ['neon green', 'neon', 'acid green'] },
  'neon pink': { hex: '#ff10f0', words: ['neon pink'] },
  transparent: { hex: '#00000000', words: ['transparent', 'clear', 'invisible'] },
};

/** Color names the command says, longest first so "light blue" wins over "blue"; each at most once. */
export function colorsSaid(text: string): string[] {
  const lower = ` ${text.toLowerCase().replace(/[^a-z\- ]/g, ' ')} `;
  const found: Array<{ name: string; at: number; length: number }> = [];
  const taken: Array<[number, number]> = [];
  const entries = Object.entries(PALETTE).flatMap(([name, color]) => color.words.map((word) => ({ name, word })));
  entries.sort((a, b) => b.word.length - a.word.length);
  for (const { name, word } of entries) {
    if (name === 'transparent' && word === 'clear') continue;
    let from = 0;
    for (;;) {
      const at = lower.indexOf(` ${word} `, from);
      if (at === -1) break;
      from = at + 1;
      const start = at + 1;
      const end = start + word.length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      taken.push([start, end]);
      found.push({ name, at: start, length: word.length });
    }
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((entry) => entry.name))];
}

function rgbOf(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})/i.exec(hex.trim());
  if (!match) return null;
  let digits = match[1]!;
  if (digits.length === 3) digits = digits.split('').map((digit) => digit + digit).join('');
  return [0, 2, 4].map((index) => parseInt(digits.slice(index, index + 2), 16)) as [number, number, number];
}

const hexOf = ([r, g, b]: readonly number[]): string =>
  `#${[r, g, b].map((channel) => Math.round(Math.min(255, Math.max(0, channel!))).toString(16).padStart(2, '0')).join('')}`;

/** Hue (0–360), saturation and lightness (0–1) of an RGB color. */
function hslOf([r, g, b]: readonly number[]): [number, number, number] {
  const [red, green, blue] = [r! / 255, g! / 255, b! / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const d = max - min;
  const saturation = lightness > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue = max === red ? (green - blue) / d + (green < blue ? 6 : 0) : max === green ? (blue - red) / d + 2 : (red - green) / d + 4;
  hue *= 60;
  return [hue, saturation, lightness];
}

/** The plain name a person would call a color by: "red", "light blue", "dark gray". */
export function colorName(hex: string): string {
  const rgb = rgbOf(hex);
  if (!rgb) return 'colored';
  const [hue, saturation, lightness] = hslOf(rgb);
  if (saturation < 0.12 || lightness > 0.96 || lightness < 0.06) {
    if (lightness > 0.93) return 'white';
    if (lightness > 0.7) return 'light gray';
    if (lightness > 0.38) return 'gray';
    if (lightness > 0.1) return 'dark gray';
    return 'black';
  }
  const pale = lightness > 0.78;
  const deep = lightness < 0.28;
  if (hue >= 335 && lightness > 0.55 && !pale) return 'pink';
  if (hue < 14 || hue >= 335) return pale ? 'light pink' : deep ? 'dark red' : 'red';
  if (hue < 44) return lightness < 0.35 || (lightness < 0.45 && saturation < 0.7) ? 'brown' : pale ? 'peach' : 'orange';
  if (hue < 68) return deep ? 'olive' : pale ? (saturation < 0.5 ? 'beige' : 'light yellow') : 'yellow';
  if (hue < 160) return pale ? 'light green' : deep ? 'dark green' : 'green';
  if (hue < 195) return pale ? 'light blue' : deep ? 'teal' : 'teal';
  if (hue < 250) return pale ? 'light blue' : deep ? 'navy' : 'blue';
  if (hue < 290) return pale ? 'lavender' : 'purple';
  return pale ? 'light pink' : saturation > 0.7 && lightness < 0.6 ? 'magenta' : 'pink';
}

/** A step lighter or darker: toward white or toward black by a fifth. */
export function stepColor(hex: string, lighter: boolean, amount = 0.2): string {
  const rgb = rgbOf(hex);
  if (!rgb) return hex;
  return hexOf(rgb.map((channel) => (lighter ? channel + (255 - channel) * amount : channel * (1 - amount))));
}

// ---------------------------------------------------------------------------
// The frame: sizes and places
// ---------------------------------------------------------------------------

/** How big an element is, by its share of the frame's area. */
export function sizeWord(area: number, frameArea: number): 'tiny' | 'small' | 'medium' | 'large' | 'fills the frame' {
  const share = frameArea > 0 ? area / frameArea : 0;
  if (share >= 0.8) return 'fills the frame';
  if (share >= 0.25) return 'large';
  if (share >= 0.05) return 'medium';
  if (share >= 0.01) return 'small';
  return 'tiny';
}

/** Where a point sits in the frame, on a 3×3 grid; "off screen" outside it. */
export function whereWord(x: number, y: number, width: number, height: number): string {
  if (x < 0 || y < 0 || x > width || y > height) return 'off screen';
  const column = x < width / 3 ? 'left' : x > (2 * width) / 3 ? 'right' : 'centre';
  const row = y < height / 3 ? 'top' : y > (2 * height) / 3 ? 'bottom' : 'middle';
  if (row === 'middle' && column === 'centre') return 'in the centre';
  if (row === 'middle') return `middle ${column}`;
  if (column === 'centre') return `${row} centre`;
  return `${row} ${column}`;
}

/** The sizes a new element can be asked for, as a share of the frame's shorter side. */
export const SIZE_BUCKETS = { tiny: 0.08, small: 0.18, medium: 0.3, large: 0.5, huge: 0.8, 'fills the frame': 1 } as const;

/** 1st, 2nd, 3rd… */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "0:03", or "0:03.5" with a fraction. */
export function timecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const whole = Math.floor(safe);
  const tenths = Math.round((safe - whole) * 10);
  const base = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  return tenths && tenths < 10 ? `${base}.${tenths}` : base;
}

/** Seconds as a person says them: "9 s", "1.5 s". */
export const secondsText = (seconds: number): string => `${Math.round(seconds * 100) / 100} s`;

// ---------------------------------------------------------------------------
// One sentence, two commands
// ---------------------------------------------------------------------------

/** Verbs a command starts with: what tells "and stop it at ten" from "the title and the subtitle". */
const STARTS_A_COMMAND = new RegExp(
  '^(?:can you |could you |please |also |now |i want |i need |let |make |have )?'
  + '(?:make|set|put|place|move|shift|add|give|turn|rotate|tilt|hide|show|unhide|lock|unlock|delete|remove|rename|call|name'
  + '|split|cut|chop|trim|shave|start|stop|end|play|pause|resume|freeze|go|jump|hop|race|wind|skip|back|zoom|fit|select|deselect'
  + '|export|render|save|open|close|undo|redo|repeat|keep|spread|line|stick|shove|chuck|blow|round|soften|harden|duck|fade|slide'
  + '|drop|bump|push|pull|bring|send|copy|paste|space|align|centre|center|scale|shrink|grow|enlarge|break|group|ungroup|wrap|unwrap'
  + '|swap|replace|fill|crop|caption|transcribe|mute|unmute|loop|bake|keyframe|key|stagger|slip|slide|duplicate|clone|reveal|switch'
  + '|write|read|generate|create|draw|import|upload|pick|choose|use|leave|let|take|tuck|sit|lay|lift|roll|chain|clear|mark|dim|brighten)\\b',
  'i',
);

/**
 * A sentence cut into the commands it holds.
 *
 * "Trim the start to two seconds and stop it at ten" is two commands, and
 * reading it as one loses the second — so it is cut on the words that join two
 * of them, but only where what follows starts a command of its own: "the title
 * and the subtitle" is one list, not two commands.
 */
export function piecesOf(command: string): string[] {
  const parts: string[] = [];
  let rest = command.trim();
  const joins = /(?:,\s*(?:and\s+)?then\s+|\s+and\s+then\s+|\s*;\s*|,\s*and\s+|\s+and\s+also\s+|\s+after that,?\s+|\s+and\s+|,\s+)/i;
  for (let cuts = 0; cuts < 2; cuts += 1) {
    const match = joins.exec(rest);
    if (!match || match.index < 6) break;
    const after = rest.slice(match.index + match[0].length).trim();
    const before = rest.slice(0, match.index).trim();
    if (!STARTS_A_COMMAND.test(after) || after.split(/\s+/).length < 2 || before.split(/\s+/).length < 2) {
      // Not a second command: look past this join for another.
      const next = joins.exec(rest.slice(match.index + match[0].length));
      if (!next) break;
      const at = match.index + match[0].length + next.index;
      const tail = rest.slice(at + next[0].length).trim();
      if (!STARTS_A_COMMAND.test(tail) || tail.split(/\s+/).length < 2) break;
      parts.push(rest.slice(0, at).trim());
      rest = tail;
      continue;
    }
    parts.push(before);
    rest = after;
  }
  parts.push(rest);
  return parts.filter(Boolean);
}
