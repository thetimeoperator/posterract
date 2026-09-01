/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  AdjustmentLayer, Animation, AnimationPhase, AnimationType, Audio, Caption, Computed, Diagram,
  DiagramKindType, Effect, Fonts, FrameRate, Geometry, Group, IsMask, Keyframe, KeyframeTrack, Name,
  PaintType, Scene, Sequential, Shadow, Source, Stage, Stroke, getActiveEntity,
  getEntityChildren, getIntrinsicPaint, isText,
} from "@posterract/video-runtime";
import { ANIMATION_TYPES, trackProperty } from "@posterract/video-reconciler";
import { parseSource } from "@posterract/composition";

import { getProject, getProjectsRoot } from "@/projects";
import { readProjectSource } from "@/projects/host";
import { getInspectEntries } from "@/engine/inspect";

import type { Accessor } from "solid-js";
import type { EditorSession } from "./session";
import type { ContextRequest, RuntimeTreeNode } from "@posterract/cli/channels";
import type { Entity, World } from "koota";

function sourceId(entity: Entity): string | null {
  const source = entity.get(Source)?.value;
  if (!source) return null;
  const locator = parseSource(source)?.locator;
  return typeof locator === "string" ? locator : null;
}

/** Source-level animation names, so the tree speaks the vocabulary the file uses. */
const ANIMATION_NAMES = new Map<AnimationType, string>(
  Object.entries(ANIMATION_TYPES).map(([name, type]) => [type, name]),
);

function kindOf(entity: Entity): string {
  if (entity.has(Stage)) return "stage";
  // Motion and decoration entities are real children in the tree. Without
  // these cases they all fell through to "node", which left an agent unable
  // to see the keyframes and animations it had just written.
  if (entity.has(KeyframeTrack)) return "keyframe-track";
  if (entity.has(Keyframe)) return "keyframe";
  if (entity.has(Animation)) return "animation";
  if (entity.has(Stroke)) return "stroke";
  if (entity.has(Shadow)) return "shadow";
  if (entity.has(Effect)) return "effect";
  if (entity.has(IsMask)) return "mask";
  if (entity.has(Scene)) return "scene";
  if (entity.has(Sequential)) return "sequence";
  if (entity.has(Group)) return "group";
  if (entity.has(AdjustmentLayer)) return "adjustment-layer";
  if (entity.has(Audio)) return "audio";
  if (entity.has(Caption)) return "captions";
  if (isText(entity)) return "text";
  const diagram = entity.get(Diagram);
  if (diagram) {
    switch (diagram.kind) {
      case DiagramKindType.NODE: return "diagram-node";
      case DiagramKindType.ARROW: return "diagram-arrow";
      case DiagramKindType.EQUATION: return "diagram-equation";
      case DiagramKindType.AXIS: return "diagram-axis";
      case DiagramKindType.PLOT: return "diagram-plot";
      case DiagramKindType.CALLOUT: return "diagram-callout";
    }
  }
  if (!entity.has(Geometry)) return "node";
  switch (getIntrinsicPaint(entity)) {
    case PaintType.VIDEO: return "video";
    case PaintType.IMAGE: return "image";
    case PaintType.HTML: return "html";
    case PaintType.SURFACE: return "surface";
    default: return "rect";
  }
}

/**
 * The values that only exist on the entity, not in the tree's shape: which
 * property a track drives, when a keyframe sits and what it holds, how an
 * animation is configured. Times are reported in seconds because that is what
 * the source file uses, even though the runtime stores frames.
 */
function detailOf(entity: Entity, frameRate: number): RuntimeTreeNode["detail"] {
  const track = entity.get(KeyframeTrack);
  if (track) return { property: trackProperty(track.property) ?? track.property };

  const keyframe = entity.get(Keyframe);
  if (keyframe) {
    return {
      time: Number((keyframe.time / frameRate).toFixed(4)),
      frame: keyframe.time,
      value: keyframe.value,
      easing: keyframe.easing,
    };
  }

  const animation = entity.get(Animation);
  if (animation) {
    return {
      type: ANIMATION_NAMES.get(animation.type) ?? String(animation.type),
      duration: Number((animation.duration / frameRate).toFixed(4)),
      delay: Number((animation.delay / frameRate).toFixed(4)),
      phase: animation.phase === AnimationPhase.OUT ? "out" : "in",
    };
  }

  return undefined;
}

function runtimeTree(world: World, entity: Entity, frameRate: number): RuntimeTreeNode {
  const detail = detailOf(entity, frameRate);
  return {
    id: sourceId(entity),
    source: entity.get(Source)?.value ?? null,
    name: entity.get(Name)?.value || null,
    kind: kindOf(entity),
    ...(detail ? { detail } : {}),
    children: getEntityChildren(world, entity).map((child) => runtimeTree(world, child, frameRate)),
  };
}

/**
 * What `posterract context` reports: what the project's source cannot say. The JSX is
 * the composition — its scenes, what is selected, which scene is active, the
 * work area are all in the file, and a caller that wants them reads it. What is
 * left over is which folder projects live under, which project folder the app
 * has open, where its playhead sits, which font families are actually
 * registered in the world drawing it. With no project open only the root is
 * left to report, and the report says so.
 */
export function handleContextGet(session: Accessor<EditorSession | null>) {
  return async ({ tree = false }: ContextRequest = {}) => {
    const rootDir = await getProjectsRoot();

    const open = session();
    if (!open) return { rootDir, projectDir: null };

    const { world, project } = open;
    const frameRate = world.get(FrameRate)?.value || 30;
    const active = getActiveEntity(world);
    const projectInfo = await getProject(project.dir());
    let sourceRevision: string | null = null;
    if (projectInfo) {
      try {
        sourceRevision = (await readProjectSource(projectInfo.dir, projectInfo.entry)).revisionId;
      } catch {
        sourceRevision = null;
      }
    }
    const stage = tree ? [...world.query(Stage)][0] : undefined;

    return {
      rootDir,
      projectDir: project.dir(),
      // Seconds, the unit the source places clips in; null when no scene is
      // active, which is when there is no playhead to report.
      currentTime: active ? (active.get(Computed)?.localTime ?? 0) / frameRate : null,
      frameRate,
      activeSceneId: active ? sourceId(active) : null,
      sourceRevision,
      compileState: "ready" as const,
      // What text can be drawn with right now: registered in the world, not
      // merely named in the source. The editor default is always among them.
      fontFamilies: [...new Set(["Inter", ...(world.get(Fonts)?.list ?? []).map((f) => f.family)])],
      variables: getInspectEntries(world).map((entry) => ({
        file: entry.file,
        name: entry.name,
        type: entry.type,
        path: [...entry.group, entry.label],
        min: entry.min,
        max: entry.max,
        step: entry.step,
        options: entry.options,
        value: entry.get(),
      })),
      ...(tree && { tree: stage ? runtimeTree(world, stage, frameRate) : null }),
    };
  }
}
