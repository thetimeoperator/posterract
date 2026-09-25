/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Options several areas ask about in the same words. */

import { VALUE_DESCRIPTIONS } from '../../command-descriptions';

import type { OptionText, SlotSpec } from '../types';

/** The named spots in the frame (the `place` prop). */
export const PLACE_OPTIONS: Record<string, string> = { ...VALUE_DESCRIPTIONS.place! };

export const SPOT: SlotSpec = {
  kind: 'choice',
  ask: 'Where in the frame does the command say it should go?',
  options: PLACE_OPTIONS,
};

/** The shapes the Component tool draws, and the two that are a shape with equal sides. */
export const SHAPE_OPTIONS: Record<string, OptionText> = {
  rectangle: { what: 'A rectangle, a box, a bar or a banner.', examples: ['a rectangle', 'a box', 'a bar'] },
  square: { what: 'A square: a rectangle with equal sides.', examples: ['a square'] },
  ellipse: { what: 'An oval or ellipse.', examples: ['an oval', 'an ellipse'] },
  circle: { what: 'A circle, a dot or a round shape.', examples: ['a circle', 'a dot', 'a round shape'] },
  triangle: { what: 'A triangle.', examples: ['a triangle'] },
  diamond: { what: 'A diamond or rhombus.', examples: ['a diamond'] },
  pentagon: { what: 'A pentagon, five sides.', examples: ['a pentagon'] },
  hexagon: { what: 'A hexagon, six sides.', examples: ['a hexagon'] },
  star: { what: 'A star.', examples: ['a star'] },
  arrow: { what: 'An arrow.', examples: ['an arrow', 'an arrow pointing right'] },
};

export const DIRECTION_OPTIONS: Record<string, string> = {
  left: 'Toward the left.',
  right: 'Toward the right.',
  up: 'Upward, higher.',
  down: 'Downward, lower.',
};

export const AMOUNT: SlotSpec = { kind: 'amount', ask: 'How big a change does the command ask for?' };

/** Which way in time. */
export const TIME_DIRECTION: SlotSpec = {
  kind: 'choice',
  ask: 'Which way in time does the command ask for?',
  options: {
    earlier: 'Earlier, back, backwards, sooner, to the left on the timeline.',
    later: 'Later, forward, ahead, afterwards, to the right on the timeline.',
  },
};

/** The easings of motion. */
export const EASING_OPTIONS: Record<string, string> = { ...VALUE_DESCRIPTIONS.easing! };

/** The properties a keyframe track can animate, as a person would name them. */
export const KEYFRAME_PROPERTIES: Record<string, string> = {
  position: 'Its position: where it is, x and y together.',
  x: 'Its horizontal position only.',
  y: 'Its vertical position only.',
  scale: 'Its size, its scale.',
  width: 'Its width.',
  height: 'Its height.',
  rotation: 'Its rotation, how far it is turned.',
  opacity: 'Its opacity, how see-through it is.',
  color: 'Its color.',
  cornerRadius: 'How rounded its corners are.',
  volume: 'Its volume, how loud it is.',
  blur: 'How blurred it is.',
  offsetX: 'Its horizontal offset.',
  offsetY: 'Its vertical offset.',
  scaleX: 'Its horizontal stretch.',
  scaleY: 'Its vertical stretch.',
  trimStart: 'How much of a drawn line is hidden from its start.',
  trimEnd: 'How much of a drawn line shows up to its end.',
  trimOffset: 'Where along a drawn line the visible part sits.',
  morph: 'How far a shape has morphed into another.',
  progress: 'How far a diagram has drawn itself.',
  value: "A filter's strength.",
  offset: "A gradient stop's position.",
  cornerRadiusTopLeft: 'The roundness of the top left corner.',
  cornerRadiusTopRight: 'The roundness of the top right corner.',
  cornerRadiusBottomRight: 'The roundness of the bottom right corner.',
  cornerRadiusBottomLeft: 'The roundness of the bottom left corner.',
};

/** The animatable properties behind each spoken one ("position" is x and y). */
export const KEYFRAME_TRACKS: Record<string, string[]> = {
  position: ['x', 'y'],
};
