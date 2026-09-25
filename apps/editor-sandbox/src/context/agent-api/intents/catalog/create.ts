/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_PRESETS } from '@/lib/layout-presets';
import { VALUE_DESCRIPTIONS } from '../../command-descriptions';
import { SHAPE_OPTIONS, SPOT } from './shared';

import type { FamilyDef } from '../types';

/** The formats a new scene can be: the Scene panel's presets, by a key the reader can name. */
export const SCENE_FORMATS: Record<string, { label: string; width: number; height: number; what: string }> = {
  vertical: { label: 'Short-form 9:16', width: 1080, height: 1920, what: 'Vertical 9:16 (1080×1920): TikTok, Reels, Shorts, a phone video, portrait.' },
  landscape: { label: 'Long-form 16:9', width: 1920, height: 1080, what: 'Landscape 16:9 (1920×1080): YouTube, widescreen, horizontal.' },
  square: { label: 'Square video 1:1', width: 1080, height: 1080, what: 'Square 1:1 (1080×1080).' },
  portrait45: { label: 'Vertical post 4:5', width: 1080, height: 1350, what: 'A 4:5 vertical post (1080×1350), an Instagram feed post.' },
  ultrawide: { label: 'Ultrawide 21:9', width: 1920, height: 823, what: 'Ultrawide 21:9 cinema.' },
  cinemascope: { label: 'CinemaScope 2.39:1', width: 1920, height: 803, what: 'CinemaScope 2.39:1, a wide movie look.' },
  dci4k: { label: 'DCI 4K 17:9', width: 4096, height: 2160, what: 'DCI 4K 17:9 (4096×2160), cinema 4K.' },
  anamorphic: { label: 'Anamorphic 2.00:1', width: 1920, height: 960, what: 'Anamorphic 2:1.' },
  twitter: { label: 'Twitter / X post', width: 1200, height: 675, what: 'A Twitter or X post (1200×675).' },
  linkedin: { label: 'LinkedIn post', width: 1200, height: 628, what: 'A LinkedIn post (1200×628).' },
  facebook: { label: 'Facebook post', width: 1200, height: 630, what: 'A Facebook post (1200×630).' },
  iphone16: { label: 'iPhone 16', width: 393, height: 852, what: 'An iPhone 16 screen, for a preview of an app.' },
  iphone17: { label: 'iPhone 17', width: 402, height: 874, what: 'An iPhone 17 screen.' },
  iphonePlus: { label: 'iPhone 16 Plus / Max', width: 430, height: 932, what: 'An iPhone Plus or Max screen.' },
  iphoneProMax: { label: 'iPhone 17 Pro Max', width: 440, height: 956, what: 'An iPhone 17 Pro Max screen.' },
  android: { label: 'Android', width: 412, height: 917, what: 'An Android phone screen.' },
  ipad: { label: 'iPad', width: 834, height: 1194, what: 'An iPad screen.' },
  laptop: { label: 'Laptop', width: 1440, height: 900, what: 'A laptop screen.' },
  desktop: { label: 'Desktop', width: 1440, height: 1024, what: 'A desktop screen.' },
};

/** Every preset of the Scene panel has a key here; the Instagram post is the 4:5 post. */
export const PRESETS_COVERED = ALL_PRESETS.every((preset) =>
  Object.values(SCENE_FORMATS).some((format) => format.width === preset.width && format.height === preset.height));

