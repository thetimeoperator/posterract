/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';

import { Icon } from '@/components/ui/icon';
import { describeSavedAt, saveState } from '@/context/save-state';

/**
 * Every edit already streams to the TSX source, but nothing said so, and a
 * user with no save button has no way to know that. The pill is the smallest
 * honest statement of it: what the writer is doing, and when it last
 * succeeded — never a claim that is not backed by a completed write.
 */
export function SavePill() {
  // "2 min ago" has to keep up on its own; the writer only speaks when it
  // changes, and a quiet project would otherwise freeze at "just now".
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 20_000);
    onCleanup(() => window.clearInterval(clock));
  });

  const label = createMemo(() => {
    const state = saveState();
    switch (state.status) {
      case 'saving': return 'Saving…';
      case 'saved': return `Saved · ${describeSavedAt(state.at, now())}`;
      case 'failed': return 'Save failed';
      case 'idle': return '';
    }
  });

  const failed = () => saveState().status === 'failed';

  return (
    <Show when={label()}>
      <span
        class="flex items-center gap-1.5 text-[11px] tabular-nums"
        classList={{
          'text-destructive': failed(),
          'text-muted-foreground': !failed(),
        }}
        title={failed() ? (saveState() as { message: string }).message : 'Edits are written straight to the project source'}
      >
        <Show
          when={failed()}
          fallback={
            <span
              class="size-1.5 rounded-full"
              classList={{
                'bg-muted-foreground animate-pulse': saveState().status === 'saving',
                'bg-emerald-400': saveState().status === 'saved',
              }}
            />
          }
        >
          <Icon name="alert-warning" class="size-4" />
        </Show>
        {label()}
      </span>
    </Show>
  );
}
