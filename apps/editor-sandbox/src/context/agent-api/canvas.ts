/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  Computed,
  FrameRate,
  Selected,
  Source,
  getActiveEntity,
  setPlayhead,
} from "@posterract/video-runtime";
import { parseSource, type PropValue } from "@posterract/composition";
import { getDocumentEditor, getEditHistory } from "@/engine";
import {
  groupSelection,
  ungroupSelection,
  unwrapSequenceSelection,
  wrapSelectionInScene,
  wrapSelectionInSequence,
} from "@/engine/group";
import { renderAuthored, type AuthoredTree } from "@posterract/video-reconciler";
import { resolveNode } from "./nodes";

import type {
  CanvasActivateRequest,
  CanvasCreateRequest,
  CanvasGroupRequest,
  CanvasIdsRequest,
  CanvasMoveRequest,
  CanvasSeekRequest,
  CanvasSelectRequest,
  CanvasSetPropertiesRequest,
  CanvasSetTextRequest,
  CanvasStateResult,
  CanvasUngroupRequest,
  CanvasVariableRequest,
} from "@posterract/cli/channels";
import type { EditorSession } from "./session";

function sourceId(source: string | undefined): string | null {
  if (!source) return null;
  const parsed = parseSource(source);
  return parsed ? String(parsed.locator) : source;
}

export function canvasState(session: () => EditorSession): CanvasStateResult {
  const { world } = session();
  const active = getActiveEntity(world);
  const frameRate = world.get(FrameRate)?.value || 30;
  const history = getEditHistory(world);
  return {
    activeSceneId: sourceId(active?.get(Source)?.value),
    selectedIds: world
      .query(Selected, Source)
      .map((entity) => sourceId(entity.get(Source)?.value))
      .filter((id): id is string => id !== null),
    currentTime: active ? (active.get(Computed)?.localTime ?? 0) / frameRate : null,
    frameRate,
    canUndo: history.canUndo(),
    canRedo: history.canRedo(),
  };
}

export function canvasSelect(session: () => EditorSession, request: CanvasSelectRequest): CanvasStateResult {
  const { world } = session();
  const editor = getDocumentEditor(world);
  const entities = request.ids.map((id) => resolveNode(world, id));
  editor.select(entities, { extend: request.extend });
  return canvasState(session);
}

export function canvasActivate(session: () => EditorSession, request: CanvasActivateRequest): CanvasStateResult {
  const { world } = session();
  getDocumentEditor(world).activate(request.id === null ? null : resolveNode(world, request.id));
  return canvasState(session);
}

export function canvasSeek(session: () => EditorSession, request: CanvasSeekRequest): CanvasStateResult {
  if (!Number.isFinite(request.time) || request.time < 0) throw new Error("Canvas time must be a non-negative number of seconds.");
  const { world } = session();
  const scene = getActiveEntity(world);
  if (!scene) throw new Error("No active video. Activate a scene before seeking.");
  const frameRate = world.get(FrameRate)?.value || 30;
  setPlayhead(world, scene, Math.round(request.time * frameRate));
  return canvasState(session);
}

export function canvasSetProperties(session: () => EditorSession, request: CanvasSetPropertiesRequest): CanvasStateResult {
  const { world } = session();
  const entity = resolveNode(world, request.id);
  const editor = getDocumentEditor(world);
  for (const [name, value] of Object.entries(request.properties)) {
    editor.editProperty(entity, name, value as PropValue);
  }
  return canvasState(session);
}

export function canvasSetText(session: () => EditorSession, request: CanvasSetTextRequest): CanvasStateResult {
  const { world } = session();
  getDocumentEditor(world).editText(resolveNode(world, request.id), request.text);
  return canvasState(session);
}

function authoredTree(element: CanvasCreateRequest["element"]): AuthoredTree {
  return {
    tag: element.tag,
    props: (element.props ?? {}) as AuthoredTree["props"],
    ...(element.text === undefined ? {} : { text: element.text }),
    children: (element.children ?? []).map(authoredTree),
  };
}

export function canvasCreate(session: () => EditorSession, request: CanvasCreateRequest): CanvasStateResult {
  const { world } = session();
  if (!/^[a-z][a-zA-Z0-9]*$/.test(request.element.tag)) throw new Error("Invalid Posterract element tag.");
  const parent = resolveNode(world, request.parentId);
  const before = request.beforeId ? resolveNode(world, request.beforeId) : undefined;
  const created = getDocumentEditor(world).insertElement(parent, () => renderAuthored(authoredTree(request.element)), before);
  if (!created.length) throw new Error("The element could not be inserted under that parent.");
  getDocumentEditor(world).select(created);
  return canvasState(session);
}

export function canvasSetVariable(session: () => EditorSession, request: CanvasVariableRequest): CanvasStateResult {
  const { world } = session();
  getDocumentEditor(world).editVariable(request.file, request.name, request.value);
  return canvasState(session);
}

export function canvasGroup(session: () => EditorSession, request: CanvasGroupRequest): CanvasStateResult {
  const { world } = session();
  getDocumentEditor(world).select(request.ids.map((id) => resolveNode(world, id)));
  if (request.kind === "sequence") wrapSelectionInSequence(world);
  else if (request.kind === "scene") wrapSelectionInScene(world);
  else groupSelection(world);
  return canvasState(session);
}

export function canvasUngroup(session: () => EditorSession, request: CanvasUngroupRequest): CanvasStateResult {
  const { world } = session();
  getDocumentEditor(world).select(resolveNode(world, request.id));
  if (request.kind === "sequence") unwrapSequenceSelection(world);
  else ungroupSelection(world);
  return canvasState(session);
}

export function canvasDuplicate(session: () => EditorSession, request: CanvasIdsRequest): CanvasStateResult {
  const { world } = session();
  getDocumentEditor(world).duplicate(request.ids.map((id) => resolveNode(world, id)));
  return canvasState(session);
}

export function canvasRemove(session: () => EditorSession, request: CanvasIdsRequest): CanvasStateResult {
  const { world } = session();
  getDocumentEditor(world).remove(request.ids.map((id) => resolveNode(world, id)));
  return canvasState(session);
}

export function canvasMove(session: () => EditorSession, request: CanvasMoveRequest): CanvasStateResult {
  const { world } = session();
  const moved = getDocumentEditor(world).reparent(
    resolveNode(world, request.id),
    resolveNode(world, request.parentId),
    request.beforeId ? resolveNode(world, request.beforeId) : undefined,
  );
  if (!moved) throw new Error("The requested move is invalid or would not change the document.");
  return canvasState(session);
}

export function canvasUndo(session: () => EditorSession): CanvasStateResult {
  const { world } = session();
  getEditHistory(world).undo();
  return canvasState(session);
}

export function canvasRedo(session: () => EditorSession): CanvasStateResult {
  const { world } = session();
  getEditHistory(world).redo();
  return canvasState(session);
}
