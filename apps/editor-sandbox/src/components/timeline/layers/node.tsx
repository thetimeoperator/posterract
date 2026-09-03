/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, For, Show } from 'solid-js';
import { useTag, useTrait, useWorld } from '@posterract/koota-solid';
import {
  ClipHeight,
  Expanded,
  Hidden,
  Locked,
  Hovering,
  Muted,
  Name,
  Selected,
  Soloed,
  findGeometryAsset,
  getEntityChildren,
  getParentEntity,
  isAdjustmentLayer,
  isCaption,
  isGroup,
  isMask,
  isScene,
  isSequence,
  isText,
  isVector,
  Geometry,
  GeometryType,
} from '@posterract/video-runtime';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'somoto';
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';
import { useProject } from '@/context/project';
import { requestDelete, stampedId } from '@/engine/delete-guard';
import { useEditor } from '@/engine/hooks';
import { bakeToKeyframes } from '@/engine/bake';

import type { AnimatableProperty } from '@posterract/composition';

/**
 * The properties the bake menu offers.
 *
 * Not every animatable name — a menu of thirty is not a menu. These are the
 * ones code-driven motion is nearly always one of, and any other property can
 * still be baked by an agent through `posterract_bake_keyframes`.
 */
const BAKEABLE: AnimatableProperty[] = ['x', 'y', 'rotation', 'scale', 'opacity', 'width', 'height'];
import { DEFAULT_CLIP_HEIGHT, MAX_CLIP_HEIGHT, MIN_CLIP_HEIGHT, getClipFallbackName } from '@/engine/timeline';
import { NESTED_INDENT_PX } from './config';
import { useLayerContext } from './context';
import { setRowHover } from './hover';

import type { World } from 'koota';
import type { TimelineNode } from '@posterract/video-runtime';
import type { LayerRowProps } from './layer';

