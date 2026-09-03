/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createMemo } from "solid-js";
import { useTrait, useWorld } from "@posterract/koota-solid";
import {
  Computed, Geometry, GeometryType, Path, PathTrim, Polygon,
} from "@posterract/video-runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlRow } from "@/components/ui/control-group";
import { Keyframe } from "@/components/ui/keyframe";
import { ControlledTextField, TextField, TextFieldInput } from "@/components/ui/text-field";

import type { AnimatableProperty } from "@posterract/composition";
import type { Entity } from "koota";

type VectorSettingsProps = { selection: Entity[] };

const KIND_LABELS: Partial<Record<GeometryType, string>> = {
  [GeometryType.PATH]: "Path",
  [GeometryType.ELLIPSE]: "Ellipse",
  [GeometryType.POLYGON]: "Polygon",
};

/**
 * The vector section: the figure itself, and how much of it is drawn.
 *
 * `d` and `points` are edited as text because that is what they are — an
 * agent writes them, and a person pastes them from a drawing tool. What the
 * panel adds over the file is the two things that move: the trim window and
 * the morph, both keyframeable in place.
 */
export function VectorSettings(props: VectorSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;
  const geometry = useTrait(entity, Geometry);
  const path = useTrait(entity, Path);
  const polygon = useTrait(entity, Polygon);
  const trim = useTrait(entity, PathTrim);

  const kind = createMemo(() => geometry()?.value ?? GeometryType.PATH);

  // Resolved rather than authored: a track over trim or morph writes here, and
  // the fields should read what the current frame is using.
  const resolved = useDerived(() => {
    const computed = entity().get(Computed);
    return {
      start: computed?.trimStart ?? 0,
      end: computed?.trimEnd ?? 1,
      offset: computed?.trimOffset ?? 0,
      morph: computed?.morph ?? 0,
    };
  });

  const writeText = (name: string) => (event: Event & { currentTarget: HTMLInputElement }) => {
    editor.editProperty(entity(), name, event.currentTarget.value);
  };

  // The prop write comes first; without the keyframe sync a running track puts
  // the sampled value straight back on the next tick.
  const writeAnimatable = (name: AnimatableProperty) => (value: number) => {
    editor.editProperty(entity(), name, value);
    syncKeyframe(world, editor, entity(), name, value);
  };

  return (
    <PanelSection
      title="Shape"
      subtitle={<span class="text-xxs text-primary">{KIND_LABELS[kind()] ?? "Path"}</span>}
    >
      <Show when={kind() === GeometryType.PATH}>
        <ControlRow label="Path">
          <TextField class="w-full min-w-0">
            <TextFieldInput uiSize="compact" value={path()?.d ?? ""} onChange={writeText("d")} />
          </TextField>
        </ControlRow>
        <ControlRow label="Morph to">
          <TextField class="w-full min-w-0">
            <TextFieldInput uiSize="compact" value={path()?.morphTo ?? ""} onChange={writeText("morphTo")} />
          </TextField>
        </ControlRow>
        <Show when={path()?.morphTo}>
          <ControlRow label="Morph">
            <ControlledTextField
              value={Math.round(resolved().morph * 100) / 100}
              min={0}
              max={1}
              step={0.01}
              sliderEnabled
              onNumber={writeAnimatable("morph")}
              keyframe={<Keyframe target={entity()} property="morph" />}
            />
          </ControlRow>
        </Show>
      </Show>

      <Show when={kind() === GeometryType.POLYGON}>
        <ControlRow label="Points">
          <TextField class="w-full min-w-0">
            <TextFieldInput uiSize="compact" value={polygon()?.points ?? ""} onChange={writeText("points")} />
          </TextField>
        </ControlRow>
      </Show>

      {/*
        Trim is the draw-on: `end` from 0 to 1 is a line drawing itself. The
        rows are always shown, because an untrimmed figure is exactly the one
        someone is about to animate.
      */}
      <ControlRow label="Trim start">
        <ControlledTextField
          value={Math.round(resolved().start * 100) / 100}
          min={0}
          max={1}
          step={0.01}
          sliderEnabled
          onNumber={writeAnimatable("trimStart")}
          keyframe={<Keyframe target={entity()} property="trimStart" />}
        />
      </ControlRow>
      <ControlRow label="Trim end">
        <ControlledTextField
          value={Math.round(resolved().end * 100) / 100}
          min={0}
          max={1}
          step={0.01}
          sliderEnabled
          onNumber={writeAnimatable("trimEnd")}
          keyframe={<Keyframe target={entity()} property="trimEnd" />}
        />
      </ControlRow>
      <ControlRow label="Trim offset">
        <ControlledTextField
          value={Math.round(resolved().offset * 100) / 100}
          step={0.01}
          sliderEnabled
          onNumber={writeAnimatable("trimOffset")}
          keyframe={<Keyframe target={entity()} property="trimOffset" />}
        />
      </ControlRow>
      <Show when={trim() === undefined}>
        <p class="px-1 pt-1 text-xxs leading-relaxed text-muted-foreground">
          The whole figure is drawn. Animate <span class="font-mono">Trim end</span> from 0 to 1 for a
          line that draws itself.
        </p>
      </Show>
    </PanelSection>
  );
}
