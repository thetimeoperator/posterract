/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { FamilyDef } from '../types';

/** What an export can be asked for, beyond the template's own settings. */
export const EXPORT_PRESETS: Record<string, { template: string; what: string }> = {
  hd: { template: 'h264-mp4-720p', what: 'HD, 720p: a smaller file.' },
  'full-hd': { template: 'h264-mp4-1080p', what: 'Full HD, 1080p: the usual export.' },
  '2k': { template: 'h264-mp4-1440p', what: '2K, 1440p.' },
  '4k': { template: 'h264-mp4-2160p', what: '4K, 2160p, Ultra HD: the sharpest.' },
  youtube: { template: 'youtube-1080p', what: 'For YouTube, 1080p.' },
  'youtube-4k': { template: 'youtube-4k', what: 'For YouTube in 4K.' },
  instagram: { template: 'instagram-1080p', what: 'For Instagram Reels.' },
  tiktok: { template: 'tiktok-1080p', what: 'For TikTok.' },
  web: { template: 'web-embedding-720p', what: 'For a web page: a small WebM file.' },
};

export const PROJECT: FamilyDef = {
  id: 'project',
  label: 'Project',
  exclusive: true,
  ask:
    'Does the command ask about the project as a whole — undoing or redoing, doing the last thing again, exporting the video or saving a frame, '
    + 'export settings, past versions, renaming the project, importing files into the library, renaming or deleting a file in the library, '
    + "setting one of the project's variables, choosing what kind of video a scene is (a skill), or opening it in the coding agent? "
    + 'For example "undo", "export in 4K", "save this frame", "rename the project to Storm", "set the headline to Sale". '
    + 'Not exporting subtitles, and not generating anything with AI.',
  slots: {
    count: { kind: 'number', text: 'How many times: how many changes to undo or redo.', units: ['count', 'x'] },
    export_preset: {
      kind: 'choice',
      ask: 'Which export does the command ask for?',
      options: Object.fromEntries(Object.entries(EXPORT_PRESETS).map(([key, preset]) => [key, preset.what])),
    },
    resolution: {
      kind: 'choice',
      ask: 'Which resolution does the command ask for?',
      options: { '720': '720p, HD.', '1080': '1080p, Full HD.', '1440': '1440p, 2K.', '2160': '2160p, 4K, Ultra HD.' },
    },
    format: {
      kind: 'choice',
      ask: 'Which file format does the command ask for?',
      options: { mp4: 'An MP4 file, the usual one.', webm: 'A WebM file, for the web.', mov: 'A MOV file, for other editors.', ogg: 'An OGG file.' },
    },
    frame_rate: { kind: 'number', text: 'How many frames a second the export runs at.', units: ['frames'] },
    words: { kind: 'words', text: 'a new name' },
    asset: { kind: 'asset', ask: 'Which file in the library does the command mean?' },
    variable: { kind: 'variable', ask: 'Which of the project variables does the command set?' },
    color: { kind: 'color', ask: 'Which color does the command give?' },
    value: { kind: 'number', text: "A variable's number.", units: ['px', '%', 's'] },
    skill: { kind: 'choice', ask: 'Which kind of video does the command say this scene is?', options: {} },
  },
  intents: [
    {
      id: 'project.undo',
      label: 'Undo',
      text: { what: 'Take back the last change, or several.', examples: ['undo', 'undo that', 'take back the last three changes', 'undo twice'] },
      uses: ['count'],
      target: 'none',
      covers: ['edit.undo'],
    },
    {
      id: 'project.redo',
      label: 'Redo',
      text: { what: 'Put back a change that was just undone.', examples: ['redo', 'redo that', 'put it back'] },
      uses: ['count'],
      target: 'none',
      covers: ['edit.redo'],
    },
    {
      id: 'project.again',
      label: 'Do that again',
      text: { what: 'Do the last command once more.', examples: ['again', 'do that again', 'once more'] },
      target: 'none',
      command: 'edit.again',
    },
    {
      id: 'project.export',
      label: 'Export',
      text: {
        what: 'Export the video to a file, with a quality, a size or a format if the command says one.',
        notFor: 'Not saving a single frame, and not subtitles.',
        examples: ['export the video', 'export in 4K', 'export for TikTok', 'export as WebM', 'render it at 60 frames a second'],
      },
      uses: ['export_preset', 'resolution', 'format', 'frame_rate'],
      target: 'none',
      covers: ['exportScene', 'export.video', 'setExport'],
    },
    {
      id: 'project.export-frame',
      label: 'Save the frame',
      text: { what: 'Save the frame under the playhead as a picture.', examples: ['save this frame as an image', 'export a still', 'screenshot this frame'] },
      target: 'none',
      covers: ['exportCurrentFrame'],
    },
    {
      id: 'project.export-settings',
      label: 'Export settings',
      text: { what: 'Open the export settings, to choose the quality and format by hand.', examples: ['open the export settings', 'show me the export options'] },
      target: 'none',
      command: 'export.settings',
    },
    {
      id: 'project.exports-library',
      label: 'Exports',
      text: { what: 'Open the library of past exports.', examples: ['open my exports', 'show the exports library'] },
      target: 'none',
      command: 'export.library',
    },
    {
      id: 'project.history',
      label: 'Version history',
      text: { what: 'Open the version history of the project.', examples: ['show the version history', 'open the versions'] },
      target: 'none',
      command: 'panel.history',
    },
    {
      id: 'project.restore',
      label: 'Restore a version',
      text: {
        what: 'Go back to the last saved version of the project, undoing everything since it.',
        examples: ['go back to the version from before', 'restore the last saved version', 'revert the project'],
      },
      target: 'none',
      risk: 'confirm',
      covers: ['restoreRevision'],
    },
    {
      id: 'project.rename',
      needs: ['words'],
      label: 'Rename the project',
      text: {
        what: 'Rename the whole project.',
        notFor: 'Not renaming an element, a scene or a file.',
        examples: ['rename the project to Storm teaser', 'call this project summer launch'],
      },
      uses: ['words'],
      target: 'none',
      covers: ['project.rename'],
    },
    {
      id: 'project.import',
      label: 'Import files',
      text: { what: 'Import files from the computer into the library.', examples: ['import a file', 'add some footage from my computer', 'upload a picture'] },
      target: 'none',
      covers: ['pickAndImport'],
    },
    {
      id: 'project.asset-rename',
      needs: ['asset'],
      label: 'Rename a file',
      text: { what: 'Rename a file in the library.', examples: ['rename the clip to drone shot', 'call that file intro music'] },
      uses: ['asset', 'words'],
      target: 'none',
      covers: ['library.rename'],
    },
    {
      id: 'project.asset-delete',
      needs: ['asset'],
      label: 'Delete a file',
      text: { what: 'Delete a file from the library.', examples: ['delete the old logo from the library', 'remove that clip from my files'] },
      uses: ['asset'],
      target: 'none',
      risk: 'confirm',
      covers: ['library.remove'],
    },
    {
      id: 'project.variable',
      needs: ['variable'],
      label: 'Set a variable',
      text: {
        what: "Set one of the project's variables — a headline, an accent color, a number the video is built from.",
        examples: ['set the headline to Summer Sale', 'set the accent color to green', 'change the count to 5'],
      },
      uses: ['variable', 'words', 'color', 'value'],
      target: 'none',
      covers: ['editVariable'],
    },
    {
      id: 'project.skill',
      needs: ['skill'],
      label: 'Skill',
      text: {
        what: 'Say what kind of video this scene is — a skill — so the agent builds it that way.',
        examples: ['make this a captioned clip', 'use the talking head skill here'],
      },
      uses: ['skill'],
      target: 'none',
      covers: ['installSkill', 'skill'],
    },
    {
      id: 'project.agent',
      label: 'Open in the agent',
      text: { what: "Open this project in the person's coding agent.", examples: ['open this in my agent', 'open the project in claude'] },
      target: 'none',
      command: 'agent.open',
    },
    {
      id: 'project.generate-panel',
      label: 'AI Generate',
      text: { what: 'Open the AI Generate panel.', examples: ['open AI generate', 'show the generate panel'] },
      target: 'none',
      command: 'ai.generate',
    },
  ],
};