export const CREATE: FamilyDef = {
  id: 'create',
  label: 'Add',
  exclusive: true,
  ask:
    'Does the command ask to add something new that is not in the video yet — a shape, a text or title, a new scene, '
    + 'a file from the library (a clip, a picture, a logo, a song, a sound), a marker on the timeline, a mask, or an adjustment layer? '
    + 'For example "add a circle", "put a title at the top that says Sale", "new vertical scene", "add the drone clip", "drop a marker here". '
    + 'Not captions or subtitles, not a copy of something already there (duplicating), and not making something with AI.',
  slots: {
    shape_kind: { kind: 'choice', ask: 'Which shape does the command ask for?', options: SHAPE_OPTIONS },
    spot: SPOT,
    size: {
      kind: 'choice',
      ask: 'How big does the command say the new thing should be?',
      options: {
        tiny: 'Tiny, very small.',
        small: 'Small, little.',
        medium: 'Medium, normal size.',
        large: 'Large, big.',
        huge: 'Huge, very big, giant.',
        fill: 'Filling the whole frame, full screen.',
      },
    },
    color: { kind: 'color', ask: 'Which color does the command ask the new thing to be?' },
    when: { kind: 'when', ask: 'When does the command say the new thing should start, or the marker should go?' },
    side: { kind: 'number', text: 'Its size in pixels, or as a percentage of the frame.', units: ['px', '%'] },
    words: { kind: 'words', text: 'the words a new text says' },
    format: {
      kind: 'choice',
      ask: 'Which shape of frame does the command ask the new scene to be?',
      options: Object.fromEntries(Object.entries(SCENE_FORMATS).map(([key, format]) => [key, format.what])),
    },
    asset: { kind: 'asset', ask: "Which file from the project's library does the command mean?" },
    mask_shape: {
      kind: 'choice',
      ask: 'Which shape should the mask be?',
      options: { rectangle: 'A rectangle or square mask.', ellipse: 'A round, circle or oval mask.' },
    },
    effect_type: {
      kind: 'choice',
      ask: 'Which filter does the command ask the adjustment layer to put over everything?',
      options: { ...VALUE_DESCRIPTIONS.effectType! },
    },
  },
  intents: [
    {
      id: 'create.shape',
      label: 'Add a shape',
      text: {
        what: 'Add a new shape to the video: a rectangle, square, circle, oval, triangle, diamond, pentagon, hexagon, star or arrow.',
        notFor: 'Not a text, not a file from the library, not a new scene, and not turning a shape that is there into another kind.',
        examples: ['add a circle', 'put a big red star in the top right', 'draw a rectangle across the bottom', 'I need an arrow here', 'add a small blue square'],
      },
      uses: ['shape_kind', 'spot', 'size', 'side', 'color', 'when'],
      target: 'none',
      covers: ['createShape', 'rect', 'ellipse', 'polygon', 'solidPaint', 'canvas.component-tool'],
    },
    {
      id: 'create.text',
      label: 'Add a text',
      text: {
        what: 'Add a new text, title, heading or label to the video, with the words the command gives.',
        notFor: 'Not changing the words of a text that is already there, and not captions or subtitles.',
        examples: ['add a title that says Summer Sale', 'put some text at the bottom saying link in bio', 'add a heading', 'new text here', 'type big white words WILD STORM at the top'],
      },
      uses: ['words', 'spot', 'size', 'side', 'color', 'when'],
      target: 'none',
      covers: ['createText', 'text', 'canvas.text-tool'],
    },
    {
      id: 'create.scene',
      label: 'Add a scene',
      text: {
        what: 'Add a new, empty scene: a new frame to build a shot in, in a format such as vertical, landscape or square.',
        notFor: 'Not turning elements that are there into a scene, and not making a scene out of a clip.',
        examples: ['new scene', 'add a YouTube scene', 'make a new square frame', 'add a vertical scene called outro'],
      },
      uses: ['format', 'words'],
      target: 'none',
      covers: ['createScene', 'scene', 'canvas.frame-tool'],
    },
    {
      id: 'create.from-asset',
      label: 'Add from the library',
      text: {
        what: "Put a file from the project's library into the video: a clip, a picture, a logo, a song or a sound effect.",
        notFor: 'Not making a picture or a clip with AI, and not making a whole scene out of it.',
        examples: ['add the drone clip', 'put the logo in the corner', 'add the music', 'bring in the beach photo', 'use the intro video here'],
      },
      uses: ['asset', 'spot', 'when'],
      target: 'none',
      covers: ['insertAsset', 'video', 'image', 'audio', 'lottie', 'captions.src', 'videoPaint', 'imagePaint'],
    },
    {
      id: 'create.scene-from-asset',
      label: 'Make a scene from a file',
      text: {
        what: 'Make a new scene out of a clip or a picture from the library, sized to it.',
        examples: ['make a scene from the storm clip', 'turn the beach photo into its own scene', 'new scene with the drone video'],
      },
      uses: ['asset'],
      target: 'none',
      covers: ['insertMediaAsScenes'],
    },
    {
      id: 'create.marker',
      label: 'Add a marker',
      text: {
        what: 'Put a marker on the timeline at a moment, with a name if the command gives one.',
        notFor: 'Not the in or out point of the part to export.',
        examples: ['marker here called drop', 'add a marker at 5 seconds', 'mark this moment', 'drop a marker where the title ends'],
      },
      uses: ['when', 'words'],
      target: 'none',
      covers: ['addMarkerAt', 'marker', 'range.marker', 'time'],
    },
    {
      id: 'create.mask',
      label: 'Add a mask',
      text: {
        what: 'Mask an element with a shape, so only the part inside the shape shows.',
        notFor: 'Not a filter, and not cropping by filling or fitting its box.',
        examples: ['mask this with a rectangle', 'add a circle mask to the video', 'only show the middle of the clip'],
      },
      uses: ['mask_shape'],
      target: 'one',
      covers: ['addMask', 'mask'],
    },
    {
      id: 'create.adjustment-layer',
      label: 'Add an adjustment layer',
      text: {
        what: 'Add an adjustment layer: a filter laid over everything under it, such as a blur or black and white over the whole video.',
        notFor: 'Not a filter on one element.',
        examples: ['add an adjustment layer with a blur', 'put a black and white layer over everything', 'add a sepia layer over the whole video'],
      },
      uses: ['effect_type'],
      target: 'none',
      covers: ['adjustmentLayer', 'effect'],
    },
  ],
};
