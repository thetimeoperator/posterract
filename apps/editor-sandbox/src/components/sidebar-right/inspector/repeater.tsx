/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show } from "solid-js";
import { useTrait, useWorld } from "@posterract/koota-solid";
import { FrameRate, Knobs, REPEATER_KNOBS, REPEATER_LAYOUTS, Repeater, colorToHex, framesToSeconds } from "@posterract/video-runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlRow } from "@/components/ui/control-group";
import { Keyframe } from "@/components/ui/keyframe";
import { ControlledTextField, TextField, TextFieldInput } from "@/components/ui/text-field";
import {
  Select, SelectContent, SelectItem, SelectPortal, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import type { AnimatableProperty } from "@posterract/composition";
import type { Entity } from "koota";

type RepeaterSettingsProps = { selection: Entity[] };

type NumberRow = { name: keyof typeof REPEATER_KNOBS; label: string; step: number; min?: number; max?: number };

// The numbers, grouped the way a person thinks about them: what the copies
// are, where they sit, the wave through them, the camera looking at them.
const GROUPS: { title: string; rows: NumberRow[] }[] = [
  {
    title: "Copies",
    rows: [
      { name: "count", label: "Count", step: 1, min: 0, max: 5000 },
      { name: "spacing", label: "Spacing", step: 1 },
      { name: "radius", label: "Radius", step: 1 },
      { name: "tube", label: "Tube", step: 1 },
      { name: "columns", label: "Columns", step: 1, min: 0 },
      { name: "morph", label: "Morph", step: 0.01, min: 0, max: 1 },
    ],
  },
  {
    title: "Ripple",
    rows: [
      { name: "ripple", label: "Height", step: 1 },
      { name: "rippleFrequency", label: "Crests", step: 0.1 },
      { name: "ripplePhase", label: "Phase", step: 0.05 },
    ],
  },
  {
    title: "Camera",
    rows: [
      { name: "tiltX", label: "Tilt X", step: 1 },
      { name: "tiltY", label: "Tilt Y", step: 1 },
      { name: "roll", label: "Roll", step: 1 },
      { name: "zoom", label: "Zoom", step: 0.01, min: 0 },
      { name: "perspective", label: "Perspective", step: 10, min: 0 },
      { name: "cameraZ", label: "Camera Z", step: 10 },
      { name: "depthFade", label: "Depth fade", step: 0.01, min: 0, max: 1 },
    ],
  },
];

const STAGGER_ORDERS = ["index", "reverse", "center", "edges", "random", "radial"];
const COLOR_BY = ["wave", "index", "depth"];

/**
 * A `<repeater>`: how many copies, in what layout, and the camera they are
 * seen through. Every number is keyframeable here and shows as its own row on
 * the timeline, which is what makes hundreds of copies one editable thing.
 */
export function RepeaterSettings(props: RepeaterSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;
  const settings = useTrait(entity, Repeater);
  const knobs = useDerived(() => ({ ...(entity().get(Knobs)?.computed ?? {}) }));
  const frameRate = useTrait(world, FrameRate);
  const stagger = () => framesToSeconds(settings()?.stagger ?? 0, frameRate()?.value ?? 30);

  const write = (name: string, value: number) => {
    editor.editProperty(entity(), name, value);
    syncKeyframe(world, editor, entity(), name as AnimatableProperty, value);
  };

  const choice = (name: string, value: string, options: readonly string[], allowNone = false) => (
    <Select<string>
      value={value}
      onChange={(next) => next !== null && editor.editProperty(entity(), name, next === "none" ? false : next)}
      options={allowNone ? ["none", ...options] : [...options]}
      itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{itemProps.item.rawValue}</SelectItem>}
    >
      <SelectTrigger>
        <SelectValue<string>>{(state) => state.selectedOption()}</SelectValue>
      </SelectTrigger>
      <SelectPortal>
        <SelectContent />
      </SelectPortal>
    </Select>
  );

  return (
    <>
      <PanelSection title="Repeater">
        <ControlRow label="Layout">{choice("layout", settings()?.layout ?? "circle", REPEATER_LAYOUTS)}</ControlRow>
        <ControlRow label="Blend to">{choice("layoutTo", settings()?.layoutTo || "none", REPEATER_LAYOUTS, true)}</ControlRow>
        <ControlRow label="Stagger">
          <ControlledTextField
            value={Math.round(stagger() * 1000) / 1000}
            min={0}
            step={0.01}
            unit="s"
            onNumber={(value) => editor.editProperty(entity(), "stagger", value > 0 ? value : false)}
          />
        </ControlRow>
        <ControlRow label="Order">{choice("staggerOrder", settings()?.staggerOrder ?? "index", STAGGER_ORDERS)}</ControlRow>
        <ControlRow label="Colour to">
          <TextField class="w-full min-w-0">
            <TextFieldInput
              uiSize="compact"
              placeholder="none"
              value={(settings()?.colorTo ?? -1) >= 0 ? colorToHex(settings()!.colorTo) : ""}
              onChange={(event) => editor.editProperty(entity(), "colorTo", event.currentTarget.value.trim() || false)}
            />
          </TextField>
        </ControlRow>
        <Show when={(settings()?.colorTo ?? -1) >= 0}>
          <ControlRow label="Colour by">{choice("colorBy", settings()?.colorBy ?? "wave", COLOR_BY)}</ControlRow>
        </Show>
      </PanelSection>
      <For each={GROUPS}>
        {(group) => (
          <PanelSection title={group.title}>
            <For each={group.rows}>
              {(row) => (
                <ControlRow label={row.label}>
                  <ControlledTextField
                    value={Number(knobs()[row.name] ?? REPEATER_KNOBS[row.name] ?? 0)}
                    step={row.step}
                    min={row.min}
                    max={row.max}
                    sliderEnabled
                    onNumber={(value) => write(row.name, value)}
                    keyframe={<Keyframe target={entity()} property={row.name as AnimatableProperty} />}
                  />
                </ControlRow>
              )}
            </For>
          </PanelSection>
        )}
      </For>
    </>
  );
}
