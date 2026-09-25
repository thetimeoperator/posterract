/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { VALUE_DESCRIPTIONS } from '../../command-descriptions';
import { AMOUNT, EASING_OPTIONS, KEYFRAME_PROPERTIES } from './shared';

import type { FamilyDef } from '../types';

export const MOTION: FamilyDef = {
  id: 'motion',
  label: 'Motion',
  exclusive: false,
  ask:
    'Does the command ask about animation — an entrance or an exit (fading in, sliding out, growing, typing on), changing one that is there '
    + '(slower, another easing, another kind), taking one off, making a group come in one after another, keyframes (recording a value at a moment, '
    + 'removing them, looping them, baking motion into them)? For example "fade the title in", "slide it out to the left", "make the entrance slower", '
    + '"keyframe the position here", "remove the animation", "loop it". Not moving something once, not a transition between clips, not playback speed.',
  slots: {
    anim_type: { kind: 'choice', ask: 'Which kind of entrance or exit does the command describe?', options: { ...VALUE_DESCRIPTIONS.animationType! } },
    anim_phase: { kind: 'choice', ask: 'Is the command about how the element comes in, or how it leaves?', options: { ...VALUE_DESCRIPTIONS.animationPhase! } },
    easing: { kind: 'choice', ask: 'How does the command say the motion should feel?', options: EASING_OPTIONS },
    duration: { kind: 'number', text: 'How long the motion takes, in seconds.', units: ['s', 'frames'] },
    delay: { kind: 'number', text: 'How long the motion waits before it starts, in seconds.', units: ['s', 'frames'] },
    distance: { kind: 'number', text: 'How far the motion travels, in pixels.', units: ['px'] },
    speed_how: {
      kind: 'choice',
      ask: 'Does the command ask for the motion to be slower or faster?',
      options: { slower: 'Slower, longer, more gentle.', faster: 'Faster, shorter, snappier.' },
    },
    amount: AMOUNT,
    remove_what: {
      kind: 'choice',
      ask: 'How much does the command ask to take off?',
      options: {
        all: 'Every entrance and exit on it.',
        named: 'Only the one kind it names (the fade, the slide).',
        phase: 'Only the entrance, or only the exit.',
      },
    },
    stagger: { kind: 'number', text: 'How far apart the elements of a group start, in seconds.', units: ['s', 'frames'] },
    property: { kind: 'choice', ask: 'Which property does the command mean?', options: KEYFRAME_PROPERTIES },
    when: { kind: 'when', ask: 'At which moment does the command ask for the keyframe?' },
    loop_how: {
      kind: 'choice',
      ask: 'How does the command ask the keyframed motion to repeat?',
      options: {
        repeat: 'Over and over from the start: loop, repeat.',
        pingpong: 'There and back again: back and forth, boomerang, ping pong.',
        off: 'Stop repeating: play once.',
      },
    },
  },
  intents: [
    {
      id: 'motion.add',
      needs: ['anim_type'],
      label: 'Add motion',
      text: {
        what: 'Give an element an entrance or an exit: fading, sliding, growing, shrinking, blurring, spinning, twisting, or appearing word by word or letter by letter.',
        notFor: 'Not a transition between two clips, not moving it once, not a keyframe.',
        examples: ['fade the title in', 'slide it in from the left', 'make the logo spin in', 'type the words on one at a time', 'grow it in over half a second'],
      },
      uses: ['anim_type', 'anim_phase', 'easing', 'duration', 'delay', 'distance'],
      target: 'many',
      covers: ['animation', 'type', 'phase', 'duration', 'delay', 'distance', 'easing', 'amount'],
    },
    {
      id: 'motion.change',
      label: 'Change the motion',
      text: {
        what: 'Change an entrance or exit the element already has: make it slower or faster, give it another easing, a delay, or another kind of motion.',
        examples: ['make the entrance slower', 'change the fade in to a slide from the left', 'make the exit snappier', 'make the animation 2 seconds', 'delay it by half a second'],
      },
      uses: ['anim_phase', 'anim_type', 'easing', 'duration', 'delay', 'distance', 'speed_how', 'amount'],
      target: 'many',
      covers: ['animation.duration', 'animation.easing', 'animation.delay', 'animation.distance', 'animation.amount'],
    },
    {
      id: 'motion.remove',
      label: 'Remove motion',
      text: {
        what: 'Take an entrance or exit off an element.',
        notFor: 'Not removing a filter, a keyframe track or a transition.',
        examples: ['take the fade off the title', 'remove the animation', 'no entrance on this one', 'get rid of the slide out'],
      },
      uses: ['anim_type', 'anim_phase', 'remove_what'],
      target: 'many',
      covers: ['animation.remove'],
    },
    {
      id: 'motion.stagger',
      needs: ['stagger'],
      label: 'Stagger',
      text: {
        what: "Make a group's elements start one after another, a little apart.",
        examples: ['stagger these by 0.2 seconds', 'make the words come in one after another', 'stagger the group'],
      },
      uses: ['stagger'],
      target: 'many',
      tags: ['group', 'sequence'],
      covers: ['stagger'],
    },
    {
      id: 'motion.keyframe-add',
      needs: ['property'],
      label: 'Keyframe',
      text: {
        what: "Record a property's value at a moment as a keyframe, so it can animate from there to another value later.",
        examples: ['keyframe the position here', 'add an opacity keyframe at 2 seconds', 'set a scale keyframe', 'key the rotation now'],
      },
      uses: ['property', 'when'],
      target: 'many',
      covers: ['writeKeyframe', 'toggleKeyframe', 'keyframeTrack', 'keyframe', 'property', 'time', 'value', 'morph', 'trimStart', 'trimEnd', 'trimOffset', 'progress', 'offsetX', 'offsetY', 'scaleX', 'scaleY'],
    },
    {
      id: 'motion.keyframe-remove',
      needs: ['property'],
      label: 'Remove keyframes',
      text: {
        what: 'Remove the keyframes of a property, so it stops animating that way.',
        examples: ['remove the rotation keyframes', 'delete the position keyframes', 'clear the opacity track'],
      },
      uses: ['property'],
      target: 'many',
      covers: ['removeKeyframeTrack'],
    },
    {
      id: 'motion.loop',
      needs: ['loop_how'],
      label: 'Loop',
      text: {
        what: 'Make keyframed motion repeat for as long as the element is on screen — over and over, or back and forth — or stop it repeating.',
        notFor: 'Not looping a clip, which the editor cannot do.',
        examples: ['loop it', 'make it go back and forth', 'stop looping', 'repeat the animation'],
      },
      uses: ['loop_how', 'property'],
      target: 'many',
      covers: ['keyframeTrack.loop', 'lottie.loop'],
    },
    {
      id: 'motion.bake',
      needs: ['property'],
      label: 'Bake',
      text: {
        what: 'Turn motion written in the code into keyframes that can be edited by hand.',
        examples: ['bake the position', 'bake the rotation to keyframes', 'make the motion editable'],
      },
      uses: ['property'],
      target: 'many',
      covers: ['bakeToKeyframes'],
    },
    {
      id: 'motion.keyframe-easing',
      needs: ['easing'],
      label: 'Keyframe easing',
      text: {
        what: 'Change how the motion between keyframes feels.',
        examples: ['make the keyframes ease out', 'bouncy keyframes', 'linear between the keyframes'],
      },
      uses: ['easing', 'property'],
      target: 'many',
      covers: ['keyframe.easing'],
    },
  ],
};
