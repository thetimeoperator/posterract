/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { KEYFRAME_TRACK_HEIGHT } from '@/engine/timeline';
import { Keyframe } from '@/components/ui/keyframe';
import { useEditor } from '@/engine/hooks';
import { NESTED_INDENT_PX } from './config';
import { formatProperty } from './keyframe';

import type { AnimatableProperty } from '@posterract/composition';
import type { LayerRowProps } from './layer';

/**
 * A knob nothing keyframes yet — one of the numbers canvas code, a shader or
 * a repeater reads. It is a row so it can be grabbed: the diamond adds the
 * first keyframe, and from then on it is a track like any other.
 */
export function KnobLayer(props: LayerRowProps) {
  const editor = useEditor();
  // `knob.tilt`, `uniform.amount`, or a repeater's own `radius`.
  const property = () => (props.layer.name ?? '') as AnimatableProperty;
  // An author's knob keeps the name their code reads (`phase`); a repeater's
  // own numbers read as the inspector and their tracks name them ("Tilt Y").
  const label = () => (property().includes('.') ? property().split('.').pop() ?? '' : formatProperty(property()));

  return (
    <div
      class="flex w-full items-center justify-between pl-0.5 pr-2 text-muted-foreground"
      style={{ height: KEYFRAME_TRACK_HEIGHT + 'px' }}
      onClick={() => editor.select(props.layer.entity)}
    >
      <div data-layer-label class="min-w-0 flex-1 overflow-hidden">
        <div
          class="flex w-max items-center gap-1"
          style={{
            'padding-left': `${props.depth * NESTED_INDENT_PX}px`,
            transform: 'translateX(calc(var(--layer-x, 0px) * -1))',
          }}
        >
          <div class="size-4 shrink-0" />
          <div class="size-4 shrink-0" />
          <span class="shrink-0 whitespace-nowrap px-0.5 text-xs text-foreground">{label()}</span>
          <span class="shrink-0 rounded bg-input px-1 font-mono text-xxs">knob</span>
        </div>
      </div>
      <Keyframe target={props.layer.entity} property={property()} />
    </div>
  );
}

/**
 * One of the scene's own settings — its motion blur, its tempo — as a row, so
 * the complete index says how the scene is finished as well as what is in it.
 * Clicking it opens the scene's settings.
 */
export function SettingLayer(props: LayerRowProps) {
  const editor = useEditor();
  return (
    <div
      class="flex w-full cursor-pointer items-center pl-0.5 pr-2 text-muted-foreground hover:text-foreground"
      style={{ height: KEYFRAME_TRACK_HEIGHT + 'px' }}
      onClick={() => editor.select(props.layer.entity)}
    >
      <div data-layer-label class="min-w-0 flex-1 overflow-hidden">
        <div
          class="flex w-max items-center gap-1"
          style={{
            'padding-left': `${props.depth * NESTED_INDENT_PX}px`,
            transform: 'translateX(calc(var(--layer-x, 0px) * -1))',
          }}
        >
          <div class="size-4 shrink-0" />
          <span class="shrink-0 whitespace-nowrap px-0.5 text-xs">{props.layer.name}</span>
        </div>
      </div>
    </div>
  );
}
