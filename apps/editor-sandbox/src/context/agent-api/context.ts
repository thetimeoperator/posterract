/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  AdjustmentLayer, Animation, AnimationPhase, AnimationType, Audio, Caption, Computed, Cue, Diagram,
  DiagramKindType, Effect, Fonts, FrameRate, Geometry, GeometryType, Group, IsMask, Keyframe, KeyframeTrack,
  Component, Live, Lottie, LottieSlot, Marker, Name, Path, PathTrim, Polygon,
  PaintType, Scene, SceneSkill, Sequential, Shadow, Source, Stage, Stroke, getActiveEntity, Tempo, MotionBlur,
  getEntityChildren, getIntrinsicPaint, isText,
} from "@posterract/video-runtime";
import { ANIMATION_TYPES, authoredElement, trackProperty } from "@posterract/video-reconciler";
import { parseSource } from "@posterract/composition";

import { getProject, getProjectsRoot } from "@/projects";
import { readProjectSource } from "@/projects/host";
import { shownRevision } from "@/projects/shown";
import { getInspectEntries } from "@/engine/inspect";

import type { Accessor } from "solid-js";
import type { EditorSession } from "./session";
import type { ContextRequest, RuntimeTreeNode } from "@posterract/cli/channels";
import { findSkill, refreshSkills, skillCards } from "@/lib/skills";
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
  if (entity.has(Lottie)) return "lottie";
  if (entity.has(LottieSlot)) return "lottie-slot";
  if (entity.has(Cue)) return "cue";
  if (entity.has(Marker)) return "marker";
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
  // Vector figures are RECT-shaped in nothing but their trait; reporting one
  // as "rect" would leave an agent unable to see the `<path>` it just wrote.
  switch (entity.get(Geometry)!.value) {
    case GeometryType.PATH: return "path";
    case GeometryType.ELLIPSE: return "ellipse";
    case GeometryType.POLYGON: return "polygon";
  }
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
  // A scene's skill: the SKILL.md folder it is made with, and where that
  // folder is when it is installed on this machine.
  if (entity.has(Scene)) {
    const skill = entity.get(SceneSkill)?.value;
    const tempo = entity.get(Tempo);
    const blur = entity.get(MotionBlur);
    const detail = {
      ...(skill ? { skill, skillPath: findSkill(skill)?.path ?? null } : {}),
      // The beat grid the scene is timed to, and whether its frames are blurred.
      ...(tempo && tempo.bpm > 0 ? { bpm: tempo.bpm, meter: tempo.meter, beatSeconds: Number((60 / tempo.bpm).toFixed(4)) } : {}),
      ...(blur ? { motionBlur: `${blur.shutter}° shutter, ${blur.samples} samples` } : {}),
    };
    if (Object.keys(detail).length) return detail;
  }

  const cue = entity.get(Cue);
  if (cue) {
    return {
      start: Number((cue.start / frameRate).toFixed(4)),
      end: Number((cue.end / frameRate).toFixed(4)),
      text: cue.text,
    };
  }

  const marker = entity.get(Marker);
  if (marker) {
    return {
      time: Number((marker.time / frameRate).toFixed(4)),
      name: marker.name,
      ...(marker.color ? { color: marker.color } : {}),
    };
  }

  const track = entity.get(KeyframeTrack);
  if (track) return { property: trackProperty(track.property) ?? track.property };

  // What a vector figure actually is: an agent that wrote a `d` should be able
  // to read it back, and to see how much of it a trim is currently drawing.
  const path = entity.get(Path);
  const polygon = entity.get(Polygon);
  const trim = entity.get(PathTrim);
  if (path || polygon || trim) {
    return {
      ...(path?.d ? { d: path.d } : {}),
      ...(path?.morphTo ? { morphTo: path.morphTo, morph: path.morph } : {}),
      ...(polygon?.points ? { points: polygon.points } : {}),
      ...(trim && (trim.start !== 0 || trim.end !== 1 || trim.offset !== 0)
        ? { trimStart: trim.start, trimEnd: trim.end, trimOffset: trim.offset }
        : {}),
    };
  }

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

/**
 * The props an edit usually starts from, as the source spells them. Everything
 * else is one `read_source` away; listing every prop of every element is how a
 * tree stops fitting in the reader's head.
 */
const CORE_PROPS = [
  "x", "y", "width", "height", "start", "end", "after", "src", "sourceIn", "sourceOut",
  "rotation", "rotationX", "rotationY", "perspective", "scale", "opacity", "hidden", "fill", "color", "fontFamily", "fontSize", "fontWeight",
  "textAlign", "objectFit", "volume", "muted", "workarea", "skill", "preset", "type", "phase", "duration", "delay",
  "bpm", "meter", "motionBlur", "layout", "layoutTo", "count", "path", "by", "stagger",
] as const;

function coreProps(entity: Entity): Record<string, unknown> | undefined {
  const authored = authoredElement(entity)?.props;
  if (!authored) return undefined;
  const props: Record<string, unknown> = {};
  for (const name of CORE_PROPS) {
    const value = authored[name];
    const literal = typeof value === "string" || typeof value === "number" || typeof value === "boolean" || Array.isArray(value);
    if (literal) props[name] = value;
  }
  return Object.keys(props).length ? props : undefined;
}

/** Nodes that say how an element moves rather than being something on screen. */
const isMotionNode = (entity: Entity): boolean =>
  entity.has(KeyframeTrack) || entity.has(Keyframe) || entity.has(Animation);

