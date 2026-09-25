/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { talkKeyName, voiceTalkKey } from '@/engine/input/shortcuts';
import { barCommands } from '@/engine/voice';
import { displayKeys } from '@/lib/command-match';

import type { CommandGroup } from '@/engine/input/shortcuts';

type Entry = { keys: string[]; label: string };
type Group = { title: string; entries: Entry[] };

/** The groups in the order an editor thinks: moving through time, cutting, arranging. */
const GROUP_ORDER: CommandGroup[] = ['Transport', 'Range', 'Editing', 'Canvas', 'Timeline', 'Export', 'Agent'];

/** The voice bar's own keys, which a table of key presses cannot spell (the talk key is held, not pressed). */
const voiceBar = (): Group => ({
  title: 'Voice bar',
  entries: [
    { keys: [`Hold ${talkKeyName(voiceTalkKey())}`], label: 'Talk to the editor' },
    { keys: ['⌘', 'K'], label: 'Type a command' },
  ],
});

/**
 * Every command the editor answers to, in one place — built from the same
 * list the voice bar matches against, so a command that exists is a command
 * listed here. Commands with no key are listed too: they can be typed or said.
 */
function groups(): Group[] {
  const commands = barCommands();
  return [
    ...GROUP_ORDER.map((title) => ({
      title,
      entries: commands
        .filter((command) => command.group === title)
        .map((command) => ({ keys: displayKeys(command.keys), label: command.label })),
    })).filter((group) => group.entries.length > 0),
    voiceBar(),
  ];
}

export function ShortcutSheet() {
  const [open, setOpen] = createSignal(false);
  const sheet = createMemo(groups);

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
            <For each={sheet()}>
              {(group) => (
                <section class="mb-5 break-inside-avoid">
                  <p class="mb-1.5 text-xxs font-450 uppercase tracking-wider text-muted-foreground">
                    {group.title}
                  </p>
                  <For each={group.entries}>
                    {(entry) => (
                      <div class="flex items-baseline justify-between gap-3 py-1">
                        <span class="text-xxs text-foreground">{entry.label}</span>
                        <Show when={entry.keys.length > 0} fallback={<span class="shrink-0 text-xxs text-muted-foreground">Type or say it</span>}>
                          <span class="flex shrink-0 items-center gap-0.5">
                            <For each={entry.keys}>{(key) => <Kbd>{key}</Kbd>}</For>
                          </span>
                        </Show>
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
