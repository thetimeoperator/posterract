/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, For, Show } from 'solid-js';
import {
  ChildOf, Cue, FrameRate, findGeometryAsset, formatSubtitles, getSceneAncestor,
  groupBy, resolveCaptionDecoder, Geometry,
} from '@posterract/video-runtime';
import { useTrait, useWorld } from '@posterract/koota-solid';
import { Cue as CueElement } from '@posterract/video-reconciler';
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';
import { useProject } from '@/context/project';
import { toast } from 'somoto';

import { PanelSection } from '@/components/ui/panel-section';
import { Button } from '@/components/ui/button';
import { useDerived, useEditor } from '@/engine/hooks';

import type { Entity } from 'koota';

/** `M:SS.d` — precise enough to retime a line, short enough to sit in a row. */
function stamp(frames: number, frameRate: number): string {
  const seconds = frames / frameRate;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}

/**
 * The caption's lines, as text you can change.
 *
 * Captions used to be whatever the transcript file said, with no way to fix a
 * misheard word. Cues are elements in the document, so editing one here is an
 * ordinary source edit: undoable, versioned, and visible to an agent.
 */
export function CueEditor(props: { selection: Entity[] }) {
  const world = useWorld();
  const project = useProject();
  const [transcribing, setTranscribing] = createSignal(false);
  const editor = useEditor();
  const frameRate = useTrait(world, FrameRate);

  const captions = createMemo(() => props.selection[0]);

  const cues = useDerived<Entity[]>(
    () => {
      const target = captions();
      if (!target) return [];
      return [...world.query(ChildOf(target), Cue)]
        .sort((a, b) => (a.get(Cue)?.start ?? 0) - (b.get(Cue)?.start ?? 0));
    },
    (prev, next) => prev.length === next.length && prev.every((entity, i) => entity === next[i]),
  );

  const rate = () => frameRate()?.value ?? 30;

  /**
   * Import what the transcript file says into the document, once. After this
   * the cues are the truth and the `src` is ignored, which is the only way an
   * edit can survive.
   */
  const unpack = () => {
    const target = captions();
    if (!target) return;
    // The decoder exposes the word groups it drew from, which is what is on
    // screen — closer to the truth than re-parsing the file would be.
    const groups = resolveCaptionDecoder(world, target)?.groups ?? [];
    if (!groups.length) return;
    for (const words of groups) {
      const start = words[0]?.start;
      const end = words[words.length - 1]?.end;
      if (start === undefined || end === undefined || !(end > start)) continue;
      const text = words.map((word) => word.text).join(' ');
      editor.insertElement(target, () => (
        <CueElement start={start} end={end}>{text}</CueElement>
      ));
    }
  };

  /**
   * Write the cues out as a subtitle file.
   *
   * Captions authored here should be usable by anything else that reads
   * subtitles — a player, a platform's upload form, another editor — so the
   * lines leave as the format everything already accepts. The times are the
   * cues' own, in seconds, which is what the file wants; nothing is uploaded.
   */
  const exportSubtitles = async (format: 'srt' | 'vtt') => {
    const lines = cues().map((cue) => {
      const value = cue.get(Cue)!;
      return { start: value.start / rate(), end: value.end / rate(), text: value.text };
    });
    if (!lines.length) return;

    const text = formatSubtitles(lines, format);
    const name = `${project.name().replace(/\s+/g, '-').toLowerCase()}.${format}`;

    try {
      if (window.desktop) {
        const picked = await mainBridge.call(MAIN_CHANNELS.FILE_PICK_EXPORT, {
          suggestedName: name,
          extension: format,
          description: format === 'srt' ? 'SubRip subtitles' : 'WebVTT subtitles',
        });
        if (!picked) return;
        // The picker is what authorises the path; the write channels are the
        // same ones an export uses, rather than the encoder's stream handle,
        // which is shaped for media chunks and not for a text file.
        const { id } = await mainBridge.call(MAIN_CHANNELS.FILE_WRITE_OPEN, { path: picked.path });
        try {
          await mainBridge.call(MAIN_CHANNELS.FILE_WRITE_CHUNK, {
            id,
            data: new TextEncoder().encode(text),
            position: 0,
          });
          await mainBridge.call(MAIN_CHANNELS.FILE_WRITE_CLOSE, { id });
        } catch (cause) {
          await mainBridge.call(MAIN_CHANNELS.FILE_WRITE_ABORT, { id }).catch(() => undefined);
          throw cause;
        }
        toast.success('Captions exported', { description: picked.path });
        return;
      }

      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: format, accept: { 'text/plain': [`.${format}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      toast.success('Captions exported');
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') return;
      toast.error('Could not export the captions', {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  /**
   * Transcribe the scene's own audio and write the result in as cues.
   *
   * The words come from whichever clip in this scene carries audio — the take
   * the captions are for — through the user's own transcription key. The
   * result is cached in the project by content hash, so running this twice on
   * the same take costs nothing and produces the same lines, which is what
   * makes them safe to then edit by hand.
   */
  const autoCaption = async () => {
    const target = captions();
    if (!target || transcribing()) return;

    const scene = getSceneAncestor(target) ?? target;
    // The first clip in the scene with an audio-bearing asset. A caption
    // belongs to what is being said, and that is what is being said.
    let source: string | null = null;
    for (const node of world.query(ChildOf(scene), Geometry)) {
      // `findGeometryAsset` already looks through a clip's fills, which is
      // where a video's asset actually lives.
      const asset = findGeometryAsset(world, node);
      if (asset && (asset.type === 'VIDEO' || asset.type === 'AUDIO')) {
        source = asset.path;
        break;
      }
    }

    if (!source) {
      toast('Nothing to transcribe', {
        description: 'Add the video or audio these captions are for, then try again.',
      });
      return;
    }

    setTranscribing(true);
    try {
      const result = await mainBridge.call(MAIN_CHANNELS.AI_TRANSCRIBE, {
        dir: project.dir(),
        path: source,
      });
      if (!result.words.length) {
        toast('No speech found', { description: 'The transcription came back empty.' });
        return;
      }

      // Grouped the same way the caption decoders group an imported
      // transcript, so auto captions and imported ones break into lines
      // identically.
      const transcript = result.segments.length
        ? result.segments.map((segment) => ({
            text: segment.text,
            words: result.words.filter((word) => word.start >= segment.start && word.end <= segment.end),
          })).filter((segment) => segment.words.length)
        : [{ text: result.text, words: result.words }];

      const lines = groupBy(transcript, { duration: 2.2 }).filter((group) => group.length > 0);
      for (const words of lines) {
        const start = words[0]!.start;
        const end = words.at(-1)!.end;
        if (!(end > start)) continue;
        editor.insertElement(target, () => (
          <CueElement start={start} end={end}>{words.map((word) => word.text).join(' ')}</CueElement>
        ));
      }

      toast.success(`${lines.length} caption lines written`, {
        description: result.cached ? 'From this project\u2019s transcript cache.' : 'Edit any line below.',
      });
    } catch (cause) {
      toast.error('Could not transcribe', {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <Show when={captions()}>
      <PanelSection
        title="Caption lines"
        subtitle={
          <Show when={cues().length}>
            <span class="text-muted-foreground">{cues().length}</span>
          </Show>
        }
      >
        <Show
          when={cues().length}
          fallback={
            <div>
              <p class="text-xxs leading-4 text-muted-foreground">
                These captions come from a transcript file. Unpack them into the project to edit
                the wording and timing.
              </p>
              <div class="mt-2 flex gap-2">
                <Button variant="secondary" size="small" onClick={unpack}>
                  Unpack to editable lines
                </Button>
                <Button variant="secondary" size="small" disabled={transcribing()} onClick={() => void autoCaption()}>
                  {transcribing() ? 'Transcribing…' : 'Auto captions'}
                </Button>
              </div>
            </div>
          }
        >
          <div class="-mx-1 max-h-64 overflow-y-auto">
            <For each={cues()}>
              {(cue) => {
                const value = () => cue.get(Cue)!;
                return (
                  <div class="group/cue flex items-start gap-2 rounded-md px-1 py-1 hover:bg-accent">
                    <span class="mt-1 shrink-0 font-mono text-xxs tabular-nums text-muted-foreground">
                      {stamp(value().start, rate())}
                    </span>
                    <textarea
                      class="min-h-6 flex-1 resize-none rounded-sm bg-transparent px-1 py-0.5 text-xxs text-foreground outline-none focus:bg-input"
                      rows={1}
                      value={value().text}
                      onChange={(event) => editor.editText(cue, event.currentTarget.value)}
                    />
                    <Button
                      variant="ghost"
                      size="small"
                      class="shrink-0 opacity-0 group-hover/cue:opacity-100 focus-visible:opacity-100"
                      onClick={() => editor.remove(cue)}
                    >
                      Delete
                    </Button>
                  </div>
                );
              }}
            </For>
          </div>

          <div class="mt-2 flex flex-wrap gap-2 border-t pt-2">
            <Button variant="secondary" size="small" disabled={transcribing()} onClick={() => void autoCaption()}>
              {transcribing() ? 'Transcribing…' : 'Auto captions'}
            </Button>
            <Button variant="secondary" size="small" onClick={() => void exportSubtitles('srt')}>
              Export SRT
            </Button>
            <Button variant="secondary" size="small" onClick={() => void exportSubtitles('vtt')}>
              Export VTT
            </Button>
          </div>
        </Show>
      </PanelSection>
    </Show>
  );
}
