/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { For } from "solid-js";
import { Library, Tool, ToolType } from "@posterract/video-runtime";
import { useWorld } from "@posterract/koota-solid";
import { useTool } from "@/engine";
import { importFiles, pickFiles } from "@/engine/asset-actions";
import { insertMediaAsScenes, insertSounds, isFrameable, SCENE_GAP, sizeOf } from "@/engine/new-scene";
import { findEmptyPlacement } from "@/engine/placement";
import { SHAPES, drawnShape, setDrawnShape, shapeOfKind } from "@/engine/shapes";
import { useLayout } from "@/context/layout";

export function Toolbar() {
  const world = useWorld();
  const { uiVisible } = useLayout();
  const selectedTool = useTool();

  const handleToolChange = (tool: ToolType) => {
    world.set(Tool, { value: tool });
  }

  /**
   * Media from the computer: each picture or video becomes a frame of its own
   * beside the work already on the canvas, and sound joins the frame being
   * worked on.
   */
  const uploadMedia = async () => {
    const library = world.get(Library);
    if (!library) return;

    const files = await pickFiles({ accept: "image/*,video/*,audio/*" });
    if (!files.length) return;

    const assets = await importFiles(library, files, "");
    const media = assets.filter(isFrameable);
    const [first] = media;
    if (first) {
      const { width, height } = sizeOf(first);
      insertMediaAsScenes(world, media, findEmptyPlacement(world, width, height, SCENE_GAP));
    }
    insertSounds(world, assets.filter((asset) => asset.type === "AUDIO"));
  }

  return (
    <div
      class="posterract-canvas-tools absolute rounded-lg p-1 bg-background border border-border-strong flex gap-1 items-center z-10"
      role="toolbar" aria-label="Canvas tools"
      style={{ top: "var(--canvas-tools-top, 72px)", right: "var(--canvas-tools-right, 24px)", display: uiVisible() ? undefined : "none" }}
    >
        <div class="flex gap-1">
          <Tooltip placement="bottom">
            <TooltipTrigger
              as={Button}
              size="icon-square"
              class={[ToolType.MOVE, ToolType.HAND].includes(selectedTool()) ? 'text-foreground' : 'text-muted-foreground'}
              variant={[ToolType.MOVE, ToolType.HAND].includes(selectedTool()) ? 'default' : 'ghost'}
              aria-label={selectedTool() === ToolType.HAND ? "Pan canvas" : "Select and move"}
              onClick={() => handleToolChange(
                selectedTool() === ToolType.HAND ? ToolType.HAND : ToolType.MOVE
              )}
            >
              <Icon name={selectedTool() === ToolType.HAND ? 'hand' : 'move'} />
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent shortcut={selectedTool() === ToolType.HAND ? 'H' : 'V'}>
                {selectedTool() === ToolType.HAND ? 'Hand' : 'Move'}
              </TooltipContent>
            </TooltipPortal>
          </Tooltip>
          <DropdownMenu placement="bottom-start">
            <Tooltip placement="bottom">
              <TooltipTrigger<typeof DropdownMenuTrigger>
                as={(triggerProps: object) => (
                  <DropdownMenuTrigger<typeof Button>
                    {...triggerProps}
                    as={(buttonProps) => (
                      <Button {...buttonProps} aria-label="Select or pan tool" size="icon-select" variant="ghost" class="text-muted-foreground">
                        <Icon name="chevron-down" />
                      </Button>
                    )}
                  />
                )}
              />
              <TooltipPortal>
                <TooltipContent>Select tool</TooltipContent>
              </TooltipPortal>
            </Tooltip>
            <DropdownMenuPortal>
              <DropdownMenuContent>
                <DropdownMenuItem class="px-0 pr-2 gap-0.5" onSelect={() => handleToolChange(ToolType.MOVE)}>
                  <div classList={{ "visible": selectedTool() === ToolType.MOVE }} class="invisible">
                    <Icon name="confirm-check" class="text-foreground" />
                  </div>
                  <Icon name="move-small" class="text-foreground" />
                  <span class="min-w-12 mx-1">Move</span>
                  <DropdownMenuShortcut>V</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem class="px-0 pr-2 gap-0.5" onSelect={() => handleToolChange(ToolType.HAND)}>
                  <div classList={{ "visible": selectedTool() === ToolType.HAND }} class="invisible">
                    <Icon name="confirm-check" class="text-foreground" />
                  </div>
                  <Icon name="hand" class="text-foreground" />
                  <span class="min-w-12 mx-1">Hand</span>
                  <DropdownMenuShortcut>H</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
        </div>
        <Separator orientation="vertical" class="min-h-5" />
        <Tooltip placement="bottom">
          <TooltipTrigger
            as={Button}
            size="icon-square"
            variant={selectedTool() === ToolType.SCENE ? 'default' : 'ghost'}
            aria-label="Draw a scene" onClick={() => handleToolChange(ToolType.SCENE)}
            class={selectedTool() === ToolType.SCENE ? 'text-foreground' : 'text-muted-foreground'}
          >
            <Icon name="frame" class="size-5" />
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent shortcut="F">Frame</TooltipContent>
          </TooltipPortal>
        </Tooltip>
        <div class="flex gap-1">
          <Tooltip placement="bottom">
            <TooltipTrigger
              as={Button}
              size="icon-square"
              variant={selectedTool() === ToolType.RECT ? 'default' : 'ghost'}
              aria-label="Draw a component" onClick={() => handleToolChange(ToolType.RECT)}
              class={selectedTool() === ToolType.RECT ? 'text-foreground' : 'text-muted-foreground'}
            >
              <Icon name={shapeOfKind(drawnShape()).icon} />
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent shortcut="R">Component</TooltipContent>
            </TooltipPortal>
          </Tooltip>
          <DropdownMenu placement="bottom-start">
            <Tooltip placement="bottom">
              <TooltipTrigger<typeof DropdownMenuTrigger>
                as={(triggerProps: object) => (
                  <DropdownMenuTrigger<typeof Button>
                    {...triggerProps}
                    as={(buttonProps) => (
                      <Button {...buttonProps} aria-label="Choose a shape" size="icon-select" variant="ghost" class="text-muted-foreground">
                        <Icon name="chevron-down" />
                      </Button>
                    )}
                  />
                )}
              />
              <TooltipPortal>
                <TooltipContent>Shapes</TooltipContent>
              </TooltipPortal>
            </Tooltip>
            <DropdownMenuPortal>
              <DropdownMenuContent>
                <For each={SHAPES}>
                  {(shape) => (
                    <DropdownMenuItem
                      class="px-0 pr-2 gap-0.5"
                      onSelect={() => {
                        setDrawnShape(shape.kind);
                        handleToolChange(ToolType.RECT);
                      }}
                    >
                      <div classList={{ "visible": drawnShape() === shape.kind }} class="invisible">
                        <Icon name="confirm-check" class="text-foreground" />
                      </div>
                      <Icon name={shape.icon} class="text-foreground" />
                      <span class="min-w-12 mx-1">{shape.label}</span>
                    </DropdownMenuItem>
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
        </div>
        <Tooltip placement="bottom">
          <TooltipTrigger
            as={Button}
            size="icon-square"
            variant={selectedTool() === ToolType.TEXT ? 'default' : 'ghost'}
            aria-label="Add text" onClick={() => handleToolChange(ToolType.TEXT)}
            class={selectedTool() === ToolType.TEXT ? 'text-foreground' : 'text-muted-foreground'}
          >
            <Icon name="tool.text" />
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent shortcut="T">Text</TooltipContent>
          </TooltipPortal>
        </Tooltip>
        <Separator orientation="vertical" class="min-h-5" />
        <Tooltip placement="bottom">
          <TooltipTrigger
            as={Button}
            size="icon-square"
            variant="ghost"
            aria-label="Upload media" onClick={() => void uploadMedia()}
            class="text-muted-foreground"
          >
            <Icon name="tool.add-media" class="size-5" />
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent>Upload media</TooltipContent>
          </TooltipPortal>
        </Tooltip>
    </div>
  );
}
