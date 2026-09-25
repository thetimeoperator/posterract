/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { toast } from 'somoto';
import { ProjectMenu } from '@/components/sidebar-left/project-menu';
import { SavePill } from '@/components/sidebar-right/inspector/save-pill';
import { ExportPanel } from '@/components/sidebar-right/inspector/export';
import { getDefaultExportTemplate } from '@/components/sidebar-right/inspector/export-templates';
import { PosterractCodePanel } from '@/components/posterract-code-panel';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Dialog, DialogContent, DialogDescription, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useLayout, type EditorWorkspace } from '@/context/layout';
import { useExport } from '@/context/export';
import { useProject } from '@/context/project';
import { useActiveScene } from '@/engine/hooks/use-active-scene';
import { useProjectConfig } from '@/engine/project-config';
import { setTimelineDetail } from '@/engine/timeline/detail';
import { registerCommand } from '@/engine/voice';

const WORKSPACES: { value: EditorWorkspace; label: string; hint: string }[] = [
  { value: 'storyboard', label: 'Storyboard', hint: 'Arrange scenes on the canvas' },
  { value: 'edit', label: 'Edit', hint: 'Cut video, edit text and sound' },
  { value: 'motion', label: 'Motion', hint: 'Refine animation and keyframes' },
];

export function CommandBar() {
  const navigate = useNavigate();
  const project = useProject();
  const layout = useLayout();
  const scene = useActiveScene();
  const config = useProjectConfig();
  const { exportScene, exporting } = useExport();
  const [draft, setDraft] = createSignal<string | null>(null);
  const [exportSettings, setExportSettings] = createSignal(false);

  // The dialog is this bar's, so the voice bar's command for it is registered here.
  onMount(() => onCleanup(registerCommand({
    id: 'export.settings', label: 'Export settings', group: 'Export', keys: [],
    aliases: ['export settings', 'export options'], when: 'scene',
    action: () => setExportSettings(true),
  })));

  const commitName = async (input: HTMLInputElement) => {
    const name = draft()?.trim();
    if (name && name !== project.name()) {
      try { await project.rename(name); }
      catch (error) { toast.error('Could not rename project', { description: (error as Error).message }); }
    }
    setDraft(null);
    input.blur();
  };
  const runExport = () => {
    const current = scene();
    if (current) void exportScene(current, config()?.exportOf(current) ?? getDefaultExportTemplate());
  };

  return (
    <>
      <div class="posterract-command-bar" style="-webkit-app-region: drag;">
        <div class="posterract-project-identity" style="-webkit-app-region: no-drag;">
          <ProjectMenu />
          <span class="posterract-wordmark">POSTER<b>RACT</b></span>
          <div class="posterract-project-status">
            <input
              aria-label="Project name" type="text" class="posterract-bar-name" value={draft() ?? project.name()}
              onInput={e => setDraft(e.currentTarget.value)}
              onFocus={e => { setDraft(project.name()); e.currentTarget.select(); }}
              onBlur={() => setDraft(null)}
              onKeyDown={e => {
                if (e.key === 'Enter') void commitName(e.currentTarget);
                if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
              }}
            />
            <SavePill />
          </div>
        </div>
        <div class="posterract-workspace-switch" role="group" aria-label="Editor workspace" style="-webkit-app-region: no-drag;">
          <For each={WORKSPACES}>{mode => (
            <button type="button" aria-pressed={layout.workspace() === mode.value} title={mode.hint}
              onClick={() => { layout.setWorkspace(mode.value); if (mode.value === 'motion') setTimelineDetail('animation'); }}>
              {mode.label}
            </button>
          )}</For>
        </div>
        <div class="posterract-command-actions" style="-webkit-app-region: no-drag;">
          <PosterractCodePanel compact />
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger as={Button} variant="ghost" size="icon" aria-label="Workspace panels and appearance" title="Workspace panels and appearance">
              <Icon name="sidebar" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal><DropdownMenuContent class="w-56">
              <DropdownMenuItem onSelect={layout.toggleLeft}>{layout.leftOpen() ? 'Collapse assets' : 'Show assets'}</DropdownMenuItem>
              <DropdownMenuItem onSelect={layout.toggleInspector}>{layout.inspectorOpen() ? 'Hide inspector' : 'Show inspector'}</DropdownMenuItem>
              <DropdownMenuItem onSelect={layout.toggleTimeline}>{layout.timelineMinimized() ? 'Expand timeline' : 'Collapse timeline'}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => layout.setInspectorTab('history')}>Version history</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={layout.toggleEditorTheme}>{layout.editorTheme() === 'noir' ? 'Switch to Glass' : 'Switch to Noir'}</DropdownMenuItem>
              <DropdownMenuItem onSelect={layout.toggleUI}>Hide interface</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenuPortal>
          </DropdownMenu>
          <div class="posterract-export-action" role="group" aria-label="Video export" aria-busy={exporting()}>
            <Button variant="ghost" disabled={!scene() || exporting()} onClick={runExport} class="posterract-export-primary" aria-label={exporting() ? 'Exporting video' : 'Export video'}>
              <span class="posterract-export-icon" aria-hidden="true"><Icon name="film-video-export" class="size-4" /></span>
              <span>{exporting() ? 'Exporting…' : 'Export'}</span>
            </Button>
            <DropdownMenu placement="bottom-end">
              <DropdownMenuTrigger as={Button} variant="ghost" class="posterract-export-options" aria-label="Export and scheduling options" title="Export options">
                <Icon name="chevron-down" class="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuPortal><DropdownMenuContent class="w-56">
                <DropdownMenuItem disabled={!scene()} onSelect={() => setExportSettings(true)}>Export settings…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/?view=exports')}>Open exports library…</DropdownMenuItem>
              </DropdownMenuContent></DropdownMenuPortal>
            </DropdownMenu>
          </div>
        </div>
      </div>
      <Dialog open={exportSettings()} onOpenChange={setExportSettings}>
        <DialogPortal><DialogContent class="max-h-[85vh] overflow-y-auto">
          <DialogTitle>Export settings</DialogTitle>
          <DialogDescription>Choose the format and quality for the active video.</DialogDescription>
          <Show when={scene()} keyed>{current => <ExportPanel selection={[current]} />}</Show>
        </DialogContent></DialogPortal>
      </Dialog>
    </>
  );
}
