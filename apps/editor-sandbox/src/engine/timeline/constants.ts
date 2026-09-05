/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { secondsToFrames } from "@posterract/video-runtime";

export const RULER_INTERVALS = [
  {
    numerator: secondsToFrames(600),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(300),
    denominator: 5,
  },
  {
    numerator: secondsToFrames(120),
    denominator: 4,
  },
  {
    numerator: secondsToFrames(60),
    denominator: 6,
  },
  {
    numerator: secondsToFrames(30),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(10),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(5),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(3),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(2),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(1),
    denominator: 10,
  },
  {
    numerator: 15,
    denominator: 5,
  },
  {
    numerator: 10,
    denominator: 10,
  },
  {
    numerator: 5,
    denominator: 5,
  },
];

// window.getComputedStyle(document.body).getPropertyValue('--background')

// The timeline is an instrument of glass over the canvas, so it paints no
// ground of its own: rows are darker strips, clips are lit capsules, and the
// one saturated thing on it is the neon needle.
export const COLORS = {
  background: {
    default: 'rgba(0, 0, 0, 0)',
    muted: 'rgba(0, 0, 0, 0.28)',
    accent: 'rgba(101, 255, 154, 0.07)',
  },
  border: {
    darker: 'rgba(234, 255, 243, 0.14)',
    input: 'rgba(234, 255, 243, 0.22)',
    ring: '#65ff9a',
    scrubber: '#65ff9a',
  },
  ruler: {
    tick: 'rgba(234, 255, 243, 0.16)',
    text: 'rgba(234, 255, 243, 0.42)',
  },
  clip: {
    group: {
      background: '#22302a',
      primary: '#35473d',
      foreground: '#e8f5ec',
    },
    video: {
      background: '#14302a',
      primary: '#a8f0c8', // Waveform
      foreground: '#dcf7e6', // Label
    },
    audio: {
      background: '#0c2f2a',
      primary: '#65ff9a',
      foreground: '#d6fff0',
    },
    caption: {
      background: '#0f2a1c',
      primary: 'rgba(101, 255, 154, 0.24)', // Word background
      foreground: '#eafff3',
    },
    image: {
      background: '#33261a',
      foreground: '#f6ede2',
    },
    text: {
      background: '#1f2a2c',
      foreground: '#eafff3',
    },
    shape: {
      background: '#2f2626',
      foreground: '#f3e9e9',
    },
    scene: {
      background: '#0f3330',
      primary: '#7cf7ff',
      foreground: '#dff8f6',
    },
    mask: {
      background: '#22332c',
      foreground: '#e6f5ea',
    },
    adjustment: {
      background: '#2a3324',
      foreground: '#eef5e4',
    },
    html: {
      background: '#1d3330',
      foreground: '#e2f5f0',
    },
    lottie: {
      background: '#2b3323',
      foreground: '#eef5e3',
    },
    vector: {
      background: '#173a30',
      foreground: '#dcf5ea',
    },
    failed: {
      background: '#2e1d1d',
      foreground: '#ff8a8a',
    },
  },
} as const;
