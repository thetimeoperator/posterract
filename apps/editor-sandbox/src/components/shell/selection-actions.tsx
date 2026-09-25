/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from 'solid-js';
import { useWorld } from '@posterract/koota-solid';
import { Animation, AnimationPhase, Effect, Name, Paint, Shadow, Source, Stroke } from '@posterract/video-runtime';
import { animationOption } from '@/components/sidebar-right/inspector/animation-types';
import { effectOption } from '@/components/sidebar-right/inspector/effect-types';
import { toast } from 'somoto';
import { useDerived, useSelection } from '@/engine/hooks';
import { getClipFallbackName } from '@/engine/timeline';
import { revealInTimeline } from '@/engine/reveal-timeline';
import { stampedId } from '@/engine/delete-guard';
import { useLayout } from '@/context/layout';
import { useProject } from '@/context/project';
import { mainBridge } from '@/lib/ipc';
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { Button } from '@/components/ui/button';

export function SelectionActions() {
  const world = useWorld();
  const selection = useSelection();
  const project = useProject();
  const layout = useLayout();
  const target = () => selection.parts()[0] ?? selection.first() ?? selection.keyframes()[0];
  const targets = () => [...selection.nodes(), ...selection.parts(), ...selection.keyframes()];
  const sourceId = useDerived(() => target()?.get(Source)?.value);
  const name = useDerived(() => {
    const node = target();
    if (targets().length > 1) return `${targets().length} selected`;
    if (!node) return 'Scene overview';
    if (node.get(Name)?.value) return node.get(Name)!.value;
    const animation = node.get(Animation);
    if (animation) return `${animationOption(animation.type).label} · ${animation.phase === AnimationPhase.OUT ? 'Exit' : 'Entrance'}`;
    if (selection.parts().includes(node)) {
      if (node.has(Effect)) return effectOption(node.get(Effect)?.type).label;
      if (node.has(Stroke)) return 'Stroke';
      if (node.has(Shadow)) return 'Shadow';
      if (node.has(Paint)) return 'Fill';
    }
    return getClipFallbackName(world, node);
  });
  const revealSource = async () => {
    const node = target();
    const id = node && stampedId(node);
    if (!id) return;
    try {
      const found = await mainBridge.call(MAIN_CHANNELS.PROJECTS_SOURCE_LOCATE, { dir: project.dir(), id });
      if (!found) toast.error('This element could not be located in the project source');
    } catch (error) { toast.error('Could not reveal source', { description: (error as Error).message }); }
  };
  return <div class="posterract-selection-summary">
    <div><strong>{name()}</strong><span>{sourceId() ? 'Editable in project source' : 'Select a layer to get started'}</span></div>
    <Show when={target()}>
      <div class="posterract-selection-actions">
        <Button variant="ghost" size="small" onClick={() => { if (layout.timelineMinimized()) layout.toggleTimeline(); revealInTimeline(world, target()!); }}>Timeline ↗</Button>
        <Button variant="ghost" size="small" disabled={!sourceId() || !window.desktop} onClick={() => void revealSource()}>Code ↗</Button>
      </div>
    </Show>
  </div>;
}
