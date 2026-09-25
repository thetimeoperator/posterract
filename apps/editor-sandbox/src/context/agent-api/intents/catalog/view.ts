/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { SHAPE_OPTIONS } from './shared';

import type { FamilyDef } from '../types';

export const VIEW: FamilyDef = {
  id: 'view',
  label: 'View',
  exclusive: true,
  ask:
    'Does the command ask about what the editor shows rather than about the video itself — zooming the view in or out, '
    + 'selecting elements, opening another scene, showing or hiding a panel (assets, inspector, timeline, mixer), switching workspace, '
    + 'the inspector tab, how much the timeline shows, the theme, which tool is in hand, snapping, hiding the interface, '
    + 'or asking what the editor can do? For example "zoom to fit", "select the title", "hide the inspector", "go to the next scene", "what can you do". '
    + 'Not hiding an element of the video itself.',
  slots: {
    zoom_how: {
      kind: 'choice',
      ask: 'How does the command ask the view to zoom?',
      options: {
        in: 'Closer, zoom in.',
        out: 'Further away, zoom out.',
        fit: 'So the whole frame fits the screen.',
        selection: 'In on what is selected.',
        actual: 'At its actual size, 100 percent.',
        percent: 'To a percentage the command says.',
      },
    },
    percent: { kind: 'number', text: 'How far to zoom, as a percentage.', units: ['%'] },
    extend: {
      kind: 'onoff',
      ask: 'Does the command ask to add to what is already selected (yes), rather than to select only what it names (no)?',
      yes: 'Add to the selection',
      no: 'Select only these',
    },
    select_what: {
      kind: 'choice',
      ask: 'Which elements does the command ask to select?',
      options: {
        named: 'The elements it names or describes.',
        all: 'Everything in the scene.',
        none: 'Nothing: clear the selection.',
        parent: 'The group or scene the selection sits in.',
        children: 'What is inside the selected group.',
        kind: 'Every element of one kind ("all the text", "every picture").',
      },
    },
    scene: { kind: 'scene', ask: 'Which scene does the command mean?' },
    scene_step: {
      kind: 'choice',
      ask: 'Which way does the command ask to step through the scenes?',
      options: { next: 'The next scene.', previous: 'The one before.', named: 'A scene it names, or none.' },
    },
    panel: {
      kind: 'choice',
      ask: 'Which part of the editor does the command mean?',
      options: {
        assets: 'The assets panel on the left, the media files.',
        inspector: 'The inspector on the right, the settings panel.',
        timeline: 'The timeline at the bottom.',
        mixer: 'The audio mixer.',
        interface: 'The whole interface, every panel at once: a clean view of just the video.',
      },
    },
    panel_show: { kind: 'onoff', ask: 'Does the command ask to show it (yes), rather than to hide it (no)?', yes: 'Show', no: 'Hide' },
    workspace: {
      kind: 'choice',
      ask: 'Which workspace does the command ask for?',
      options: {
        storyboard: 'The storyboard: all the scenes side by side.',
        edit: 'The edit workspace: the canvas and the timeline.',
        motion: 'The motion workspace: for animation, with the animation rows.',
      },
    },
    tab: {
      kind: 'choice',
      ask: 'Which inspector tab does the command ask for?',
      options: { design: 'Design: the look of what is selected.', motion: 'Motion: its animation.', history: 'History: the versions of the project.' },
    },
    detail: {
      kind: 'choice',
      ask: 'How much does the command ask the timeline to show?',
      options: {
        clips: 'Just the clips and their keyframes.',
        animation: 'The clips and their animation rows.',
        everything: 'Everything: effects, paints, strokes and shadows too.',
      },
    },
    timeline_zoom: {
      kind: 'choice',
      ask: 'How does the command ask the timeline to zoom?',
      options: {
        in: 'In, to see less time in more detail.',
        out: 'Out, to see more time.',
        fit: 'So the whole video fits.',
        selection: 'To the selected clips.',
      },
    },
    theme: {
      kind: 'choice',
      ask: 'Which look does the command ask for?',
      options: { noir: 'Noir: the dark, solid look.', frost: 'Glass, also called frost: the translucent look.' },
    },
    tool: {
      kind: 'choice',
      ask: 'Which tool does the command ask for?',
      options: {
        move: 'The move tool, for selecting and dragging.',
        hand: 'The hand tool, for panning the view.',
        frame: 'The frame tool, for drawing a new scene.',
        text: 'The text tool, for drawing a new text.',
        shape: 'The shape tool, for drawing a shape.',
      },
    },
    shape_kind: { kind: 'choice', ask: 'Which shape should the shape tool draw?', options: SHAPE_OPTIONS },
    snapping: { kind: 'onoff', ask: 'Does the command ask to turn snapping on (yes), rather than off (no)?', yes: 'Snapping on', no: 'Snapping off' },
  },
  intents: [
    {
      id: 'view.zoom',
      label: 'Zoom',
      text: {
        what: 'Zoom the view of the canvas: in, out, to fit, in on the selection, to its actual size, or to a percentage.',
        notFor: 'Not making an element bigger, and not the timeline.',
        examples: ['zoom in', 'zoom to fit', 'zoom to 200 percent', 'fit the frame on screen', 'zoom in on this'],
      },
      uses: ['zoom_how', 'percent'],
      target: 'none',
      covers: ['zoomBy', 'zoomTo', 'zoomToFit', 'zoomToSelection', 'canvas.zoom-in', 'canvas.zoom-out', 'canvas.zoom-fit', 'canvas.zoom-selection', 'canvas.actual-size'],
    },
    {
      id: 'view.select',
      label: 'Select',
      text: {
        what: 'Select elements: the ones the command names, everything, every element of a kind, the parent, what is inside, or nothing.',
        examples: ['select the title', 'select all the text', 'add the logo to the selection', 'select nothing', 'select everything'],
      },
      uses: ['select_what', 'extend'],
      target: 'optional',
      covers: ['select', 'edit.select-all', 'edit.deselect', 'edit.select-parents', 'edit.select-children'],
    },
    {
      id: 'view.scene',
      label: 'Go to a scene',
      text: {
        what: 'Open another scene to work on: one the command names, the next one, or the one before.',
        notFor: 'Not moving the playhead within a scene, and not making a new scene.',
        examples: ['go to the intro scene', 'next scene', 'open the second scene', 'back to the first scene'],
      },
      uses: ['scene', 'scene_step'],
      target: 'none',
      covers: ['activate'],
    },
    {
      id: 'view.reveal',
      label: 'Show in the timeline',
      text: {
        what: 'Scroll the timeline to an element and show its row.',
        examples: ['show this in the timeline', 'find the title in the timeline', 'where is the logo on the timeline'],
      },
      target: 'one',
      covers: ['revealInTimeline'],
    },
    {
      id: 'view.panel',
      needs: ['panel'],
      label: 'Panel',
      text: {
        what: 'Show or hide a part of the editor: the assets, the inspector, the timeline, the mixer, or the whole interface.',
        notFor: 'Not hiding an element of the video.',
        examples: ['hide the inspector', 'show the assets', 'open the mixer', 'collapse the timeline', 'hide the interface'],
      },
      uses: ['panel', 'panel_show'],
      target: 'none',
      covers: ['toggleLeft', 'toggleInspector', 'toggleTimeline', 'toggleMixer', 'toggleUI', 'panel.assets', 'panel.inspector', 'panel.timeline', 'view.hide-interface'],
    },
    {
      id: 'view.workspace',
      needs: ['workspace'],
      label: 'Workspace',
      text: {
        what: 'Switch workspace: the storyboard, the edit workspace, or the motion workspace.',
        examples: ['go to the storyboard', 'motion workspace', 'back to editing'],
      },
      uses: ['workspace'],
      target: 'none',
      covers: ['setWorkspace', 'workspace.storyboard', 'workspace.edit', 'workspace.motion'],
    },
    {
      id: 'view.inspector-tab',
      needs: ['tab'],
      label: 'Inspector tab',
      text: {
        what: 'Switch the inspector to its design, motion or history tab.',
        examples: ['show the motion tab', 'open the design settings', 'show the version history'],
      },
      uses: ['tab'],
      target: 'none',
      covers: ['setInspectorTab', 'panel.history'],
    },
    {
      id: 'view.timeline-zoom',
      label: 'Timeline zoom',
      text: {
        what: 'Zoom the timeline in or out, to fit the whole video, or to the selected clips.',
        notFor: 'Not zooming the canvas view.',
        examples: ['zoom the timeline in', 'fit the whole video in the timeline', 'zoom the timeline to this clip'],
      },
      uses: ['timeline_zoom'],
      target: 'none',
      covers: ['zoomTimeline', 'timeline.zoom-in', 'timeline.zoom-out', 'timeline.fit', 'timeline.zoom-selection'],
    },
    {
      id: 'view.timeline-detail',
      needs: ['detail'],
      label: 'Timeline detail',
      text: {
        what: 'Change how much the timeline shows: just the clips, the animation rows too, or everything.',
        examples: ['show the animation rows', 'show everything in the timeline', 'just the clips please'],
      },
      uses: ['detail'],
      target: 'none',
      covers: ['setTimelineDetail'],
    },
    {
      id: 'view.theme',
      needs: ['theme'],
      label: 'Theme',
      text: { what: "Switch the editor's look between Noir and Glass.", examples: ['switch to Noir', 'use the glass look', 'change the theme'] },
      uses: ['theme'],
      target: 'none',
      covers: ['toggleEditorTheme', 'view.theme'],
    },
    {
      id: 'view.tool',
      needs: ['tool', 'shape_kind'],
      label: 'Tool',
      text: {
        what: 'Take a tool in hand: move, hand, frame, text or shape — and which shape the shape tool draws.',
        examples: ['take the text tool', 'shape tool', 'let me draw stars', 'move tool'],
      },
      uses: ['tool', 'shape_kind'],
      target: 'none',
      covers: ['selectTool', 'setDrawnShape', 'canvas.move-tool', 'canvas.hand-tool', 'canvas.frame-tool', 'canvas.text-tool', 'canvas.component-tool'],
    },
    {
      id: 'view.snapping',
      needs: ['snapping'],
      label: 'Snapping',
      text: { what: 'Turn snapping on or off while dragging.', examples: ['turn snapping off', 'snapping on', 'stop snapping to things'] },
      uses: ['snapping'],
      target: 'none',
      covers: ['toggleSnapping', 'edit.snapping'],
    },
    {
      id: 'view.help',
      label: 'What you can say',
      text: {
        what: 'Say what the voice bar can do: the kinds of command it understands.',
        examples: ['what can you do', 'help', 'what can I say', 'what commands are there'],
      },
      target: 'none',
      covers: ['help'],
    },
  ],
};
