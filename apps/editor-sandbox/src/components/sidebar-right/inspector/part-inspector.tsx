/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, Switch, Match } from 'solid-js';
import { Animation, Effect, Paint, Stroke, Shadow, LottieSlot, Geometry, Group, AdjustmentLayer, getParentEntity } from '@posterract/video-runtime';
import { useDerived, useEditor } from '@/engine/hooks';
import { AnimationInspector } from './animations';
import { EffectsSettings } from './effects';
import { FillsSettings } from './fills';
import { StrokesSettings } from './strokes';
import { ShadowsSettings } from './shadows';
import { LottieSettings } from './lottie';
import { Button } from '@/components/ui/button';
import type { Entity } from 'koota';

export function partOwner(part: Entity): Entity | null {
  let parent = getParentEntity(part);
  while (parent && !parent.has(Geometry) && !parent.has(Group) && !parent.has(AdjustmentLayer)) parent = getParentEntity(parent);
  return parent;
}

/** Timeline parts use the same source-writing controls as their owning layer. */
export function PartInspector(props: { part: Entity }) {
  const editor = useEditor();
  const owner = useDerived(() => partOwner(props.part));
  return <Show when={owner()} keyed>{node => (
    <>
      <div class="px-4 py-3"><Button variant="ghost" size="small" onClick={() => editor.select(node)}>← Back to layer</Button></div>
      <Switch fallback={<p class="px-4 text-xs text-muted-foreground">Select the owning layer to edit this property.</p>}>
        <Match when={props.part.has(Animation)}><AnimationInspector inline animation={props.part} node={node} onClose={() => editor.select(node)} /></Match>
        <Match when={props.part.has(Stroke)}><StrokesSettings selection={[node]} /></Match>
        <Match when={props.part.has(Shadow)}><ShadowsSettings selection={[node]} /></Match>
        <Match when={props.part.has(Paint)}><FillsSettings selection={[node]} /></Match>
        <Match when={props.part.has(Effect)}><EffectsSettings selection={[node]} /></Match>
        <Match when={props.part.has(LottieSlot)}><LottieSettings selection={[node]} /></Match>
      </Switch>
    </>
  )}</Show>;
}
