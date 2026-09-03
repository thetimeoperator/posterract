/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from 'solid-js';
import { useTag, useWorld } from '@posterract/koota-solid';
import { Hovering, Selected } from '@posterract/video-runtime';
import { Icon } from '@/components/ui/icon';
import { useEditor } from '@/engine/hooks';
import { KEYFRAME_TRACK_HEIGHT } from '@/engine/timeline';
import { NESTED_INDENT_PX } from './config';
import { setRowHover } from './hover';

import type { LayerRowProps } from './layer';

/**
 * A heading for the elements one of the project's own components produced.
 *
 * A component compiles away — `<Panel>` becomes the rects and texts it
 * returns — so without this the timeline is a flat list of pieces and the
 * thing the author actually wrote is nowhere. The row is a heading, not a
 * container: the clips under it are the real elements, each still editable
 * and still writing to its own place in the source.
 *
 * Collapsing it is what makes it worth having on a long composition, so the
 * toggle drives every element in the run rather than only the first.
 */
export function ComponentLayer(props: LayerRowProps) {
  const world = useWorld();
  const editor = useEditor();

  const entity = () => props.layer.entity;
  const hovering = useTag(entity, Hovering);
  const selected = useTag(entity, Selected);

  const toggle = () => {
    const next = !props.expanded;
    for (const child of props.layer.children) {
      editor.editProperty(child.entity, 'expanded', next);
    }
  };

  return (
    <div
      class="w-full pl-0.5 pr-2 flex items-center justify-between text-muted-foreground"
      classList={{
        'bg-accent': selected(),
        'bg-accent/70': !selected() && hovering(),
        'bg-accent/40': !selected() && !hovering() && props.ancestorSelected,
      }}
      onPointerEnter={() => setRowHover(world, entity())}
      onPointerLeave={() => setRowHover(world, null)}
      style={{ height: KEYFRAME_TRACK_HEIGHT + 'px' }}
    >
      <div data-layer-label class="flex-1 min-w-0 overflow-hidden">
        <div
          class="flex items-center gap-0.5 w-max"
          style={{
            'padding-left': `${props.depth * NESTED_INDENT_PX}px`,
            transform: 'translateX(calc(var(--layer-x, 0px) * -1))',
          }}
        >
          <div class="size-4 shrink-0" />
          <button
            onClick={toggle}
            class="size-4 shrink-0 flex items-center justify-center overflow-clip rounded-sm focus-ring mr-0.5"
          >
            <Icon name={props.expanded ? 'chevron-down' : 'chevron-right'} class="size-6 hover:text-foreground" />
          </button>
          {/*
            Angle brackets because that is how it is written in the file. The
            row names a component, not a layer, and should not be mistaken for
            one that can be selected, renamed, or dragged.
          */}
          <span class="shrink-0 whitespace-nowrap px-0.5 font-mono text-xs text-primary">
            {`<${props.layer.name ?? 'Component'}>`}
          </span>
          <Show when={props.layer.children.length > 1}>
            <span class="shrink-0 pl-1 text-xxs tabular-nums">{props.layer.children.length}</span>
          </Show>
        </div>
      </div>
    </div>
  );
}
