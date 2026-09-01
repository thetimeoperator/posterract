/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createMemo } from "solid-js";
import { useTrait, useWorld } from "@posterract/koota-solid";
import { Color, Computed, Diagram, DiagramKindType, colorToHex } from "@posterract/video-runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlRow } from "@/components/ui/control-group";
import { Keyframe } from "@/components/ui/keyframe";
import { ControlledTextField, TextField, TextFieldInput } from "@/components/ui/text-field";

import type { Entity } from "koota";

type DiagramSettingsProps = { selection: Entity[] };

type DiagramTextInputProps = {
  value: string;
  onChange: (event: Event & { currentTarget: HTMLInputElement }) => void;
};

/** Kobalte inputs require their owning field context, even in compact inspector rows. */
function DiagramTextInput(props: DiagramTextInputProps) {
  return (
    <TextField class="w-full min-w-0">
      <TextFieldInput uiSize="compact" value={props.value} onChange={props.onChange} />
    </TextField>
  );
}

const KIND_LABELS: Record<DiagramKindType, string> = {
  [DiagramKindType.NODE]: "Node",
  [DiagramKindType.ARROW]: "Arrow",
  [DiagramKindType.EQUATION]: "Equation",
  [DiagramKindType.AXIS]: "Axis",
  [DiagramKindType.PLOT]: "Plot",
  [DiagramKindType.CALLOUT]: "Callout",
};

export function DiagramSettings(props: DiagramSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;
  const diagram = useTrait(entity, Diagram);
  const fill = useTrait(entity, Color);
  const kind = createMemo(() => diagram()?.kind ?? DiagramKindType.NODE);

  // The reveal is keyframeable, so the shown value is the resolved one the
  // motion system writes rather than the authored prop. Computed is written
  // without change events, hence useDerived.
  const progress = useDerived(() => entity().get(Computed)?.progress ?? 1);

  const writeString = (name: string) => (event: Event & { currentTarget: HTMLInputElement | HTMLSelectElement }) => {
    editor.editProperty(entity(), name, event.currentTarget.value);
  };

  // The field clamps to 0–1 before this runs. The keyframe sync follows the
  // prop write: with a track running, the motion system would otherwise put
  // the sampled value back on the next tick.
  const handleProgressChange = (value: number) => {
    editor.editProperty(entity(), "progress", value);
    syncKeyframe(world, editor, entity(), "progress", value);
  };

  return (
    <PanelSection title="Diagram" subtitle={<span class="text-xxs text-primary">{KIND_LABELS[kind()]}</span>}>
      <Show when={kind() === DiagramKindType.NODE || kind() === DiagramKindType.CALLOUT}>
        <ControlRow label="Label"><DiagramTextInput value={diagram()?.label ?? ""} onChange={writeString("label")} /></ControlRow>
        <ControlRow label="Subtitle"><DiagramTextInput value={diagram()?.subtitle ?? ""} onChange={writeString("subtitle")} /></ControlRow>
        <ControlRow label="Fill"><DiagramTextInput value={colorToHex(fill()?.value ?? 0x0B2118)} onChange={writeString("fill")} /></ControlRow>
      </Show>

      <Show when={kind() === DiagramKindType.EQUATION}>
        <ControlRow label="Formula"><DiagramTextInput value={diagram()?.expression ?? ""} onChange={writeString("expression")} /></ControlRow>
        <ControlRow label="Caption"><DiagramTextInput value={diagram()?.label ?? ""} onChange={writeString("label")} /></ControlRow>
      </Show>

      <Show when={kind() === DiagramKindType.ARROW}>
        <ControlRow label="Label"><DiagramTextInput value={diagram()?.label ?? ""} onChange={writeString("label")} /></ControlRow>
        <ControlRow label="Route">
          <select class="h-7 w-full rounded-md bg-input px-2 text-xs text-foreground focus-ring" value={diagram()?.route ?? "straight"} onChange={writeString("route")}>
            <option value="straight">Straight</option><option value="elbow">Elbow</option><option value="curve">Curve</option>
          </select>
        </ControlRow>
      </Show>

      <Show when={kind() === DiagramKindType.NODE}>
        <ControlRow label="Shape">
          <select class="h-7 w-full rounded-md bg-input px-2 text-xs text-foreground focus-ring" value={diagram()?.shape ?? "rounded"} onChange={writeString("shape")}>
            <option value="rounded">Rounded</option><option value="pill">Pill</option><option value="circle">Circle</option><option value="diamond">Diamond</option><option value="hexagon">Hexagon</option>
          </select>
        </ControlRow>
      </Show>

      <Show when={kind() === DiagramKindType.AXIS}>
        <ControlRow label="X label"><DiagramTextInput value={diagram()?.xLabel ?? ""} onChange={writeString("xLabel")} /></ControlRow>
        <ControlRow label="Y label"><DiagramTextInput value={diagram()?.yLabel ?? ""} onChange={writeString("yLabel")} /></ControlRow>
      </Show>

      <Show when={kind() === DiagramKindType.PLOT}>
        <ControlRow label="Label"><DiagramTextInput value={diagram()?.label ?? ""} onChange={writeString("label")} /></ControlRow>
      </Show>

      <ControlRow label="Stroke"><DiagramTextInput value={colorToHex(diagram()?.strokeColor ?? 0x5DFF9D)} onChange={writeString("strokeColor")} /></ControlRow>
      <ControlRow label="Line width"><ControlledTextField value={diagram()?.strokeWidth ?? 4} min={0.5} max={40} step={0.5} sliderEnabled onNumber={(value) => editor.editProperty(entity(), "strokeWidth", value)} /></ControlRow>
      <ControlRow label="Text"><DiagramTextInput value={colorToHex(diagram()?.textColor ?? 0xF4FFF8)} onChange={writeString("textColor")} /></ControlRow>
      <ControlRow label="Type size"><ControlledTextField value={diagram()?.fontSize ?? 34} min={8} max={220} step={1} sliderEnabled onNumber={(value) => editor.editProperty(entity(), "fontSize", value)} /></ControlRow>
      <ControlRow label="Reveal">
        <ControlledTextField
          value={Math.round(progress() * 100) / 100}
          min={0}
          max={1}
          step={0.01}
          sliderEnabled
          onNumber={handleProgressChange}
          keyframe={<Keyframe target={entity()} property="progress" />}
        />
      </ControlRow>
    </PanelSection>
  );
}
