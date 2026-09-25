/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useWorld } from '@posterract/koota-solid';
import {
  Computed, Library, PLACEMENTS, RenderSurface, elementAnchor, entityQuad, frameAnchor, getActiveEntity, isPlacement,
  placedPosition, store,
} from '@posterract/video-runtime';

import { Command, CommandItem, CommandList } from '@/components/ui/command';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { Kbd } from '@/components/ui/kbd';
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from '@/components/ui/popover';
import { SiriWave } from '@/components/ui/siri-wave';
import { Switch, SwitchControl, SwitchInput, SwitchThumb } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from '@/components/ui/tooltip';
import { FISH_VOICES, openGeneratePanel } from '@/components/genai/generate-panel';
import { insertGeneration } from '@/components/genai/insert-generation';
import { KeysCard } from '@/components/genai/keys-card';
import { TEMPLATE_BY_ID, getDefaultExportTemplate } from '@/components/sidebar-right/inspector/export-templates';
import { useAi } from '@/context/ai';
import { useExport } from '@/context/export';
import { useLayout } from '@/context/layout';
import { useProject } from '@/context/project';
import { applyIntentReading } from '@/context/agent-api/intents/exec';
import {
  cancelIntent, exactReading, helpLines, readIntentAgain, rereadIntent, resolveIntent, selectForReading,
} from '@/context/agent-api/intents/resolve';
import { resolveNode } from '@/context/agent-api/nodes';
import { pickAndImport } from '@/engine/asset-actions';
import { useDerived } from '@/engine/hooks';
import { skillCards } from '@/lib/skills';
import { listRevisions, restoreRevision } from '@/projects/history';
import { aiGenerateLocal } from '@/lib/ai-bridge';
import { TALK_KEYS, setTalkKey, talkKeyName, voiceTalkKey } from '@/engine/input/shortcuts';
import { useProjectConfig } from '@/engine/project-config';
import { skillDeckScene } from '@/engine/skill-deck';
import { setTimelineDetail } from '@/engine/timeline/detail';
import {
  attachVoiceHost,
  showVoiceHelp,
  voiceHelp,
  barCommands,
  cancelVoice,
  closeVoiceBar,
  confirmVoice,
  dismissMissingKey,
  openVoiceBar,
  pickVoiceAlternative,
  pickVoiceChoice,
  registerCommand,
  runListedCommand,
  setVoiceAppliesAutomatically,
  setVoiceText,
  startTalking,
  stopTalking,
  submitCommand,
  voiceAppliesAutomatically,
  voiceError,
  voiceHistory,
  voiceIsAsking,
  voiceIsChoosing,
  voiceLatency,
  voiceLevels,
  voiceMissingKey,
  voiceMode,
  voiceQuestion,
  voiceReading,
  voiceReceipt,
  voiceTalking,
  voiceText,
} from '@/engine/voice';
import { aiSaveKeys, voiceLog } from '@/lib/ai-bridge';
import { displayKeys, rankCommands } from '@/lib/command-match';
import { cx } from '@/lib/cva';
import { getEditWriter } from '@/projects/edits';

import type { World } from 'koota';
import type { Chip } from '@/context/agent-api/intents/types';
import type { VoiceUi } from '@/context/agent-api/intents/runs/types';
import type { Command as EditorCommand, VoiceMode } from '@/engine/voice';

type Size = { width: number; height: number };

/** The bar's size in each mode, and the wave's inside it. */
const BAR: Record<VoiceMode, Size> = {
  idle: { width: 160, height: 40 },
  typing: { width: 460, height: 48 },
  listening: { width: 420, height: 96 },
  transcribing: { width: 460, height: 48 },
  resolving: { width: 460, height: 48 },
  confirm: { width: 460, height: 48 },
  choose: { width: 460, height: 48 },
  done: { width: 460, height: 48 },
  error: { width: 460, height: 48 },
};

const WAVE_BESIDE_TEXT: Size = { width: 96, height: 32 };

/** How many matching commands the list under the input shows. */
const LIST_LIMIT = 6;

