/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Time } from "./types.js";

/** Frames per second of the canonical `Time` frame unit ("30f"). */
export const TIME_FPS = 30;

/**
 * A musical `Time` ("4b", "2bar", "1.5beats") as the beats and bars it
 * spells, or undefined for any other form. Musical time needs the scene's
 * tempo to become seconds, so `parseTime` does not read it; whoever knows the
 * tempo turns it into seconds with `musicalSeconds`.
 */
export function parseMusicalTime(value: unknown): { beats: number; bars: number } | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*(b|beat|beats|bar|bars)$/i);
  if (!match) return undefined;
  const amount = parseFloat(match[1]!);
  if (!Number.isFinite(amount)) return undefined;
  return match[2]!.toLowerCase().startsWith("bar") ? { beats: 0, bars: amount } : { beats: amount, bars: 0 };
}

/** Musical time in seconds at `bpm` with `meter` beats to the bar. */
export function musicalSeconds(time: { beats: number; bars: number }, bpm: number, meter = 4): number {
  if (!(bpm > 0)) return 0;
  return ((time.beats + time.bars * (meter > 0 ? meter : 4)) * 60) / bpm;
}

/**
 * Parses a `Time` value into seconds: plain numbers are seconds, "30f" is
 * frames at `TIME_FPS`, "MM:SS" / "HH:MM:SS" are clock strings. Values may be
 * negative. Returns undefined for anything unparsable.
 */
export function parseTime(value: Time | string | null | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  const str = value?.trim();
  if (typeof str !== "string" || str.length === 0) {
    return undefined;
  }

  // Frames, e.g. "-30f".
  if (/^-?\d+(?:\.\d+)?f$/i.test(str)) {
    return parseFloat(str) / TIME_FPS;
  }

  // MM:SS or HH:MM:SS.
  if (str.includes(":")) {
    const negative = str.startsWith("-");
    const parts = str.replace(/^-/, "").split(":").map(Number);

    if (parts.some((n) => !Number.isFinite(n))) {
      return undefined;
    }

    let seconds: number;
    if (parts.length === 2) {
      seconds = parts[0]! * 60 + parts[1]!;
    } else if (parts.length === 3) {
      seconds = parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
    } else {
      return undefined;
    }

    return negative ? -seconds : seconds;
  }

  // Plain seconds (may be fractional).
  const seconds = parseFloat(str);
  return Number.isFinite(seconds) ? seconds : undefined;
}
