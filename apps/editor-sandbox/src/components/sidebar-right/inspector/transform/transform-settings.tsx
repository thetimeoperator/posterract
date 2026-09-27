/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createMemo, Show } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlledTextField } from "@/components/ui/text-field";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Keyframe } from "@/components/ui/keyframe";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTrait, useWorld } from "@posterract/koota-solid";
import {
  Computed,
  PLACEMENTS,
  Place,
  Tilt,
  Cache,
  KeyframeTrack,
  getParentEntity,
  getSceneAncestor,
  isAdjustmentLayer,
  isScene,
  isSequence,
  type Placement,
} from "@posterract/video-runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import { RotateRow } from "./rotate-row";
import { AnchorRow } from "./anchor-row";
import { OffsetRow } from "./offset-row";
import { ScaleRow } from "./scale-row";
import { SkewRow } from "./skew-row";
import { TiltRow } from "./tilt-row";
import { ConstraintsRow } from "./constraints-row";
import { createStoredSignal } from "@/lib/store";
import { store } from "@/init";

import type { Entity } from "koota";

type TransformSettingsProps = {
  selection: Entity[];
};

/** "Where it belongs" as a choice: no placement (the numbers decide), or one of the frame's named places. */
type PlaceOption = { value: Placement | null; label: string };

const PLACE_OPTIONS: PlaceOption[] = [
  { value: null, label: "By X / Y" },
  { value: "top-left", label: "Top left" },
  { value: "top", label: "Top" },
  { value: "top-right", label: "Top right" },
  { value: "upper-third", label: "Upper third" },
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "lower-third", label: "Lower third" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom", label: "Bottom" },
  { value: "bottom-right", label: "Bottom right" },
];

type TransformAddon = 'rotate' | 'tilt' | 'anchor' | 'offset' | 'scale' | 'skew' | 'constraints';

/** The paths a 3D tilt's tracks drive. */
const TILT_PATHS = new Set(['rotation.x', 'rotation.y', 'perspective']);
type TransformAddons = Partial<Record<TransformAddon, boolean>>;

/**
 * Where a node sits and how it is transformed there. Position, rotation,
 * offset and scale are props (`x`/`y`, `rotation`, `offsetX`/`offsetY`,
 * `scale` or `scaleX`/`scaleY`) written through the editor; anchor, flip,
 * skew and constraints have no JSX spelling and are written to their traits
 * alone, so they do not survive a recompile. The rows below Position are
 * opt-in and which ones are shown is app state, kept per user rather than
 * per node.
 */
