/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo } from "solid-js";
import { useHas, useWorld } from "@posterract/koota-solid";
import { ChildOf, Knobs, Paint, PaintType, Repeater, Shader } from "@posterract/video-runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlRow } from "@/components/ui/control-group";
import { Keyframe } from "@/components/ui/keyframe";
import { ControlledTextField } from "@/components/ui/text-field";

import type { AnimatableProperty } from "@posterract/composition";
import type { Entity } from "koota";

type KnobsSettingsProps = { selection: Entity[] };

/**
 * The knobs of a code-drawn element: a `<surface>`'s and an `<html>`'s, and
 * the numeric uniforms of any `<shaderPaint>` on it. Each is a slider that
 * writes the source and a keyframe toggle that animates it — the code only
 * reads the value, so this is where its motion is made.
 */
export function KnobsSettings(props: KnobsSettingsProps) {
  const world = useWorld();
  const entity = () => props.selection[0]!;
  const hasKnobs = useHas(entity, Knobs);
  const isRepeater = useHas(entity, Repeater);

  // Shader paints under the element carry their uniforms as knobs of their own.
  const shaders = useDerived(() =>
    [...world.query(ChildOf(entity()), Paint, Shader)].filter((paint) => paint.get(Paint)?.value === PaintType.SHADER),
  );

  return (
    <>
      <Show when={hasKnobs() && !isRepeater()}>
        <KnobList owner={entity()} title="Knobs" prefix="knob" />
      </Show>
      <For each={shaders()}>
        {(shader) => <KnobList owner={shader} title="Shader" prefix="uniform" />}
      </For>
    </>
  );
}

function KnobList(props: { owner: Entity; title: string; prefix: "knob" | "uniform" }) {
  const world = useWorld();
  const editor = useEditor();

  const authored = useDerived(() => ({ ...(props.owner.get(Knobs)?.authored ?? {}) }));
  const computed = useDerived(() => ({ ...(props.owner.get(Knobs)?.computed ?? {}) }));
  const names = createMemo(() => Object.keys(authored()).filter((name) => typeof authored()[name] === "number"));

  // Written back whole — a knob is one entry of the `knobs` (or `uniforms`)
  // object — and kept in step with its track when it has one.
  const write = (name: string, value: number) => {
    const prop = props.prefix === "knob" ? "knobs" : "uniforms";
    const current = props.prefix === "knob"
      ? authored()
      : { ...(props.owner.get(Shader)?.uniforms ?? {}) };
    editor.editProperty(props.owner, prop, { ...current, [name]: value });
    syncKeyframe(world, editor, props.owner, `${props.prefix}.${name}` as AnimatableProperty, value);
  };

  return (
    <Show when={names().length > 0}>
      <PanelSection title={props.title}>
        <For each={names()}>
          {(name) => (
            <ControlRow label={name}>
              <ControlledTextField
                value={Number(computed()[name] ?? authored()[name] ?? 0)}
                step={0.01}
                sliderEnabled
                onNumber={(value) => write(name, value)}
                keyframe={<Keyframe target={props.owner} property={`${props.prefix}.${name}` as AnimatableProperty} />}
              />
            </ControlRow>
          )}
        </For>
      </PanelSection>
    </Show>
  );
}
