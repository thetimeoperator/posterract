/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What the bar does not offer, and why.
 *
 * The promise the catalog makes is that every capability of the editor is
 * either something a person can say or something written down here with a
 * reason. `coverage.test.ts` fails when anything is in neither — so a new
 * element, prop or command cannot quietly go unsayable.
 *
 * The reasons are the words the bar itself would use.
 */

export type NotVoiceable = { what: string; why: string };

/** Elements (vocabulary tags) with no intent. */
export const NOT_VOICEABLE_TAGS: NotVoiceable[] = [
  { what: 'path', why: 'A drawn line needs pointing, not words: there is no pen tool to say.' },
  { what: 'lottieSlot', why: "A Lottie's own slots are named by the file it came from; the inspector lists them." },
  { what: 'html', why: 'Written as code — work for the connected agent.' },
  { what: 'htmlPaint', why: 'Written as code — work for the connected agent.' },
  { what: 'shaderPaint', why: 'A shader is written as code — work for the connected agent.' },
  { what: 'surface', why: 'Written as code — work for the connected agent.' },
  { what: 'surfacePaint', why: 'Written as code — work for the connected agent.' },
  { what: 'diagramNode', why: 'Diagrams are written as code — work for the connected agent.' },
  { what: 'diagramArrow', why: 'Diagrams are written as code — work for the connected agent.' },
  { what: 'diagramEquation', why: 'Diagrams are written as code — work for the connected agent.' },
  { what: 'diagramAxis', why: 'Diagrams are written as code — work for the connected agent.' },
  { what: 'diagramPlot', why: 'Diagrams are written as code — work for the connected agent.' },
  { what: 'diagramCallout', why: 'Diagrams are written as code — work for the connected agent.' },
  // The motion tools (Sep 26 2026) are set up in code for now.
  { what: 'textAnimator', why: 'A letter animator is set up in code — work for the connected agent.' },
  { what: 'repeater', why: 'A repeater is set up in code — work for the connected agent.' },
];

/** The motion tools' settings (beats, blur, 3D tilt, letter animators, repeaters, text on a path) are set up in code for now. */
const MOTION_TOOL = 'A motion-tool setting, set up in code — work for the connected agent.';

