/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Switch, createMemo, createSignal } from "solid-js";
import { WebFonts, loadWebFont } from "@posterract/video-runtime";
import { useWorld } from "@posterract/koota-solid";

import { Button } from "@/components/ui/button";
import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { ColorOpacityRow } from "@/components/ui/color-opacity-row";
import { ControlRow } from "@/components/ui/control-group";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorTitle,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SliderInput } from "@/components/ui/slider-input";
import { Switch as SwitchToggle, SwitchControl, SwitchInput, SwitchThumb } from "@/components/ui/switch";
import { ControlledTextField } from "@/components/ui/text-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditor } from "@/engine/hooks";
import { useInspectEntries } from "@/engine/inspect";
import { colorToHex, parseColor } from "@/utils/color";
import { FontDropdown, GrowingTextArea } from "./text";

import type { InspectValue } from "@posterract/composition";
import type { InspectEntry } from "@posterract/video-reconciler";

export function VariablesSettings() {
  const entries = useInspectEntries(useWorld());
  const sections = createMemo(() => {
    const grouped = new Map<string, InspectEntry[]>([["", []]]);
    for (const entry of entries()) {
      const key = entry.group.join(" / ");
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
    return [...grouped].filter(([, members]) => members.length > 0);
  });

  return (
    <For each={sections()}>
      {([group, members]) => (
        <PanelSection title={group || "Variables"}>
          <For each={members}>{(entry) => <VariableControl entry={entry} />}</For>
        </PanelSection>
      )}
    </For>
  );
}

function VariableControl(props: { entry: InspectEntry }) {
  const world = useWorld();
  const editor = useEditor();
  const entry = () => props.entry;
  const commit = (value: InspectValue) => editor.editVariable(entry().file, entry().name, value);

  return (
    <Switch>
      <Match when={entry().type === "number"}>
        <NumberControl entry={entry()} onCommit={commit} />
      </Match>
      <Match when={entry().type === "color"}>
        <ColorControl entry={entry()} onCommit={commit} />
      </Match>
      <Match when={entry().type === "font"}>
        <ControlRow label={entry().label}>
          <FontDropdown
            family={String(entry().committed())}
            onPreview={(family) => entry().set(family)}
            onFamilyChange={(family) => {
              commit(family);
              if (family in WebFonts) void loadWebFont(world, family as keyof typeof WebFonts);
            }}
            onWeightsChange={() => {}}
          />
        </ControlRow>
      </Match>
      <Match when={entry().type === "text"}>
        <ControlRow label={entry().label} contentClass="flex flex-col">
          <GrowingTextArea
            value={String(entry().get())}
            maxRows={8}
            onInput={(value) => commit(value)}
          />
        </ControlRow>
      </Match>
      <Match when={entry().type === "boolean"}>
        <ControlRow label={entry().label} contentClass="flex justify-end">
          <SwitchToggle checked={Boolean(entry().get())} onChange={commit} class="flex items-center">
            <SwitchInput aria-label={entry().label} />
            <SwitchControl variant="compact"><SwitchThumb variant="compact" /></SwitchControl>
          </SwitchToggle>
        </ControlRow>
      </Match>
      <Match when={entry().type === "select"}>
        <ControlRow label={entry().label}>
          <Select
            value={String(entry().get())}
            onChange={(value) => { if (value !== null) commit(value); }}
            options={entry().options ?? []}
            itemComponent={(itemProps) => (
              <SelectItem item={itemProps.item}>{itemProps.item.rawValue}</SelectItem>
            )}
          >
            <SelectTrigger><SelectValue>{String(entry().get())}</SelectValue></SelectTrigger>
            <SelectPortal><SelectContent /></SelectPortal>
          </Select>
        </ControlRow>
      </Match>
    </Switch>
  );
}

function NumberControl(props: { entry: InspectEntry; onCommit: (value: InspectValue) => void }) {
  const value = () => Number(props.entry.get());
  return (
    <ControlRow label={props.entry.label}>
      <Switch>
        <Match when={props.entry.min !== undefined && props.entry.max !== undefined}>
          <SliderInput
            value={value()}
            min={props.entry.min}
            max={props.entry.max}
            step={props.entry.step}
            onChange={props.onCommit}
          />
        </Match>
        <Match when={true}>
          <ControlledTextField
            value={value()}
            onNumber={props.onCommit}
            step={props.entry.step ?? 1}
            min={props.entry.min}
            max={props.entry.max}
            autoSelect
            sliderEnabled
            limitEvents
          />
        </Match>
      </Switch>
    </ControlRow>
  );
}

function ColorControl(props: { entry: InspectEntry; onCommit: (value: InspectValue) => void }) {
  const [open, setOpen] = createSignal(false);
  const color = () => parseColor(String(props.entry.get())) ?? 0;
  const assignColor = (next: number) => props.onCommit(colorToHex(next));
  let anchorRef: HTMLDivElement | undefined;

  return (
    <ControlRow label={props.entry.label} ref={anchorRef}>
      <ColorOpacityRow color={color()} onChangeColor={assignColor} onClick={() => setOpen(true)} />
      <FloatingInspector open={open} anchorRef={anchorRef}>
        <FloatingInspectorHeader>
          <FloatingInspectorTitle>{props.entry.label}</FloatingInspectorTitle>
          <div class="ml-auto">
            <Tooltip>
              <TooltipTrigger
                as={Button}
                size="icon"
                variant="ghost"
                class="text-muted-foreground"
                onClick={() => setOpen(false)}
              ><Icon name="close-remove" class="size-6" /></TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </div>
        </FloatingInspectorHeader>
        <FloatingInspectorContent class="p-0">
          <ColorOpacityPicker color={color()} opacity={1} onColorChange={assignColor} withoutOpacity />
        </FloatingInspectorContent>
      </FloatingInspector>
    </ControlRow>
  );
}
