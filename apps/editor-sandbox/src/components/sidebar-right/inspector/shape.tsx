/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";
import { useWorld } from "@posterract/koota-solid";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { Select, SelectContent, SelectIconTrigger, SelectItem, SelectPortal } from "@/components/ui/select";
import { useDerived } from "@/engine/hooks";
import { SHAPES, changeShape, isReshapeable, shapeKindOf, shapeOfKind } from "@/engine/shapes";

import type { Entity } from "koota";
import type { ShapeKind } from "@/engine/shapes";

/**
 * Which shape a rectangle, an ellipse or a polygon is, and the menu that turns
 * it into another — box, fill, strokes and animation all kept.
 */
export function ShapePicker(props: { entity: Entity }) {
  const world = useWorld();
  const kind = useDerived(() => shapeKindOf(world, props.entity));
  const current = () => {
    const value = kind();
    return value ? shapeOfKind(value) : null;
  };

  return (
    <ControlRow label="Type">
      <div>
        <Select<ShapeKind>
          value={kind()}
          onChange={(value) => {
            if (value && value !== kind()) changeShape(world, props.entity, value);
          }}
          options={SHAPES.map((shape) => shape.kind)}
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              <span class="flex items-center gap-1.5">
                <Icon name={shapeOfKind(itemProps.item.rawValue).icon} class="size-5 text-muted-foreground" />
                {shapeOfKind(itemProps.item.rawValue).label}
              </span>
            </SelectItem>
          )}
        >
          <SelectIconTrigger
            icon={<Icon name={current()?.icon ?? "tool.polygon"} class="size-5" />}
            valueClass="text-xxs flex-1"
          >
            {current()?.label ?? "Custom"}
          </SelectIconTrigger>
          <SelectPortal>
            <SelectContent class="w-44 overscroll-contain" />
          </SelectPortal>
        </Select>
      </div>
    </ControlRow>
  );
}

/** A rectangle's Shape section: the vectors have theirs (see `VectorSettings`). */
export function ShapeSettings(props: { selection: Entity[] }) {
  const entity = () => props.selection[0];

  return (
    <Show when={props.selection.length === 1 && entity() && isReshapeable(entity()!)}>
      <PanelSection title="Shape">
        <ShapePicker entity={entity()!} />
      </PanelSection>
    </Show>
  );
}
