/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The catalog of what the voice bar can do, as Jev is shown it.
 *
 * Jev cannot work anything out: it picks from what it is shown. So every
 * capability of the editor is an entry Jev can pick (an intent), every
 * parameter something pickable (a slot), and every slot has a default so the
 * short command works ("add a circle"). Numbers and words the person says are
 * copied from the command by code; Jev only says which slot they belong to.
 *
 * The catalog is plain data (catalog/*.ts), read alike in the app, the unit
 * tests and the corpus runner. What carries an intent out lives with the
 * editor (runs/*.ts).
 */

import type { CanvasEdit } from '@posterract/cli/channels';

export type Family = 'create' | 'time' | 'arrange' | 'style' | 'motion' | 'sound' | 'captions' | 'view' | 'project' | 'generate';

/** How an option is described to Jev: what it is, what it is not, and how people say it. */
export type OptionText = { what: string; notFor?: string; examples: string[] };

export type Unit = 'px' | '%' | 's' | 'frames' | 'deg' | 'x' | 'db' | 'count';

/**
 * One question an area asks about a command, shared by every intent of the
 * area that names it: "which color?" is asked once for the area, however many
 * of its intents take a color.
 */
export type SlotSpec =
  /** A choice over the slot's own options. `unstated` is added: the command does not say. */
  | { kind: 'choice'; ask: string; options: Record<string, OptionText | string>; noUnstated?: boolean }
  /** A yes/no about which way ("hide" rather than "show"): `yes` is the first word. */
  | { kind: 'onoff'; ask: string; yes: string; no: string }
  /** A number the command says, found by code; the `number_*` questions say which slot it is. */
  | { kind: 'number'; text: string; units: Unit[] }
  /** Words the command gives (quoted, or after "says", "called"…), copied by code. */
  | { kind: 'words'; text: string }
  /** How much: a little, noticeably, a lot. */
  | { kind: 'amount'; ask: string }
  /** A named color, lighter/darker, or the color of another element. */
  | { kind: 'color'; ask: string }
  /** A moment: the playhead, the start or end, a marker, when another element starts or ends. */
  | { kind: 'when'; ask: string }
  /** A file in the project's library. */
  | { kind: 'asset'; ask: string; types?: AssetType[] }
  /** A second element, besides the target: "under the title", "into the intro scene". */
  | { kind: 'element'; ask: string; containers?: boolean }
  /** A marker of the scene. */
  | { kind: 'marker'; ask: string }
  /** A scene of the project. */
  | { kind: 'scene'; ask: string }
  /** A variable of the project (`@inspect`). */
  | { kind: 'variable'; ask: string };

export type AssetType = 'image' | 'video' | 'audio' | 'transcript' | 'lottie' | 'sequence';

export type IntentDef = {
  /** `family.what`, e.g. `time.split`. */
  id: string;
  /** A short name for chips and receipts: "Split", "Add a shape". */
  label: string;
  text: OptionText;
  /** The family's slots it reads. */
  uses?: string[];
  /**
   * The slots without which it means nothing: an intent nobody filled a value
   * for is not what the command asked for ("make it red" with no color said).
   * At least one of these must be filled.
   */
  needs?: string[];
  /** Intents that say the same thing as this one: only the surest of them runs. */
  excludes?: string[];
  /**
   * What it acts on: `one`/`many` need elements (the selection when none is
   * named), `optional` works with or without, `none` is about the video or
   * the editor.
   */
  target: 'one' | 'many' | 'optional' | 'none';
  /** Only elements of these tags can be its target (the rest are left out of the reading). */
  tags?: string[];
  /** `confirm`: deletes, anything that spends the person's money, restores. Always asks first. */
  risk?: 'safe' | 'confirm';
  /** The editor's own command it runs, when it is one (the keyboard's table or the UI's). */
  command?: string;
  /** The editor functions and props it carries out, for the coverage test. */
  covers?: string[];
};

export type FamilyDef = {
  id: Family;
  /** A short name for the area: "Timeline", "Style". */
  label: string;
  /** The first step's yes/no question: does the command ask for something in this area? */
  ask: string;
  /**
   * Intents that exclude each other (which thing to add) are one choice; in a
   * family that combines, each intent is asked yes/no ("make it red and bold").
   */
  exclusive: boolean;
  slots: Record<string, SlotSpec>;
  intents: IntentDef[];
};

// ---------------------------------------------------------------------------
// What the editor looks like to the reader
// ---------------------------------------------------------------------------

export type Box = { x: number; y: number; width: number; height: number };

export type SceneElement = {
  /** How an edit addresses it: its id, or its source stamp. */
  id: string;
  /** The authored tag: text, rect, ellipse, polygon, image, video, audio, group, sequence, captions, scene… */
  tag: string;
  /** For rect/ellipse/polygon: which shape it is drawn as. */
  shape?: string;
  /** Its name in the layers list. */
  name?: string;
  /** What a text says. */
  text?: string;
  /** The file a picture, clip or sound plays. */
  media?: string;
  /** Scene seconds. */
  start: number;
  end: number;
  /** Whether the playhead is over it. */
  shown: boolean;
  place?: string;
  /** Its box in the scene's own pixels, drawn. */
  box?: Box;
  /** Its fill or text color, as #hex. */
  color?: string;
  /** Paint order among everything in the scene: 0 is drawn first (at the back). */
  order: number;
  /** The group, sequence or scene it sits in, when that is not the active scene. */
  parent?: string;
  /** Whether its parent plays its children one after another (a sequence): a transition can go between them. */
  inSequence?: boolean;
  /** The numbers a relative change starts from, as they are now. */
  props: Partial<Record<'x' | 'y' | 'width' | 'height' | 'scale' | 'fontSize' | 'rotation' | 'opacity' | 'volume' | 'playbackRate' | 'cornerRadius' | 'letterSpacing' | 'leading', number>>;
  animations: Array<{ id: string; type: string; phase: 'in' | 'out'; duration?: number }>;
  effects?: Array<{ id: string; type: string }>;
  strokes?: Array<{ id: string; color?: string; width?: number }>;
  shadows?: Array<{ id: string }>;
  /** Properties with a keyframe track, by the track's address. */
  tracks?: Array<{ id: string; property: string; loop?: string }>;
  transition?: string;
  /** Which caption style a captions element is playing. */
  preset?: string;
  hidden?: boolean;
  muted?: boolean;
  locked?: boolean;
};

export type SceneAsset = { path: string; name: string; type: AssetType; duration?: number; width?: number; height?: number };

export type Situation = {
  command: string;
  scene: { id: string | null; name?: string; width: number; height: number; duration: number; fps: number } | null;
  /** Scene seconds. */
  playhead: number;
  selected: string[];
  elements: SceneElement[];
  /** Font families that can be drawn now. */
  fonts: string[];
  markers: Array<{ id: string; name?: string; time: number }>;
  assets: SceneAsset[];
  scenes: Array<{ id: string; name?: string; width: number; height: number; active: boolean }>;
  variables: Array<{ key: string; name: string; type: string; value?: string | number | boolean; options?: string[] }>;
  /** What the editor shows, for the intents that set it to a value rather than toggle it. */
  view?: {
    playing?: boolean;
    snapping?: boolean;
    workspace?: string;
    theme?: string;
    panels?: Partial<Record<'assets' | 'inspector' | 'timeline' | 'mixer', boolean>>;
    ui?: boolean;
  };
  /** The voices a generated line can be spoken in. */
  voices?: Array<{ id: string; label: string }>;
  /** The skills a scene can be made with. */
  skills?: Array<{ name: string; what: string }>;
  range?: { start: number; end: number } | null;
  canUndo?: boolean;
  canRedo?: boolean;
  /** The ids the last command made or changed ("it"). */
  last?: string[];
};

// ---------------------------------------------------------------------------
// What a reading comes to
// ---------------------------------------------------------------------------

export type SlotValue =
  | { kind: 'elements'; ids: string[]; how: 'named' | 'selection' | 'new' | 'all' }
  | { kind: 'choice'; value: string }
  | { kind: 'onoff'; on: boolean }
  | { kind: 'number'; value: number; unit: Unit | '' }
  | { kind: 'amount'; step: 0 | 1 | 2 }
  | { kind: 'words'; value: string }
  | { kind: 'time'; seconds: number; word: string }
  | { kind: 'color'; hex: string; word: string }
  | { kind: 'color-step'; lighter: boolean }
  | { kind: 'color-of'; id: string }
  | { kind: 'asset'; path: string; name: string; type: AssetType }
  | { kind: 'element'; id: string }
  | { kind: 'marker'; id: string; name?: string; time: number }
  | { kind: 'scene'; id: string }
  | { kind: 'variable'; key: string };

/** One intent the command asks for, with its slots filled. */
export type Step = {
  intent: string;
  family: Family;
  label: string;
  /** Its targets (empty for an intent about the video or the editor). */
  targets: string[];
  /** How the targets were read: named, the selection, what this command adds, or none said. */
  targetHow: 'named' | 'selection' | 'new' | 'all' | 'none';
  slots: Record<string, SlotValue>;
  /** The least sure answer it rests on. */
  confidence: number;
  risk: 'safe' | 'confirm';
  /** The prop edits it comes to, worked out from the situation, for intents that are prop edits. */
  edits?: CanvasEdit[];
  /** Children taken off (animations, filters, outlines…), addressed like elements. */
  removals?: string[];
  /** Props set on children that are no elements (an animation's duration), by their address. */
  subs?: Array<{ id: string; props: Record<string, unknown> }>;
};

export type Lane = 'apply' | 'confirm' | 'choose' | 'note' | 'nothing';

export type ChipAlternative = { value: string; text: string; p: number | null };
/** One part of a reading, shown above the bar; picking an alternative replaces one answer. */
export type Chip = { key: string; text: string; sure: boolean; alternatives: ChipAlternative[] };
/** A numbered option of a reading too unsure to guess. */
export type Choice = { key: string; value: string; text: string; p: number; elementId?: string };
/** Where the element will land, drawn as a dashed outline before it is applied. */
export type Ghost = { id: string; place?: string; dx?: number; dy?: number; scale?: number };

/** One answer, as the decisions API gives it. */
export type Answer = {
  type?: string;
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  noul?: number;
  score?: number | string;
  legend?: Record<string, string>;
};
export type Answers = Record<string, Answer | undefined>;

export type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string | OptionText> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string };
export type Questions = Record<string, Question>;

