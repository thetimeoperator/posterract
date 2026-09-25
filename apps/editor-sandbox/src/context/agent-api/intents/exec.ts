/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Carrying a reading out.
 *
 * Everything a sentence asks for lands as one undo step, in the order the
 * editor needs it: what moves the playhead first, then what is made, then what
 * is changed. What the first part makes is what "it" means to the second ("add
 * a circle and make it red"), and what the whole sentence made or changed is
 * selected at the end, so the next command can say "it" too.
 *
 * Nothing reports success unless something changed: a run says what it did, or
 * why it could not, and the bar shows whichever is true.
 */

import { getDocumentEditor } from '@/engine/editor';
import { getEditHistory } from '@/engine/history';
import { addMarkerAtPlayhead } from '@/engine/markers';
import { applyCompiled } from './runs/apply';

import { resolveNode } from '../nodes';
import { requireEditorSession } from '../session';
import { INTENT_BY_ID } from './catalog';
import { RUNS } from './runs';
import { rememberLastMade, situationOf } from './resolve';
import { compileStep } from './compile';
import { timecode } from './words';

import type { Outcome, Reading, Step } from './types';
import type { RunContext, VoiceUi } from './runs/types';

export { applyCompiled };

/** Intents that take their own time or open something of their own: they run outside the one undo step. */
const SLOW = new Set([
  'generate.image', 'generate.video', 'generate.voice', 'captions.add', 'captions.export',
  'project.export', 'project.export-frame', 'project.import', 'project.restore',
  'project.asset-delete', 'project.asset-rename', 'project.exports-library', 'project.export-settings',
  'project.history', 'project.agent', 'project.generate-panel', 'view.help',
]);

/** Elements a step acts on, as entities — `new` means whatever this same sentence has made. */
function targetsOf(step: Step, made: string[]): string[] {
  if (step.targetHow === 'new') return made;
  return step.targets;
}

async function runStep(ctx: RunContext, step: Step): Promise<Outcome> {
  const run = RUNS[step.intent];
  if (!run) {
    const intent = INTENT_BY_ID.get(step.intent);
    return { changed: false, receipt: '', why: `${intent?.label ?? step.intent} is not wired up yet`, fix: 'Say it another way, or do it in the panel.' };
  }
  return run(ctx, step);
}

/**
 * A step against the canvas as it is now: what an earlier part of the same
 * sentence made is what "it" means, and a relative change ("bigger") is
 * measured from what the element is at this moment.
 */
function fresh(reading: Reading, step: Step, made: string[]): Step {
  const targets = targetsOf(step, made);
  if (targets === step.targets && !made.length) return step;
  const situation = situationOf(reading.basis.situation.command);
  const resolved: Step = { ...step, targets, edits: undefined, removals: undefined, subs: undefined };
  const compiled = compileStep(resolved, situation);
  return compiled ? { ...resolved, ...compiled } : resolved;
}

/** What the bar says after a sentence ran, and what it left selected. */
export type Ran = { receipt: string; made: string[]; changed: boolean };

/**
 * Runs a reading as one undo step. Throws what the person has to know when
 * nothing could be done at all; otherwise the receipt says what happened, and
 * what did not.
 */
export async function runReading(reading: Reading, ui: VoiceUi): Promise<Ran> {
  const session = requireEditorSession();
  const { world } = session;
  const history = getEditHistory(world);
  const editor = getDocumentEditor(world);

  const made: string[] = [];
  const outcomes: Outcome[] = [];
  const quick = reading.steps.filter((step) => !SLOW.has(step.intent));
  const slow = reading.steps.filter((step) => SLOW.has(step.intent));

  const ctx: RunContext = {
    world,
    session: () => session,
    ui,
    situation: reading.basis.situation,
    made,
    dir: () => session.project.dir(),
  };

  if (quick.length) {
    let failure: Error | null = null;
    const before = history.recordedSoFar();
    history.beginGesture();
    try {
      for (const step of quick) {
        const resolved = fresh(reading, step, made);
        const recorded = history.recordedSoFar();
        let outcome: Outcome;
        try {
          outcome = await runStep(ctx, resolved);
        } catch (error) {
          outcome = { changed: false, receipt: '', why: (error as Error).message };
        }
        // Honest outcomes: a run that says it changed something, and recorded
        // nothing, changed nothing.
        if (outcome.changed && history.recordedSoFar() === recorded && !VIEW_ONLY.has(step.intent)) {
          outcome = {
            ...outcome,
            changed: false,
            why: outcome.ifNothing?.why ?? outcome.why ?? 'nothing changed — it may be locked, or already like that',
            ...(outcome.ifNothing?.fix ? { fix: outcome.ifNothing.fix } : {}),
          };
        }
        outcomes.push(outcome);
        if (outcome.made?.length) made.push(...outcome.made);
      }
    } catch (error) {
      failure = error as Error;
    } finally {
      const changed = history.endGesture();
      if (failure && changed) history.undo();
      void before;
    }
    if (failure) throw failure;
  }

  for (const step of slow) {
    const resolved = fresh(reading, step, made);
    try {
      const outcome = await runStep(ctx, resolved);
      outcomes.push(outcome);
      if (outcome.made?.length) made.push(...outcome.made);
    } catch (error) {
      outcomes.push({ changed: false, receipt: '', why: (error as Error).message });
    }
  }

  // "It" is what just happened: the bar selects what the sentence made or changed.
  const changedIds = [...new Set([...made, ...reading.steps.flatMap((step) => targetsOf(step, made))])];
  if (made.length) {
    const entities = made.map((id) => {
      try {
        return resolveNode(world, id);
      } catch {
        return null;
      }
    }).filter((entity): entity is NonNullable<typeof entity> => entity !== null);
    if (entities.length) editor.select(entities);
  }
  rememberLastMade(changedIds);

  const did = outcomes.filter((outcome) => outcome.changed);
  const didNot = outcomes.filter((outcome) => !outcome.changed);
  if (!did.length) {
    const first = didNot[0];
    throw new Error(first?.why ? upper(`${first.why}.${first.fix ? ` ${first.fix}` : ''}`) : 'Nothing changed.');
  }
  const receipt = [
    did.map((outcome) => outcome.receipt).filter(Boolean).join(' · '),
    ...didNot.slice(0, 1).map((outcome) => (outcome.why ? `(not ${outcome.why})` : '')),
  ].filter(Boolean).join(' ');
  return { receipt: `${receipt} · ⌘Z`, made, changed: true };
}

/** Intents that change what the editor shows rather than the video: nothing is recorded, and that is right. */
const VIEW_ONLY = new Set([
  'view.zoom', 'view.select', 'view.scene', 'view.reveal', 'view.panel', 'view.workspace', 'view.inspector-tab',
  'view.timeline-zoom', 'view.timeline-detail', 'view.theme', 'view.tool', 'view.snapping', 'view.help',
  'time.go-to', 'time.skip', 'time.cut-jump', 'time.play', 'time.pause', 'time.play-backwards', 'time.fast-forward',
  'project.undo', 'project.redo', 'arrange.copy', 'captions.unpack',
]);

const upper = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A reading, carried out: a note goes on the timeline for the connected
 * agent; anything else runs as one undo step. Returns what the bar says.
 */
export async function applyIntentReading(reading: Reading, ui: VoiceUi): Promise<string> {
  if (reading.lane === 'note') {
    const session = requireEditorSession();
    const history = getEditHistory(session.world);
    history.beginGesture();
    let at: number | null = null;
    try {
      at = addMarkerAtPlayhead(session.world, reading.message ?? `@agent ${reading.basis.situation.command}`);
    } finally {
      history.endGesture();
    }
    if (at === null) throw new Error('Open a video first.');
    return `Left a note for your agent at ${timecode(at)}.`;
  }
  if (!reading.steps.length) throw new Error(reading.message ?? "I couldn't tell what to do.");
  const ran = await runReading(reading, ui);
  return ran.receipt;
}
