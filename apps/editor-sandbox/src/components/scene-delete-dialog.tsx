/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, Show } from 'solid-js';
import { toast } from 'somoto';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useProject } from '@/context/project';
import { getDocumentEditor } from '@/engine/editor';
import { clearPendingSceneDelete, pendingSceneDelete } from '@/engine/delete-guard';
import { putTrash } from '@/projects/history';

/**
 * The confirmation for deleting a scene with content. The trash copy is taken
 * *before* the removal and the removal is abandoned if it fails, so there is
 * no window in which the scene is gone and unrecoverable.
 */
export function SceneDeleteDialog() {
  const project = useProject();
  const [deleting, setDeleting] = createSignal(false);

  const pending = pendingSceneDelete;
  const names = () => pending()?.scenes.map((scene) => scene.name) ?? [];

  const confirm = async () => {
    const request = pending();
    if (!request || deleting()) return;
    setDeleting(true);
    try {
      for (const scene of request.scenes) {
        await putTrash(project.dir(), { sceneId: scene.id, name: scene.name });
      }
      getDocumentEditor(request.world).remove([
        ...request.scenes.map((scene) => scene.entity),
        ...request.rest,
      ]);
      clearPendingSceneDelete();
    } catch (cause) {
      toast.error('Nothing was deleted', {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog
      open={pending() !== null}
      onOpenChange={(open) => {
        if (!open && !deleting()) clearPendingSceneDelete();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {names().length === 1 ? `Delete "${names()[0]}"?` : `Delete ${names().length} scenes?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Show
              when={names().length === 1}
              fallback="These scenes and everything in them will be removed from the video."
            >
              This scene and everything in it will be removed from the video.
            </Show>
            {' '}A copy is kept in this project's Trash, in the inspector under Version history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="secondary" disabled={deleting()} onClick={() => clearPendingSceneDelete()}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={deleting()} onClick={() => void confirm()}>
            {deleting() ? 'Deleting…' : 'Delete'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