/** A press on the wave shorter than this opens the bar for typing; longer is a hold to talk. */
const HOLD_MS = 300;

/**
 * The voice bar: a black pill at the bottom of the canvas with a glowing
 * line in it. ⌘K opens it for typing a command; holding the talk key (Q
 * unless another is picked in its settings) listens for one. It says what it
 * did in a line above itself, and one ⌘Z takes it back.
 */
export function VoiceBar() {
  const world = useWorld();
  const layout = useLayout();
  const navigate = useNavigate();
  const { exportScene, exportCurrentFrame } = useExport();
  const config = useProjectConfig();
  const project = useProject();
  const ai = useAi();

  let input: HTMLInputElement | undefined;
  let historyIndex = -1;

  /** A command the UI registered, run by name (the export settings, the agent). */
  const runRegistered = (id: string): void => {
    barCommands().find((entry) => entry.id === id)?.action(world);
  };

  const skillNames = () => skillCards().map((card) => ({ name: card.name, what: card.description ?? card.name }));

  /**
   * What a spoken command borrows from the interface: the panels, the export,
   * the library and the AI panel all live in Solid contexts, so they are
   * handed over rather than reached for.
   */
  const voiceUi = (): VoiceUi => ({
    workspace: layout.workspace,
    setWorkspace: layout.setWorkspace,
    panelOpen: (panel) => (
      panel === 'assets' ? layout.leftOpen()
        : panel === 'inspector' ? layout.inspectorOpen()
          : panel === 'timeline' ? !layout.timelineMinimized()
            : panel === 'mixer' ? layout.mixerOpen()
              : layout.uiVisible()
    ),
    setPanel: (panel, show) => {
      const open = panel === 'assets' ? layout.leftOpen()
        : panel === 'inspector' ? layout.inspectorOpen()
          : panel === 'timeline' ? !layout.timelineMinimized()
            : panel === 'mixer' ? layout.mixerOpen()
              : layout.uiVisible();
      if (open === show) return;
      if (panel === 'assets') layout.toggleLeft();
      else if (panel === 'inspector') layout.toggleInspector();
      else if (panel === 'timeline') layout.toggleTimeline();
      else if (panel === 'mixer') layout.toggleMixer();
      else layout.toggleUI();
    },
    setInspectorTab: (tab) => {
      layout.setInspectorTab(tab);
      if (!layout.inspectorOpen()) layout.toggleInspector();
    },
    theme: layout.editorTheme,
    setTheme: (theme) => {
      if (layout.editorTheme() !== theme) layout.toggleEditorTheme();
    },
    exportVideo: async (settings) => {
      const scene = getActiveEntity(world);
      if (!scene) return;
      const base = (settings.template ? TEMPLATE_BY_ID.get(settings.template) : undefined)
        ?? config()?.exportOf(scene)
        ?? getDefaultExportTemplate();
      await exportScene(scene, {
        ...base,
        ...(settings.format ? { format: settings.format as typeof base.format } : {}),
        ...(settings.resolution || settings.frameRate
          ? {
            video: {
              ...base.video,
              ...(settings.resolution ? { resolution: settings.resolution } : {}),
              ...(settings.frameRate ? { fps: settings.frameRate } : {}),
            },
          }
          : {}),
      });
    },
    exportFrame: () => exportCurrentFrame(),
    openExportSettings: () => runRegistered('export.settings'),
    openExports: () => navigate('/?view=exports'),
    openHistory: () => {
      layout.setInspectorTab('history');
      if (!layout.inspectorOpen()) layout.toggleInspector();
    },
    restoreLatest: async () => {
      const dir = project.dir();
      if (!dir) return null;
      const revisions = await listRevisions(dir);
      const latest = revisions[0];
      if (!latest) return null;
      await restoreRevision(dir, latest.id);
      return new Date(latest.savedAt).toLocaleString();
    },
    renameProject: (name) => project.rename(name),
    importFiles: async () => {
      const library = world.get(Library);
      if (!library) return 0;
      const added = await pickAndImport(library, '');
      return added.length;
    },
    renameAsset: async (path, name) => {
      const library = world.get(Library);
      const asset = library?.assets().find((entry) => entry.path === path);
      if (library && asset) await library.rename(asset, name);
    },
    deleteAsset: async (path) => {
      const library = world.get(Library);
      const asset = library?.assets().find((entry) => entry.path === path);
      if (library && asset) await library.remove([asset]);
    },
    generate: async (kind, options) => {
      const dir = project.dir();
      if (!dir) throw new Error('Open a project first.');
      const output = await aiGenerateLocal(dir, { kind, ...options } as never);
      insertGeneration(world, kind, output);
    },
    openGenerate: () => openGeneratePanel(),
    openAgent: () => runRegistered('agent.open'),
    help: showVoiceHelp,
  });

  onMount(() => {
    void ai.refreshKeys();
    const detach = attachVoiceHost({
      world,
      dir: () => project.dir(),
      hasKey: (key) => {
        const keys = ai.keys();
        return keys ? Boolean(keys[key]) : undefined;
      },
      voiceProvider: () => ai.keys()?.voiceProvider ?? 'openai-compatible',
      read: (text, requestId) => {
        const dir = project.dir();
        if (!dir) return Promise.reject(new Error('Open a project first.'));
        return resolveIntent(text, { dir, requestId, extra: { voices: [...FISH_VOICES].filter((voice) => voice.id), skills: skillNames() } });
      },
      cancelRead: cancelIntent,
      reread: (reading, key, value) => rereadIntent(reading.basis, key, value),
      apply: (reading) => applyIntentReading(reading, voiceUi()),
      select: selectForReading,
      again: readIntentAgain,
      note: (text) => getEditWriter(world)?.noteNextWrite(text),
      readExact: exactReading,
      helpLines,
      log: (entry) => {
        const dir = project.dir();
        if (dir) void voiceLog(dir, entry);
      },
    });

    // Commands with no key of their own: they live in the UI, so the UI
    // registers them, and they can be named like any other.
    const stops = [
      registerCommand({
        id: 'workspace.storyboard', label: 'Storyboard workspace', group: 'Canvas', keys: [],
        aliases: ['storyboard', 'storyboard view', 'go to storyboard'],
        action: () => layout.setWorkspace('storyboard'),
      }),
      registerCommand({
        id: 'workspace.edit', label: 'Edit workspace', group: 'Canvas', keys: [],
        aliases: ['edit view', 'go to edit', 'edit workspace'],
        action: () => layout.setWorkspace('edit'),
      }),
      registerCommand({
        id: 'workspace.motion', label: 'Motion workspace', group: 'Canvas', keys: [],
        aliases: ['motion', 'motion view', 'go to motion'],
        action: () => { layout.setWorkspace('motion'); setTimelineDetail('animation'); },
      }),
      registerCommand({
        id: 'panel.assets', label: 'Show or hide assets', group: 'Canvas', keys: [],
        aliases: ['assets', 'show assets', 'hide assets', 'collapse assets'],
        action: layout.toggleLeft,
      }),
      registerCommand({
        id: 'panel.inspector', label: 'Show or hide the inspector', group: 'Canvas', keys: [],
        aliases: ['inspector', 'show the inspector', 'hide the inspector'],
        action: layout.toggleInspector,
      }),
      registerCommand({
        id: 'panel.timeline', label: 'Expand or collapse the timeline', group: 'Timeline', keys: [],
        aliases: ['timeline', 'show the timeline', 'hide the timeline', 'expand the timeline', 'collapse the timeline'],
        action: layout.toggleTimeline,
      }),
      registerCommand({
        id: 'panel.history', label: 'Version history', group: 'Editing', keys: [],
        aliases: ['version history', 'versions', 'show the history'],
        action: () => {
          layout.setInspectorTab('history');
          if (!layout.inspectorOpen()) layout.toggleInspector();
        },
      }),
      registerCommand({
        id: 'view.theme', label: 'Switch between Noir and Glass', group: 'Canvas', keys: [],
        aliases: ['switch theme', 'switch to glass', 'switch to noir', 'glass', 'noir'],
        action: layout.toggleEditorTheme,
      }),
      registerCommand({
        id: 'view.hide-interface', label: 'Hide the interface', group: 'Canvas', keys: [],
        aliases: ['hide the interface', 'hide the ui', 'clean view'],
        action: layout.toggleUI,
      }),
      registerCommand({
        id: 'export.video', label: 'Export the video', group: 'Export', keys: ['e', 'mod'],
        aliases: ['export', 'export the video', 'export this', 'render the video'], when: 'scene', done: 'Exporting the video',
        action: (target) => {
          const scene = getActiveEntity(target);
          if (scene) void exportScene(scene, config()?.exportOf(scene) ?? getDefaultExportTemplate());
        },
      }),
      registerCommand({
        id: 'export.library', label: 'Open the exports library', group: 'Export', keys: [],
        aliases: ['exports library', 'open exports', 'my exports'],
        action: () => navigate('/?view=exports'),
      }),
      registerCommand({
        id: 'ai.generate', label: 'Open AI Generate', group: 'Agent', keys: [],
        aliases: ['ai generate', 'open generate', 'generate an image', 'generate a video'],
        action: () => openGeneratePanel(),
      }),
    ];

    onCleanup(() => {
      for (const stop of stops) stop();
      detach();
    });
  });

  const mode = voiceMode;
  const size = () => BAR[mode()];
  const talkKey = () => talkKeyName(voiceTalkKey());

  // The first-run hint: shown once, above the resting pill, until the bar is
  // used, the hint is closed, or it has been up for a while.
  const [hintSeen, setHintSeen] = createSignal(readHintSeen());
  const seeHint = (): void => {
    if (hintSeen()) return;
    setHintSeen(true);
    try {
      localStorage.setItem(HINT_SETTING, '1');
    } catch {
      // Seen for this session only.
    }
  };
  createEffect(on(mode, (next) => { if (next !== 'idle') seeHint(); }, { defer: true }));
  createEffect(() => {
    if (hintSeen() || hidden()) return;
    const timer = setTimeout(seeHint, HINT_MS);
    onCleanup(() => clearTimeout(timer));
  });
  const typing = () => mode() === 'typing';
  const hidden = () => !layout.uiVisible() || skillDeckScene() !== null;

  // ⌘K reaches the bar through the engine; the input takes the keyboard as it opens.
  createEffect(on(mode, (next) => {
    if (next === 'typing') queueMicrotask(() => input?.focus());
    else if (document.activeElement === input) input?.blur();
  }));

  /** What the wave is doing in each mode (Phase 2 drives it from the microphone). */
  const wave = createMemo(() => {
    const current = mode();
    if (current === 'listening') {
      const levels = voiceLevels();
      return { live: 1, amp: 0.05 + 1.2 * levels.level, levels, paused: false };
    }
    if (current === 'transcribing' || current === 'resolving') {
      return { live: 0, amp: 0.35, levels: undefined, paused: false };
    }
    return { live: 1, amp: 0.05, levels: { low: 0, mid: 0, high: 0 }, paused: current === 'error' };
  });

  const waveSize = (): Size => {
    const current = mode();
    if (current === 'idle') return { width: BAR.idle.width - 8, height: BAR.idle.height - 8 };
    if (current === 'listening') return { width: BAR.listening.width - 12, height: BAR.listening.height - 12 };
    return WAVE_BESIDE_TEXT;
  };

  const matches = createMemo(() => (typing() ? rankCommands(barCommands(), voiceText()).slice(0, LIST_LIMIT) : []));

  const lineText = () => {
    const current = mode();
    if (current === 'transcribing') return voiceText() || 'Listening…';
    if (current === 'error') return voiceError() ?? '';
    if (current === 'confirm' || current === 'choose') return voiceQuestion() ?? voiceText();
    return voiceText();
  };

  /** What the bar understood, shown above it while typing (a live reading) and while it asks. */
  const chips = createMemo(() => {
    const current = mode();
    if (current !== 'typing' && current !== 'confirm') return [];
    return voiceReading()?.chips ?? [];
  });
  const choices = createMemo(() => (mode() === 'choose' ? voiceReading()?.choices ?? [] : []));

  const onKeyDown = (event: KeyboardEvent) => {
    // The bar's keys stay the bar's: cmdk's own list keys would run a second
    // command on the same Enter.
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      historyIndex = -1;
      void submitCommand(voiceText(), 'typed');
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      historyIndex = -1;
      closeVoiceBar();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      const past = voiceHistory();
      if (!past.length) return;
      const step = event.key === 'ArrowUp' ? 1 : -1;
      historyIndex = Math.max(-1, Math.min(past.length - 1, historyIndex + step));
      setVoiceText(historyIndex === -1 ? '' : past[past.length - 1 - historyIndex]!);
    }
  };

  const onFocusOut = (event: FocusEvent) => {
    // Clicking away from an empty bar puts it away. Its own settings and its
    // chips' menus open outside it (in a portal), and are not away from it.
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return;
    if (next instanceof Element && next.closest('.posterract-voice-settings-menu, .posterract-voice-chip-menu')) return;
    if (typing() && !voiceText().trim()) closeVoiceBar();
  };

  const note = () => voiceReceipt() ?? (typing() ? voiceError() : null);

  // Asked for a key the page thought the project had: its list is out of date.
  createEffect(on(voiceMissingKey, (missing) => {
    if (missing) void ai.refreshKeys();
  }, { defer: true }));

  // A key saved in the card is the key the bar was asking for: the card goes
  // once that key arrives — not because an out-of-date list still names it.
  createEffect(on(ai.keys, (keys, previous) => {
    const missing = voiceMissingKey();
    if (missing && keys?.[missing] && !previous?.[missing]) dismissMissingKey();
  }, { defer: true }));

  // While the bar is asking (or listening), Enter and Escape are its answer,
  // not the canvas's: taken before the engine's own listener sees them.
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      // Keys inside a chip's menu or the settings are the menu's: Enter picks an option there.
      if (event.target instanceof Element && event.target.closest('.posterract-voice-chip-menu, .posterract-voice-settings-menu')) return;
      if (voiceIsAsking() && (event.key === 'Enter' || event.key === 'Escape')) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Enter') confirmVoice();
        else cancelVoice();
        return;
      }
      if (voiceIsChoosing() && (event.key === 'Escape' || /^[1-9]$/.test(event.key))) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') cancelVoice();
        else void pickVoiceChoice(Number(event.key) - 1);
        return;
      }
      if (mode() === 'resolving' && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeVoiceBar();
        return;
      }
      if (mode() === 'listening' && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        void stopTalking('cancelled');
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    onCleanup(() => window.removeEventListener('keydown', onKey, { capture: true }));
  });

  // Holding the wave talks, as holding Q does; a short press opens the bar for typing.
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let pressed = false;
  const onWaveUp = () => {
    if (!pressed) return;
    pressed = false;
    clearTimeout(holdTimer);
    window.removeEventListener('pointerup', onWaveUp);
    window.removeEventListener('pointercancel', onWaveUp);
    if (voiceTalking() === 'pointer') void stopTalking('released');
    else if (mode() === 'idle') openVoiceBar();
  };
  const onWaveDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    pressed = true;
    clearTimeout(holdTimer);
    // The pill turns into the listening wave under the pointer, so the
    // release is listened for on the window, wherever it lands.
    window.addEventListener('pointerup', onWaveUp);
    window.addEventListener('pointercancel', onWaveUp);
    holdTimer = setTimeout(() => {
      if (pressed) void startTalking('pointer');
    }, HOLD_MS);
  };
  onCleanup(() => {
    clearTimeout(holdTimer);
    window.removeEventListener('pointerup', onWaveUp);
    window.removeEventListener('pointercancel', onWaveUp);
  });

  return (
    <Show when={!hidden()}>
      <VoiceGhost world={world} />
      <div
        class="posterract-voice"
        data-mode={mode()}
        data-latency={voiceLatency() ?? undefined}
        on:pointerdown={(event) => event.stopPropagation()}
        onFocusOut={onFocusOut}
      >
        <Show when={voiceMissingKey()}>
          {(key) => (
            <div class="posterract-voice-key">
              <KeysCard provider={key()} />
              <button type="button" class="posterract-voice-key-close" aria-label="Not now" onClick={dismissMissingKey}>
                Not now
              </button>
            </div>
          )}
        </Show>

        <Show when={mode() === 'idle' && !hintSeen()}>
          <div class="posterract-voice-hint" role="note">
            <span>Hold {talkKey()} and say 'split' — or press ⌘K</span>
            <button type="button" class="posterract-voice-hint-close" aria-label="Close the hint" onClick={seeHint}>
              <Icon name="close-remove-small" class="size-3.5" />
            </button>
          </div>
        </Show>

        <Show when={note()}>
          {(message) => (
            <div class="posterract-voice-note" role="status" classList={{ 'is-error': !voiceReceipt() }}>
              {message()}
            </div>
          )}
        </Show>

        <Show when={voiceHelp().length > 0}>
          <div class="posterract-voice-help" role="note">
            <span class="posterract-voice-help-title">Say things like</span>
            <For each={voiceHelp()}>{(line) => <span>{line}</span>}</For>
          </div>
        </Show>

        <Show when={chips().length > 0}>
          <div class="posterract-voice-chips" role="group" aria-label="What the bar understood">
            <For each={chips()}>{(chip) => <ReadingChip chip={chip} />}</For>
          </div>
        </Show>

        <Show when={choices().length > 0}>
          <div class="posterract-voice-choices" role="group" aria-label="Which one">
            <For each={choices()}>
              {(choice, index) => (
                <button type="button" class="posterract-voice-choice" onClick={() => void pickVoiceChoice(index())}>
                  <Kbd>{index() + 1}</Kbd>
                  <span class="truncate">{choice.text}</span>
                  <span class="posterract-voice-odds">{percent(choice.p)}</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <Show when={typing() && matches().length > 0}>
          <Command class="posterract-voice-list" shouldFilter={false} loop={false}>
            <CommandList>
              <For each={matches()}>
                {(match) => <CommandRow command={match.command} />}
              </For>
            </CommandList>
          </Command>
        </Show>

        <div
          class={cx('posterract-voice-bar', `is-${mode()}`)}
          style={{ width: `${size().width}px`, height: `${size().height}px` }}
        >
          <Show
            when={mode() !== 'idle'}
            fallback={
              <Tooltip placement="top">
                <TooltipTrigger
                  as="button"
                  type="button"
                  class="posterract-voice-pill"
                  aria-label="Voice and typed commands"
                  onPointerDown={onWaveDown}
                  onKeyDown={(event: KeyboardEvent) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openVoiceBar(); }
                  }}
                >
                  <SiriWave {...wave()} width={waveSize().width} height={waveSize().height} />
                </TooltipTrigger>
                <TooltipPortal>
                  <TooltipContent>Hold {talkKey()} to talk · ⌘K to type</TooltipContent>
                </TooltipPortal>
              </Tooltip>
            }
          >
            <SiriWave
              {...wave()}
              width={waveSize().width}
              height={waveSize().height}
              class="shrink-0 cursor-pointer"
              onPointerDown={onWaveDown}
            />
            <Show when={mode() !== 'listening'}>
              <Show
                when={typing()}
                fallback={<span class="posterract-voice-line" classList={{ 'is-error': mode() === 'error' }}>{lineText()}</span>}
              >
                <input
                  ref={input}
                  class="posterract-voice-input"
                  aria-label="Type a command"
                  placeholder="Type a command — split, duplicate, zoom to fit…"
                  autocomplete="off"
                  spellcheck={false}
                  value={voiceText()}
                  onInput={(event) => { historyIndex = -1; setVoiceText(event.currentTarget.value); }}
                  onKeyDown={onKeyDown}
                />
                <VoiceSettings
                  provider={ai.keys()?.voiceProvider === 'xai' ? 'xai' : 'openai-compatible'}
                  onProvider={(provider) => {
                    const dir = project.dir();
                    if (!dir) return;
                    void aiSaveKeys(dir, { voiceProvider: provider }).then(() => ai.refreshKeys()).catch(() => undefined);
                  }}
                />
              </Show>
            </Show>
          </Show>
        </div>
      </div>
    </Show>
  );
}

