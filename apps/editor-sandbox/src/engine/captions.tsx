/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Captions, as lines in the document.
 *
 * Writing captions from what is said in the video, and unpacking an imported
 * transcript into lines that can be fixed, used to live inside the caption
 * panel. They live here now, so the panel, the voice bar and an agent all
 * write the same cues.
 */

import { Captions as CaptionsElement, Cue as CueElement } from '@posterract/video-reconciler';
import {
  Caption, ChildOf, Cue, FrameRate, Geometry, findGeometryAsset, formatSubtitles, getNextName, groupBy, resolveCaptionDecoder,
} from '@posterract/video-runtime';

import { MAIN_CHANNELS } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';

import type { Entity, World } from 'koota';
import type { DocumentEditor } from './editor';

/** The captions element of a scene, when it has one. */
export function captionsOf(world: World, scene: Entity): Entity | null {
  return [...world.query(ChildOf(scene), Caption)][0] ?? null;
}

/** The cues of a captions element, earliest first. */
export function cuesOf(world: World, captions: Entity): Entity[] {
  return [...world.query(ChildOf(captions), Cue)].sort((a, b) => (a.get(Cue)?.start ?? 0) - (b.get(Cue)?.start ?? 0));
}

/** Adds an empty captions element to a scene, ready for lines. */
export function addCaptions(world: World, editor: DocumentEditor, scene: Entity, options: { preset?: string; position?: string } = {}): Entity | null {
  const [entity] = editor.insertElement(scene, () => (
    <CaptionsElement
      name={getNextName(world, 'Captions')}
      {...(options.preset ? { preset: options.preset as never } : {})}
      {...(options.position ? { verticalAlign: options.position as never } : {})}
    />
  ));
  return entity ?? null;
}

/**
 * What is said in the scene, written into the captions as lines.
 *
 * The first clip with sound is what is transcribed — a caption belongs to what
 * is being said — and the words are grouped into lines the same way an
 * imported transcript is, so auto captions and imported ones break identically.
 * Returns how many lines were written.
 */
export async function transcribeIntoCues(
  world: World,
  editor: DocumentEditor,
  captions: Entity,
  scene: Entity,
  dir: string,
): Promise<{ lines: number; why?: string }> {
  let source: string | null = null;
  for (const node of world.query(ChildOf(scene), Geometry)) {
    const asset = findGeometryAsset(world, node);
    if (asset && (asset.type === 'VIDEO' || asset.type === 'AUDIO')) {
      source = asset.path;
      break;
    }
  }
  if (!source) return { lines: 0, why: 'there is no clip with sound in this scene to listen to' };

  const result = await mainBridge.call(MAIN_CHANNELS.AI_TRANSCRIBE, { dir, path: source });
  if (!result.words.length) return { lines: 0, why: 'no speech was found in the sound' };

  const transcript = result.segments.length
    ? result.segments
      .map((segment) => ({
        text: segment.text,
        words: result.words.filter((word) => word.start >= segment.start && word.end <= segment.end),
      }))
      .filter((segment) => segment.words.length)
    : [{ text: result.text, words: result.words }];

  const lines = groupBy(transcript, { duration: 2.2 }).filter((group) => group.length > 0);
  for (const words of lines) {
    const start = words[0]!.start;
    const end = words.at(-1)!.end;
    if (!(end > start)) continue;
    editor.insertElement(captions, () => <CueElement start={start} end={end}>{words.map((word) => word.text).join(' ')}</CueElement>);
  }
  return { lines: lines.length };
}

/**
 * Imports what the transcript file says into the document, once: after this
 * the cues are the truth and the `src` is ignored, which is the only way an
 * edit can survive. Returns how many lines arrived.
 */
export function unpackCues(world: World, editor: DocumentEditor, captions: Entity): number {
  const groups = resolveCaptionDecoder(world, captions)?.groups ?? [];
  let written = 0;
  for (const words of groups) {
    const start = words[0]?.start;
    const end = words[words.length - 1]?.end;
    if (start === undefined || end === undefined || !(end > start)) continue;
    editor.insertElement(captions, () => <CueElement start={start} end={end}>{words.map((word) => word.text).join(' ')}</CueElement>);
    written += 1;
  }
  return written;
}

/** The cues as a subtitle file's text. */
export function subtitlesText(world: World, captions: Entity, format: 'srt' | 'vtt'): string {
  const rate = world.get(FrameRate)?.value ?? 30;
  const lines = cuesOf(world, captions).map((cue) => {
    const value = cue.get(Cue)!;
    return { start: value.start / rate, end: value.end / rate, text: value.text };
  });
  return lines.length ? formatSubtitles(lines, format) : '';
}
