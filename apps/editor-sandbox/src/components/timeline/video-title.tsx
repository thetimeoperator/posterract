/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { useTrait } from "@posterract/koota-solid";
import { Name } from "@posterract/video-runtime";
import { Icon } from "@/components/ui/icon";
import { useActiveScene } from "@/engine/hooks/use-active-scene";

/**
 * A stable header for the lower workspace. The scene entity is shared by the
 * canvas, layers, timeline, and mixer, so switching videos updates every pane
 * and this title in the same reactive turn.
 */
export function VideoTimelineTitle() {
  const activeScene = useActiveScene();
  const name = useTrait(activeScene, Name);
  const title = createMemo(() => name()?.value.trim() || "Untitled video");

  return (
    <div class="col-span-full grid h-8 min-h-8 grid-cols-[264px_1px_minmax(0,1fr)_1px_264px] bg-sidebar/95">
      <div class="flex items-center px-3 text-[9px] font-semibold tracking-[0.18em] text-muted-foreground/70">
        LAYERS
      </div>
      <div class="bg-border-strong" />
      <div class="flex min-w-0 items-center gap-2 px-3" title={title()}>
        <Icon name="film-video-export" class="size-3.5 text-primary" />
        <span class="shrink-0 text-[9px] font-semibold tracking-[0.18em] text-primary/75">
          ACTIVE VIDEO
        </span>
        <span class="truncate text-[11px] font-medium text-foreground">{title()}</span>
      </div>
      <div class="bg-border-strong" />
      <div class="flex items-center px-3 text-[9px] font-semibold tracking-[0.18em] text-muted-foreground/70">
        AUDIO MIXER
      </div>
    </div>
  );
}
