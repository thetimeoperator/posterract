/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { World } from 'koota';
import type { EditorSession } from '../../session';
import type { Outcome, Situation, Step } from '../types';

/**
 * What the editor's own interface has to lend a command: the panels, the
 * export, the AI panel and the project itself live in Solid contexts, so the
 * bar is handed them rather than reaching for them.
 *
 * Everything is optional: a run whose part is missing says so plainly instead
 * of pretending it worked.
 */
export type VoiceUi = {
  workspace?: () => string;
  setWorkspace?: (workspace: 'storyboard' | 'edit' | 'motion') => void;
  panelOpen?: (panel: 'assets' | 'inspector' | 'timeline' | 'mixer' | 'interface') => boolean;
  setPanel?: (panel: 'assets' | 'inspector' | 'timeline' | 'mixer' | 'interface', show: boolean) => void;
  setInspectorTab?: (tab: 'design' | 'motion' | 'history') => void;
  theme?: () => string;
  setTheme?: (theme: 'noir' | 'frost') => void;
  /** Exports the active scene, with whatever of the settings the command gave. */
  exportVideo?: (settings: { template?: string; resolution?: number; format?: string; frameRate?: number }) => Promise<void>;
  exportFrame?: () => Promise<void>;
  openExportSettings?: () => void;
  openExports?: () => void;
  openHistory?: () => void;
  /** Goes back to the newest saved version; returns what it restored, or null when there is none. */
  restoreLatest?: () => Promise<string | null>;
  renameProject?: (name: string) => Promise<void> | void;
  /** Opens the file picker and imports; returns how many files arrived. */
  importFiles?: () => Promise<number>;
  renameAsset?: (path: string, name: string) => Promise<void>;
  deleteAsset?: (path: string) => Promise<void>;
  /** Makes something with AI and puts it in the video. */
  generate?: (kind: 'image' | 'video' | 'voice', options: Record<string, unknown>) => Promise<void>;
  openGenerate?: () => void;
  openAgent?: () => void;
  installSkill?: (name: string) => void;
  /** Saves the caption lines as a subtitle file the person picks a place for. */
  exportSubtitles?: (format: 'srt' | 'vtt', text: string) => Promise<void>;
  /** Says what the bar can do. */
  help?: () => void;
};

export type RunContext = {
  world: World;
  session: () => EditorSession;
  ui: VoiceUi;
  /** The canvas as it was when the command was read. */
  situation: Situation;
  /** What this same sentence has made so far. */
  made: string[];
  dir: () => string | undefined;
};

export type RunFn = (ctx: RunContext, step: Step) => Promise<Outcome> | Outcome;
