/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Show, onCleanup, onMount } from "solid-js";
import { isInputTarget } from "@/utils";
import { useEditorApi } from "@/context/agent-api";
import { FileMenu } from "./file-menu";
import { EditMenu } from "./edit-menu";
import { ViewMenu } from "./view-menu";
import { ToolMenu } from "./tool-menu";
import { useNavigate } from "@solidjs/router";
import { posterractIcon } from "@/assets/brand";

export function ProjectMenu() {
  const { isDesktop } = useEditorApi();
  const navigate = useNavigate();

  const handleOpenProjects = () => {
    (document.activeElement as HTMLElement)?.blur?.();
    navigate("/");
  };

  const handleBackToPosterract = () => {
    (document.activeElement as HTMLElement)?.blur?.();
    window.parent.postMessage({ type: "posterract-editor-navigate", path: "/continuum" }, "*");
  };

  /**
   * Leaving the editor is the app's command rather than the runtime's, so its
   * key is bound here, with the item that offers it.
   */
  const handleShortcut = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
    if (event.key.toLowerCase() !== "d" || isInputTarget(event)) return;

    event.preventDefault();
    handleOpenProjects();
  };

  onMount(() => {
    window.addEventListener("keydown", handleShortcut);
    onCleanup(() => window.removeEventListener("keydown", handleShortcut));
  });

  return (
    <>
      <DropdownMenu placement="bottom-start">
        <DropdownMenuTrigger
          as="button"
          type="button"
          class="flex items-center gap-0 h-7 rounded-md text-muted-foreground outline-none focus-ring hover:text-foreground data-expanded:text-foreground"
        >
          <img
            src={posterractIcon}
            alt=""
            class="size-6 shrink-0 rounded-md object-cover shadow-[0_0_14px_rgba(96,246,177,0.14)]"
          />
          <div class="flex items-center justify-center overflow-clip h-6 w-4">
            <Icon name="chevron-down" class="size-6" />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent class="w-[196px]">
            <DropdownMenuItem onSelect={handleOpenProjects}>
              All projects
              <DropdownMenuShortcut>⇧⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleBackToPosterract}>
              Back to Posterract
            </DropdownMenuItem>
            <DropdownMenuSeparator />

            <div>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>File</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent class="w-[196px]">
                    <FileMenu />
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Edit</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent class="w-[196px]">
                    <EditMenu />
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>View</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent class="w-[216px]">
                    <ViewMenu />
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Tool</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent class="w-[172px]">
                    <ToolMenu />
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            </div>

            <Show when={isDesktop}>
              <DropdownMenuItem disabled>Posterract desktop runtime</DropdownMenuItem>
            </Show>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>
    </>
  );
}
