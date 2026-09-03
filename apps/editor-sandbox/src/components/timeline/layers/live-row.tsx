/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, For, Show } from 'solid-js';
import { toast } from 'somoto';
import { useWorld } from '@posterract/koota-solid';
import { KEYFRAME_TRACK_HEIGHT } from '@/engine/timeline';
import { bakeToKeyframes } from '@/engine/bake';
import { useEditor } from '@/engine/hooks';
import { useProject } from '@/context/project';
import { NESTED_INDENT_PX } from './config';

import type { AnimatableProperty } from '@posterract/composition';
import type { LayerRowProps } from './layer';

/**
 * Which of an element's live props the runtime can sample and bake. A prop
 * that drives something other than an animatable channel — a `src`, a label —
 * is still worth naming on the row, but there is no track to turn it into.
 */
const BAKEABLE = new Set<string>([
  'x', 'y', 'rotation', 'scale', 'scaleX', 'scaleY', 'opacity', 'width', 'height',
  'blur', 'volume', 'cornerRadius', 'progress', 'morph', 'trimStart', 'trimEnd', 'trimOffset',
]);

/**
 * A row for motion that lives in the code.
 *
 * `x={progress() * 200}` moves the canvas and leaves the timeline empty, so a
 * clip that is plainly animating looks static and there is nothing to grab.
 * This row is the timeline admitting the motion exists, naming the props it
 * comes from, and offering the one thing that makes it editable here: baking
 * a prop into a keyframe track, which then wins over the code value.
 *
 * The source is never rewritten. The expression stays exactly where it was —
 * baking adds a track beside it, and deleting the track gives the code back.
 */
export function LiveLayer(props: LayerRowProps) {
  const world = useWorld();
  const editor = useEditor();
  const project = useProject();
  const [baking, setBaking] = createSignal<string | null>(null);

  const names = () => (props.layer.name ?? '').split(',').map((name) => name.trim()).filter(Boolean);

  const bake = async (property: string) => {
    if (baking()) return;
    setBaking(property);
    try {
      const result = await bakeToKeyframes(
        world,
        editor,
        props.layer.entity,
        property as AnimatableProperty,
        { dir: project.dir() },
      );
      if (!result) {
        toast('Nothing to bake', { description: `This layer has no span, or ${property} is not animatable on it.` });
        return;
      }
      toast.success(`Baked ${property}`, {
        description: `${result.keyframes} keyframes from ${result.sampled} frames. The original code is still in the source.`,
      });
    } catch (cause) {
      toast.error(`Could not bake ${property}`, {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBaking(null);
    }
  };

  return (
    <div
      class="flex w-full items-center justify-between pl-0.5 pr-2 text-muted-foreground"
      style={{ height: KEYFRAME_TRACK_HEIGHT + 'px' }}
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
          {/*
            Named for what it is rather than "live": the useful fact is that
            this motion is in the file, not on the timeline.
          */}
          <span class="shrink-0 whitespace-nowrap px-0.5 text-xs text-foreground">From code</span>
          <For each={names()}>
            {(name) => (
              <Show
                when={BAKEABLE.has(name)}
                fallback={<span class="shrink-0 rounded bg-input px-1 font-mono text-xxs">{name}</span>}
              >
                <button
                  type="button"
                  disabled={baking() !== null}
                  onClick={() => void bake(name)}
                  title={`Bake ${name} into keyframes`}
                  class="shrink-0 rounded bg-input px-1 font-mono text-xxs hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  {baking() === name ? `${name}…` : name}
                </button>
              </Show>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
