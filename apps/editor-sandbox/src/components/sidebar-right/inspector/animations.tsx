/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ControlRow } from "@/components/ui/control-group";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorSeparator,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import { ItemRow } from "@/components/ui/item-row";
import { PanelSection } from "@/components/ui/panel-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectSection,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SliderInput } from "@/components/ui/slider-input";
import { useTrait, useWorld } from "@posterract/koota-solid";
import { Animation as AnimationElement } from "@posterract/video-reconciler";
import {
  Animation,
  AnimationPhase,
  AnimationType,
  animationDefaults,
  Cache,
  FrameRate,
  Paint,
  PaintType,
  framesToSeconds,
  Expanded,
  getIntrinsicPaint,
  isAudio,
  isText,
} from "@posterract/video-runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { setTimelineDetail } from "@/engine/timeline/detail";
import { ANIMATION_GROUPS, DEFAULT_ANIMATION, animationOption } from "./animation-types";
import { EASE_PRESETS, SPRING_PRESETS, type EasingPreset } from "./easing-types";
import { locateEntity, renameLocator, resolveEntity, type EntityLocator } from "./entity-locator";

import type { AnimationGroup, AnimationOption } from "./animation-types";
import type { Entity } from "koota";

/** `<animation>`'s defaults; a control left at one of these unsets its prop. */
const DEFAULT_DURATION = 1;
const DEFAULT_DELAY = 0;

/**
 * What `amount` is for each preset that has one, as a control: the presets do
 * different things, so the same prop is an opacity for one and degrees for
 * another (see the runtime's `animationDefaults`, which holds the defaults).
 */
const AMOUNT_CONTROLS: Partial<Record<AnimationType, { label: string; max: number; step: number; format(value: number): string }>> = {
  [AnimationType.FADE]: { label: "Fade", max: 1, step: 0.05, format: (value) => `${Math.round(value * 100)}%` },
  [AnimationType.GROW]: { label: "From", max: 1, step: 0.05, format: (value) => `${Math.round((1 - value) * 100)}%` },
  [AnimationType.SHRINK]: { label: "From", max: 2, step: 0.05, format: (value) => `${Math.round((1 + value) * 100)}%` },
  [AnimationType.BLUR]: { label: "Blur", max: 100, step: 1, format: (value) => `${Math.round(value)}px` },
  [AnimationType.SLIDE_LEFT]: { label: "Fade", max: 1, step: 0.05, format: (value) => `${Math.round(value * 100)}%` },
  [AnimationType.SLIDE_RIGHT]: { label: "Fade", max: 1, step: 0.05, format: (value) => `${Math.round(value * 100)}%` },
  [AnimationType.SLIDE_UP]: { label: "Fade", max: 1, step: 0.05, format: (value) => `${Math.round(value * 100)}%` },
  [AnimationType.SLIDE_DOWN]: { label: "Fade", max: 1, step: 0.05, format: (value) => `${Math.round(value * 100)}%` },
  [AnimationType.SPIN]: { label: "Rotation", max: 360, step: 1, format: (value) => `${Math.round(value)}°` },
  [AnimationType.TWIST]: { label: "Rotation", max: 90, step: 1, format: (value) => `${Math.round(value)}°` },
};

/** The presets that travel, and so have a `distance`. */
const TRAVELS: ReadonlySet<AnimationType> = new Set([
  AnimationType.SLIDE_LEFT, AnimationType.SLIDE_RIGHT, AnimationType.SLIDE_UP, AnimationType.SLIDE_DOWN, AnimationType.TWIST,
]);

/** "The preset's own curve" — `easing` absent — then the easings the JSX has a word for. */
const OWN_CURVE: EasingPreset = { name: "linear", label: "Preset", descriptor: "" };
const ANIMATION_EASINGS: EasingPreset[] = [
  OWN_CURVE,
  // For a preset the empty descriptor is its own curve, so linear is stored spelled out.
  ...EASE_PRESETS.map((option) => (option.name === "linear" ? { ...option, descriptor: "linear" } : option)),
  ...SPRING_PRESETS,
];

