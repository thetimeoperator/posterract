/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, useContext, type Accessor, type JSX } from 'solid-js';
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
};

export type EditorTheme = 'noir' | 'frost';

const LayoutContext = createContext<LayoutContextValue>();

export const MIN_TIMELINE_HEIGHT = 96;
// The dock is an instrument over the canvas, not a row of the window, so it
// starts small: a ruler and three lanes. The canvas is the point.
export const DEFAULT_TIMELINE_HEIGHT = 156;

export function LayoutProvider(props: { children: JSX.Element }) {
  const [uiVisible, setUiVisible] = createStoredSignal(
    store.define<boolean>('layout.uiVisible', true),
  );

  const [timelineHeight, setTimelineHeight] = createStoredSignal(
    store.define<number>('layout.timelineHeight', DEFAULT_TIMELINE_HEIGHT),
  );
  const [timelineMinimized, setTimelineMinimized] = createStoredSignal(
    store.define<boolean>('layout.timelineMinimized', true),
  );

  const [mixerOpen, setMixerOpen] = createStoredSignal(
    store.define<boolean>('layout.mixerVisible', true),
  );

  const toggleUI = () => setUiVisible(!uiVisible());
  const toggleTimeline = () => setTimelineMinimized(!timelineMinimized());
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