function CommandRow(props: { command: EditorCommand }) {
  const keys = () => displayKeys(props.command.keys);
  return (
    <CommandItem
      value={props.command.id}
      class="posterract-voice-row"
      onSelect={() => runListedCommand(props.command)}
    >
      <span class="truncate">{props.command.label.split(' — ')[0]}</span>
      <Show when={keys().length > 0}>
        <span class="ml-auto flex shrink-0 items-center gap-0.5">
          <For each={keys()}>{(key) => <Kbd>{key}</Kbd>}</For>
        </span>
      </Show>
    </CommandItem>
  );
}

const percent = (p: number): string => `${Math.round(p * 100)}%`;

/** One part of the reading; it opens to the other options, most likely first. */
function ReadingChip(props: { chip: Chip }) {
  return (
    <DropdownMenu placement="top">
      <DropdownMenuTrigger
        as="button"
        type="button"
        class={cx('posterract-voice-chip', !props.chip.sure && 'is-unsure')}
        disabled={props.chip.alternatives.length === 0}
      >
        {props.chip.text}
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="posterract-voice-chip-menu">
          <For each={props.chip.alternatives}>
            {(alternative) => (
              <DropdownMenuItem onSelect={() => pickVoiceAlternative(props.chip.key, alternative.value)}>
                <span class="truncate">{alternative.text}</span>
                <Show when={alternative.p !== null}>
                  <span class="posterract-voice-odds">{percent(alternative.p!)}</span>
                </Show>
              </DropdownMenuItem>
            )}
          </For>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

type Box = { x: number; y: number; width: number; height: number };
type Outline = Box & { number?: number; now?: boolean };

/** An entity's box in the workspace's own pixels, as the Skill Deck draws over a scene. */
function boxOf(world: World, id: string): Box | null {
  try {
    const entity = resolveNode(world, id);
    const resolution = world.get(RenderSurface)?.resolution ?? 1;
    const points = [...entityQuad(world, entity)];
    if (!points.length) return null;
    const xs = points.map((point) => point.x / resolution);
    const ys = points.map((point) => point.y / resolution);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  } catch {
    return null;
  }
}

/**
 * Where the reading will put the element, drawn as a dashed outline on the
 * canvas before it is applied (and, for numbered choices, the numbers on the
 * elements they name). The change is worked out in code on the element's box:
 * a place by the same placement arithmetic the runtime uses, a move and a
 * size step on the box as it is.
 */
function VoiceGhost(props: { world: World }) {
  const outlines = useDerived<Outline[]>(
    () => {
      const current = voiceMode();
      const reading = voiceReading();
      if (!reading || (current !== 'typing' && current !== 'confirm' && current !== 'choose')) return [];
      const world = props.world;

      if (current === 'choose') {
        return reading.choices.flatMap((choice, index) => {
          const box = choice.elementId ? boxOf(world, choice.elementId) : null;
          return box ? [{ ...box, number: index + 1 }] : [];
        });
      }

      const ghost = reading.ghost;
      if (!ghost) return [];
      const box = boxOf(world, ghost.id);
      if (!box) return [];
      let next: Box = box;

      const scene = getActiveEntity(world);
      const sceneId = reading.basis.situation.scene?.id;
      const frame = scene && sceneId ? boxOf(world, sceneId) : null;
      const computed = store(world, Computed);
      const sceneWidth = scene ? computed.width[scene.id()] ?? 0 : 0;
      const sceneHeight = scene ? computed.height[scene.id()] ?? 0 : 0;
      // Workspace pixels per scene unit.
      const k = frame && sceneWidth ? frame.width / sceneWidth : 1;

      if (ghost.place && isPlacement(ghost.place) && frame && sceneWidth && sceneHeight) {
        const [fx, fy] = PLACEMENTS[ghost.place];
        const target = frameAnchor(fx, fy, sceneWidth, sceneHeight, 0, 0);
        const at = placedPosition({ target, ax: elementAnchor(fx), ay: elementAnchor(fy), width: box.width / k, height: box.height / k });
        next = { ...next, x: frame.x + at.x * k, y: frame.y + at.y * k };
      }
      if (ghost.dx || ghost.dy) next = { ...next, x: next.x + (ghost.dx ?? 0) * k, y: next.y + (ghost.dy ?? 0) * k };
      if (ghost.scale && ghost.scale !== 1) {
        const width = next.width * ghost.scale;
        const height = next.height * ghost.scale;
        next = { x: next.x + (next.width - width) / 2, y: next.y + (next.height - height) / 2, width, height };
      }
      const moved = next.x !== box.x || next.y !== box.y || next.width !== box.width || next.height !== box.height;
      return moved ? [{ ...box, now: true }, next] : [next];
    },
    (a, b) => a.length === b.length && a.every((outline, index) => {
      const other = b[index]!;
      return outline.x === other.x && outline.y === other.y && outline.width === other.width
        && outline.height === other.height && outline.number === other.number && outline.now === other.now;
    }),
  );

  return (
    <div class="posterract-voice-ghosts" aria-hidden="true">
      <For each={outlines()}>
        {(outline) => (
          <div
            class="posterract-voice-ghost"
            classList={{ 'is-now': Boolean(outline.now) }}
            style={{ left: `${outline.x}px`, top: `${outline.y}px`, width: `${outline.width}px`, height: `${outline.height}px` }}
          >
            <Show when={outline.number}>{(number) => <span class="posterract-voice-ghost-number">{number()}</span>}</Show>
          </div>
        )}
      </For>
    </div>
  );
}

const HINT_SETTING = 'posterract.voice.hintSeen';
/** How long the first-run hint stays up before it counts as seen. */
const HINT_MS = 12_000;

function readHintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_SETTING) === '1';
  } catch {
    return false;
  }
}