/** An editor command as the reader sees it (the keyboard's table and the UI's registered commands). */
export type CommandInfo = { id: string; label: string; when?: 'selection' | 'scene'; group?: string };

/** What the answers were read from, kept so a chip or a choice can change one answer and read again. */
export type Basis = {
  situation: Situation;
  commands: CommandInfo[];
  /** Every answer, keyed `<request>:<question>` — `areas:create`, `time:intent`, `members:is_3`. */
  answers: Answers;
  /** The areas the second step read. */
  families: Family[];
};

export type Reading = {
  lane: Lane;
  steps: Step[];
  /** The least sure answer anything rests on. */
  confidence: number;
  chips: Chip[];
  choices: Choice[];
  ghost: Ghost | null;
  /** Something in it deletes, spends money or restores: it asks first however sure it is. */
  destructive: boolean;
  /** A note for the agent (lane note), why nothing can be done (lane nothing), or what to pick (lane choose). */
  message?: string;
  basis: Basis;
};

/** What carrying an intent out came to. Nothing reports success unless something changed. */
export type Outcome = {
  changed: boolean;
  receipt: string;
  /** When nothing changed: why, and what to say or do instead. */
  why?: string;
  fix?: string;
  /** Elements it made or changed: selected afterwards, so "it" means them. */
  made?: string[];
  /** What to say if the history shows nothing was recorded after all. */
  ifNothing?: { why: string; fix?: string };
};
