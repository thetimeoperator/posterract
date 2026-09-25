/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** What the editor shows: zoom, selection, scenes, panels, workspaces, the theme, tools, snapping. */

import { Scene, Selected, Source, Tool, ToolType, getActiveEntity, getSelection } from '@posterract/video-runtime';

import { zoomBy, zoomTo, zoomToFit, zoomToSelection } from '@/engine/camera';
import { getDocumentEditor } from '@/engine/editor';
import { revealInTimeline } from '@/engine/reveal-timeline';
import { setDrawnShape } from '@/engine/shapes';
import { setTimelineDetail } from '@/engine/timeline/detail';
import { snappingEnabled, toggleSnapping } from '@/engine/timeline/snapping';
import { zoomTimeline, zoomTimelineToFit, zoomTimelineToSelection } from '@/engine/timeline/zoom';

import { nameOf } from '../scene';
import { choiceOf, did, didNot, entitiesOf, numberOf, onOf } from './helpers';
import { runEditorCommand } from './index';

import type { ShapeKind } from '@/engine/shapes';
import type { TimelineDetail } from '@posterract/video-runtime';
import type { RunFn } from './types';

const TOOLS: Record<string, ToolType> = {
  move: ToolType.MOVE,
  hand: ToolType.HAND,
  frame: ToolType.SCENE,
  text: ToolType.TEXT,
  shape: ToolType.RECT,
};

