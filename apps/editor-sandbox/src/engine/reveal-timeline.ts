/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Expanded, buildTimelineLayers, getActiveEntity, getParentNode, getSceneAncestor, isScene, type TimelineNode } from '@posterract/video-runtime';
import { getDocumentEditor } from './editor';
import { setTimelineDetail } from './timeline/detail';
import { getNodeHeight } from './timeline/layout';
import { setScrollY } from './timeline/view';
import type { Entity, World } from 'koota';

export function revealInTimeline(world: World, target: Entity): void {
  const editor = getDocumentEditor(world);
  const scene = isScene(target) ? target : getSceneAncestor(target) ?? getActiveEntity(world);
  if (!scene) return;
  editor.activate(scene);
  setTimelineDetail('everything');
  let parent = getParentNode(target);
  while (parent && parent !== scene) {
    if (!parent.has(Expanded)) editor.editProperty(parent, 'expanded', true);
    parent = getParentNode(parent);
  }
  let top = 0;
  const find = (nodes: TimelineNode[]): number | null => {
    for (const node of nodes) {
      if (node.entity === target && node.kind !== 'component') return top;
      top += getNodeHeight(node);
      const found = find(node.children);
      if (found !== null) return found;
    }
    return null;
  };
  const found = find(buildTimelineLayers(world, scene, 'everything'));
  if (found !== null) setScrollY(world, scene, Math.max(0, found - 40));
}
