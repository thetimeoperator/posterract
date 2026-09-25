/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What a menu item, a key or the zoom control does to the view. Every move of
 * the camera is reported through the editor, the same way a pan is (see
 * `CameraController`); it is remembered beside the project rather than in its
 * source (see `@/projects/view-state`), so looking around never edits the file.
 */

import {
	Root,
	focusContent,
	focusEntities,
	getCameraMatrix,
	getSelection,
	setCameraZoom,
	zoomCameraBy,
} from '@posterract/video-runtime';

import { getDocumentEditor } from './editor';

import type { World } from 'koota';

type WorkspaceCamera = { fit(): void; manual(): void };
const workspaceCameras = new WeakMap<World, WorkspaceCamera>();
export function bindWorkspaceCamera(world: World, camera: WorkspaceCamera) {
	workspaceCameras.set(world, camera);
	return () => { if (workspaceCameras.get(world) === camera) workspaceCameras.delete(world); };
}
export function useManualCamera(world: World): void { workspaceCameras.get(world)?.manual(); }

function reportCamera(world: World): void {
	getDocumentEditor(world).reportEdit(world.get(Root)!, 'camera', getCameraMatrix(world));
}

/** Zooms around the center of the viewport: above 1 in, below 1 out. */
export function zoomBy(world: World, factor: number): void {
	useManualCamera(world);
	zoomCameraBy(world, factor);
	reportCamera(world);
}

/** Zooms to an absolute scale, 1 being 100%. */
export function zoomTo(world: World, scale: number): void {
	useManualCamera(world);
	setCameraZoom(world, scale);
	reportCamera(world);
}

/** Frames everything on the stage. */
export function zoomToFit(world: World): void {
	const workspace = workspaceCameras.get(world);
	if (workspace) { workspace.fit(); return; }
	focusContent(world);
	reportCamera(world);
}

/** Frames the selection, wherever on the stage it sits. */
export function zoomToSelection(world: World): void {
	useManualCamera(world);
	const selected = getSelection(world);
	if (!selected.length) return;

	focusEntities(world, selected);
	reportCamera(world);
}
