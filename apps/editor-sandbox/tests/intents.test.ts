/**
 * The catalog, and the reading it drives.
 *
 * Two promises are kept here. The first is coverage: every element, prop and
 * command of the editor is either something a person can say or something
 * written down in `not-voiceable.ts` with a reason — nothing is silently
 * unsayable. The second is the reading itself: given the answers Jev would
 * give, the right intent comes out with the right slots, and a command that
 * asks for a time gets the time rather than the playhead.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { FAMILIES, INTENTS, exactIntent } from '../src/context/agent-api/intents/catalog';
import { NOT_VOICEABLE } from '../src/context/agent-api/intents/not-voiceable';
import {
  AREAS_REQUEST, THRESHOLDS, areaQuestions, areasChosen, familyQuestions, familyState, keyOf, literalsOf, readPlan,
} from '../src/context/agent-api/intents/read';
import { FAMILY_BY_ID } from '../src/context/agent-api/intents/catalog';
import { colorName, colorsSaid, findLiterals, findNumbers, givenWords } from '../src/context/agent-api/intents/words';

import type { Answer, Answers, Family, Reading, Situation } from '../src/context/agent-api/intents/types';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../..');

const FIXTURE: Situation = JSON.parse(readFileSync(join(repo, 'scripts/intent-corpus/fixture.json'), 'utf8'));

const situationOf = (command: string): Situation => ({ ...FIXTURE, command });

const choice = (value: string, confidence = 1): Answer => ({ type: 'choice', choice: value, confidence, probabilities: { [value]: confidence } });
const noul = (p: number): Answer => ({ type: 'noul', noul: p });

/** The answers Jev would give, as the resolver keys them. */
function answersFor(areas: Record<string, number>, rest: Record<string, Answer>): Answers {
  const answers: Answers = {};
  for (const [family, p] of Object.entries(areas)) answers[keyOf(AREAS_REQUEST, family)] = noul(p);
  for (const [key, answer] of Object.entries(rest)) answers[key] = answer;
  return answers;
}

const read = (command: string, areas: Record<string, number>, rest: Record<string, Answer>): Reading =>
  readPlan({
    situation: situationOf(command),
    commands: [],
    answers: answersFor(areas, rest),
    families: Object.keys(areas).filter((family) => (areas[family] ?? 0) >= THRESHOLDS.area) as Family[],
  });

// ---------------------------------------------------------------------------
// Coverage: nothing the editor can do is quietly unsayable
// ---------------------------------------------------------------------------

const vocabulary = JSON.parse(readFileSync(join(repo, 'packages/posterract-composition/vocabulary.json'), 'utf8')) as {
  tags: Record<string, unknown>;
  props: Record<string, unknown>;
};

const covered = new Set<string>();
for (const intent of INTENTS) {
  for (const name of [...(intent.covers ?? []), ...(intent.command ? [intent.command] : [])]) covered.add(name);
}
const coveredOrSuffixed = (name: string): boolean => covered.has(name) || [...covered].some((entry) => entry.endsWith(`.${name}`));

test('every element the editor can author is sayable, or written down as not', () => {
  const missing = Object.keys(vocabulary.tags).filter((tag) => !coveredOrSuffixed(tag) && !NOT_VOICEABLE.has(tag));
  assert.deepEqual(missing, [], `no intent and no reason for: ${missing.join(', ')}`);
});

test('every prop the editor can write is sayable, or written down as not', () => {
  const missing = Object.keys(vocabulary.props).filter((prop) => !coveredOrSuffixed(prop) && !NOT_VOICEABLE.has(prop));
  assert.deepEqual(missing, [], `no intent and no reason for: ${missing.join(', ')}`);
});

