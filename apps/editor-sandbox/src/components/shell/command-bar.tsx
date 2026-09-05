/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The command bar: the one strip across the top of the editor.
 *
 * Wordmark and project on the left, the videos of this project in the
 * middle as chips (the same scene entities the canvas and timeline show, so
 * activating one moves every pane at once), and on the right the readouts
 * that used to head the inspector — save state and zoom — plus the layout
 * toggles that lived in the left panel's title row.
 */
import { createSignal, For } from "solid-js";
import { toast } from "somoto";
import { useWorld } from "@posterract/koota-solid";
import { Name, Scene, getParentNode } from "@posterract/video-runtime";
import { ProjectMenu } from "@/components/sidebar-left/project-menu";
import { InspectorHeader } from "@/components/sidebar-right/inspector/inspector-header";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useLayout } from "@/context/layout";
import { useProject } from "@/context/project";
import { useDerived, useEditor } from "@/engine/hooks";
import { useActiveScene } from "@/engine/hooks/use-active-scene";

import type { Entity } from "koota";

export function CommandBar() {
  const world = useWorld();
  const editor = useEditor();
  const project = useProject();
  const activeScene = useActiveScene();
  const { toggleTimeline, toggleUI, editorTheme, toggleEditorTheme } = useLayout();

  // Top-level scenes only: a scene nested inside another is a component of
  // that video, not a video of its own.
  const scenes = useDerived<Entity[]>(
    () => [...world.query(Scene)].filter((entity) => getParentNode(entity) === null),
    (prev, next) => prev.length === next.length && prev.every((entity, index) => entity === next[index]),
  );

  const [draft, setDraft] = createSignal<string | null>(null);

  const commitName = async (input: HTMLInputElement) => {
    const trimmed = draft()?.trim() ?? "";
    // The rename the folder follows: the project keeps its id, so the URL
    // and the open editor are untouched by the move.
    if (trimmed.length > 0 && trimmed !== project.name()) {
      try {
        await project.rename(trimmed);
      } catch (error) {
        toast.error("Failed to rename project", { description: (error as Error).message });
      }
    }
    setDraft(null);
    input.blur();
  };

  return (
    <div
      class="flex h-full items-center gap-2 pr-2"
      classList={{ "pl-2": true }}
      style="-webkit-app-region: drag;"
    >
      <div class="flex items-center gap-2" style="-webkit-app-region: no-drag;">
        <ProjectMenu />
        <span class="posterract-wordmark">POSTER<b>RACT</b></span>
        <span class="text-muted-foreground/40">/</span>
        <input
          type="text"
          class="posterract-bar-name"
          value={draft() ?? project.name()}
          placeholder="Project name"
          onInput={(event) => setDraft(event.currentTarget.value)}
          onFocus={(event) => {
            setDraft(project.name());
            event.currentTarget.select();
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commitName(event.currentTarget);
            if (event.key === "Escape") {
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
        />
      </div>

      {/* The videos in this project. */}
      <div class="mx-auto flex items-center gap-1.5" style="-webkit-app-region: no-drag;">
        <For each={scenes()}>
          {(scene, index) => (
            <button
              type="button"
              class="posterract-scene-chip"
              classList={{ "is-active": activeScene() === scene }}
              title={scene.get(Name)?.value?.trim() || "Untitled video"}
              onClick={() => editor.activate(scene)}
            >
              {String(index() + 1).padStart(2, "0")}
            </button>
          )}
        </For>
      </div>

      <div class="flex items-center gap-1" style="-webkit-app-region: no-drag;">
        <button
          type="button"
          class="posterract-theme-switch"
          classList={{ "is-frost": editorTheme() === "frost" }}
          onClick={toggleEditorTheme}
          title={editorTheme() === "frost" ? "Glass mode on — switch to Noir" : "Switch to Glass mode"}
          aria-pressed={editorTheme() === "frost"}
        >
          <span class="posterract-theme-switch-dot" />
          {editorTheme() === "frost" ? "Glass" : "Noir"}
        </button>
        <InspectorHeader />
        <Button variant="ghost" size="icon" class="text-muted-foreground" onClick={toggleTimeline} title="Collapse the timeline">
          <Icon name="sidebar-timeline" />
        </Button>
        <Button variant="ghost" size="icon" class="text-muted-foreground" onClick={toggleUI} title="Hide the instruments">
          <Icon name="sidebar" />
        </Button>
      </div>
    </div>
  );
}
