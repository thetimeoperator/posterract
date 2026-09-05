/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Assets } from "./assets";
import { ExportsView } from "./exports-view";
import { useLayout } from "@/context/layout";
import { useEditorApi } from "@/context/agent-api";
import { createSignal, Show } from "solid-js";
import { toast } from "somoto";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import { ProjectMenu } from "./project-menu";
import { useProject } from "@/context/project";
import { cx } from "@/lib/cva";
import { PosterractCodePanel } from "@/components/posterract-code-panel";
import { GenerateLauncher, openGeneratePanel } from "@/components/genai";
import { createStoredSignal } from "@/lib/store";
import { store } from "@/init";

type LeftSection = "assets" | "exports";

/**
 * The left instrument: a rail of what the drawer can show, and the drawer.
 * The project name and the layout toggles moved to the command bar; the AI
 * buttons keep their place at the top of the drawer so a connected agent is
 * always in view.
 */
export function SidebarLeft() {
  const [section, setSection] = createStoredSignal(
    store.define<LeftSection>("layout.leftSection", "assets"),
  );

  return (
    <div class="flex h-full min-h-0 overflow-hidden">
      <div class="posterract-rail">
        <RailButton icon="folder-thumbnail" label="Assets" active={section() === "assets"} onClick={() => setSection("assets")} />
        <RailButton icon="film-video-export" label="Exports" active={section() === "exports"} onClick={() => setSection("exports")} />
        <RailButton icon="ai-generate" label="Generate with your keys" onClick={() => openGeneratePanel()} />
      </div>
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="posterract-agent-slot flex flex-col">
          <GenerateLauncher />
          <PosterractCodePanel />
        </div>
        <Show when={section() === "assets"}>
          <Assets />
        </Show>
        {/* Finished renders live on this computer; the library is where they are
            found again, and the only place one is sent to the cloud. */}
        <Show when={section() === "exports"}>
          <div class="flex min-h-0 flex-1 flex-col">
            <ExportsView />
          </div>
        </Show>
      </div>
    </div>
  );
}

function RailButton(props: { icon: string; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      class="posterract-rail-button"
      classList={{ "is-active": props.active }}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      <Icon name={props.icon} class="size-5" />
    </button>
  );
}

export function ElectronHeader() {
  const { isDesktop, isFullscreen } = useEditorApi();
  const { toggleTimeline, toggleUI } = useLayout();

  return (
    <Show when={isDesktop}>
      <div class="h-10 border-b border-border shrink-0 pr-4 pl-1.5 gap-1 relative flex items-center">
        <div class="flex-1 h-full data-[fullscreen=true]:flex-none transition-all duration-100 ease-out" data-fullscreen={isFullscreen()} />
        <div class="flex items-center gap-1 relative z-30" style="-webkit-app-region: no-drag;">
          <Button variant="ghost" size="icon" class="text-muted-foreground" onClick={toggleTimeline}>
            <Icon name="sidebar-timeline" />
          </Button>
          <Button variant="ghost" size="icon" class="text-muted-foreground" onClick={toggleUI}>
            <Icon name="sidebar" />
          </Button>
        </div>
      </div>
    </Show>
  )
}

type ProjectHeaderProps = {
  class?: string;
}

export function ProjectHeader(props: ProjectHeaderProps) {
  const project = useProject();
  const [projectNameDraft, setProjectNameDraft] = createSignal<string | null>(null);

  const handleProjectNameInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    setProjectNameDraft(event.currentTarget.value);
  };

  const handleFocusNameInput = (event: FocusEvent & { currentTarget: HTMLInputElement }) => {
    setProjectNameDraft(project.name());
    event.currentTarget.select();
  };

  const handleBlurNameInput = () => {
    setProjectNameDraft(null);
  };

  const handleKeyDownNameInput = async (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "Enter") {
      const input = event.currentTarget;
      const trimmedName = projectNameDraft()?.trim() ?? "";

      // The rename the folder follows: the project keeps its id, so the URL
      // and the open editor are untouched by the move.
      if (trimmedName.length > 0 && trimmedName !== project.name()) {
        try {
          await project.rename(trimmedName);
        } catch (e) {
          toast.error("Failed to rename project", { description: (e as Error).message });
        }
      }

      setProjectNameDraft(null);
      input.blur();
    }

    if (event.key === "Escape") {
      event.currentTarget.blur();
      setProjectNameDraft(null);
    }
  };

  return (
    <div class={cx("h-12 shrink-0 flex items-center gap-1 pr-4 pl-2.5", props.class)}>
      <ProjectMenu />
      <div class="flex items-center w-full">
        <input
          type="text"
          value={projectNameDraft() ?? project.name()}
          onInput={handleProjectNameInput}
          onFocus={handleFocusNameInput}
          onBlur={handleBlurNameInput}
          onKeyDown={handleKeyDownNameInput}
          placeholder="Project name"
          class="w-full bg-transparent focus-ring px-1 h-5 ml-1 rounded text-xs text-muted-foreground font-450 outline-none"
        />
      </div>
    </div>
  )
}

export function FloatingProjectHeader() {
  const { isDesktop } = useEditorApi();
  const { toggleUI } = useLayout();

  return (
    <div data-desktop={isDesktop} class="h-10 rounded-lg border border-border shrink-0 flex items-center px-2 gap-1 fixed top-4 data-[desktop=true]:top-10 left-4 z-30 bg-background shadow-lg">
      <ProjectMenu />
      <span class="text-xs text-muted-foreground font-450">Posterract Create</span>
      <Button variant="ghost" size="icon" class="text-muted-foreground ml-2" onClick={toggleUI}>
        <Icon name="sidebar" />
      </Button>
    </div>
  )
}
