/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createResource, createSignal, For, Show } from 'solid-js';
import { toast } from 'somoto';

import { PanelSection } from '@/components/ui/panel-section';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useProject } from '@/context/project';
import { saveState } from '@/context/save-state';
import { listRevisions, listTrash, restoreRevision, restoreTrash } from '@/projects/history';

import type { RevisionEntry, TrashEntry } from '@/projects/history';

function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1_000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
}

/**
 * Every write to the composition is snapshotted outside the project folder,
 * and deleted scenes are kept beside it. Neither was reachable from the app,
 * which made both invisible to the person they exist for. This panel is the
 * whole of that safety net in one place: what the file used to be, and what
 * was thrown away.
 */
export function VersionHistory() {
  const project = useProject();
  const [busy, setBusy] = createSignal<string | null>(null);

  // A new snapshot is written on every save, so the list is re-read whenever
  // the writer reports one rather than polling.
  const [revisions, revisionsApi] = createResource(
    () => [project.dir(), saveState().status] as const,
    ([dir]) => listRevisions(dir).catch(() => [] as RevisionEntry[]),
  );
  const [trash, trashApi] = createResource(
    () => project.dir(),
    (dir) => listTrash(dir).catch(() => [] as TrashEntry[]),
  );

  const onRestoreRevision = async (entry: RevisionEntry) => {
    if (busy()) return;
    setBusy(entry.id);
    try {
      await restoreRevision(project.dir(), entry.id);
      toast.success('Version restored', {
        description: 'The state you were on was saved first, so this is undoable.',
      });
      void revisionsApi.refetch();
    } catch (cause) {
      toast.error('Could not restore that version', {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBusy(null);
    }
  };

  const onRestoreTrash = async (entry: TrashEntry) => {
    if (busy()) return;
    setBusy(entry.id);
    try {
      const { name } = await restoreTrash(project.dir(), entry.id);
      toast.success(`${name} restored`);
      void trashApi.refetch();
      void revisionsApi.refetch();
    } catch (cause) {
      toast.error('Could not restore that scene', {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PanelSection
        title="Version history"
        subtitle={
          <Show when={revisions()?.length}>
            <span class="text-muted-foreground">{revisions()!.length}</span>
          </Show>
        }
      >
        <Show
          when={revisions()?.length}
          fallback={
            <p class="text-xxs leading-4 text-muted-foreground">
              Every edit is saved to the project source and kept here. The first version appears
              after your next change.
            </p>
          }
        >
          {/* Fifty snapshots are kept; showing them all would bury every
              section below this one, so the list scrolls at about five. */}
          <div class="-mx-1 max-h-52 overflow-y-auto">
            <For each={revisions()}>
              {(entry) => (
                <div class="group/version flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-accent">
                  <Show when={entry.deleted}>
                    <Icon name="alert-warning" class="size-4 shrink-0 text-destructive" />
                  </Show>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xxs text-foreground">
                      {entry.deleted ? 'Before the file was deleted' : ago(entry.savedAt)}
                    </p>
                    <p class="text-xxs text-muted-foreground">
                      {entry.deleted ? ago(entry.savedAt) : size(entry.bytes)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="small"
                    class="shrink-0 opacity-0 group-hover/version:opacity-100 focus-visible:opacity-100"
                    disabled={busy() !== null}
                    onClick={() => void onRestoreRevision(entry)}
                  >
                    {busy() === entry.id ? 'Restoring…' : 'Restore'}
                  </Button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </PanelSection>

      <Show when={trash()?.length}>
        <PanelSection
          title="Trash"
          subtitle={<span class="text-muted-foreground">{trash()!.length}</span>}
        >
          <div class="-mx-1 max-h-40 overflow-y-auto">
            <For each={trash()}>
              {(entry) => (
                <div class="group/trash flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-accent">
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xxs text-foreground">{entry.name}</p>
                    <p class="text-xxs text-muted-foreground">Deleted {ago(entry.deletedAt)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="small"
                    class="shrink-0 opacity-0 group-hover/trash:opacity-100 focus-visible:opacity-100"
                    disabled={busy() !== null}
                    onClick={() => void onRestoreTrash(entry)}
                  >
                    {busy() === entry.id ? 'Restoring…' : 'Restore'}
                  </Button>
                </div>
              )}
            </For>
          </div>
        </PanelSection>
      </Show>
    </>
  );
}
