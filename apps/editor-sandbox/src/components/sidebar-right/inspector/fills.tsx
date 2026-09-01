/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { SolidPaint } from "@posterract/video-reconciler";
import { Cache, Source, isText } from "@posterract/video-runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { FillPicker, type FillTab } from "./fill-picker";
import { FillRow } from "./fill-row";
import { clearFloatingInspectorPosition } from "@/components/ui/floating-inspector";

import type { Entity } from "koota";

/** What "Add fill" authors. */
const DEFAULT_FILL_COLOR = "#E0E0E0";

/** A text is painted by its glyphs, which no picture and no video fills. */
const TEXT_TABS: FillTab[] = ["solid", "gradient"];

// Stable identity, so a node without fills does not resample every tick.
const NO_FILLS: Entity[] = [];

type OpenFill = { source?: string; index: number };

// A source save remounts the runtime document. Keep only the currently open
// fill identity outside the remounted inspector so changing paint kind does
// not dismiss the picker. This is in-memory UI state, never project state.
const openFillByNode = new Map<string, OpenFill>();

type FillsSettingsProps = {
  selection: Entity[];
};

/**
 * The paint children of the selected node, in paint order (the list is shown
 * topmost first, so the last element in the file is the first row). A row
 * opens the picker, where the fill's kind can be changed — which replaces the
 * element, since each kind is a tag of its own, so the picker hands back the
 * entity it ended up with.
 */
export function FillsSettings(props: FillsSettingsProps) {
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  let sectionRef!: HTMLDivElement;

  const nodeSource = () => entity().get(Source)?.value ?? String(entity());
  const pickerPositionKey = () => `fill-picker:${nodeSource()}`;
  const [picked, setPicked] = createSignal<OpenFill | undefined>(
    openFillByNode.get(nodeSource()),
  );
  const [pickerAnchor, setPickerAnchor] = createSignal<HTMLElement>();

  // Cache is derived state, written without change events.
  const fills = useDerived(() => entity().get(Cache)?.fills ?? NO_FILLS);

  const tabs = createMemo<FillTab[] | undefined>(() =>
    isText(entity()) ? TEXT_TABS : undefined,
  );

  const handleAppendFill = () => {
    editor.insertElement(entity(), () => (
      <SolidPaint color={DEFAULT_FILL_COLOR} />
    ));
  };

  const handleSelectFill = (fill: Entity, event: MouseEvent) => {
    clearFloatingInspectorPosition(pickerPositionKey());
    const target = event.currentTarget;
    setPickerAnchor(target instanceof HTMLElement ? target : sectionRef);
    const next = {
      source: fill.get(Source)?.value,
      index: fills().indexOf(fill),
    };
    setPicked(next);
    openFillByNode.set(nodeSource(), next);
  };

  const rememberReplacement = (fill: Entity) => {
    const next = {
      source: fill.get(Source)?.value,
      index: Math.max(0, fills().indexOf(fill)),
    };
    setPicked(next);
    openFillByNode.set(nodeSource(), next);
  };

  const closePicker = () => {
    clearFloatingInspectorPosition(pickerPositionKey());
    openFillByNode.delete(nodeSource());
    setPicked(undefined);
  };

  // Pending source IDs are replaced by stable IDs after the atomic TSX write.
  // Follow that rename so the picker can find the same paint after remount.
  const stopRename = editor.onRename((ids) => {
    const current = picked();
    if (!current?.source || !ids[current.source]) return;
    const next = { ...current, source: ids[current.source] };
    setPicked(next);
    openFillByNode.set(nodeSource(), next);
  });
  onCleanup(stopRename);

  // Read back from the current runtime. Source identity is preferred; the
  // preserved paint-stack index covers the short remount/restamp race.
  const editing = createMemo(() => {
    const current = picked();
    if (!current) return undefined;
    const bySource = current.source
      ? fills().find((fill) => fill.get(Source)?.value === current.source)
      : undefined;
    return bySource ?? fills()[current.index];
  });

  createEffect(() => {
    const fill = editing();
    const current = picked();
    if (!fill || !current) return;
    const source = fill.get(Source)?.value;
    const index = fills().indexOf(fill);
    if (source === current.source && index === current.index) return;
    const next = { source, index };
    setPicked(next);
    openFillByNode.set(nodeSource(), next);
  });

  /**
   * Swaps `fill` with its neighbour, later in the file (`direction` 1, on
   * top) or earlier. Written as a swap because a move needs an anchor:
   * `reparent` appends without one, and refuses an append into the parent the
   * element already has.
   */
  const handleReorderFill = (fill: Entity, direction: number) => {
    const siblings = fills();
    const index = siblings.indexOf(fill);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= siblings.length) return;

    if (direction > 0) {
      editor.reparent(siblings[target]!, entity(), fill);
    } else {
      editor.reparent(fill, entity(), siblings[target]!);
    }
  };

  return (
    <>
      <PanelSection
        title="Fill"
        ref={sectionRef}
        actions={
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              aria-label="Add fill"
              class="text-muted-foreground"
              onClick={handleAppendFill}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>Add fill</TooltipContent>
          </Tooltip>
        }
      >
        <For each={fills().toReversed()}>
          {(fill) => (
            <FillRow
              fill={fill}
              onSelect={(event) => handleSelectFill(fill, event)}
              onRemove={() => editor.remove(fill)}
              onMoveUp={() => handleReorderFill(fill, 1)}
              onMoveDown={() => handleReorderFill(fill, -1)}
            />
          )}
        </For>
      </PanelSection>

      <Show when={editing() !== undefined}>
        <FillPicker
          node={entity()}
          fill={editing()!}
          anchorRef={pickerAnchor() ?? sectionRef}
          positionKey={pickerPositionKey()}
          onClose={closePicker}
          onReplace={rememberReplacement}
          tabs={tabs()}
        />
      </Show>
    </>
  );
}