// Stable identity, so a node without animations does not resample every tick.
const NO_ANIMATIONS: Entity[] = [];

const phaseRank = (animation: Entity) =>
  animation.get(Animation)?.phase === AnimationPhase.OUT ? 1 : 0;

const sameOrder = (a: Entity[], b: Entity[]) =>
  a.length === b.length && a.every((entity, index) => entity === b[index]);

type AnimationsSettingsProps = {
  selection: Entity[];
};

/**
 * The `<animation>` children of the selected node: the presets it plays over
 * its head and tail. Rows are the ones playing in first and the ones playing
 * out after, each in the file's order, which is the order they write in when
 * two of them drive the same property.
 *
 * The plus authors a fade rather than asking which preset first: every
 * animation is the same three settings under a different name, so which one
 * it is, is a control in the inspector like the others.
 */
export function AnimationsSettings(props: AnimationsSettingsProps) {
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const [picked, setPicked] = createSignal<EntityLocator>();

  // Cache is derived state, written without change events.
  const animations = useDerived(() => {
    const list = entity().get(Cache)?.animations ?? NO_ANIMATIONS;
    // Sorting is stable, so the file's order survives within each phase.
    return list.length < 2 ? list : [...list].sort((a, b) => phaseRank(a) - phaseRank(b));
  }, sameOrder);

  const handleAppendAnimation = (phase: 'in' | 'out' = 'in') => {
    const [animation] = editor.insertElement(entity(), () => (
      <AnimationElement type={DEFAULT_ANIMATION.name} phase={phase} />
    ));
    // Which preset it is, is the one thing the default cannot answer, so the
    // inspector opens on the new animation for it to be said.
    if (animation) {
      if (!entity().has(Expanded)) editor.editProperty(entity(), 'expanded', true);
      setTimelineDetail('animation');
      setPicked(locateEntity(animation, animations()));
    }
  };

  const stopRename = editor.onRename((ids) => setPicked((current) => renameLocator(current, ids)));
  onCleanup(stopRename);

  // Read back off the list, so removing an animation closes the inspector on it.
  const editing = createMemo(() => {
    return resolveEntity(picked(), animations());
  });

  return (
    <>
      <PanelSection
        title="Animations"
        ref={anchorRef}
        actions={
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={() => handleAppendAnimation()}
              aria-label="Add entrance animation"
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>Add animation</TooltipContent>
          </Tooltip>
        }
      >
        <div class="posterract-motion-add">
          <Button variant="outline" size="small" onClick={() => handleAppendAnimation('in')}>+ Entrance</Button>
          <Button variant="outline" size="small" onClick={() => handleAppendAnimation('out')}>+ Exit</Button>
        </div>
        <Show when={!animations().length}><p class="text-xs text-muted-foreground leading-relaxed">Add an entrance or exit, then adjust its timing. Each animation stays editable in your timeline.</p></Show>
        <For each={animations()}>
          {(animation) => (
            <AnimationRow
              animation={animation}
              onSelect={() => setPicked(locateEntity(animation, animations()))}
              onRemove={() => editor.remove(animation)}
            />
          )}
        </For>
      </PanelSection>

      <Show when={editing() !== undefined}>
        <AnimationInspector
          animation={editing()!}
          node={entity()}
          anchorRef={anchorRef}
          onClose={() => setPicked(undefined)}
        />
      </Show>
    </>
  );
}

type AnimationRowProps = {
  animation: Entity;
  onSelect(): void;
  onRemove(): void;
};

function AnimationRow(props: AnimationRowProps) {
  const animation = useTrait(() => props.animation, Animation);

  const label = createMemo(() => animationOption(animation()?.type).label);
  const phase = createMemo(() => (animation()?.phase === AnimationPhase.OUT ? "OUT" : "IN"));

  return (
    <ItemRow
      label={phase()}
      value={label()}
      icon={<Icon name="preferences-adjust" />}
      onClick={props.onSelect}
    >
      <Tooltip>
        <TooltipTrigger
          as={Button}
          size="icon"
          variant="ghost"
          class="text-muted-foreground"
          onClick={props.onRemove}
          aria-label={`Remove ${label()} animation`}
        >
          <Icon name="close-remove-small" />
        </TooltipTrigger>
        <TooltipContent>Remove animation</TooltipContent>
      </Tooltip>
    </ItemRow>
  );
}

