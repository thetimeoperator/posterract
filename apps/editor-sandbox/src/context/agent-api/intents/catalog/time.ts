/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AMOUNT, TIME_DIRECTION } from './shared';

import type { FamilyDef } from '../types';

/** The transitions a clip in a sequence can have into it (`transition-types.ts`). */
export const TRANSITION_OPTIONS: Record<string, string> = {
  dissolve: 'A dissolve or crossfade: the clips blend into each other.',
  slideFromRight: 'The new clip slides in from the right.',
  slideFromLeft: 'The new clip slides in from the left.',
  fadeToBlack: 'A fade through black: dip to black between them.',
  fadeToWhite: 'A fade through white: dip to white, a flash between them.',
  remove: 'No transition: take the transition off, a hard cut.',
};

export const TIME: FamilyDef = {
  id: 'time',
  label: 'Timeline',
  exclusive: true,
  ask:
    'Does the command ask about time or the timeline — splitting or cutting a clip at a moment, trimming its start or end, '
    + 'when something starts or ends or how long it lasts, moving it earlier or later, its speed, a transition between clips, '
    + 'moving the playhead (go to a time, back, forward, next cut), playing or pausing, markers, or the part of the video to export? '
    + 'For example "split at 5 seconds", "go to 0:12", "make it 3 seconds long", "play", "trim the end to here", "move it a second later". '
    + 'Not deleting something, and not an entrance or exit animation.',
  slots: {
    when: { kind: 'when', ask: 'Which moment does the command mean?' },
    length: { kind: 'number', text: 'How long something should last, or a transition should take.', units: ['s', 'frames'] },
    by: { kind: 'number', text: 'How much to move, trim, slip, skip or cut off — an amount of time.', units: ['s', 'frames'] },
    rate: { kind: 'number', text: 'A speed, as a multiple: 2x, half speed, 150 percent.', units: ['x', '%'] },
    from: { kind: 'number', text: 'Where a range begins, the first of two times ("from 2 to 8 seconds").', units: ['s', 'frames'] },
    to: { kind: 'number', text: 'Where a range ends, the second of two times ("from 2 to 8 seconds").', units: ['s', 'frames'] },
    direction: TIME_DIRECTION,
    amount: AMOUNT,
    speed_word: {
      kind: 'choice',
      ask: 'Which speed does the command ask for?',
      options: {
        faster: 'Faster, sped up, quicker.',
        slower: 'Slower, slowed down, slow motion.',
        normal: 'Normal speed, real time, 1x — the speed it was.',
      },
    },
    transition_type: { kind: 'choice', ask: 'Which transition does the command ask for?', options: TRANSITION_OPTIONS },
    marker: { kind: 'marker', ask: 'Which marker does the command mean?' },
    words: { kind: 'words', text: 'a new name' },
  },
  intents: [
    {
      id: 'time.split',
      label: 'Split',
      text: {
        what: 'Cut clips in two at a moment — at the playhead, at a time the command says, at a marker, or where another element starts or ends.',
        notFor: 'Not trimming a part off, not deleting, not cutting to the clipboard, and not breaking a group or a sequence apart.',
        examples: ['split here', 'cut the clip at 5 seconds', 'split at the marker', 'make a cut where the music starts', 'blade the video at 0:03'],
      },
      uses: ['when'],
      target: 'optional',
      covers: ['splitAtPlayhead', 'edit.split'],
    },
    {
      id: 'time.trim-start',
      label: 'Trim the start',
      text: {
        what: 'Trim the beginning of a clip or element: it starts at a later moment, and the part before is cut off; its end stays.',
        notFor: 'Not moving the whole clip, not the end.',
        examples: ['trim the start to the playhead', 'cut the first 2 seconds off the clip', 'trim the beginning of the video to 1 second', 'start the clip here but keep where it ends'],
      },
      uses: ['when', 'by'],
      target: 'one',
      covers: ['trimIn'],
    },
    {
      id: 'time.trim-end',
      label: 'Trim the end',
      text: {
        what: 'Trim the end of a clip or element: it ends at an earlier moment, and the part after is cut off.',
        notFor: 'Not moving the whole clip, not the start.',
        examples: ['end it here', 'cut everything after 8 seconds', 'trim the last second off', 'make the title stop at the playhead'],
      },
      uses: ['when', 'by'],
      target: 'one',
      covers: ['trimOut'],
    },
    {
      id: 'time.set-length',
      needs: ['length'],
      label: 'Set the length',
      text: {
        what: 'Make an element last a given time, keeping when it starts.',
        examples: ['make it 3 seconds long', 'the title should last 2 seconds', 'shorten the clip to 5 seconds', 'make the logo stay up for four seconds'],
      },
      uses: ['length', 'amount'],
      target: 'one',
      covers: ['trimOut'],
    },
    {
      id: 'time.move-to',
      label: 'Move in time',
      text: {
        what: 'Move an element in time so it starts at a moment, keeping its length: at a time, at the playhead, at a marker, or right when another element starts or ends.',
        notFor: 'Not moving it on screen, and not moving it by an amount.',
        examples: ['move it to 10 seconds', 'start the logo when the title ends', 'put the outro right after the intro', 'make the text come in at the playhead'],
      },
      uses: ['when'],
      target: 'many',
      covers: ['moveEntityTo', 'start', 'end'],
    },
    {
      id: 'time.shift',
      label: 'Move earlier or later',
      text: {
        what: 'Move an element earlier or later in time by an amount, keeping its length.',
        notFor: 'Not moving it left or right on screen.',
        examples: ['move it half a second later', 'push the title back a bit', 'make it come in two seconds earlier', 'ten frames later'],
      },
      uses: ['by', 'direction', 'amount'],
      target: 'many',
      covers: ['nudgeSelectionInTime', 'edit.nudge-earlier', 'edit.nudge-later', 'edit.nudge-earlier-far', 'edit.nudge-later-far'],
    },
    {
      id: 'time.fill',
      label: 'Last the whole video',
      text: {
        what: 'Make an element last the whole video, from its very start to its end.',
        examples: ['make it last the whole video', 'keep the logo on screen the entire time', 'stretch the text across the whole video'],
      },
      target: 'many',
      covers: ['editTime'],
    },
    {
      id: 'time.slip',
      label: 'Slip',
      text: {
        what: 'Slip a clip: change which part of its footage plays, without moving the clip or changing its length.',
        examples: ['slip the footage one second', 'show a later part of the clip in the same spot', 'slip it back half a second'],
      },
      uses: ['by', 'direction', 'amount'],
      target: 'one',
      covers: ['slipEntity', 'sourceIn', 'sourceOut'],
    },
    {
      id: 'time.slide',
      label: 'Slide',
      text: {
        what: 'Slide a clip between its neighbours: move it along while the clips beside it trim to fill the gap.',
        examples: ['slide this clip a second later', 'slide it 10 frames earlier between the others'],
      },
      uses: ['by', 'direction', 'amount'],
      target: 'one',
      covers: ['slideEntity'],
    },
    {
      id: 'time.speed',
      needs: ['rate', 'speed_word'],
      label: 'Speed',
      text: {
        what: 'Change how fast a clip plays: a multiple such as double or half, faster, slower, or back to normal speed.',
        notFor: 'Not how fast an entrance or exit animation is.',
        examples: ['play it twice as fast', 'half speed', 'slow the clip down', 'back to normal speed', 'speed the video up a lot'],
      },
      uses: ['rate', 'speed_word', 'amount'],
      target: 'many',
      covers: ['playbackRate', 'speed'],
    },
    {
      id: 'time.transition',
      needs: ['transition_type'],
      label: 'Transition',
      text: {
        what: 'Put a transition into a clip from the one before it in a sequence — a dissolve, a slide, or a fade through black or white — or take one off.',
        notFor: 'Not an entrance or exit animation of one element.',
        examples: ['dissolve into the next clip', 'fade to black between these', 'add a one second crossfade', 'remove the transition'],
      },
      uses: ['transition_type', 'length'],
      target: 'one',
      covers: ['transition'],
    },
    {
      id: 'time.go-to',
      label: 'Go to',
      text: {
        what: 'Move the playhead to a moment: a time, the start, the end, a marker, or where an element starts or ends.',
        notFor: 'Not moving an element.',
        examples: ['go to 5 seconds', 'jump to the end', 'go to the drop marker', 'take me to where the title comes in', 'back to the beginning'],
      },
      uses: ['when'],
      target: 'none',
      covers: ['canvasSeek', 'seekToStart', 'seekToEnd', 'transport.start', 'transport.end'],
    },
    {
      id: 'time.skip',
      label: 'Skip',
      text: {
        what: 'Move the playhead forward or back by an amount of time.',
        examples: ['back 3 seconds', 'forward 10 frames', 'skip ahead a bit', 'go back one frame'],
      },
      uses: ['by', 'direction', 'amount'],
      target: 'none',
      covers: ['seekBy', 'transport.frame-back', 'transport.frame-forward', 'transport.second-back', 'transport.second-forward'],
    },
    {
      id: 'time.cut-jump',
      label: 'Next or previous cut',
      text: {
        what: 'Move the playhead to the next or the previous cut between clips.',
        examples: ['next cut', 'previous cut', 'jump to the next edit'],
      },
      uses: ['direction'],
      target: 'none',
      covers: ['seekToCut', 'transport.next-cut', 'transport.previous-cut'],
    },
    {
      id: 'time.play',
      label: 'Play',
      text: { what: 'Start playing the video.', examples: ['play', 'play the video', 'play it from here', 'resume'] },
      target: 'none',
      covers: ['togglePlayback', 'transport.play'],
    },
    {
      id: 'time.pause',
      label: 'Pause',
      text: { what: 'Stop playing the video: pause it.', examples: ['pause', 'stop playing', 'hold on, stop'] },
      target: 'none',
      covers: ['togglePlayback', 'transport.play', 'transport.pause-shuttle'],
    },
    {
      id: 'time.play-backwards',
      label: 'Play backwards',
      text: { what: 'Play the video backwards; again for faster.', examples: ['play backwards', 'rewind'] },
      target: 'none',
      command: 'transport.shuttle-back',
    },
    {
      id: 'time.fast-forward',
      label: 'Fast forward',
      text: { what: 'Play the video fast forward; again for faster.', examples: ['fast forward', 'play it faster to see'] },
      target: 'none',
      command: 'transport.shuttle-forward',
    },
    {
      id: 'time.range',
      needs: ['from', 'to'],
      label: 'Set the export range',
      text: {
        what: 'Set the part of the video that exports, from one time to another.',
        examples: ['export only 2 to 8 seconds', 'set the range from 1 second to 5 seconds', 'just the first 10 seconds'],
      },
      uses: ['from', 'to'],
      target: 'none',
      covers: ['editWorkarea', 'workarea'],
    },
    {
      id: 'time.mark-in',
      label: 'Mark in',
      text: {
        what: 'Mark where the part of the video to export begins.',
        examples: ['mark in here', 'set the in point at 2 seconds', 'start the export here'],
      },
      uses: ['when'],
      target: 'none',
      covers: ['setInPoint', 'range.in'],
    },
    {
      id: 'time.mark-out',
      label: 'Mark out',
      text: {
        what: 'Mark where the part of the video to export ends.',
        examples: ['mark out here', 'set the out point at 8 seconds', 'end the export here'],
      },
      uses: ['when'],
      target: 'none',
      covers: ['setOutPoint', 'range.out'],
    },
    {
      id: 'time.range-clear',
      label: 'Clear the range',
      text: { what: 'Clear the marked part to export, so the whole video exports.', examples: ['clear the range', 'export the whole thing again'] },
      target: 'none',
      command: 'range.clear',
    },
    {
      id: 'time.marker-remove',
      label: 'Remove a marker',
      text: { what: 'Take a marker off the timeline.', examples: ['remove the marker', 'delete the drop marker', 'get rid of the marker here'] },
      uses: ['marker'],
      target: 'none',
      covers: ['sceneMarkers'],
    },
    {
      id: 'time.marker-rename',
      needs: ['words'],
      label: 'Rename a marker',
      text: { what: 'Give a marker a new name.', examples: ['rename the marker to chorus', 'call this marker intro'] },
      uses: ['marker', 'words'],
      target: 'none',
      covers: ['marker.name'],
    },
  ],
};
