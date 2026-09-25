/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For } from 'solid-js';
import { useWorld } from '@posterract/koota-solid';
import { useLayout } from '@/context/layout';
import { Button } from '@/components/ui/button';
import { TIMELINE_DETAILS, timelineDetail, setTimelineDetail } from '@/engine/timeline/detail';
import { zoomTimelineIn, zoomTimelineOut, zoomTimelineToFit } from '@/engine/timeline/zoom';

export function VideoTimelineTitle() {
  const world = useWorld();
  const { mixerOpen, toggleMixer, toggleTimeline } = useLayout();
  return (
    <div class="posterract-timeline-heading">
      <div class="posterract-timeline-heading-label"><strong>Timeline</strong><span>Layers & motion</span></div>
      <div class="posterract-detail-switch" role="group" aria-label="Timeline detail">
        <For each={TIMELINE_DETAILS}>{detail => (
          <button type="button" aria-pressed={timelineDetail() === detail.value} title={detail.hint} onClick={() => setTimelineDetail(detail.value)}>{detail.label}</button>
        )}</For>
      </div>
      <div class="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="small" class="px-2" aria-label="Zoom timeline out" onClick={() => zoomTimelineOut(world)}>−</Button>
        <Button variant="ghost" size="small" class="px-2" onClick={() => zoomTimelineToFit(world)} title="Fit the active video in the timeline">Fit</Button>
        <Button variant="ghost" size="small" class="px-2" aria-label="Zoom timeline in" onClick={() => zoomTimelineIn(world)}>+</Button>
        <Button variant="ghost" size="small" aria-pressed={mixerOpen()} onClick={toggleMixer}>Mixer</Button>
        <Button variant="ghost" size="small" onClick={toggleTimeline} aria-label="Collapse timeline">Collapse</Button>
      </div>
    </div>
  );
}
