/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { ControlledTextField } from "@/components/ui/text-field";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { Keyframe } from "@/components/ui/keyframe";
import { useWorld } from "@posterract/koota-solid";
import { Computed, DEFAULT_TILT_PERSPECTIVE } from "@posterract/video-runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";

import type { AnimatableProperty } from "@posterract/composition";
import type { Entity } from "koota";

export type TiltRowProps = {
  node: Entity;
  onRemoveAddon(): void;
};

/**
 * The element turned in 3D: `rotationX` tips the top away, `rotationY` turns
 * the right side away, and `perspective` is how far the camera stands. All
 * three are props with keyframe diamonds, so a tilt is timeline rows like any
 * other move; each is unset again at its default.
 */
export function TiltRow(props: TiltRowProps) {
  const world = useWorld();
  const editor = useEditor();

  // Shown to a tenth: a track mid-move is a long decimal the field cannot fit.
  const tenth = (value: number) => Math.round(value * 10) / 10;
  const tiltX = useDerived(() => tenth(props.node.get(Computed)?.tiltX ?? 0));
  const tiltY = useDerived(() => tenth(props.node.get(Computed)?.tiltY ?? 0));
  const perspective = useDerived(() => Math.round(props.node.get(Computed)?.perspective ?? DEFAULT_TILT_PERSPECTIVE));

  const isDefault = createMemo(() => tiltX() === 0 && tiltY() === 0 && perspective() === DEFAULT_TILT_PERSPECTIVE);

  const write = (property: AnimatableProperty, value: number, unset: number) => {
    editor.editProperty(props.node, property, value === unset ? false : value);
    syncKeyframe(world, editor, props.node, property, value);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label="3D tilt"
        contentClass="grid grid-cols-2 gap-2"
      >
        <ControlledTextField
          icon={<Icon name="prop-x-position" />}
          value={tiltX()}
          onNumber={(value) => write("rotationX", value, 0)}
          step={1}
          unit="°"
          autoSelect
          sliderEnabled
          limitEvents
          keyframe={<Keyframe target={props.node} property="rotationX" />}
        />
        <ControlledTextField
          icon={<Icon name="prop-y-position" />}
          value={tiltY()}
          onNumber={(value) => write("rotationY", value, 0)}
          step={1}
          unit="°"
          autoSelect
          sliderEnabled
          limitEvents
          keyframe={<Keyframe target={props.node} property="rotationY" />}
        />
      </ContextMenuTrigger>
      <ControlRow label="Perspective">
        <ControlledTextField
          value={perspective()}
          onNumber={(value) => write("perspective", Math.max(0, value), DEFAULT_TILT_PERSPECTIVE)}
          min={0}
          step={50}
          unit="px"
          autoSelect
          sliderEnabled
          limitEvents
          keyframe={<Keyframe target={props.node} property="perspective" />}
        />
      </ControlRow>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={isDefault()}
          onSelect={() => {
            write("rotationX", 0, 0);
            write("rotationY", 0, 0);
            write("perspective", DEFAULT_TILT_PERSPECTIVE, DEFAULT_TILT_PERSPECTIVE);
          }}
        >
          Reset to Default
        </ContextMenuItem>
        <ContextMenuItem onSelect={props.onRemoveAddon}>
          Remove row
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
