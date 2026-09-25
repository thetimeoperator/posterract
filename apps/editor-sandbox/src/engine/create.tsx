/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Making a shape or a text, with the defaults the tools give them.
 *
 * The Component and Text tools used to hold this inside their pointer
 * handler, so anything else that wanted to add a shape — the voice bar, an
 * agent — had to guess at the sizes, the fill and the naming. It lives here
 * now, and the overlay calls it, so what a person draws and what a command
 * adds are the same element.
 */

import { Text } from '@posterract/video-reconciler';
import { Computed, getNextName, store } from '@posterract/video-runtime';

import { ShapeElement, shapeOfKind } from './shapes';

import type { Entity, World } from 'koota';
import type { DocumentEditor } from './editor';
import type { ShapeKind } from './shapes';

/** What the Component tool gives a shape it draws with one click. */
export const SHAPE_DEFAULTS = { width: 300, height: 300, color: '#E0E0E0' } as const;

/** What the Text tool gives a text: white, the word "Text", and a size read off the scene. */
export const TEXT_DEFAULTS = { color: '#FFFFFF', words: 'Text' } as const;

/** The font size the Text tool picks inside `parent`: about a twenty-second of the frame's height. */
export function textSizeIn(world: World, parent: Entity | null): number {
  const height = parent ? store(world, Computed).height[parent.id()] ?? 0 : 0;
  return height ? Math.max(8, Math.round(height / 22.5)) : 16;
}

/** The name the tools would give a new shape: "Star 2", "Rect 3". */
export const shapeName = (world: World, kind: ShapeKind): string =>
  getNextName(world, kind === 'rectangle' ? 'Rect' : shapeOfKind(kind).label);

export interface NewShape {
  kind: ShapeKind;
  parent: Entity;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  /** Where it starts on the timeline, in seconds; left to its parent when unset. */
  start?: number;
  /** How long it lasts, in seconds. */
  end?: number;
  /** A named spot in the frame instead of x and y. */
  place?: string;
}

/** Adds a shape as the Component tool draws it, and returns it. */
export function insertShape(world: World, editor: DocumentEditor, shape: NewShape): Entity | null {
  const name = shape.name ?? shapeName(world, shape.kind);
  const [entity] = editor.insertElement(shape.parent, () => (
    <ShapeElement
      kind={shape.kind}
      name={name}
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
      color={shape.color ?? SHAPE_DEFAULTS.color}
    />
  ));
  if (!entity) return null;
  place(editor, entity, shape);
  return entity;
}

export interface NewText {
  parent: Entity;
  words?: string;
  name?: string;
  x: number;
  y: number;
  /** A text sizes itself to its words unless it is given a box. */
  width?: number;
  height?: number;
  fontSize?: number;
  color?: string;
  start?: number;
  end?: number;
  place?: string;
}

/** Adds a text as the Text tool draws it, and returns it. */
export function insertText(world: World, editor: DocumentEditor, text: NewText): Entity | null {
  const name = text.name ?? getNextName(world, 'Text');
  const fontSize = text.fontSize ?? textSizeIn(world, text.parent);
  const size = text.width && text.height ? { width: text.width, height: text.height } : {};
  const [entity] = editor.insertElement(text.parent, () => (
    <Text name={name} x={text.x} y={text.y} {...size} fontSize={fontSize} color={text.color ?? TEXT_DEFAULTS.color}>
      {text.words ?? TEXT_DEFAULTS.words}
    </Text>
  ));
  if (!entity) return null;
  place(editor, entity, text);
  return entity;
}

/** The timing and the named spot a new element was asked for, written after it exists. */
function place(editor: DocumentEditor, entity: Entity, options: { place?: string; start?: number; end?: number }): void {
  if (options.place) editor.editProperty(entity, 'place', options.place);
  if (options.start !== undefined) editor.editProperty(entity, 'start', options.start);
  if (options.end !== undefined) editor.editProperty(entity, 'end', options.end);
}
