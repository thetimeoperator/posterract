/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  Computed,
  FrameRate,
  Locked,
  Name,
  Scene,
  Selected,
  Source,
  getActiveEntity,
  getEntityChildren,
  getEntityTree,
  setPlayhead,
} from "@posterract/video-runtime";
import { stampedId } from "@/engine/delete-guard";
import { putTrash } from "@/projects/history";
import { parseSource, type AnimatableProperty, type PropValue } from "@posterract/composition";
import { getDocumentEditor, getEditHistory } from "@/engine";
import { bakeToKeyframes } from "@/engine/bake";
import {
  groupSelection,
  ungroupSelection,
  unwrapSequenceSelection,
  wrapSelectionInScene,
  wrapSelectionInSequence,
} from "@/engine/group";
import { authoredElement, renderAuthored, type AuthoredTree } from "@posterract/video-reconciler";
import { checkProps, checkTree } from "@posterract/video-compiler/vocabulary";
import { resolveNode } from "./nodes";

import type { Entity } from "koota";
import type {
  CanvasActivateRequest,
  CanvasApplyRequest,
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
  CanvasBakeRequest,
  CanvasBakeResult,
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

/**
 * What an edit was let through with but should hear about: a prop the runtime
 * accepts that the element does not document. Collected while a call is
 * checked and handed over with its result (see `takeEditWarnings`).
 */
let editWarnings: string[] = [];

/** The warnings of the edit that just ran, once. */
export function takeEditWarnings(): string[] {
  const taken = editWarnings;
  editWarnings = [];
  return taken;
}

/**
 * Refuses props that would do nothing, before anything is changed. The runtime
 * ignores a prop name it does not know and the writer spells out whatever it
 * is handed, so without this a wrong guess — `speed` on a `<video>` — does
 * nothing on the canvas, is written into the source anyway, and is reported as
 * a success. A name the runtime knows but the element does not document is let
 * through with a warning that names the documented prop: it may well work
 * (`fill` on a `<text>` colors it as `color` would), and refusing what works
 * would be a lie. All of a call's props are checked first: an edit is applied
 * whole or not at all.
 */
function requireKnownProps(tag: string, id: string | undefined, props: Record<string, unknown>): void {
  const { problems, warnings } = checkProps(tag, id, props);
  if (problems.length) {
    throw new Error(`${problems.join(" ")} Nothing was changed. \`posterract describe ${tag}\` lists what <${tag}> takes.`);
  }
  editWarnings.push(...warnings);
}

export function canvasSetProperties(session: () => EditorSession, request: CanvasSetPropertiesRequest): CanvasStateResult {
  const { world } = session();
  const entity = resolveNode(world, request.id);
  const tag = authoredElement(entity)?.tag;
  if (tag) requireKnownProps(tag, request.id, request.properties);
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

/** Checks a whole tree to be created: every tag a real element, every prop one it takes. */
function requireKnownTree(element: CanvasCreateRequest["element"]): void {
  const { problems, warnings } = checkTree(element);
  if (problems.length) throw new Error(`${problems.join(" ")} Nothing was created. \`posterract describe\` lists the elements and their props.`);
  editWarnings.push(...warnings);
}

export function canvasCreate(session: () => EditorSession, request: CanvasCreateRequest): CanvasStateResult {
  const { world } = session();
  if (!/^[a-z][a-zA-Z0-9]*$/.test(request.element.tag)) throw new Error("Invalid Posterract element tag.");
  requireKnownTree(request.element);
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

/**
 * Sample what a property does across an element's span and write it back as a
 * keyframe track.
 *
 * This is how motion written in code becomes motion an agent — or a person —
 * can retime: a track wins over the code value, so the baked version is what
 * plays, while the original expression stays in the source.
 */
export async function canvasBake(
  session: () => EditorSession,
  request: CanvasBakeRequest,
): Promise<CanvasBakeResult> {
  const { world, project } = session();
  const target = resolveNode(world, request.id);
  const result = await bakeToKeyframes(
    world,
    getDocumentEditor(world),
    target,
    request.property as AnimatableProperty,
    { tolerance: request.tolerance, dir: project.dir() },
  );
  if (!result) {
    throw new Error(
      `Nothing to bake: ${request.id} has no span in the source, or "${request.property}" is not animatable on it.`,
    );
  }
  return result;
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

/**
 * The agent's delete is held to the same rule as the keyboard's: a populated
 * scene is copied to the project trash before it goes, and a locked layer is
 * left alone. There is no confirmation dialog on this path — the agent is
 * acting on an instruction — but the recovery it would have offered exists.
 */
export async function canvasRemove(session: () => EditorSession, request: CanvasIdsRequest): Promise<CanvasStateResult> {
  const { world, project } = session();
  const entities = request.ids.map((id) => resolveNode(world, id)).filter((entity) => !entity.has(Locked));
  for (const entity of entities) {
    const id = stampedId(entity);
    if (entity.has(Scene) && id && getEntityChildren(world, entity).length) {
      await putTrash(project.dir(), { sceneId: id, name: entity.get(Name)?.value || "Untitled scene" });
    }
  }
  if (entities.length) getDocumentEditor(world).remove(entities);
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

/** Every id a tree to be created names, with the tag it names it on. */
function namedIn(element: CanvasCreateRequest["element"], into: Map<string, string>): void {
  if (typeof element.props?.id === "string") into.set(element.props.id, element.tag);
  for (const child of element.children ?? []) namedIn(child as CanvasCreateRequest["element"], into);
}

/**
 * Several edits as one: one step of the undo history, one write of the source,
 * and all of them or none.
 *
 * An agent that works through tools pays a round trip per call, and a caption
 * made of a group, a shape and a text is three creates and a handful of props —
 * a dozen round trips, a dozen undo steps and a dozen revisions for what the
 * person will think of as one thing. Everything is checked before anything is
 * changed (every id there or about to be, every tag and prop known), and an
 * edit that still fails halfway has what came before it taken back. An edit may
 * name an element an earlier one of the same call creates, by the `id` it gave it.
 */
export async function canvasApply(
  session: () => EditorSession,
  request: CanvasApplyRequest,
  // Inside a caller's gesture (the voice bar running a whole sentence): the
  // edits join that one undo step, and a failure is the caller's to take back.
  options: { inGesture?: boolean } = {},
): Promise<CanvasStateResult> {
  const { world } = session();
  const edits = request.edits ?? [];
  if (!Array.isArray(edits) || !edits.length) throw new Error("`edits` is empty: nothing to apply.");

  // 1. Check it all. Nothing has changed yet, so a refusal here costs nothing.
  const coming = new Map<string, string>();
  const known = (id: string): string | undefined => coming.get(id) ?? authoredElement(resolveNode(world, id))?.tag;
  edits.forEach((edit, index) => {
    try {
      switch (edit.op) {
        case "set": {
          const tag = known(edit.id);
          if (tag) requireKnownProps(tag, edit.id, edit.properties ?? {});
          break;
        }
        case "text":
          known(edit.id);
          break;
        case "create":
          if (!/^[a-z][a-zA-Z0-9]*$/.test(edit.element?.tag ?? "")) throw new Error("Invalid Posterract element tag.");
          requireKnownTree(edit.element);
          known(edit.parentId);
          if (edit.beforeId) known(edit.beforeId);
          namedIn(edit.element, coming);
          break;
        case "move":
          known(edit.id);
          known(edit.parentId);
          if (edit.beforeId) known(edit.beforeId);
          break;
        case "delete":
        case "duplicate":
          for (const id of edit.ids ?? []) known(id);
          break;
        default:
          throw new Error(`Unknown op "${(edit as { op?: string }).op}". Use set, text, create, move, delete or duplicate.`);
      }
    } catch (error) {
      takeEditWarnings();
      throw new Error(`Edit ${index + 1} of ${edits.length} (${edit.op}): ${(error as Error).message}`);
    }
  });

  // 2. Apply it all, as one step. An element created here has no name in the
  //    file until the write answers, so later edits find it by the id it was given.
  const editor = getDocumentEditor(world);
  const history = getEditHistory(world);
  const made = new Map<string, Entity>();
  const find = (id: string): Entity => made.get(id) ?? resolveNode(world, id);

  let failure: { index: number; error: Error } | undefined;
  if (!options.inGesture) history.beginGesture();
  try {
    for (const [index, edit] of edits.entries()) {
      try {
        if (edit.op === "set") {
          const entity = find(edit.id);
          for (const [name, value] of Object.entries(edit.properties ?? {})) editor.editProperty(entity, name, value as PropValue);
        } else if (edit.op === "text") {
          editor.editText(find(edit.id), edit.text);
        } else if (edit.op === "create") {
          const created = editor.insertElement(
            find(edit.parentId),
            () => renderAuthored(authoredTree(edit.element)),
            edit.beforeId ? find(edit.beforeId) : undefined,
          );
          if (!created.length) throw new Error("The element could not be inserted under that parent.");
          for (const top of created) {
            for (const entity of getEntityTree(world, top)) {
              const id = authoredElement(entity)?.props.id;
              if (typeof id === "string") made.set(id, entity);
            }
          }
        } else if (edit.op === "move") {
          if (!editor.reparent(find(edit.id), find(edit.parentId), edit.beforeId ? find(edit.beforeId) : undefined)) {
            throw new Error("The requested move is invalid or would not change the document.");
          }
        } else if (edit.op === "duplicate") {
          editor.duplicate(edit.ids.map(find));
        } else {
          await canvasRemove(session, { ids: edit.ids });
        }
      } catch (error) {
        failure = { index, error: error as Error };
        break;
      }
    }
  } finally {
    // Whatever was done is one step — which is also what lets it be taken back whole.
    if (!options.inGesture) {
      const recorded = history.endGesture();
      if (failure && recorded) history.undo();
    }
  }
  if (failure) {
    takeEditWarnings();
    throw new Error(
      `Edit ${failure.index + 1} of ${edits.length} (${edits[failure.index]!.op}) failed: ${failure.error.message} ` +
        "The edits before it were taken back: nothing was changed.",
    );
  }
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