test("every command of the editor's own tables is an intent", () => {
  const sources = [
    'apps/editor-sandbox/src/engine/input/shortcuts.ts',
    'apps/editor-sandbox/src/components/shell/voice-bar.tsx',
    'apps/editor-sandbox/src/components/shell/command-bar.tsx',
    'apps/editor-sandbox/src/components/posterract-code-panel.tsx',
  ].map((path) => readFileSync(join(repo, path), 'utf8')).join('\n');
  const commands = [...new Set([...sources.matchAll(/\bid:\s*['"]([a-z]+\.[a-z-]+)['"]/g)].map((match) => match[1]!))]
    .filter((id) => !id.startsWith('voice.'));
  const missing = commands.filter((id) => !covered.has(id));
  assert.deepEqual(missing, [], `commands with no intent: ${missing.join(', ')}`);
});

test('every intent has something to carry it out', () => {
  const runs = ['arrange', 'captions', 'create', 'generate', 'motion', 'project', 'sound', 'style', 'time', 'view']
    .map((family) => {
      const base = join(repo, `apps/editor-sandbox/src/context/agent-api/intents/runs/${family}`);
      return readFileSync(existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`, 'utf8');
    })
    .join('\n')
    + readFileSync(join(repo, 'apps/editor-sandbox/src/context/agent-api/intents/runs/index.ts'), 'utf8');
  const missing = INTENTS.filter((intent) => !intent.command && !runs.includes(`'${intent.id}'`)).map((intent) => intent.id);
  assert.deepEqual(missing, [], `intents with no run: ${missing.join(', ')}`);
});

test('every intent is described with what it is, what it is not, and how people say it', () => {
  for (const intent of INTENTS) {
    assert.ok(intent.text.what.length > 20, `${intent.id}: too short a description`);
    assert.ok(intent.text.examples.length >= 2, `${intent.id}: fewer than two examples`);
    assert.ok(intent.label.length > 0 && intent.label.length < 30, `${intent.id}: label`);
  }
});

test('every slot an intent names is one its area asks about', () => {
  for (const family of FAMILIES) {
    for (const intent of family.intents) {
      for (const slot of intent.uses ?? []) {
        assert.ok(family.slots[slot], `${intent.id} uses "${slot}", which ${family.id} does not ask about`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// What code finds in a command
// ---------------------------------------------------------------------------

test('numbers as they are actually said', () => {
  assert.deepEqual(findNumbers('split at nine seconds').map((n) => [n.value, n.unit]), [[9, 's']]);
  assert.deepEqual(findNumbers('go to 1:30').map((n) => [n.value, n.unit]), [[90, 's']]);
  assert.deepEqual(findNumbers('move it half a second later').map((n) => [n.value, n.unit]), [[0.5, 's']]);
  assert.deepEqual(findNumbers('make it twice as fast').map((n) => [n.value, n.unit]), [[2, 'x']]);
  assert.deepEqual(findNumbers('ten frames earlier').map((n) => [n.value, n.unit]), [[10, 'frames']]);
  // What a speech model writes for "two seconds".
  assert.deepEqual(findNumbers('trim it to seconds').map((n) => [n.value, n.unit]), [[2, 's']]);
  // Words that only look like numbers.
  assert.deepEqual(findNumbers('make this one red'), []);
  assert.deepEqual(findNumbers('add a frame'), []);
});

test('colors by the words people use for them', () => {
  assert.deepEqual(colorsSaid('make the red circle light blue'), ['red', 'light blue']);
  assert.equal(colorName('#ff0000'), 'red');
  assert.equal(colorName('#E0E0E0'), 'light gray');
  assert.equal(colorName('#0a84ff'), 'blue');
});

test('the words a command gives for a text', () => {
  const command = 'add a title that says Summer Sale';
  assert.equal(givenWords(command, findLiterals(command)), 'Summer Sale');
  const quoted = 'change the title to "Calm seas"';
  assert.equal(givenWords(quoted, findLiterals(quoted)), 'Calm seas');
});

// ---------------------------------------------------------------------------
// The questions
// ---------------------------------------------------------------------------

test('the first step asks about every area, plus writing and nonsense', () => {
  const questions = areaQuestions();
  for (const family of FAMILIES) assert.ok(questions[family.id], `no question for ${family.id}`);
  assert.ok(questions.needs_writing);
  assert.ok(questions.nonsense);
});

test('an area asks about its own intents and nothing else', () => {
  const situation = situationOf('put the logo in the top right');
  const arrange = FAMILY_BY_ID.get('arrange')!;
  const questions = familyQuestions(arrange, situation, literalsOf(situation));
  assert.ok(questions['do_place'], 'the area that combines asks yes/no per intent');
  assert.ok(questions.target, 'it asks which element');
  assert.ok(questions.spot, 'it asks where in the frame');
  assert.equal(questions.intent, undefined, 'an area that combines has no single choice');

  const create = FAMILY_BY_ID.get('create')!;
  const adding = familyQuestions(create, situationOf('add a circle'), literalsOf(situationOf('add a circle')));
  assert.ok(adding.intent, 'an area that excludes asks one choice');
  assert.ok(adding.shape_kind);
});

test('the scene is put to Jev in words, not numbers', () => {
  const state = familyState(FAMILY_BY_ID.get('arrange')!, situationOf('move the logo left')) as { elements: string[] };
  const logo = state.elements.find((line) => line.startsWith('#logo'))!;
  assert.match(logo, /picture/);
  assert.match(logo, /top right/);
  assert.match(logo, /small|tiny|medium/);
});

test('a number in the command is put to Jev as a question about which setting it is', () => {
  const situation = situationOf('split at nine seconds');
  const questions = familyQuestions(FAMILY_BY_ID.get('time')!, situation, literalsOf(situation));
  assert.ok(questions.number_1, 'it asks which setting the number belongs to');
  assert.match((questions.number_1 as { instructions: string }).instructions, /nine seconds/);
});

// ---------------------------------------------------------------------------
// What the answers come to
// ---------------------------------------------------------------------------

test('"split at nine seconds" splits at nine seconds, not at the playhead', () => {
  const reading = read('split at nine seconds', { time: 0.97 }, {
    'time:intent': choice('time.split'),
    'time:number_1': choice('when'),
    'time:target': choice('none'),
  });
  assert.equal(reading.lane, 'apply');
  assert.equal(reading.steps.length, 1);
  assert.equal(reading.steps[0]!.intent, 'time.split');
  assert.equal((reading.steps[0]!.slots.when as { kind: string; seconds: number }).kind, 'time');
  assert.equal((reading.steps[0]!.slots.when as { seconds: number }).seconds, 9);
});

test('"add a circle" adds a circle, with the tool\'s own defaults and no timing', () => {
  const reading = read('add a circle', { create: 0.98 }, {
    'create:intent': choice('create.shape'),
    'create:shape_kind': choice('circle'),
    'create:spot': choice('unstated'),
    'create:size': choice('unstated'),
    'create:color': choice('unstated'),
    'create:when': choice('playhead'),
  });
  assert.equal(reading.steps[0]!.intent, 'create.shape');
  assert.deepEqual(reading.steps[0]!.slots.shape_kind, { kind: 'choice', value: 'circle' });
  assert.equal(reading.steps[0]!.slots.when, undefined, 'nothing was said about when, so it follows the tool');
});

test('a command that says "here" does set the time', () => {
  const reading = read('add a circle here', { create: 0.98 }, {
    'create:intent': choice('create.shape'),
    'create:shape_kind': choice('circle'),
    'create:when': choice('playhead'),
  });
  assert.equal((reading.steps[0]!.slots.when as { seconds: number }).seconds, FIXTURE.playhead);
});

test('"make the title red" comes to one prop on one element', () => {
  const reading = read('make the title red', { style: 0.95 }, {
    'style:do_color': noul(0.96),
    'style:color': choice('red'),
    'style:target': choice('title'),
    'style:target_all': noul(0.02),
  });
  assert.equal(reading.steps[0]!.intent, 'style.color');
  assert.deepEqual(reading.steps[0]!.edits, [{ op: 'set', id: 'title', properties: { color: '#ff3b30' } }]);
});

test('two areas in one sentence come to two steps, the new element second', () => {
  const reading = read('add a circle and make it red', { create: 0.95, style: 0.9 }, {
    'create:intent': choice('create.shape'),
    'create:shape_kind': choice('circle'),
    'style:do_color': noul(0.93),
    'style:color': choice('red'),
    'style:target': choice('new'),
  });
  assert.deepEqual(reading.steps.map((step) => step.intent), ['create.shape', 'style.color']);
  assert.equal(reading.steps[1]!.targetHow, 'new');
});

test('an unsure reading offers numbered choices rather than guessing', () => {
  const reading = read('make that one bigger', { arrange: 0.55 }, {
    'arrange:do_size': noul(0.6),
    'arrange:size_dir': choice('bigger', 0.4),
    'arrange:target': { type: 'choice', choice: 'title', confidence: 0.35, probabilities: { title: 0.35, subtitle: 0.33, cta: 0.3 } },
  });
  assert.equal(reading.lane, 'choose');
  assert.ok(reading.choices.length >= 2);
});

test('a delete always asks first, however sure the reading', () => {
  const reading = read('delete the live badge', { arrange: 0.99 }, {
    'arrange:do_delete': noul(0.99),
    'arrange:target': choice('badge'),
  });
  assert.equal(reading.lane, 'confirm');
  assert.equal(reading.destructive, true);
});

test('words to be written are a note for the agent', () => {
  const reading = readPlan({
    situation: situationOf('write me a punchier headline'),
    commands: [],
    answers: answersFor({}, { [keyOf(AREAS_REQUEST, 'needs_writing')]: noul(0.95) }),
    families: [],
  });
  assert.equal(reading.lane, 'note');
  assert.match(reading.message ?? '', /@agent/);
});

test('a sentence that is not a command at all does nothing', () => {
  const reading = readPlan({
    situation: situationOf("what's the weather like in Paris"),
    commands: [],
    answers: answersFor({}, { [keyOf(AREAS_REQUEST, 'nonsense')]: noul(0.97) }),
    families: [],
  });
  assert.equal(reading.lane, 'nothing');
});

test('the areas to read are the ones above the line, most likely first', () => {
  const answers = answersFor({ create: 0.9, style: 0.7, time: 0.1 }, {});
  assert.deepEqual(areasChosen(answers), ['create', 'style']);
});

// ---------------------------------------------------------------------------
// The toggles a person never means to flip
// ---------------------------------------------------------------------------

test('"hide" hides, and "show" shows', () => {
  assert.equal(exactIntent('hide')?.intent, 'arrange.visibility');
  assert.deepEqual(exactIntent('hide')?.slots.hide, { kind: 'onoff', on: true });
  assert.deepEqual(exactIntent('show')?.slots.hide, { kind: 'onoff', on: false });
  assert.equal(exactIntent('pause')?.intent, 'time.pause');
  assert.equal(exactIntent('play')?.intent, 'time.play');
  assert.equal(exactIntent('turn snapping off')?.intent, 'view.snapping');
  assert.deepEqual(exactIntent('turn snapping off')?.slots.snapping, { kind: 'onoff', on: false });
  assert.equal(exactIntent('what can you do')?.intent, 'view.help');
  assert.equal(exactIntent('make the title red'), null);
});

// ---------------------------------------------------------------------------
// The test sentences are never the ones Jev is shown
// ---------------------------------------------------------------------------

test('no test sentence is an example from the catalog', { skip: !existsSync(join(repo, 'scripts/intent-corpus/sentences.json')) }, () => {
  const corpus = JSON.parse(readFileSync(join(repo, 'scripts/intent-corpus/sentences.json'), 'utf8')) as { sentences: Array<{ say: string }> };
  const examples = new Set(INTENTS.flatMap((intent) => intent.text.examples.map((example) => example.toLowerCase().trim())));
  const shown = corpus.sentences.filter((sentence) => examples.has(sentence.say.toLowerCase().trim())).map((sentence) => sentence.say);
  assert.deepEqual(shown, [], `test sentences Jev is shown as examples: ${shown.join(' · ')}`);
});
