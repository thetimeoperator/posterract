/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createResource, createSignal, For, Show } from 'solid-js';
import { toast } from 'somoto';

import { Icon } from '@/components/ui/icon';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';

import type { ListedExport } from '@desktop/main-channels';

function duration(ms: number | null): string {
  if (!ms) return '';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function size(bytes: number | null): string {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb < 1 ? `${Math.round(bytes / 1024)} kB` : `${mb.toFixed(1)} MB`;
}

function when(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days === 0) return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Every finished render, on this machine.
 *
 * Export is local and nothing is uploaded by rendering — so the library is
 * where a video lives until the user decides to do something with it. Sending
 * one to the cloud is a deliberate action taken from here, never a side effect
 * of finishing an export.
 */
export function ExportsView() {
  const [busy, setBusy] = createSignal<string | null>(null);
  const [exports, { refetch }] = createResource(() =>
    mainBridge.call(MAIN_CHANNELS.EXPORTS_LIST, undefined).catch(() => [] as ListedExport[]),
  );

  const act = async (id: string, run: () => Promise<unknown>, failure: string) => {
    if (busy()) return;
    setBusy(id);
    try {
      await run();
      void refetch();
    } catch (cause) {
      toast.error(failure, { description: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(null);
    }
  };

  /**
   * The one path that leaves this computer. The host page owns the upload and
   * the compose handoff; the editor only says which file the user chose.
   */
  const sendToCloud = (entry: ListedExport, schedule: boolean) => {
    window.parent.postMessage({
      type: 'posterract-export-complete',
      path: entry.path,
      fileName: entry.fileName,
      contentType: entry.contentType,
      durationMs: entry.durationMs ?? undefined,
      projectId: entry.projectId,
      sceneId: entry.sceneId,
      sourceRevision: entry.sourceRevision,
      width: entry.width,
      height: entry.height,
      intent: schedule ? 'schedule' : 'post',
    }, '*');
  };

  return (
    <div class="flex flex-col h-full min-h-0">
      <div class="h-10 shrink-0 flex items-center justify-between px-4">
        <span class="text-xs font-450 text-foreground">
          Exports
          <Show when={exports()?.length}>
            <span class="ml-1 text-muted-foreground">({exports()!.length})</span>
          </Show>
        </span>
      </div>

      <Show
        when={exports()?.length}
        fallback={
          <p class="px-4 text-xxs leading-4 text-muted-foreground">
            Exported videos are saved on this computer and listed here. Nothing is uploaded until
            you schedule or post one.
          </p>
        }
      >
        <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <For each={exports()}>
            {(entry) => (
              <ContextMenu>
                <ContextMenuTrigger
                  as="div"
                  class="group/export flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent"
                  classList={{ 'opacity-50': entry.missing }}
                >
                  <Icon name={entry.missing ? 'alert-warning' : 'video-small'} class="size-6 shrink-0 text-muted-foreground" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xxs text-foreground">{entry.fileName}</p>
                    <p class="truncate text-xxs text-muted-foreground">
                      <Show when={entry.missing} fallback={
                        [when(entry.createdAt), duration(entry.durationMs), size(entry.bytes)]
                          .filter(Boolean)
                          .join(' · ')
                      }>
                        Moved or deleted on disk
                      </Show>
                    </p>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuPortal>
                  <ContextMenuContent class="w-[180px]">
                    <ContextMenuItem disabled={entry.missing} onSelect={() => sendToCloud(entry, false)}>
                      Post now
                    </ContextMenuItem>
                    <ContextMenuItem disabled={entry.missing} onSelect={() => sendToCloud(entry, true)}>
                      Schedule
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      disabled={entry.missing || busy() !== null}
                      onSelect={() => void act(entry.id, () => mainBridge.call(MAIN_CHANNELS.EXPORTS_REVEAL, { id: entry.id }), 'Could not reveal that file')}
                    >
                      Reveal in Finder
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      disabled={busy() !== null}
                      onSelect={() => void act(
                        entry.id,
                        () => mainBridge.call(MAIN_CHANNELS.EXPORTS_DELETE, { id: entry.id, removeFile: !entry.missing }),
                        'Could not remove that export',
                      )}
                    >
                      Move to Trash
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenuPortal>
              </ContextMenu>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