/** Whether `node` has anything to hear, which is what a gain animates. */
function hasAudio(node: Entity): boolean {
  if (isAudio(node) || getIntrinsicPaint(node) === PaintType.VIDEO) return true;
  return (node.get(Cache)?.fills ?? []).some((fill) => fill.get(Paint)?.value === PaintType.VIDEO);
}

type AnimationInspectorProps = {
  animation: Entity;
  node: Entity;
  anchorRef?: HTMLElement;
  onClose(): void;
};

/**
 * One `<animation>`: which preset it is (the select in the header, where a
 * title would be), whether it plays in or out, how long it takes and how
 * long after the clip edge it starts. `type` is required and always written;
 * the other three unset at their defaults.
 */
export function AnimationInspector(props: AnimationInspectorProps & { inline?: boolean }) {
  const world = useWorld();
  const editor = useEditor();

  const animation = useTrait(() => props.animation, Animation);
  const frameRate = useTrait(world, FrameRate);

  const option = createMemo(() => animationOption(animation()?.type));
  const fps = () => frameRate()?.value ?? 30;
  const duration = createMemo(() => framesToSeconds(animation()?.duration ?? 0, fps()));
  const delay = createMemo(() => framesToSeconds(animation()?.delay ?? 0, fps()));
  const isOut = createMemo(() => animation()?.phase === AnimationPhase.OUT);

  /**
   * The groups this node can play, plus whichever one holds the current
   * preset: a `gain` authored on a node that has since lost its audio still
   * has to be shown, or the select would have no value to display.
   */
  const groups = createMemo(() =>
    ANIMATION_GROUPS.filter(
      (group) =>
        group.kind === undefined ||
        (group.kind === "text" ? isText(props.node) : hasAudio(props.node)) ||
        group.options.includes(option()),
    ),
  );

  const handleTypeChange = (next: AnimationOption | null) => {
    if (next === null || next.name === option().name) return;
    editor.editProperty(props.animation, "type", next.name);
  };

  const handlePhaseChange = (next: boolean) => {
    editor.editProperty(props.animation, "phase", next ? "out" : false);
  };

  const handleDurationChange = (seconds: number) => {
    const next = Math.round(seconds * fps()) / fps();
    editor.editProperty(props.animation, "duration", next === DEFAULT_DURATION ? false : next);
  };

  const handleDelayChange = (seconds: number) => {
    const next = Math.round(seconds * fps()) / fps();
    editor.editProperty(props.animation, "delay", next === DEFAULT_DELAY ? false : next);
  };

  // How far and how much: the preset's own until someone says otherwise, and
  // unset again when put back there, so the file only spells what was chosen.
  const type = () => animation()?.type ?? AnimationType.FADE;
  const own = createMemo(() => animationDefaults(type()));
  const distance = createMemo(() => animation()?.distance ?? own().distance);
  const amount = createMemo(() => animation()?.amount ?? own().amount);
  const amountControl = createMemo(() => AMOUNT_CONTROLS[type()]);
  const easing = createMemo(() => {
    const descriptor = animation()?.easing ?? "";
    return ANIMATION_EASINGS.find((option) => option.descriptor === descriptor)
      ?? { name: "linear" as const, label: "Custom", descriptor };
  });

  const handleDistanceChange = (value: number) => {
    const next = Math.round(value);
    editor.editProperty(props.animation, "distance", next === own().distance ? false : next);
  };

  const handleAmountChange = (value: number) => {
    const next = Math.round(value * 100) / 100;
    editor.editProperty(props.animation, "amount", next === own().amount ? false : next);
  };

  const handleEasingChange = (next: EasingPreset | null) => {
    if (next === null || next.descriptor === easing().descriptor) return;
    editor.editProperty(props.animation, "easing", next === OWN_CURVE ? false : next.name);
  };

  const controls = () => (
    <>
      <FloatingInspectorHeader class="items-center justify-between px-2">
        <Select<AnimationOption, AnimationGroup>
          value={option()}
          onChange={handleTypeChange}
          options={groups()}
          optionValue="name"
          optionTextValue="label"
          optionGroupChildren="options"
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>{itemProps.item.rawValue.label}</SelectItem>
          )}
          sectionComponent={(sectionProps) => (
            <SelectSection>{sectionProps.section.rawValue.label}</SelectSection>
          )}
        >
          <SelectTrigger>
            <SelectValue<AnimationOption>>
              {(state) => state.selectedOption()?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon"
            variant="ghost"
            aria-label={props.inline ? 'Select owning layer' : 'Close animation controls'}
            class="text-muted-foreground"
            onClick={props.onClose}
          >
            <Icon name="close-remove" />
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </FloatingInspectorHeader>
      <FloatingInspectorSeparator />
      <FloatingInspectorContent class="flex flex-col gap-2 p-4">
        <ControlRow label="Phase">
          <Select<boolean>
            value={isOut()}
            onChange={(value) => value !== null && handlePhaseChange(value)}
            options={[false, true]}
            itemComponent={(itemProps) => (
              <SelectItem item={itemProps.item}>
                {itemProps.item.rawValue ? "Out" : "In"}
              </SelectItem>
            )}
          >
            <SelectTrigger>
              <SelectValue class="text-xs">{isOut() ? "Out" : "In"}</SelectValue>
            </SelectTrigger>
            <SelectPortal>
              <SelectContent />
            </SelectPortal>
          </Select>
        </ControlRow>

        <ControlRow label="Duration">
          <SliderInput
            value={duration()}
            onChange={handleDurationChange}
            min={1 / fps()}
            max={Math.max(5, duration())}
            step={1 / fps()}
            format={(value) => `${value.toFixed(2)}s`}
          />
        </ControlRow>

        <ControlRow label="Delay">
          <SliderInput
            value={delay()}
            onChange={handleDelayChange}
            min={0}
            max={Math.max(5, delay())}
            step={1 / fps()}
            format={(value) => `${value.toFixed(2)}s`}
          />
        </ControlRow>

        <Show when={TRAVELS.has(type())}>
          <ControlRow label="Distance">
            <SliderInput
              value={distance()}
              onChange={handleDistanceChange}
              min={0}
              max={Math.max(400, distance())}
              step={1}
              format={(value) => `${Math.round(value)}px`}
            />
          </ControlRow>
        </Show>

        <Show when={amountControl()}>
          {(control) => (
            <ControlRow label={control().label}>
              <SliderInput
                value={amount()}
                onChange={handleAmountChange}
                min={0}
                max={Math.max(control().max, amount())}
                step={control().step}
                format={control().format}
              />
            </ControlRow>
          )}
        </Show>

        <ControlRow label="Easing">
          <Select<EasingPreset>
            value={easing()}
            onChange={handleEasingChange}
            options={easing().label === "Custom" ? [...ANIMATION_EASINGS, easing()] : ANIMATION_EASINGS}
            optionValue="descriptor"
            optionTextValue="label"
            itemComponent={(itemProps) => (
              <SelectItem item={itemProps.item}>{itemProps.item.rawValue.label}</SelectItem>
            )}
          >
            <SelectTrigger>
              <SelectValue class="text-xs">{easing().label}</SelectValue>
            </SelectTrigger>
            <SelectPortal>
              <SelectContent />
            </SelectPortal>
          </Select>
        </ControlRow>
      </FloatingInspectorContent>
    </>
  );
  return <Show when={!props.inline} fallback={<div class="posterract-inline-motion">{controls()}</div>}>
    <FloatingInspector open anchorRef={props.anchorRef} width={280}>{controls()}</FloatingInspector>
  </Show>;
}