/** The bar's settings: which key to hold, whether a clear command applies at once, and who turns speech into words. */
function VoiceSettings(props: { provider: 'openai-compatible' | 'xai'; onProvider: (provider: 'openai-compatible' | 'xai') => void }) {
  return (
    <Popover placement="top-end" gutter={10}>
      <PopoverTrigger
        as="button"
        type="button"
        class="posterract-voice-settings"
        aria-label="Voice bar settings"
        // The input keeps the keyboard: a click on the button is not a click away from the bar.
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
      >
        <Icon name="settings" class="size-4" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="posterract-voice-settings-menu">
          <div class="posterract-voice-setting">
            <span class="posterract-voice-setting-label">Talk key</span>
            <div class="posterract-voice-choices-row" role="radiogroup" aria-label="Talk key">
              <For each={TALK_KEYS}>
                {(key) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={voiceTalkKey() === key}
                    class={cx('posterract-voice-option', voiceTalkKey() === key && 'is-on')}
                    onClick={() => setTalkKey(key)}
                  >
                    {talkKeyName(key)}
                  </button>
                )}
              </For>
            </div>
          </div>
          <div class="posterract-voice-setting">
            <span class="posterract-voice-setting-label">
              Apply clear commands right away
              <span class="posterract-voice-setting-note">Off: every command waits for Enter.</span>
            </span>
            <Switch checked={voiceAppliesAutomatically()} onChange={setVoiceAppliesAutomatically}>
              <SwitchInput aria-label="Apply clear commands right away" />
              <SwitchControl variant="compact">
                <SwitchThumb variant="compact" />
              </SwitchControl>
            </Switch>
          </div>
          <div class="posterract-voice-setting">
            <span class="posterract-voice-setting-label">Speech</span>
            <div class="posterract-voice-choices-row" role="radiogroup" aria-label="Speech">
              <For each={[{ value: 'openai-compatible' as const, text: 'Groq' }, { value: 'xai' as const, text: 'xAI' }]}>
                {(option) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={props.provider === option.value}
                    class={cx('posterract-voice-option', props.provider === option.value && 'is-on')}
                    onClick={() => props.onProvider(option.value)}
                  >
                    {option.text}
                  </button>
                )}
              </For>
            </div>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
