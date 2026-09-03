/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';

type Entry = { keys: string[]; label: string };
type Group = { title: string; entries: Entry[] };

/**
 * Every shortcut the editor answers to, in one place.
 *
 * A key that only exists in the source is a key nobody uses, and Phase 3 adds
 * a dozen of them. Grouped the way an editor thinks — moving through time,
 * cutting, arranging — rather than by which module implements them.
 */
const GROUPS: Group[] = [
  {
    title: 'Transport',
    entries: [
      { keys: ['Space'], label: 'Play / pause' },
      { keys: ['J'], label: 'Shuttle back — press again for 2× and 4×' },
      { keys: ['K'], label: 'Pause the shuttle' },
      { keys: ['L'], label: 'Shuttle forward — press again for 2× and 4×' },
      { keys: ['A'], label: 'Back one frame' },
      { keys: ['D'], label: 'Forward one frame' },
      { keys: ['S'], label: 'Back one second' },
      { keys: ['W'], label: 'Forward one second' },
      { keys: ['Home'], label: 'Go to the start, or the in point' },
      { keys: ['End'], label: 'Go to the end, or the out point' },
      { keys: ['⌥', '↑'], label: 'Previous cut' },
      { keys: ['⌥', '↓'], label: 'Next cut' },
    ],
  },
  {
    title: 'Range',
    entries: [
      { keys: ['I'], label: 'Mark in — sets the work area an export renders' },
      { keys: ['O'], label: 'Mark out' },
      { keys: ['⌥', 'X'], label: 'Clear the range' },
      { keys: ['M'], label: 'Marker at the playhead — press again to remove it' },
    ],
  },
  {
    title: 'Editing',
    entries: [
      { keys: ['⌘', 'B'], label: 'Split at the playhead' },
      { keys: ['Delete'], label: 'Delete — a scene with content asks first' },
      { keys: ['⇧', 'Delete'], label: 'Ripple delete — closes the gap' },
      { keys: ['⌘', 'D'], label: 'Duplicate' },
      { keys: ['⌘', 'G'], label: 'Group' },
      { keys: ['⇧', '⌘', 'G'], label: 'Ungroup' },
      { keys: ['⌘', 'Z'], label: 'Undo — survives a reload' },
      { keys: ['⇧', '⌘', 'Z'], label: 'Redo' },
      { keys: ['⌥', '←'], label: 'Nudge the selection one frame' },
      { keys: ['⌥', '⇧', '←'], label: 'Nudge ten frames' },
      { keys: ['N'], label: 'Snapping on or off — hold ⌘ while dragging to invert' },
      { keys: [']'], label: 'Bring to front' },
      { keys: ['['], label: 'Send to back' },
    ],
  },
  {
    title: 'Canvas',
    entries: [
      { keys: ['V'], label: 'Move tool' },
      { keys: ['H'], label: 'Hand tool' },
      { keys: ['T'], label: 'Text' },
      { keys: ['R'], label: 'Rectangle' },
      { keys: ['F'], label: 'Scene' },
      { keys: ['⌘', '1'], label: 'Zoom to fit' },
      { keys: ['⌘', '2'], label: 'Zoom to selection' },
      { keys: ['⌘', '0'], label: 'Actual size' },
      { keys: ['←', '→', '↑', '↓'], label: 'Nudge on the canvas' },
    ],
  },
  {
    title: 'Timeline',
    entries: [
      { keys: ['⌥', '+'], label: 'Zoom the timeline in' },
      { keys: ['⌥', '−'], label: 'Zoom the timeline out' },
      { keys: ['⇧', 'Z'], label: 'Fit the whole video' },
      { keys: ['⌥', 'Z'], label: 'Zoom to the selection' },
    ],
  },
  {
    title: 'Agent',
    entries: [{ keys: ['⇧', '⌘', 'O'], label: 'Open this project in your agent' }],
  },
];

export function ShortcutSheet() {
  const [open, setOpen] = createSignal(false);

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      // `?` is the conventional key, and it needs no modifier — but a text
      // field is a place where `?` means a question mark.
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target?.tagName ?? '')) return;
      if (event.key === '?') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  return (
    <Dialog open={open()} onOpenChange={setOpen}>
      <DialogContent class="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div class="max-h-[60vh] overflow-y-auto pr-1">
          <div class="columns-1 sm:columns-2 gap-6">
            <For each={GROUPS}>
              {(group) => (
                <section class="mb-5 break-inside-avoid">
                  <p class="mb-1.5 text-xxs font-450 uppercase tracking-wider text-muted-foreground">
                    {group.title}
                  </p>
                  <For each={group.entries}>
                    {(entry) => (
                      <div class="flex items-baseline justify-between gap-3 py-1">
                        <span class="text-xxs text-foreground">{entry.label}</span>
                        <span class="flex shrink-0 items-center gap-0.5">
                          <For each={entry.keys}>{(key) => <Kbd>{key}</Kbd>}</For>
                        </span>
                      </div>
                    )}
                  </For>
                </section>
              )}
            </For>
          </div>
        </div>
        <Show when={open()}>
          <p class="pt-1 text-xxs text-muted-foreground">Press ? again to close.</p>
        </Show>
      </DialogContent>
    </Dialog>
  );
}
