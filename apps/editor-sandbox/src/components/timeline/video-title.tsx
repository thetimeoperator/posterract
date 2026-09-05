/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, For, Show } from "solid-js";
import { useTrait, useWorld } from "@posterract/koota-solid";
import { Computed, FrameRate, Name, Scene, getParentNode, store } from "@posterract/video-runtime";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveScene } from "@/engine/hooks/use-active-scene";
import { useDerived, useEditor } from "@/engine/hooks";
import { useLayout } from "@/context/layout";
import { Button } from "@/components/ui/button";

import type { Entity } from "koota";

/** `MM:SS` for a scene's own length. */
function duration(frames: number, frameRate: number): string {
  const total = Math.max(0, Math.round(frames / frameRate));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * A stable header for the lower workspace, and the way between videos.
 *
 * The scene entity is shared by the canvas, layers, timeline and mixer, so
 * activating one from here updates every pane in the same reactive turn. A
 * project with several videos previously had no way to switch between them
 * except finding the scene on the canvas.
 */
export function VideoTimelineTitle() {
  const world = useWorld();
  const editor = useEditor();
  const activeScene = useActiveScene();
  const { mixerOpen, toggleMixer, toggleTimeline } = useLayout();
  const frameRate = useTrait(world, FrameRate);
  const name = useTrait(activeScene, Name);
  const title = createMemo(() => name()?.value.trim() || "Untitled video");

  // Top-level scenes only: a scene nested inside another is a component of
  // that video, not a video of its own.
  const scenes = useDerived<Entity[]>(
    () => [...world.query(Scene)].filter((entity) => getParentNode(entity) === null),
    (prev, next) => prev.length === next.length && prev.every((entity, index) => entity === next[index]),
  );

  return (
    <div class="grid h-8 min-h-8 grid-cols-[220px_1px_minmax(0,1fr)] border-b border-border">
      <div class="flex items-center px-3 text-[9px] font-semibold tracking-[0.18em] text-muted-foreground/70">
        LAYERS
      </div>
      <div class="bg-border-strong" />
      <div class="flex min-w-0 items-center gap-2 px-3">
        <Icon name="film-video-export" class="size-3.5 text-primary" />
        <span class="shrink-0 text-[9px] font-semibold tracking-[0.18em] text-primary/75">
          ACTIVE VIDEO
        </span>
        <DropdownMenu placement="bottom-start">
          <DropdownMenuTrigger
            class="flex min-w-0 items-center gap-1 rounded px-1 text-[11px] font-medium text-foreground hover:bg-accent focus-ring"
            title={title()}
          >
            <span class="truncate">{title()}</span>
            <Show when={scenes().length > 1}>
              <Icon name="chevron-down" class="size-4 shrink-0 text-muted-foreground" />
            </Show>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent class="w-[240px]">
              <For each={scenes()}>
                {(scene) => {
                  const label = scene.get(Name)?.value?.trim() || "Untitled video";
                  const frames = store(world, Computed).duration[scene.id()] ?? 0;
                  return (
                    <DropdownMenuItem onSelect={() => editor.activate(scene)}>
                      <span class="truncate">{label}</span>
                      <span class="ml-auto shrink-0 text-xxs text-muted-foreground">
                        {duration(frames, frameRate()?.value ?? 30)}
                      </span>
                    </DropdownMenuItem>
                  );
                }}
              </For>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenu>
        {/* The dock's own controls: the mixer pop-over and Peek. */}
        <div class="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="small"
            class="h-6 px-2 text-[10px] tracking-[0.08em] uppercase text-muted-foreground"
            classList={{ 'text-primary': mixerOpen() }}
            onClick={toggleMixer}
            title="Audio mixer"
          >
            Mixer
          </Button>
          <Button
            variant="ghost"
            size="small"
            class="h-6 px-2 text-[10px] tracking-[0.08em] uppercase text-muted-foreground"
            onClick={toggleTimeline}
            title="Collapse the dock to a strip"
          >
            Peek
          </Button>
        </div>
      </div>
    </div>
  );
}