/** An element's motion in one line: keyframes per property, presets as `type phase`. */
function motionOf(world: World, entity: Entity): RuntimeTreeNode["motion"] {
  const keyframes: Record<string, number> = {};
  const animations: string[] = [];
  for (const child of getEntityChildren(world, entity)) {
    const track = child.get(KeyframeTrack);
    if (track) {
      const property = trackProperty(track.property) ?? String(track.property);
      keyframes[property] = getEntityChildren(world, child).filter((node) => node.has(Keyframe)).length;
    }
    const animation = child.get(Animation);
    if (animation) {
      const type = ANIMATION_NAMES.get(animation.type) ?? String(animation.type);
      animations.push(`${type} ${animation.phase === AnimationPhase.OUT ? "out" : "in"}`);
    }
  }
  if (!Object.keys(keyframes).length && !animations.length) return undefined;
  return {
    ...(Object.keys(keyframes).length ? { keyframes } : {}),
    ...(animations.length ? { animations } : {}),
  };
}

type TreeOptions = { frameRate: number; motion: boolean; depth: number; scene?: string };

function runtimeTree(world: World, entity: Entity, options: TreeOptions, level = 0): RuntimeTreeNode {
  const detail = detailOf(entity, options.frameRate);
  // The project's own component this came from, when it came from one. A
  // component compiles away, so an agent reading the tree would otherwise see
  // the pieces and never the `<Panel>` the author wrote.
  const component = entity.get(Component)?.name;
  // Props this element gets from code. An agent asked to change `x` on an
  // element whose `x` is an expression needs to know that editing the prop
  // will be overwritten on the next tick — the source expression is what to
  // change, or the prop should be baked first.
  const live = entity.get(Live)?.props;
  const props = coreProps(entity);
  const text = isText(entity) ? authoredElement(entity)?.text : undefined;
  const motion = options.motion ? undefined : motionOf(world, entity);

  let children = getEntityChildren(world, entity);
  if (!options.motion) children = children.filter((child) => !isMotionNode(child));
  // One scene of several: the others are other videos, not context for this one.
  if (entity.has(Stage) && options.scene !== undefined) {
    children = children.filter((child) => !child.has(Scene) || sourceId(child) === options.scene);
  }
  const cut = level >= options.depth;

  return {
    id: sourceId(entity),
    source: entity.get(Source)?.value ?? null,
    name: entity.get(Name)?.value || null,
    kind: kindOf(entity),
    ...(props ? { props } : {}),
    ...(text ? { text } : {}),
    ...(motion ? { motion } : {}),
    ...(component ? { component } : {}),
    ...(live ? { live: live.split(',') } : {}),
    ...(detail ? { detail } : {}),
    ...(cut && children.length ? { more: children.length } : {}),
    children: cut ? [] : children.map((child) => runtimeTree(world, child, options, level + 1)),
  };
}

/**
 * What `posterract context` reports: what the project's source cannot say. The JSX is
 * the composition — its scenes and their work areas are in the file, and a
 * caller that wants them reads it. Where the author is looking (selection,
 * active scene, camera) is in `.posterract/view.json` beside it. What is left
 * over is which folder projects live under, which project folder the app has
 * open, where its playhead sits, which font families are actually registered
 * in the world drawing it. With no project open only the root is left to
 * report, and the report says so.
 */
export function handleContextGet(session: Accessor<EditorSession | null>) {
  return async ({ tree = false, scene, depth, motion = false }: ContextRequest = {}) => {
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

    // The skill list is fetched lazily; the first context call pays for it.
    const activeSkillName = active?.get(SceneSkill)?.value ?? "";
    if (activeSkillName && !skillCards().length) await refreshSkills(project.dir()).catch(() => undefined);
    const activeSkill = activeSkillName ? { name: activeSkillName, path: findSkill(activeSkillName)?.path ?? null } : null;

    return {
      rootDir,
      projectDir: project.dir(),
      // Seconds, the unit the source places clips in; null when no scene is
      // active, which is when there is no playhead to report.
      currentTime: active ? (active.get(Computed)?.localTime ?? 0) / frameRate : null,
      frameRate,
      activeSceneId: active ? sourceId(active) : null,
      // The active scene's skill, with the folder path an agent should read.
      activeSkill,
      // Exactly sha256 of the entry file's on-disk bytes: the same value
      // `source.read` reports as `revisionId` (both go through the desktop's
      // `readProjectSource`), so agents get one revision namespace that only
      // changes when the file changes.
      sourceRevision,
      // The revision of the entry source the *canvas* is showing. For a moment
      // after the file changes on disk the two differ — the change is written
      // and not yet on screen; equal means the canvas has caught up, and what
      // `inspect`, `geometry` and `capture` say is about that revision.
      shownRevision: projectInfo ? shownRevision(projectInfo.dir, projectInfo.entry) : null,
      // The compile pipeline lives in the editor page's load closures (see
      // pages/editor.tsx) and exposes no state this handler can read cheaply.
      // "unknown" is honest; do not report "ready" without evidence.
      compileState: "unknown" as const,
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
      ...(tree && {
        tree: stage
          ? runtimeTree(world, stage, {
            frameRate,
            motion,
            depth: typeof depth === "number" && depth >= 0 ? depth : Number.POSITIVE_INFINITY,
            ...(scene === undefined ? {} : { scene }),
          })
          : null,
      }),
    };
  }
}
