/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { EFFECT_TYPES } from "@posterract/video-reconciler";

import type { EffectType as EffectName } from "@posterract/composition";
import type { EffectType } from "@posterract/video-runtime";

/**
 * What an `<effect>`'s `value` means, which is what a type switch has to
 * answer for: the amount filters share a 0-1 scale, `blur` is a radius in px
 * and `hueRotate` an angle in degrees. Within a unit the value carries over,
 * across one it cannot.
 */
export type EffectUnit = "amount" | "px" | "deg" | "strength";

export type EffectOption = {
  name: EffectName;
  label: string;
  unit: EffectUnit;
  /** What "Add effect", and a switch into this type, authors. */
  value: number;
  /** What the value row is called when "Amount"/"Radius"/"Angle" would not say it. */
  valueLabel?: string;
  /** The finishing effects' second number (`size`): its row, and what it means. */
  size?: { label: string; unit: "px" | "amount"; value: number };
  /** Whether the effect has a direction (`angle`). */
  angle?: boolean;
};

/** The effect types, in menu order. */
export const EFFECT_OPTIONS: EffectOption[] = [
  { name: "blur", label: "Layer Blur", unit: "px", value: 8 },
  { name: "brightness", label: "Brightness", unit: "amount", value: 0.8 },
  { name: "contrast", label: "Contrast", unit: "amount", value: 0.8 },
  { name: "grayscale", label: "Grayscale", unit: "amount", value: 0.5 },
  { name: "hueRotate", label: "Hue Rotation", unit: "deg", value: 100 },
  { name: "invert", label: "Invert", unit: "amount", value: 0.5 },
  { name: "saturate", label: "Saturate", unit: "amount", value: 0.8 },
  { name: "sepia", label: "Sepia", unit: "amount", value: 0.5 },
  { name: "grain", label: "Film Grain", unit: "amount", value: 0.15, size: { label: "Size", unit: "px", value: 1.5 } },
  { name: "vignette", label: "Vignette", unit: "amount", value: 0.5, size: { label: "Reach", unit: "amount", value: 0.5 } },
  { name: "glow", label: "Glow", unit: "strength", value: 0.6, size: { label: "Radius", unit: "px", value: 24 } },
  { name: "chromaticAberration", label: "Colour Fringe", unit: "px", value: 4, valueLabel: "Offset" },
  { name: "directionalBlur", label: "Directional Blur", unit: "px", value: 24, valueLabel: "Length", angle: true },
];

/** What the panel's plus inserts, spelled out. */
export const DEFAULT_EFFECT: EffectOption = EFFECT_OPTIONS[0]!;

const BY_TYPE = new Map<EffectType, EffectOption>(
  EFFECT_OPTIONS.map((option) => [EFFECT_TYPES[option.name]!, option]),
);

/**
 * The option for the type an `Effect` trait holds. Identity matters: the
 * type select compares its value against the array it was given, so this
 * hands back the option itself rather than a copy.
 */
export function effectOption(type: EffectType | undefined): EffectOption {
  return (type === undefined ? undefined : BY_TYPE.get(type)) ?? DEFAULT_EFFECT;
}
