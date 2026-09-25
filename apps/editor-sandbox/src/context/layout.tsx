/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { batch, createContext, useContext, type Accessor, type JSX } from 'solid-js';
import { assert } from '@/utils';
import { createStoredSignal } from '@/lib/store';
import { store } from '@/init';

type LayoutContextValue = {
  uiVisible: Accessor<boolean>;
  timelineMinimized: Accessor<boolean>;
  timelineHeight: Accessor<number>;
  setTimelineHeight(height: number): void;
  toggleUI(): void;
  toggleTimeline(): void;
  /** The audio mixer, a pop-over beside the dock rather than a fixed column. */
  mixerOpen: Accessor<boolean>;
  toggleMixer(): void;
  /** The look of the shell: `noir` (the default) or `frost`, the glass mode. */
  editorTheme: Accessor<EditorTheme>;
  toggleEditorTheme(): void;
  workspace: Accessor<EditorWorkspace>;
  setWorkspace(workspace: EditorWorkspace): void;
  leftOpen: Accessor<boolean>;
  toggleLeft(): void;
  inspectorOpen: Accessor<boolean>;
  toggleInspector(): void;
  inspectorTab: Accessor<InspectorTab>;
  setInspectorTab(tab: InspectorTab): void;
};

export type EditorTheme = 'noir' | 'frost';
export type EditorWorkspace = 'storyboard' | 'edit' | 'motion';
export type InspectorTab = 'design' | 'motion' | 'history';

type WorkspaceLayout = { height: number; minimized: boolean; left: boolean; inspector: boolean };
const DEFAULT_WORKSPACES: Record<EditorWorkspace, WorkspaceLayout> = {
  storyboard: { height: 180, minimized: true, left: true, inspector: true },
  edit: { height: 224, minimized: false, left: true, inspector: true },
  motion: { height: 300, minimized: false, left: false, inspector: true },
};

const LayoutContext = createContext<LayoutContextValue>();

export const MIN_TIMELINE_HEIGHT = 128;
export const DEFAULT_TIMELINE_HEIGHT = DEFAULT_WORKSPACES.edit.height;

export function LayoutProvider(props: { children: JSX.Element }) {
  const [uiVisible, setUiVisible] = createStoredSignal(
    store.define<boolean>('layout.uiVisible', true),
  );

  const [workspace, setWorkspaceValue] = createStoredSignal(
    store.define<EditorWorkspace>('layout.workspace', 'edit'),
  );
  const [workspaces, setWorkspaces] = createStoredSignal(
    store.define<Record<EditorWorkspace, WorkspaceLayout>>('layout.workspaces.v1', DEFAULT_WORKSPACES),
  );
  const layout = () => workspaces()[workspace()] ?? DEFAULT_WORKSPACES.edit;
  const patchLayout = (patch: Partial<WorkspaceLayout>) =>
    setWorkspaces({ ...workspaces(), [workspace()]: { ...layout(), ...patch } });
  const timelineHeight = () => layout().height;
  const timelineMinimized = () => layout().minimized;
  const setTimelineHeight = (height: number) => patchLayout({ height: Math.max(MIN_TIMELINE_HEIGHT, height) });
  const leftOpen = () => layout().left;
  const inspectorOpen = () => layout().inspector;
  const toggleLeft = () => patchLayout({ left: !leftOpen() });
  const toggleInspector = () => patchLayout({ inspector: !inspectorOpen() });
  const [inspectorTab, setInspectorTabValue] = createStoredSignal(
    store.define<InspectorTab>('layout.inspectorTab', 'design'),
  );
  const setInspectorTab = (tab: InspectorTab) => batch(() => {
    setInspectorTabValue(tab);
    patchLayout({ inspector: true });
  });
  const setWorkspace = (next: EditorWorkspace) => batch(() => {
    setWorkspaceValue(next);
    setInspectorTabValue(next === 'motion' ? 'motion' : 'design');
  });

  const [mixerOpen, setMixerOpen] = createStoredSignal(
    store.define<boolean>('layout.workspaceMixerVisible', false),
  );

  const toggleUI = () => setUiVisible(!uiVisible());
  const toggleTimeline = () => patchLayout({ minimized: !timelineMinimized() });
  const toggleMixer = () => setMixerOpen(!mixerOpen());

  const [editorTheme, setEditorTheme] = createStoredSignal(
    store.define<EditorTheme>('layout.editorTheme', 'noir'),
  );
  const toggleEditorTheme = () => setEditorTheme(editorTheme() === 'noir' ? 'frost' : 'noir');

  return (
    <LayoutContext.Provider
      value={{
        uiVisible,
        timelineMinimized,
        timelineHeight,
        setTimelineHeight,
        toggleUI,
        toggleTimeline,
        mixerOpen,
        toggleMixer,
        editorTheme,
        toggleEditorTheme,
        workspace,
        setWorkspace,
        leftOpen,
        toggleLeft,
        inspectorOpen,
        toggleInspector,
        inspectorTab,
        setInspectorTab,
      }}>
      {props.children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  assert(ctx, 'useLayout must be used within LayoutProvider');
  return ctx;
}
