/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo } from "solid-js";
import { useTrait, useWorld } from "@posterract/koota-solid";
import { ChildOf, Computed, Lottie, LottieHandle, LottieSlot, colorToHex } from "@posterract/video-runtime";
import { LottieSlot as LottieSlotElement } from "@posterract/video-reconciler";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlRow } from "@/components/ui/control-group";
import { Keyframe } from "@/components/ui/keyframe";
import { ControlledTextField, TextField, TextFieldInput } from "@/components/ui/text-field";
import { Switch, SwitchControl, SwitchInput, SwitchThumb } from "@/components/ui/switch";

import type { Entity } from "koota";

type LottieSettingsProps = { selection: Entity[] };

/**
 * The Lottie section.
 *
 * A Lottie is opaque from the outside — the composition cannot reach inside
 * the file — except through its **slots**, the values the animation itself
 * marks as editable. So this panel is mostly a slot list: every slot the file
 * declares, whether or not the source overrides it yet, with the ones it does
 * override editable and keyframeable in place. Overriding one writes a
 * `<lottieSlot>` into the source, which is what makes the change part of the
 * document rather than a setting living in the editor.
 */
export function LottieSettings(props: LottieSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;
  const settings = useTrait(entity, Lottie);

  // The player is attached asynchronously (CanvasKit loads once, lazily) and
  // carries no change events, so the slot list is derived rather than reactive
  // on a trait: it fills in on the tick after the animation is ready.
  const declared = useDerived(() => entity().get(LottieHandle)?.slotNames() ?? []);

  /** The `<lottieSlot>` children the source already writes, by slot name. */
  const overrides = useDerived(() => {
    const found = new Map<string, Entity>();
    for (const slot of world.query(LottieSlot, ChildOf(entity()))) {
      found.set(slot.get(LottieSlot)?.name ?? "", slot);
    }
    return found;
  });

  // Every slot worth showing: what the file declares, plus any override for a
  // slot it does not (a renamed slot, a file swapped under the composition) so
  // an override never becomes invisible.
  const slots = createMemo(() => {
    const names = new Set<string>(declared());
    for (const name of overrides().keys()) if (name) names.add(name);
    return [...names].sort();
  });

  const addOverride = (name: string) => {
    editor.insertElement(entity(), () => <LottieSlotElement name={name} value={0} />);
  };

  return (
    <PanelSection title="Lottie">
      <ControlRow label="Speed">
        <ControlledTextField
          value={settings()?.speed ?? 1}
          min={0}
          max={8}
          step={0.05}
          sliderEnabled
          onNumber={(value) => editor.editProperty(entity(), "speed", value)}
        />
      </ControlRow>

      <ControlRow label="Loop">
        <Switch
          checked={settings()?.loop === true}
          onChange={(checked) => editor.editProperty(entity(), "loop", checked)}
        >
          <SwitchInput />
          <SwitchControl variant="compact">
            <SwitchThumb variant="compact" />
          </SwitchControl>
        </Switch>
      </ControlRow>

      <Show
        when={slots().length > 0}
        fallback={
          <p class="px-1 pt-1 text-xxs leading-relaxed text-muted-foreground">
            This animation exposes no editable slots. A Lottie file marks one by giving a property
            a <span class="font-mono">sid</span>.
          </p>
        }
      >
        <For each={slots()}>
          {(name) => (
            <Show
              when={overrides().get(name)}
              fallback={
                <ControlRow label={name}>
                  <button
                    type="button"
                    class="h-7 w-full rounded-md bg-input px-2 text-left text-xs text-muted-foreground hover:text-foreground focus-ring"
                    onClick={() => addOverride(name)}
                  >
                    Use the file's value — click to override
                  </button>
                </ControlRow>
              }
            >
              {(slot) => <SlotRow slot={slot()} name={name} />}
            </Show>
          )}
        </For>
      </Show>
    </PanelSection>
  );
}

/**
 * One overridden slot. Which editor it gets follows how the value was
 * authored, because that is what the runtime uses to decide which of
 * Skottie's setters applies: a colour, a string, or a number.
 */
function SlotRow(props: { slot: Entity; name: string }) {
  const world = useWorld();
  const editor = useEditor();
  const slot = useTrait(() => props.slot, LottieSlot);

  // Resolved rather than authored: a keyframe track over the slot writes here,
  // and the row should read what the frame is actually using.
  const value = useDerived(() => props.slot.get(Computed)?.value ?? 0);

  const write = (next: string | number) => {
    editor.editProperty(props.slot, "value", next);
  };

  const writeNumber = (next: number) => {
    write(next);
    syncKeyframe(world, editor, props.slot, "value", next);
  };

  return (
    <ControlRow label={props.name}>
      <Show
        when={slot()?.text === ""}
        fallback={
          <TextField class="w-full min-w-0">
            <TextFieldInput
              uiSize="compact"
              value={slot()?.text ?? ""}
              onChange={(event: Event & { currentTarget: HTMLInputElement }) => write(event.currentTarget.value)}
            />
          </TextField>
        }
      >
        <Show
          when={slot()?.isColor !== true}
          fallback={
            <TextField class="w-full min-w-0">
              <TextFieldInput
                uiSize="compact"
                value={colorToHex(value())}
                onChange={(event: Event & { currentTarget: HTMLInputElement }) => write(event.currentTarget.value)}
              />
            </TextField>
          }
        >
          <ControlledTextField
            value={Math.round(value() * 1000) / 1000}
            step={0.1}
            onNumber={writeNumber}
            keyframe={<Keyframe target={props.slot} property="value" />}
          />
        </Show>
      </Show>
    </ControlRow>
  );
}
