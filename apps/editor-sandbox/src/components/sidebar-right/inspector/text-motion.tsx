/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";
import { useTrait, useWorld } from "@posterract/koota-solid";
import {
  ChildOf, Computed, FrameRate, TextAnimator, TextAnimatorOrder, TextAnimatorUnit, TextPath, TextPathAlign, framesToSeconds,
} from "@posterract/video-runtime";
import {
  Keyframe as KeyframeElement,
  KeyframeTrack as KeyframeTrackElement,
  TextAnimator as TextAnimatorElement,
} from "@posterract/video-reconciler";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlRow } from "@/components/ui/control-group";
import { Keyframe } from "@/components/ui/keyframe";
import { Button } from "@/components/ui/button";
import { ControlledTextField, TextField, TextFieldInput } from "@/components/ui/text-field";
import {
  Select, SelectContent, SelectItem, SelectPortal, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import type { Entity } from "koota";

type TextMotionSettingsProps = { selection: Entity[] };

const ALIGNS = ["start", "center", "end"] as const;
const ALIGN_NAMES: Record<TextPathAlign, (typeof ALIGNS)[number]> = {
  [TextPathAlign.START]: "start",
  [TextPathAlign.CENTER]: "center",
  [TextPathAlign.END]: "end",
};

const UNITS = ["letter", "word", "line"] as const;
const UNIT_NAMES: Record<TextAnimatorUnit, (typeof UNITS)[number]> = {
  [TextAnimatorUnit.LETTER]: "letter",
  [TextAnimatorUnit.WORD]: "word",
  [TextAnimatorUnit.LINE]: "line",
};

const ORDERS = ["forward", "reverse", "center", "edges", "random"] as const;
const ORDER_NAMES: Record<TextAnimatorOrder, (typeof ORDERS)[number]> = {
  [TextAnimatorOrder.FORWARD]: "forward",
  [TextAnimatorOrder.REVERSE]: "reverse",
  [TextAnimatorOrder.CENTER]: "center",
  [TextAnimatorOrder.EDGES]: "edges",
  [TextAnimatorOrder.RANDOM]: "random",
};

/**
 * Text that moves as more than one block: laid along a path (and slid along
 * it), or animated a letter, word or line at a time.
 */
export function TextMotionSettings(props: TextMotionSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;
  const path = useTrait(entity, TextPath);
  const resolved = useDerived(() => ({
    offset: entity().get(Computed)?.pathOffset ?? 0,
    shift: entity().get(Computed)?.pathShift ?? 0,
  }));
  const animator = useDerived(() => [...world.query(TextAnimator, ChildOf(entity()))][0] ?? null);
  const motion = useTrait(animator, TextAnimator);
  const frameRate = useTrait(world, FrameRate);
  const unit = () => UNIT_NAMES[motion()?.by ?? TextAnimatorUnit.LETTER];
  const stagger = () => framesToSeconds(motion()?.stagger ?? 0, frameRate()?.value ?? 30);

  const write = (name: "pathOffset" | "pathShift", value: number) => {
    editor.editProperty(entity(), name, value);
    syncKeyframe(world, editor, entity(), name, value);
  };

  const choice = (holder: Entity, name: "by" | "order", value: string, options: readonly string[]) => (
    <Select<string>
      value={value}
      onChange={(next) => next && editor.editProperty(holder, name, next)}
      options={[...options]}
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

  // A rise-and-fade, one letter after another: the usual start, and
  // everything in it is an ordinary keyframe to change afterwards.
  const addLetterAnimation = () => {
    editor.insertElement(entity(), () => (
      <TextAnimatorElement by="letter" stagger={0.04}>
        <KeyframeTrackElement property="offsetY">
          <KeyframeElement time={0} value={60} easing="snappy" />
          <KeyframeElement time={0.5} value={0} />
        </KeyframeTrackElement>
        <KeyframeTrackElement property="opacity">
          <KeyframeElement time={0} value={0} />
          <KeyframeElement time={0.2} value={1} />
        </KeyframeTrackElement>
      </TextAnimatorElement>
    ));
  };

  return (
    <PanelSection title="Text motion">
      <ControlRow label="On a path">
        <TextField class="w-full min-w-0">
          <TextFieldInput
            uiSize="compact"
            placeholder="Path data, e.g. a circle"
            value={path()?.d ?? ""}
            onChange={(event) => editor.editProperty(entity(), "path", event.currentTarget.value.trim() || false)}
          />
        </TextField>
      </ControlRow>
      <Show when={path()}>
        <ControlRow label="Along">
          <ControlledTextField
            value={Math.round(resolved().offset * 1000) / 1000}
            step={0.01}
            sliderEnabled
            onNumber={(value) => write("pathOffset", value)}
            keyframe={<Keyframe target={entity()} property="pathOffset" />}
          />
        </ControlRow>
        <ControlRow label="Off path">
          <ControlledTextField
            value={resolved().shift}
            step={1}
            sliderEnabled
            onNumber={(value) => write("pathShift", value)}
            keyframe={<Keyframe target={entity()} property="pathShift" />}
          />
        </ControlRow>
        <ControlRow label="Anchor">
          <Select<string>
            value={ALIGN_NAMES[path()?.align ?? TextPathAlign.START]}
            onChange={(next) => next && editor.editProperty(entity(), "pathAlign", next)}
            options={[...ALIGNS]}
            itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{itemProps.item.rawValue}</SelectItem>}
          >
            <SelectTrigger>
              <SelectValue<string>>{(state) => state.selectedOption()}</SelectValue>
            </SelectTrigger>
            <SelectPortal>
              <SelectContent />
            </SelectPortal>
          </Select>
        </ControlRow>
      </Show>
      <Show
        when={animator()}
        fallback={
          <div class="px-1 pt-1">
            <Button variant="outline" class="w-full" onClick={addLetterAnimation}>
              Animate letter by letter
            </Button>
          </div>
        }
      >
        {(holder) => (
          <>
            <ControlRow label="Moves by">{choice(holder(), "by", unit(), UNITS)}</ControlRow>
            <ControlRow label="Stagger">
              <ControlledTextField
                value={Math.round(stagger() * 1000) / 1000}
                min={0}
                step={0.01}
                unit="s"
                onNumber={(value) => editor.editProperty(holder(), "stagger", Math.max(0, value))}
              />
            </ControlRow>
            <ControlRow label="Order">
              {choice(holder(), "order", ORDER_NAMES[motion()?.order ?? TextAnimatorOrder.FORWARD], ORDERS)}
            </ControlRow>
            <p class="px-1 pt-1 text-xxs leading-relaxed text-muted-foreground">
              Its keyframes are on the timeline under the text. Each {unit()} plays them from its own start, {Math.round(stagger() * 1000) / 1000}s after the one before.
            </p>
          </>
        )}
      </Show>
    </PanelSection>
  );
}
