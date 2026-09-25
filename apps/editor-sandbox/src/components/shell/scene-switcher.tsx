/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show } from 'solid-js';
import { useTrait, useWorld } from '@posterract/koota-solid';
import { Name, Scene, getParentNode } from '@posterract/video-runtime';
import { useActiveScene } from '@/engine/hooks/use-active-scene';
import { useDerived, useEditor } from '@/engine/hooks';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import type { Entity } from 'koota';

export function SceneSwitcher() {
  const world = useWorld();
  const editor = useEditor();
  const active = useActiveScene();
  const name = useTrait(active, Name);
  const scenes = useDerived<Entity[]>(
    () => [...world.query(Scene)].filter(entity => getParentNode(entity) === null),
    (a, b) => a.length === b.length && a.every((entity, i) => entity === b[i]),
  );
  const activeName = () => name()?.value.trim() || 'Untitled video';
  return (
    <Show when={scenes().length > 1} fallback={
      <div class="posterract-scene-switcher" aria-label={`Active video: ${activeName()}`}>
        <small class="posterract-active-video-label">Active video</small><span>{activeName()}</span>
      </div>
    }>
    <DropdownMenu placement="bottom-start">
      <DropdownMenuTrigger class="posterract-scene-switcher" aria-label="Choose active video" title="Choose which video's timeline to edit and which video to export.">
        <small class="posterract-active-video-label">Active video</small>
        <span>{activeName()}</span>
        <Icon name="chevron-down" class="size-4 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="min-w-64 max-w-96">
          <For each={scenes()}>{(scene, i) => (
            <DropdownMenuItem onSelect={() => editor.activate(scene)}>
              <span class="font-mono text-muted-foreground">{String(i() + 1).padStart(2, '0')}</span>
              <span class="truncate">{scene.get(Name)?.value.trim() || 'Untitled video'}</span>
              {active() === scene && <span class="ml-auto text-primary">Active</span>}
            </DropdownMenuItem>
          )}</For>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
    </Show>
  );
}