export function NodeLayer(props: LayerRowProps) {
  const project = useProject();
  const [baking, setBaking] = createSignal<AnimatableProperty | null>(null);
  const world = useWorld();
  const editor = useEditor();

  const entity = () => props.layer.entity;

  const clipHeight = useTrait(entity, ClipHeight);
  const height = () => clipHeight()?.value ?? DEFAULT_CLIP_HEIGHT;

  const muted = useTag(entity, Muted);
  const soloed = useTag(entity, Soloed);
  const hidden = useTag(entity, Hidden);
  const hovering = useTag(entity, Hovering);
  const selected = useTag(entity, Selected);
  const controlsVisible = createMemo(() => hovering() || muted() || soloed() || hidden());

  const { resized: resizedSignal, drag } = useLayerContext();
  const [resized, setResized] = resizedSignal;

  const [editing, setEditing] = createSignal(false);
  let originalName = '';

  const nameTrait = useTrait(entity, Name);
  const name = createMemo(() => nameTrait()?.value || getClipFallbackName(world, entity()));
  const icon = createMemo(() => getLayerIcon(world, props.layer));

  const toggleMuted = (e?: Event) => {
    e?.stopPropagation();
    editor.editProperty(entity(), 'muted', !muted());
  };

  const toggleHidden = (e?: Event) => {
    e?.stopPropagation();
    editor.editProperty(entity(), 'hidden', !hidden());
  };

  const toggleExpanded = (e?: Event) => {
    e?.stopPropagation();
    editor.editProperty(entity(), 'expanded', !entity().has(Expanded));
  };

  /**
   * Solo is monitoring rather than composition — it says what you want to
   * hear right now, which the file has nothing to say about — so it is
   * written to the trait and only one node holds it.
   */
  const toggleSoloed = (e?: Event) => {
    e?.stopPropagation();

    const wasSoloed = soloed();
    for (const other of world.query(Soloed)) other.remove(Soloed);
    if (!wasSoloed) entity().add(Soloed);
  };

  /**
   * A press on a row selects it, shift-clicking to extend the selection. A
   * plain press also arms a drag: moving far enough turns the press into
   * dragging the layer to a new place in the tree.
   */
  const handleRowPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || resized() !== null) return;
    if ((e.target as HTMLElement | null)?.closest('button')) return;

    editor.select(entity(), { extend: e.shiftKey });
    if (!e.shiftKey) drag.begin(e, entity());
  };

  let resizeStartY = 0;
  let resizeStartHeight = 0;

  const handleResizeMove = (e: PointerEvent) => {
    const next = Math.max(MIN_CLIP_HEIGHT, Math.min(MAX_CLIP_HEIGHT, resizeStartHeight + e.clientY - resizeStartY));
    editor.editProperty(entity(), 'clipHeight', next);
  };

  const handleResizeEnd = () => {
    setResized(null);
    document.removeEventListener('pointermove', handleResizeMove);
    document.removeEventListener('pointerup', handleResizeEnd);
  };

  const handleResizeStart = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeStartY = e.clientY;
    resizeStartHeight = height();
    setResized(entity());

    document.addEventListener('pointermove', handleResizeMove);
    document.addEventListener('pointerup', handleResizeEnd);
  };

  /**
   * Open the project source where this element is written. The timeline and
   * the file are two views of one document; this is the shortest path between
   * them for anyone who would rather edit the TSX directly.
   */
  /**
   * Turn what a property actually does into a keyframe track.
   *
   * The values are sampled from an offline copy of the project — the same
   * world an export builds — so the track holds the numbers a render would
   * produce, not what the live preview happened to be showing.
   */
  const handleBake = async (property: AnimatableProperty) => {
    if (baking()) return;
    setBaking(property);
    try {
      const result = await bakeToKeyframes(world, editor, entity(), property, { dir: project.dir() });
      if (!result) {
        toast('Nothing to bake', {
          description: `This layer has no span, or ${property} is not animatable on it.`,
        });
        return;
      }
      toast.success(`Baked ${property}`, {
        description: `${result.keyframes} keyframes from ${result.sampled} frames. The original code is still in the source.`,
      });
    } catch (cause) {
      toast.error(`Could not bake ${property}`, {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBaking(null);
    }
  };

  const handleRevealInCode = () => {
    const id = stampedId(entity());
    if (!id) {
      toast.error('This layer has no source stamp yet', {
        description: 'Save the project once and try again.',
      });
      return;
    }
    void mainBridge
      .call(MAIN_CHANNELS.PROJECTS_SOURCE_LOCATE, { dir: project.dir(), id })
      .then((at) => {
        if (!at) toast.error('That element could not be found in the project source');
      })
      .catch((cause: unknown) => {
        toast.error('Could not open the source', {
          description: cause instanceof Error ? cause.message : String(cause),
        });
      });
  };

  // Same guard as the delete shortcut: a populated scene is confirmed and
  // kept in trash rather than removed on a menu click.
  const handleRemove = () => requestDelete(world, [entity()]);

  // Locking is a source-persisted property, so it survives a reload and an
  // agent reading the file can see the layer is protected.
  const locked = useTag(entity, Locked);
  const toggleLocked = () => editor.editProperty(entity(), 'locked', !locked());

  /**
   * The column reads top-down while the file reads bottom-up: the last child
   * of an element is the one drawn on top, so "front" is the end of the file
   * and "back" is the beginning.
   */
  const handleReorder = (target: 'front' | 'back') => {
    const parent = getParentEntity(entity());
    if (!parent) return;

    const siblings = getEntityChildren(world, parent).filter((sibling) => sibling !== entity());
    editor.reparent(entity(), parent, target === 'back' ? siblings[0] : undefined);
  };

  const startEditing = () => {
    originalName = name();
    setEditing(true);
  };

  const finishEditing = (input: HTMLInputElement) => {
    if (!editing()) return;
    // An empty name is not a name; the row falls back to what it had.
    if (!input.value.trim()) editor.editProperty(entity(), 'name', originalName);
    setEditing(false);
  };

  const handleNameInput = (e: InputEvent) => {
    editor.editProperty(entity(), 'name', (e.currentTarget as HTMLInputElement).value);
  };

  const handleNameKeyDown = (e: KeyboardEvent) => {
    // The canvas is listening for keys; a name being typed is not a shortcut.
    e.stopPropagation();
    const input = e.currentTarget as HTMLInputElement;

    if (e.key === 'Escape') {
      editor.editProperty(entity(), 'name', originalName);
      input.blur();
    } else if (e.key === 'Enter') {
      input.blur();
    }
  };

  const mountNameInput = (input: HTMLInputElement) => {
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        as="div"
        data-layer-row
        class="w-full text-muted-foreground group relative select-none"
        onPointerEnter={() => setRowHover(world, entity())}
        onPointerLeave={() => setRowHover(world, null)}
        onPointerDown={handleRowPointerDown}
        classList={{
          'bg-accent': selected(),
          'bg-accent/70': !selected() && hovering() && resized() === null && drag.dragging() === null,
          'bg-accent/40': !selected() && !(hovering() && resized() === null) && props.ancestorSelected,
          'opacity-60': drag.dragging() === entity(),
        }}
        style={{ height: height() + 'px' }}
      >
        <div class="w-full pl-0.5 pr-2 flex items-center justify-between h-full">
          <div
            data-layer-label
            class="flex-1 min-w-0 overflow-hidden"
            style={{
              'mask-image': controlsVisible() && !editing() ? 'linear-gradient(to right, #000 calc(100% - 1.25rem), transparent)' : undefined,
              '-webkit-mask-image': controlsVisible() && !editing() ? 'linear-gradient(to right, #000 calc(100% - 1.25rem), transparent)' : undefined,
            }}
          >
            <div
              class="flex items-center gap-0.5 w-max"
              style={{
                'padding-left': `${props.depth * NESTED_INDENT_PX}px`,
                transform: editing() ? 'none' : 'translateX(calc(var(--layer-x, 0px) * -1))',
              }}
            >
              {/*
                An expandable layer holds keyframe tracks or child clips.
                Revealing that only on hover hid the whole keyframe editor, so
                an expandable row always shows its chevron; only a leaf row's
                placeholder stays hover-only, which keeps the row aligned.
              */}
              <button
                disabled={!props.layer.expandable}
                onClick={toggleExpanded}
                class="size-4 shrink-0 flex items-center justify-center overflow-clip focus-ring rounded-sm"
                classList={{ 'invisible group-hover/layers:visible': !props.layer.expandable }}
              >
                <Show when={props.layer.expandable}>
                  <Icon name={props.expanded ? "chevron-down" : "chevron-right"} class="size-6 hover:text-foreground" />
                </Show>
              </button>
              <div class="size-4 shrink-0 flex items-center justify-center overflow-clip mr-0.5">
                <Icon name={icon()} class="size-6" />
              </div>
              <Show
                when={editing()}
                fallback={
                  <span class="text-xs px-0.5 shrink-0 whitespace-nowrap text-foreground" onDblClick={startEditing}>
                    {name()}
                  </span>
                }
              >
                <input
                  ref={mountNameInput}
                  type="text"
                  class="text-xs bg-input border border-primary rounded-sm outline-none px-0.5 w-32 text-foreground"
                  value={name()}
                  onInput={handleNameInput}
                  onKeyDown={handleNameKeyDown}
                  onBlur={(e) => finishEditing(e.currentTarget)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDblClick={(e) => e.stopPropagation()}
                />
              </Show>
            </div>
          </div>

          <div
            class="items-center flex gap-0.5 shrink-0 overflow-hidden group-hover:w-auto"
            classList={{
              'hidden': resized() !== null,
              'w-0': !(muted() || soloed() || hidden() || locked()),
              'w-auto': muted() || soloed() || hidden() || locked(),
            }}
          >
            <Tooltip placement="bottom">
              <TooltipTrigger
                as={Button}
                variant={locked() ? "on" : "ghost"}
                size="icon"
                class="invisible group-hover:visible"
                style={{ visibility: locked() ? 'visible' : undefined }}
                onClick={toggleLocked}
              >
                <Icon name={locked() ? "lock-closed" : "lock-open"} class="size-6" />
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent>{locked() ? "Unlock layer" : "Lock layer"}</TooltipContent>
              </TooltipPortal>
            </Tooltip>
            <Tooltip placement="bottom">
              <TooltipTrigger
                as={Button}
                variant={muted() ? "on" : "ghost"}
                size="icon"
                class="invisible group-hover:visible"
                style={{ visibility: muted() ? 'visible' : undefined }}
                onClick={toggleMuted}
              >
                <Icon name="mute" class="size-6" />
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent>{muted() ? "Unmute" : "Mute"}</TooltipContent>
              </TooltipPortal>
            </Tooltip>
            <Tooltip placement="bottom">
              <TooltipTrigger
                as={Button}
                variant={soloed() ? "on" : "ghost"}
                size="icon"
                class="invisible group-hover:visible"
                style={{ visibility: soloed() ? 'visible' : undefined }}
                onClick={toggleSoloed}
              >
                <Icon name="solo" class="size-6" />
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent>{soloed() ? "Unsolo" : "Solo"}</TooltipContent>
              </TooltipPortal>
            </Tooltip>
            <Tooltip placement="bottom">
              <TooltipTrigger
                as={Button}
                variant="ghost"
                size="icon"
                class="invisible group-hover:visible"
                onClick={toggleHidden}
                style={{ visibility: hidden() ? 'visible' : undefined }}
              >
                <Show when={!hidden()} fallback={<Icon name="eye-off" class="size-6" />}>
                  <Icon name="eye-on" class="size-6" />
                </Show>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent>{hidden() ? "Show" : "Hide"}</TooltipContent>
              </TooltipPortal>
            </Tooltip>
          </div>
        </div>

        {/* Drag the bottom edge to make the row taller. */}
        <div
          class="absolute bottom-0 left-0 right-0 h-[3px] cursor-ns-resize translate-y-0.5 z-20 group/resize"
          onPointerDown={handleResizeStart}
        >
          <div
            class="absolute left-0 right-0 top-px h-px transition-colors group-hover/resize:bg-primary"
            classList={{ 'bg-primary': resized() === entity() }}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent class="w-[160px]">
          <ContextMenuItem onSelect={toggleMuted}>{muted() ? 'Unmute' : 'Mute'}</ContextMenuItem>
          <ContextMenuItem onSelect={toggleSoloed}>{soloed() ? 'Unsolo' : 'Solo'}</ContextMenuItem>
          <ContextMenuItem onSelect={toggleHidden}>{hidden() ? 'Unhide' : 'Hide'}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => handleReorder('front')}>
            Bring to front
            <ContextMenuShortcut>]</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => handleReorder('back')}>
            Send to back
            <ContextMenuShortcut>[</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleRevealInCode}>Reveal in code</ContextMenuItem>
          <ContextMenuSub overlap gutter={4} shift={-8}>
            <ContextMenuSubTrigger>Bake to keyframes</ContextMenuSubTrigger>
            <ContextMenuPortal>
              <ContextMenuSubContent>
                <For each={BAKEABLE}>
                  {(property) => (
                    <ContextMenuItem
                      disabled={baking() !== null}
                      onSelect={() => void handleBake(property)}
                    >
                      {baking() === property ? `Baking ${property}…` : property}
                    </ContextMenuItem>
                  )}
                </For>
              </ContextMenuSubContent>
            </ContextMenuPortal>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleRemove}>Remove</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  )
}

function getLayerIcon(world: World, layer: TimelineNode) {
  const entity = layer.entity;

  if (isMask(entity)) return "mask-small";
  if (isAdjustmentLayer(entity)) return "adjustment-layer";
  if (isScene(entity)) return "scene-frame-small";
  if (isSequence(entity)) return "timeline-sequence-small";
  if (isGroup(entity)) return "group";
  if (isCaption(entity)) return "captions-small";
  if (isText(entity)) return "text-small";
  if (isVector(entity)) {
    return entity.get(Geometry)?.value === GeometryType.ELLIPSE ? "tool.ellipse-small" : "vector-small";
  }

  switch (findGeometryAsset(world, entity)?.type) {
    case 'IMAGE':
      return "image-small";
    case 'VIDEO':
    case 'SEQUENCE':
      return "video-small";
    case 'AUDIO':
      return "audio-small";
    case 'LOTTIE':
      return "lottie-small";
    default:
      return "rectangle-small";
  }
}