export const VIEW_RUNS: Record<string, RunFn> = {
  'view.zoom': (ctx, step) => {
    const { world } = ctx;
    const how = choiceOf(step.slots.zoom_how) ?? 'in';
    const percent = numberOf(step.slots.percent);
    if (how === 'percent' || percent) {
      const value = percent?.value ?? 100;
      zoomTo(world, value > 5 ? value / 100 : value);
      return did(`Zoom ${Math.round((percent?.value ?? 100))}%`);
    }
    if (how === 'in') zoomBy(world, 1.25);
    else if (how === 'out') zoomBy(world, 1 / 1.25);
    else if (how === 'fit') zoomToFit(world);
    else if (how === 'actual') zoomTo(world, 1);
    else if (how === 'selection') {
      if (!getSelection(world).length) return didNot('nothing is selected to zoom to', 'Select something first.');
      zoomToSelection(world);
    }
    return did(`Zoomed ${how === 'fit' ? 'to fit' : how === 'actual' ? 'to 100%' : how}`);
  },

  'view.select': (ctx, step) => {
    const { world } = ctx;
    const what = choiceOf(step.slots.select_what) ?? 'named';
    const editor = getDocumentEditor(world);
    const extend = onOf(step.slots.extend) === true;

    if (what === 'none') {
      if (!getSelection(world).length) return didNot('nothing is selected already');
      editor.clearSelection();
      return did('Selected nothing');
    }
    if (what === 'all') {
      const scene = getActiveEntity(world);
      if (!scene) return didNot('no video is open');
      const all = ctx.situation.elements.filter((element) => element.tag !== 'scene').map((element) => element.id);
      const entities = entitiesOf(world, { ...step, targets: all });
      if (!entities.length) return didNot('the scene is empty');
      editor.select(entities);
      return did(`Selected ${entities.length} elements`);
    }
    if (what === 'parent' || what === 'children') {
      if (!getSelection(world).length) return didNot('nothing is selected', 'Select something first.');
      return runEditorCommand(ctx, step, what === 'parent' ? 'edit.select-parents' : 'edit.select-children');
    }

    const entities = entitiesOf(world, step);
    if (!entities.length) return didNot('the command named no element to select', 'Say which one.');
    editor.select(entities, { extend });
    const only = entities.length === 1 ? ctx.situation.elements.find((element) => element.id === step.targets[0]) : undefined;
    return did(entities.length === 1 ? `Selected ${only ? nameOf(only) : 'it'}` : `Selected ${entities.length} elements`);
  },

  'view.scene': (ctx, step) => {
    const { world } = ctx;
    const editor = getDocumentEditor(world);
    const scenes = [...world.query(Scene, Source)];
    if (!scenes.length) return didNot('there are no scenes yet', 'Say "new scene".');
    const step_ = choiceOf(step.slots.scene_step);
    const named = step.slots.scene?.kind === 'scene' ? step.slots.scene.id : null;

    if (named) {
      const [entity] = entitiesOf(world, { ...step, targets: [named] });
      if (!entity) return didNot('that scene is not here any more');
      if (entity === getActiveEntity(world)) return didNot('that scene is already open');
      editor.activate(entity);
      return did(`Opened ${entity.get(Source) ? ctx.situation.scenes.find((scene) => scene.id === named)?.name ?? 'the scene' : 'the scene'}`);
    }

    const active = getActiveEntity(world);
    const at = active ? scenes.indexOf(active) : -1;
    const next = step_ === 'previous' ? scenes[at - 1] : scenes[at + 1];
    if (!next) return didNot(`there is no ${step_ === 'previous' ? 'previous' : 'next'} scene`);
    editor.activate(next);
    return did(`Opened the ${step_ === 'previous' ? 'previous' : 'next'} scene`);
  },

  'view.reveal': (ctx, step) => {
    const { world } = ctx;
    const [entity] = entitiesOf(world, step);
    if (!entity) return didNot('nothing is selected', 'Say which element.');
    revealInTimeline(world, entity);
    return did('Shown in the timeline');
  },

  'view.panel': (ctx, step) => {
    const panel = (choiceOf(step.slots.panel) ?? 'inspector') as 'assets' | 'inspector' | 'timeline' | 'mixer' | 'interface';
    const show = onOf(step.slots.panel_show);
    if (!ctx.ui.setPanel || !ctx.ui.panelOpen) return didNot('the panels are not available here');
    const open = ctx.ui.panelOpen(panel);
    const wanted = show ?? !open;
    if (open === wanted) return didNot(`the ${panel === 'interface' ? 'interface' : `${panel} panel`} is already ${wanted ? 'showing' : 'hidden'}`);
    ctx.ui.setPanel(panel, wanted);
    return did(`${wanted ? 'Showed' : 'Hid'} the ${panel === 'interface' ? 'interface' : panel}`);
  },

  'view.workspace': (ctx, step) => {
    const workspace = choiceOf(step.slots.workspace) as 'storyboard' | 'edit' | 'motion' | null;
    if (!workspace) return didNot('the command did not say which workspace');
    if (!ctx.ui.setWorkspace) return didNot('the workspaces are not available here');
    if (ctx.ui.workspace?.() === workspace) return didNot(`the ${workspace} workspace is already open`);
    ctx.ui.setWorkspace(workspace);
    if (workspace === 'motion') setTimelineDetail('animation');
    return did(`${workspace[0]!.toUpperCase()}${workspace.slice(1)} workspace`);
  },

  'view.inspector-tab': (ctx, step) => {
    const tab = choiceOf(step.slots.tab) as 'design' | 'motion' | 'history' | null;
    if (!tab) return didNot('the command did not say which tab');
    if (!ctx.ui.setInspectorTab) return didNot('the inspector is not available here');
    ctx.ui.setInspectorTab(tab);
    return did(`${tab[0]!.toUpperCase()}${tab.slice(1)} tab`);
  },

  'view.timeline-zoom': (ctx, step) => {
    const how = choiceOf(step.slots.timeline_zoom) ?? 'in';
    if (how === 'in') zoomTimeline(1.25);
    else if (how === 'out') zoomTimeline(1 / 1.25);
    else if (how === 'fit') zoomTimelineToFit(ctx.world);
    else if (how === 'selection') {
      if (!getSelection(ctx.world).length) return didNot('nothing is selected', 'Select a clip first.');
      zoomTimelineToSelection(ctx.world);
    }
    return did(`Timeline ${how === 'fit' ? 'fitted' : how === 'selection' ? 'zoomed to the selection' : `zoomed ${how}`}`);
  },

  'view.timeline-detail': (_ctx, step) => {
    const detail = choiceOf(step.slots.detail) as TimelineDetail | null;
    if (!detail) return didNot('the command did not say how much to show');
    setTimelineDetail(detail);
    return did(`Timeline showing ${detail}`);
  },

  'view.theme': (ctx, step) => {
    const theme = (choiceOf(step.slots.theme) ?? 'noir') as 'noir' | 'frost';
    if (!ctx.ui.setTheme) return didNot('the theme is not available here');
    if (ctx.ui.theme?.() === theme) return didNot(`the ${theme === 'frost' ? 'glass' : 'noir'} look is already on`);
    ctx.ui.setTheme(theme);
    return did(theme === 'frost' ? 'Glass' : 'Noir');
  },

  'view.tool': (ctx, step) => {
    const { world } = ctx;
    const said = choiceOf(step.slots.tool);
    const shape = choiceOf(step.slots.shape_kind);
    if (shape) {
      const kind = (shape === 'circle' || shape === 'oval' ? 'ellipse' : shape === 'square' ? 'rectangle' : shape) as ShapeKind;
      setDrawnShape(kind);
      world.set(Tool, { value: ToolType.RECT });
      return did(`Drawing ${shape}s`);
    }
    if (!said || !TOOLS[said]) return didNot('the command did not say which tool');
    world.set(Tool, { value: TOOLS[said]! });
    return did(`${said[0]!.toUpperCase()}${said.slice(1)} tool`);
  },

  'view.snapping': (_ctx, step) => {
    const on = onOf(step.slots.snapping);
    const now = snappingEnabled();
    const wanted = on ?? !now;
    if (now === wanted) return didNot(`snapping is already ${wanted ? 'on' : 'off'}`);
    toggleSnapping();
    return did(`Snapping ${wanted ? 'on' : 'off'}`);
  },

  'view.help': (ctx) => {
    ctx.ui.help?.();
    return did('Here is what you can say');
  },
};

void Selected;