/** Props with no intent. */
export const NOT_VOICEABLE_PROPS: NotVoiceable[] = [
  // The motion tools (Sep 26 2026).
  { what: 'angle', why: MOTION_TOOL },
  { what: 'bpm', why: MOTION_TOOL },
  { what: 'cameraZ', why: MOTION_TOOL },
  { what: 'colorBy', why: MOTION_TOOL },
  { what: 'colorTo', why: MOTION_TOOL },
  { what: 'columns', why: MOTION_TOOL },
  { what: 'context', why: MOTION_TOOL },
  { what: 'count', why: MOTION_TOOL },
  { what: 'depthFade', why: MOTION_TOOL },
  { what: 'draw', why: MOTION_TOOL },
  { what: 'knobs', why: MOTION_TOOL },
  { what: 'layout', why: MOTION_TOOL },
  { what: 'layoutTo', why: MOTION_TOOL },
  { what: 'meter', why: MOTION_TOOL },
  { what: 'motionBlur', why: MOTION_TOOL },
  { what: 'order', why: MOTION_TOOL },
  { what: 'pathAlign', why: MOTION_TOOL },
  { what: 'pathOffset', why: MOTION_TOOL },
  { what: 'pathShift', why: MOTION_TOOL },
  { what: 'perspective', why: MOTION_TOOL },
  { what: 'radius', why: MOTION_TOOL },
  { what: 'ripple', why: MOTION_TOOL },
  { what: 'rippleCenterX', why: MOTION_TOOL },
  { what: 'rippleCenterY', why: MOTION_TOOL },
  { what: 'rippleFrequency', why: MOTION_TOOL },
  { what: 'rippleMode', why: MOTION_TOOL },
  { what: 'ripplePhase', why: MOTION_TOOL },
  { what: 'roll', why: MOTION_TOOL },
  { what: 'rotationX', why: MOTION_TOOL },
  { what: 'rotationY', why: MOTION_TOOL },
  { what: 'size', why: MOTION_TOOL },
  { what: 'spacing', why: MOTION_TOOL },
  { what: 'staggerOrder', why: MOTION_TOOL },
  { what: 'tiltX', why: MOTION_TOOL },
  { what: 'tiltY', why: MOTION_TOOL },
  { what: 'tube', why: MOTION_TOOL },
  { what: 'zoom', why: MOTION_TOOL },
  // The pipeline is not here.
  { what: 'removeBackground', why: 'Cutting the subject out needs a hosted pipeline the desktop app does not have yet.' },
  { what: 'upscale', why: 'Upscaling needs a hosted pipeline the desktop app does not have yet.' },
  { what: 'addAudio', why: 'Scoring a clip needs a hosted pipeline the desktop app does not have yet.' },

  // The editor keeps them, but nobody says them.
  { what: 'offsetX', why: 'A nudge on top of the layout: moving by words sets x and y instead.' },
  { what: 'offsetY', why: 'A nudge on top of the layout: moving by words sets x and y instead.' },
  { what: 'scaleX', why: 'Stretching one way only: say a width or a height instead.' },
  { what: 'scaleY', why: 'Stretching one way only: say a width or a height instead.' },
  { what: 'cap', why: "How an outline's open ends are drawn: the inspector's stroke row." },
  { what: 'join', why: 'How an outline turns a corner: the inspector\'s stroke row.' },
  { what: 'miterLimit', why: "How far an outline's corner may spike: the inspector's stroke row." },
  { what: 'clipHeight', why: 'How tall a row is in the timeline: dragged, not said.' },
  { what: 'expanded', why: 'Whether a timeline row is open: clicked, not said.' },
  { what: 'frameRate', why: 'How fast a folder of numbered frames plays: the Time panel.' },
  { what: 'syncTo', why: "Lining a clip up with another's audio track: nothing in the editor sets it yet." },
  { what: 'seed', why: 'The transcription seed: captions are written again rather than re-seeded.' },
  { what: 'after', why: 'Following another element in time: say "start it when the title ends" instead.' },

  // The editor's own bookkeeping.
  { what: 'id', why: "The element's name in the file: the editor writes it." },
  { what: 'children', why: 'What is inside an element: said as adding or moving things, not as a prop.' },
  { what: 'selected', why: 'What the editor has selected: say "select the title".' },
  { what: 'active', why: 'Which scene is open: say "go to the outro scene".' },
  { what: 'error', why: 'Why a file never loaded: the editor writes it, nobody sets it.' },
  { what: 'camera', why: 'Where the canvas view sits: say "zoom to fit".' },

  // Figures and diagrams, which are written as code.
  { what: 'd', why: 'The shape of a drawn line: it needs pointing, not words.' },
  { what: 'morph', why: 'How far one drawn figure has become another: keyframe it, or write it in code.' },
  { what: 'morphTo', why: 'The figure to become: written in code.' },
  { what: 'trimStart', why: 'How much of a drawn figure shows: keyframe it, or use the Vector panel.' },
  { what: 'trimEnd', why: 'How much of a drawn figure shows: keyframe it, or use the Vector panel.' },
  { what: 'trimOffset', why: 'Where along a drawn figure the visible part sits: keyframe it, or use the Vector panel.' },
  { what: 'shape', why: 'A diagram node\'s shape: diagrams are written as code.' },
  { what: 'label', why: 'A diagram label: diagrams are written as code.' },
  { what: 'expression', why: 'A diagram equation: written as code.' },
  { what: 'domain', why: 'A diagram axis range: written as code.' },
  { what: 'range', why: 'A diagram axis range: written as code.' },
  { what: 'grid', why: 'A diagram grid: written as code.' },
  { what: 'markers', why: 'Dots on a diagram plot: written as code.' },
  { what: 'align', why: 'How a diagram equation lines up: written as code.' },
  { what: 'padding', why: 'Space inside a diagram element: written as code.' },
  { what: 'progress', why: "A diagram's draw-on: keyframe it, or write it in code." },
  { what: 'route', why: 'How a diagram arrow bends: written as code.' },
  { what: 'smooth', why: 'How a diagram plot curves: written as code.' },
  { what: 'headSize', why: 'A diagram arrowhead: written as code.' },
  { what: 'arrowStart', why: 'A diagram arrowhead: written as code.' },
  { what: 'arrowEnd', why: 'A diagram arrowhead: written as code.' },
  { what: 'targetX', why: 'Where a diagram arrow points: written as code.' },
  { what: 'targetY', why: 'Where a diagram arrow points: written as code.' },
  { what: 'tickCount', why: 'A diagram axis: written as code.' },
  { what: 'xLabel', why: 'A diagram axis label: written as code.' },
  { what: 'yLabel', why: 'A diagram axis label: written as code.' },
  { what: 'subtitle', why: 'A diagram subtitle: written as code.' },
  { what: 'strokeWidth', why: 'A diagram stroke: written as code.' },
  { what: 'strokeColor', why: 'A diagram stroke: written as code.' },
  { what: 'textColor', why: 'A diagram label color: written as code.' },
  { what: 'uniforms', why: 'A shader input: written as code.' },
  { what: 'wgsl', why: 'A shader: written as code.' },
];

/**
 * Whole features the editor has that the bar does not offer, with what it says
 * when someone asks for one.
 */
export const NOT_VOICEABLE_FEATURES: NotVoiceable[] = [
  { what: 'flip', why: 'Flipping is kept only in memory — nothing in the file records it, so it would be lost on reload.' },
  { what: 'skew', why: 'Skew is kept only in memory: nothing in the file records it.' },
  { what: 'anchor point', why: 'The anchor point is kept only in memory: nothing in the file records it.' },
  { what: 'constraints', why: 'Constraints are kept only in memory: nothing in the file records it.' },
  { what: 'clip contents', why: 'Clipping a group to its box is kept only in memory: nothing in the file records it.' },
  { what: 'solo', why: 'Solo is kept only in memory: nothing in the file records it. Muting the rest is the version that lasts.' },
  { what: 'crop', why: 'The editor has no crop. Say "fill the frame", "show the whole picture", or mask it with a shape.' },
  { what: 'pan the canvas', why: 'There is no function for panning by an amount: hold space and drag, or say "zoom to fit".' },
  { what: 'drawing a path', why: 'A drawn line needs pointing, not words.' },
  { what: 'marquee selection', why: 'Dragging a box around things needs pointing: say "select all the text" instead.' },
  { what: 'freeze frame', why: 'The editor has no freeze frame yet.' },
  { what: 'reverse a clip', why: 'The editor cannot play a clip backwards yet — only the playhead can go back.' },
  { what: 'loop a clip', why: 'A clip has no loop: only keyframed motion and a Lottie can repeat.' },
];

/** Everything above, by name. */
export const NOT_VOICEABLE = new Map<string, string>([
  ...NOT_VOICEABLE_TAGS,
  ...NOT_VOICEABLE_PROPS,
  ...NOT_VOICEABLE_FEATURES,
].map((entry) => [entry.what, entry.why]));
