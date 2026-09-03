/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CAPTION_PRESETS } from "@posterract/video-reconciler";

import type { CaptionPreset as CaptionPresetName } from "@posterract/composition";
import type { CaptionType } from "@posterract/video-runtime";

/**
 * A color the preset paints with and lets the file override, in the order its
 * decoder reads `colors`. `defaultColor` is what that decoder falls back to,
 * so it is what the row shows for a slot the file has not filled; the runtime
 * constants are the source of truth for those values.
 */
export type CaptionColorSlot = {
  label: string;
  defaultColor: number;
};

export type CaptionPresetOption = {
  name: CaptionPresetName;
  label: string;
  /** One line on what it looks like, for the gallery card. */
  hint?: string;
  slots: CaptionColorSlot[];
};

/** The presets, in the order the select lists them. */
export const CAPTION_PRESET_OPTIONS: CaptionPresetOption[] = [
  { name: "classic", label: "Classic", slots: [] },
  { name: "cascade", label: "Cascade", slots: [] },
  {
    name: "spotlight",
    label: "Spotlight",
    slots: [{ label: "Highlight", defaultColor: 0x24D5FF }],
  },
  { name: "whisper", label: "Whisper", slots: [] },
  { name: "paper", label: "Paper", slots: [] },
  {
    name: "guinea",
    label: "Guinea",
    slots: [
      { label: "Color 1", defaultColor: 0xF55353 },
      { label: "Color 2", defaultColor: 0xFEB139 },
      { label: "Color 3", defaultColor: 0xF6F54D },
    ],
  },
  { name: "stark", label: "Stark", slots: [] },
  {
    name: "pop",
    label: "Pop",
    hint: "One word at a time, big",
    slots: [{ label: "Accent", defaultColor: 0x5DFF9D }],
  },
  {
    name: "karaoke",
    label: "Karaoke",
    hint: "The line fills in behind the voice",
    slots: [{ label: "Fill", defaultColor: 0x24D5FF }],
  },
  { name: "typewriter", label: "Typewriter", hint: "Arrives a word at a time", slots: [] },
  {
    name: "banner",
    label: "Banner",
    hint: "Short wide lines, low in frame",
    slots: [{ label: "Accent", defaultColor: 0xFFD166 }],
  },
  {
    name: "punch",
    label: "Punch",
    hint: "The said word swells out of the line",
    slots: [{ label: "Accent", defaultColor: 0xFF3355 }],
  },
  {
    name: "marquee",
    label: "Marquee",
    hint: "Two or three words, rolling",
    slots: [{ label: "Accent", defaultColor: 0x24D5FF }],
  },
];

/** The preset a caption with no `preset` of its own plays. */
export const DEFAULT_CAPTION_PRESET: CaptionPresetOption = CAPTION_PRESET_OPTIONS[0]!;

const BY_TYPE = new Map<CaptionType, CaptionPresetOption>(
  CAPTION_PRESET_OPTIONS.map((option) => [CAPTION_PRESETS[option.name]!, option]),
);

/**
 * The option for the type a `Caption` trait holds. Identity matters: the
 * select compares its value against the options it was given, so this hands
 * back the option itself rather than a copy.
 */
export function captionPresetOption(type: CaptionType | undefined): CaptionPresetOption {
  return (type === undefined ? undefined : BY_TYPE.get(type)) ?? DEFAULT_CAPTION_PRESET;
}
