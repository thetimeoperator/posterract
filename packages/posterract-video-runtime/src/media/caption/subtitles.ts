/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Transcript } from '@posterract/video-assets';

const TIMESTAMP_RE = /(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/g;

function parseTimestamp(raw: string): number {
  return raw
    .replace(',', '.')
    .split(':')
    .reduce((acc, part) => acc * 60 + Number(part), 0);
}

/**
 * Parses SRT or WebVTT text into a `Transcript`. Each cue becomes one segment
 * (a sentence boundary for grouping). Cues carry no word timings, so each
 * word's window is synthesized proportional to its length within the cue.
 */
/**
 * One transcript segment from a line and its window.
 *
 * Cues carry no per-word timings, so each word's share of the window is
 * proportional to its length — the same approximation the subtitle parser
 * makes, kept in one place so authored cues and imported files animate
 * identically.
 */
export function segmentFromLine(text: string, start: number, end: number) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length || !(end > start)) return null;

  const total = tokens.reduce((acc, token) => acc + token.length, 0);
  const duration = end - start;
  let elapsed = 0;
  const words = tokens.map((token) => {
    const wordStart = start + (elapsed / total) * duration;
    elapsed += token.length;
    return { text: token, start: wordStart, end: start + (elapsed / total) * duration };
  });

  return { text: tokens.join(' '), words };
}

export function parseSubtitles(text: string): Transcript {
  const transcript: Transcript = [];
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue; // WEBVTT header, NOTE/STYLE/REGION blocks, stray indices

    const timestamps = lines[timingIndex].match(TIMESTAMP_RE);
    if (!timestamps || timestamps.length < 2) continue;
    const start = parseTimestamp(timestamps[0]);
    const end = parseTimestamp(timestamps[1]);
    if (!(end > start)) continue;

    // Strip inline markup: HTML/VTT tags (<i>, <c.class>, <00:01.000>) and
    // SSA-style overrides ({\an8}).
    const content = lines
      .slice(timingIndex + 1)
      .join(' ')
      .replace(/<[^>]*>/g, '')
      .replace(/\{[^}]*\}/g, '');

    const segment = segmentFromLine(content, start, end);
    if (!segment) continue;

    transcript.push(segment);
  }

  return transcript.sort((a, b) => a.words[0].start - b.words[0].start);
}


/** `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (VTT). */
function formatTimestamp(seconds: number, separator: ',' | '.'): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(millis, 3)}`;
}

/** One caption line as a subtitle file holds it. */
export interface SubtitleCue {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Serialise cues as SRT or WebVTT.
 *
 * The inverse of `parseSubtitles`, so a file imported into a project and
 * exported again comes back the same — which is what makes captions
 * authored here usable by anything else that reads subtitles.
 *
 * Cues out of order, or with no text, are dropped rather than written: a
 * player given either produces nothing useful, and a file that only some
 * players accept is worse than one that is correct.
 */
export function formatSubtitles(cues: readonly SubtitleCue[], format: 'srt' | 'vtt'): string {
  const usable = cues
    .filter((cue) => cue.end > cue.start && cue.text.trim().length > 0)
    .slice()
    .sort((a, b) => a.start - b.start);

  const separator = format === 'srt' ? ',' : '.';
  const blocks = usable.map((cue, index) => {
    const timing = `${formatTimestamp(cue.start, separator)} --> ${formatTimestamp(cue.end, separator)}`;
    // SRT numbers its cues; VTT does not require it, and omitting it keeps
    // the file to what the format actually needs.
    const header = format === 'srt' ? `${index + 1}\n` : '';
    return `${header}${timing}\n${cue.text.trim()}`;
  });

  const body = blocks.join('\n\n');
  return format === 'vtt' ? `WEBVTT\n\n${body}\n` : `${body}\n`;
}