export function TransformSettings(props: TransformSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  const [addons, setAddons] = createStoredSignal(
    store.define<TransformAddons>('transform.addons', {})
  );

  const positionX = useDerived(() => entity().get(Computed)?.positionX ?? 0);
  const positionY = useDerived(() => entity().get(Computed)?.positionY ?? 0);

  // Position is where the node is rather than a modifier of it, so it is
  // written out even at 0, the way a drag on the canvas writes it.
  const updatePositionX = (x: number) => {
    editor.editProperty(entity(), 'x', x);
    syncKeyframe(world, editor, entity(), 'x', x);
  };

  const updatePositionY = (y: number) => {
    editor.editProperty(entity(), 'y', y);
    syncKeyframe(world, editor, entity(), 'y', y);
  };

  /**
   * Where the element belongs in the frame, when the source says that rather
   * than `x`/`y` (`place="lower-third"`). The fields above show where that
   * comes to; typing into them — like dragging the element — replaces the
   * placement with those numbers (see `DocumentEditor.editProperty`), and
   * choosing a place here puts it back. Only something inside a scene has a
   * frame to be placed in.
   */
  const placement = useTrait(entity, Place);
  const placeable = createMemo(() => !isScene(entity()) && !isSequence(entity()) && getSceneAncestor(entity()) !== null);
  const place = createMemo<PlaceOption>(() => {
    const current = placement();
    if (!current) return PLACE_OPTIONS[0]!;
    const name = (Object.keys(PLACEMENTS) as Placement[]).find(
      (key) => PLACEMENTS[key][0] === current.fx && PLACEMENTS[key][1] === current.fy,
    );
    return PLACE_OPTIONS.find((option) => option.value === name) ?? PLACE_OPTIONS[0]!;
  });
  // One number in the panel: the inset of both axes, or of the horizontal one when they differ.
  const inset = () => placement()?.insetX ?? 0;

  const updatePlace = (next: PlaceOption | null) => {
    if (next === null || next.value === place().value) return;
    if (next.value !== null) {
      editor.editProperty(entity(), 'place', next.value);
      return;
    }
    // Back to numbers: the ones it is showing, so it does not jump.
    editor.editProperty(entity(), 'x', Math.round(positionX()));
  };

  const updateInset = (value: number) => {
    const next = Math.round(value);
    editor.editProperty(entity(), 'inset', next === 0 ? false : next);
  };

  // Mirrors the runtime's own rule (see resolveConstraintOffsets): a sequence
  // is not a spatial parent, so look above it, and constraints only mean
  // something against a scene's frame.
  const supportsConstraints = createMemo(() => {
    const node = entity();
    if (isSequence(node) || isAdjustmentLayer(node)) return false;

    let parent = getParentEntity(node);
    while (parent !== null && isSequence(parent)) {
      parent = getParentEntity(parent);
    }

    return parent !== null && isScene(parent);
  });

  // A tilt the source already has — as a prop or as a track — shows its row
  // whether or not it was added here: a 3D turn is easy to miss otherwise.
  const tilted = useDerived(() => {
    const node = entity();
    if (node.has(Tilt)) return true;
    return (node.get(Cache)?.keyframeTracks ?? []).some((track) => {
      const settings = track.get(KeyframeTrack);
      return settings?.target === node && TILT_PATHS.has(settings.property);
    });
  });
  const showAddon = (addon: TransformAddon) => addons()[addon] === true || (addon === 'tilt' && tilted());
  const toggleAddon = (addon: TransformAddon, on: boolean) => {
    setAddons({ ...addons(), [addon]: on });
  };

  return (
    <PanelSection
      title="Transform"
      actions={
        <Show when={!showAddon('rotate') || !showAddon('tilt') || !showAddon('anchor') || !showAddon('offset') || !showAddon('scale') || !showAddon('skew') || !showAddon('constraints')}>
          <DropdownMenu placement="bottom-end">
            <Tooltip>
              <TooltipTrigger<typeof DropdownMenuTrigger>
                as={(triggerProps: object) => (
                  <DropdownMenuTrigger<typeof Button>
                    {...triggerProps}
                    as={(buttonProps) => (
                      <Button size="icon" variant="ghost" class="text-muted-foreground" {...buttonProps}>
                        <Icon name="plus-add" />
                      </Button>
                    )}
                  />
                )}
              />
              <TooltipContent>Add transform</TooltipContent>
            </Tooltip>
            <DropdownMenuContent>
              <Show when={!showAddon('rotate')}>
                <DropdownMenuItem onSelect={() => toggleAddon('rotate', true)}>
                  Rotate
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('tilt')}>
                <DropdownMenuItem onSelect={() => toggleAddon('tilt', true)}>
                  3D tilt
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('constraints')}>
                <DropdownMenuItem onSelect={() => toggleAddon('constraints', true)}>
                  Constraints
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('anchor')}>
                <DropdownMenuItem onSelect={() => toggleAddon('anchor', true)}>
                  Anchor
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('offset')}>
                <DropdownMenuItem onSelect={() => toggleAddon('offset', true)}>
                  Offset
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('scale')}>
                <DropdownMenuItem onSelect={() => toggleAddon('scale', true)}>
                  Scale
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('skew')}>
                <DropdownMenuItem onSelect={() => toggleAddon('skew', true)}>
                  Skew
                </DropdownMenuItem>
              </Show>
            </DropdownMenuContent>
          </DropdownMenu>
        </Show>
      }
    >
      <ControlRow label="Position">
        <div class="grid grid-cols-2 gap-2">
          <ControlledTextField
            icon={<Icon name="prop-x-position" />}
            keyframe={<Keyframe target={entity()} property="x" />}
            value={positionX()}
            onNumber={updatePositionX}
            step={1}
            autoSelect
            sliderEnabled
            limitEvents
          />
          <ControlledTextField
            icon={<Icon name="prop-y-position" />}
            keyframe={<Keyframe target={entity()} property="y" />}
            value={positionY()}
            onNumber={updatePositionY}
            step={1}
            autoSelect
            sliderEnabled
            limitEvents
          />
        </div>
      </ControlRow>

      <Show when={placeable()}>
        <ControlRow label="Place">
          <div class="grid grid-cols-2 gap-2">
            <Select<PlaceOption>
              value={place()}
              onChange={updatePlace}
              options={PLACE_OPTIONS}
              optionValue="label"
              optionTextValue="label"
              itemComponent={(itemProps) => (
                <SelectItem item={itemProps.item}>{itemProps.item.rawValue.label}</SelectItem>
              )}
            >
              <SelectTrigger>
                <SelectValue class="text-xs">{place().label}</SelectValue>
              </SelectTrigger>
              <SelectPortal>
                <SelectContent />
              </SelectPortal>
            </Select>
            <Show when={place().value !== null}>
              <ControlledTextField
                icon={<span class="text-[10px] text-muted-foreground">in</span>}
                value={inset()}
                onNumber={updateInset}
                step={1}
                min={0}
                autoSelect
                sliderEnabled
                limitEvents
              />
            </Show>
          </div>
        </ControlRow>
      </Show>

      <Show when={showAddon('constraints') && supportsConstraints()}>
        <ConstraintsRow node={entity()} />
      </Show>

      <Show when={showAddon('rotate')}>
        <RotateRow node={entity()} onRemoveAddon={() => toggleAddon('rotate', false)} />
      </Show>

      <Show when={showAddon('tilt')}>
        <TiltRow node={entity()} onRemoveAddon={() => toggleAddon('tilt', false)} />
      </Show>

      <Show when={showAddon('anchor')}>
        <AnchorRow node={entity()} onRemoveAddon={() => toggleAddon('anchor', false)} />
      </Show>

      <Show when={showAddon('offset')}>
        <OffsetRow node={entity()} onRemoveAddon={() => toggleAddon('offset', false)} />
      </Show>

      <Show when={showAddon('scale')}>
        <ScaleRow node={entity()} onRemoveAddon={() => toggleAddon('scale', false)} />
      </Show>

      <Show when={showAddon('skew')}>
        <SkewRow node={entity()} onRemoveAddon={() => toggleAddon('skew', false)} />
      </Show>
    </PanelSection>
  );
}
