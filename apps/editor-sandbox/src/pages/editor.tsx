/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js";
import { Canvas } from "@/components/canvas";
import { Timeline, Layers, VideoTimelineTitle } from "@/components/timeline";
import { Soundboard, Inspector } from "@/components/sidebar-right";
import { FloatingProjectHeader, SidebarLeft } from "@/components/sidebar-left";
import { CommandBar } from "@/components/shell/command-bar";
import { useLayout, MIN_TIMELINE_HEIGHT } from "@/context/layout";
import { useDerived } from "@/engine/hooks";
import { useEditorApi } from "@/context/agent-api";
import { RULER_HEIGHT } from "@/engine/timeline";
import { toast } from 'somoto';
import { useWorld } from '@posterract/koota-solid';
import { mount } from '@posterract/video-reconciler';
import { getDocumentEditor } from '@/engine/editor';
import { getProject, readProjectSource } from '@/projects';
import { loadUndoCache, saveUndoCache } from '@/projects/undo-cache';
import { getEditHistory, type EditHistory } from '@/engine/history';
import { setInspectEntries } from '@/engine/inspect';
import { attachLibrary, isLibraryFile } from '@/engine/library';
import { attachProjectConfig, isProjectConfigFile } from '@/engine/project-config';
import { loadProjectBundle, rememberProjectBundle } from '@/lib/db';
import { isCacheFile } from '@posterract/video-assets';
import { createEditWriter } from '@/projects/edits';
import { bindSaveState, resetSaveState } from '@/context/save-state';
import { SceneDeleteDialog } from '@/components/scene-delete-dialog';
import { ShortcutSheet } from '@/components/shortcut-sheet';
import { compileProject, watchProject } from '@/projects/host';
import { captureProjectCover } from '@/projects/cover';
import { useProject } from "@/context/project";
import { useEngineContext } from "@/engine";
import {
  Computed,
  FrameRate,
  getActiveEntity,
  getCameraMatrix,
  getCameraScale,
  getContentBounds,
  getParentNode,
  getViewport,
  RenderSurface,
  Root,
  Scene,
  setCamera,
  store,
  WorkspaceTheme,
} from '@posterract/video-runtime';

import type { Mount } from '@posterract/video-reconciler';
import type { EditWriter } from '@/projects/edits';

const MIN_CANVAS_HEIGHT = 200;
const TIMELINE_TITLE_HEIGHT = 32;
/** Instruments float this far from the window edge and from each other. */
const INSTRUMENT_INSET = 16;
const SIDE_INSTRUMENT_WIDTH = 224;
const MIXER_WIDTH = 248;
const BAR_HEIGHT = 40;
/** The bar sits higher than the other instruments so the traffic lights read as part of it. */
const BAR_TOP = 8;
/**
 * Where the command bar starts on macOS while windowed.
 *
 * titleBarStyle "hiddenInset" draws the traffic lights over the page at roughly
 * x 20-72. The bar began at 16 and so passed underneath them, which read as the
 * bar cutting across the buttons. Starting after them puts the lights back on
 * the canvas where they belong.
 */
const MAC_BAR_LEFT = 84;
/** Where the side instruments start: below the command bar. */
const SIDE_TOP = BAR_TOP + BAR_HEIGHT + INSTRUMENT_INSET;

/** A media query as a signal, for the instruments to size themselves by. */
function useMedia(query: string) {
  const list = window.matchMedia(query);
  const [matches, setMatches] = createSignal(list.matches);
  const update = () => setMatches(list.matches);
  list.addEventListener('change', update);
  onCleanup(() => list.removeEventListener('change', update));
  return matches;
}
/** How long the pointer rests on the canvas before the instruments step back. */
const FOCUS_FADE_MS = 1500;
const MIN_FIT_ZOOM = 0.02;

type Insets = { left: number; right: number; top: number; bottom: number };

/**
 * Fit the composition into the part of the canvas the instruments leave
 * uncovered. `focusContent` fits to the whole surface, which is now the whole
 * window — with panels floating over it, that would park scenes underneath
 * them.
 */
function fitVisible(world: ReturnType<typeof useWorld>, insets: Insets, padding: number): void {
  const bounds = getContentBounds(world);
  const viewport = getViewport(world);
  if (!bounds || !viewport || bounds.width <= 0 || bounds.height <= 0) return;

  const width = viewport.width - insets.left - insets.right - padding * 2;
  const height = viewport.height - insets.top - insets.bottom - padding * 2;
  if (width <= 0 || height <= 0) return;

  const scale = Math.max(MIN_FIT_ZOOM, Math.min(1, width / bounds.width, height / bounds.height));
  const centerX = insets.left + padding + width / 2;
  const centerY = insets.top + padding + height / 2;

  setCamera(world, {
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    e: centerX - (bounds.x + bounds.width / 2) * scale,
    f: centerY - (bounds.y + bounds.height / 2) * scale,
  });
}

function formatClock(seconds: number, fps: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const frames = Math.round((seconds - whole) * fps);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${String(frames).padStart(2, '0')}`;
}

export function EditorPage() {
  const { uiVisible, timelineMinimized, timelineHeight, setTimelineHeight, toggleTimeline, mixerOpen, editorTheme } = useLayout();
  // Narrower windows get narrower instruments; the mixer steps out first, so
  // the timeline keeps its room. The canvas is never the thing that shrinks.
  const compact = useMedia('(max-width: 1320px)');
  const narrow = useMedia('(max-width: 1080px)');
  const sideWidth = createMemo(() => (narrow() ? 184 : compact() ? 204 : SIDE_INSTRUMENT_WIDTH));
  /** The mixer sits beside the dock; in Peek the dock is a strip and the mixer steps out. */
  const mixerShown = createMemo(() => mixerOpen() && !timelineMinimized() && !compact());

  // The workspace ground follows the shell's theme; the runtime paints it.
  createEffect(() => {
    const value = editorTheme();
    if (!world.has(WorkspaceTheme)) world.add(WorkspaceTheme);
    world.set(WorkspaceTheme, { value });
  });
  const { isDesktop, isFullscreen, isMac } = useEditorApi();
  // Only macOS reserves this space, and only while windowed — fullscreen hides
  // the traffic lights entirely.
  const barLeft = createMemo(() => (isMac && !isFullscreen() ? MAC_BAR_LEFT : INSTRUMENT_INSET));
  const [resizing, setResizing] = createSignal(false);
  const project = useProject();
  const world = useWorld();
  const engine = useEngineContext();

  // Keyed on the folder, not the project: a rename moves it, and everything
  // below holds a path — the watcher, the library, the writer — so all of it
  // is torn down and re-attached where the project now is.
  createEffect(() => {
    const dir = project.dir();
    if (!dir) return;

    let mounted: Mount | undefined;
    let mountedCode: string | undefined;
    let writer: EditWriter | undefined;
    let unbindSaveState: (() => void) | undefined;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let generation = 0;
    let initialViewFitted = false;
    let fitFrame: number | undefined;
    let fitSequence = 0;

    /**
     * Fit only after Engine.resize has replaced the canvas element's temporary
     * 300×150 browser size with the real workspace dimensions. The retry also
     * covers the first transform pass that produces document bounds.
     */
    const scheduleFit = (): void => {
      const sequence = ++fitSequence;
      if (fitFrame !== undefined) cancelAnimationFrame(fitFrame);

      const attemptFit = (attempt: number): void => {
        if (disposed || sequence !== fitSequence) return;

        const canvas = world.get(RenderSurface)?.canvas;
        const viewport = getViewport(world);
        const bounds = getContentBounds(world);
        const canvasHost = canvas instanceof HTMLCanvasElement ? canvas.parentElement : null;
        const hostRect = canvasHost?.getBoundingClientRect();
        const layoutIsFinal = Boolean(
          viewport
          && hostRect
          && hostRect.width > 0
          && hostRect.height > 0
          && Math.abs(viewport.width - hostRect.width) < 2
          && Math.abs(viewport.height - hostRect.height) < 2,
        );

        if (layoutIsFinal && bounds && canvasHost) {
          fitVisible(world, untrack(insets), 32);
          const root = world.get(Root);
          if (root) getDocumentEditor(world).reportEdit(root, 'camera', getCameraMatrix(world));
          initialViewFitted = true;
          fitFrame = undefined;
          return;
        }

        if (attempt < 180) {
          fitFrame = requestAnimationFrame(() => attemptFit(attempt + 1));
        } else {
          fitFrame = undefined;
        }
      };

      // Two frames allow the engine's own ResizeObserver to size the render
      // surface before this controller reads and centers it.
      fitFrame = requestAnimationFrame(() => {
        fitFrame = requestAnimationFrame(() => attemptFit(0));
      });
    };

    // The library first: a mounted project's `src` values name its assets.
    const library = attachLibrary(world, dir);
    // Project export settings live in the Posterract package configuration.
    const config = attachProjectConfig(world, dir);

    const unmount = (): void => {
      // Before the entities go: what the editor changed is still owed to the
      // file, whatever happens to the scene that showed it.
      unlisten?.();
      unlisten = undefined;
      writer?.dispose();
      writer = undefined;
      unbindSaveState?.();
      unbindSaveState = undefined;
      resetSaveState();
      mounted?.dispose();
      mounted = undefined;
      mountedCode = undefined;
      setInspectEntries(world, []);
    };

    /**
     * Restore the previous session's undo stack, once, if it still matches the
     * source on disk. Later mounts in the same session are the editor's own
     * recompiles, whose stack is already live in memory.
     */
    let undoRestored = false;
    let persistTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * Keep the cached stack in step with the file. It is written after a save
     * settles, stamped with the revision that save produced, so a stack is
     * never paired with source it cannot address. Debounced because a drag
     * ends in a burst of saves and only the last one matters.
     */
    const persistUndo = (): void => {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        void (async () => {
          try {
            const project = await getProject(dir);
            if (!project || disposed) return;
            const { revisionId } = await readProjectSource(dir, project.entry);
            if (disposed) return;
            await saveUndoCache(dir, revisionId, getEditHistory(world).serialize());
          } catch {
            // Losing the cache costs undo across a reload, nothing more.
          }
        })();
      }, 400);
    };

    const adoptCachedUndo = async (history: EditHistory): Promise<void> => {
      if (undoRestored || disposed) return;
      undoRestored = true;
      try {
        const project = await getProject(dir);
        if (!project || disposed) return;
        const { revisionId } = await readProjectSource(dir, project.entry);
        const cached = await loadUndoCache(dir, revisionId);
        if (cached && !disposed) history.restore(cached);
      } catch {
        // A missing or unreadable cache just means no undo across the reload.
      }
    };

    /** Puts `code` on the stage, unless it is what is there already. */
    const applyBundle = (code: string): void => {
      if (code === mountedCode) return;
      // The old render goes first: there is only one stage per world.
      unmount();
      mounted = mount(code, world);
      mountedCode = code;
      setInspectEntries(world, mounted.inspect);
      // The rendered scene knows which element every entity came from, so
      // from here on an edit in the editor can find its way back.
      writer = createEditWriter(dir, world);
      unbindSaveState?.();
      unbindSaveState = bindSaveState(writer, (state) => {
        if (state.status === 'saved') persistUndo();
      });
      const editor = getDocumentEditor(world);
      unlisten = editor.onEdit((edit) => writer?.push(edit));

      // Older projects can predate the `active` scene attribute. A project
      // with frames but no active frame renders correctly on the canvas, but
      // leaves the timeline with no video to describe. Choose the first
      // top-level frame through the normal editor route so the repair is also
      // persisted to that project's TSX source.
      if (getActiveEntity(world) === null) {
        const firstScene = [...world.query(Scene)].find((entity) => getParentNode(entity) === null);
        if (firstScene) editor.activate(firstScene);
      }

      // Cached bundles mount before the fresh compile finishes. Fitting here
      // makes the full canvas stable before the user can click a component;
      // waiting for the compile made that first click appear to change zoom.
      if (!initialViewFitted) scheduleFit();
      // A mount comes from the file: edits recorded against the document it
      // replaced cannot be replayed against this one. A stack cached from a
      // previous session is adopted only when it was recorded against exactly
      // this revision, which is checked in `loadUndoCache`.
      const history = getEditHistory(world);
      history.reset();
      void adoptCachedUndo(history);
    };

    const loadProject = async (): Promise<void> => {
      const current = ++generation;
      const compiling = compileProject(dir);
      const loading = library.load();

      // First open only: the bundle the last session mounted, straight from
      // the app's database, goes on the stage while the compile chews
      // through the sources — unless the compile wins the race outright. A
      // bundle the sources have outgrown can fail against today's assets;
      // the compile that is already running replaces it either way.
      if (current === 1) {
        // Neither arm may reject: the loser would be an unhandled rejection,
        // and the compile's real failure is dealt with below.
        const cached = await Promise.race([
          Promise.all([loadProjectBundle(untrack(project.id)), loading])
            .then(([code]) => code, () => null),
          compiling.then(() => null, () => null),
        ]);
        if (disposed || current !== generation) return;
        if (cached && mountedCode === undefined) {
          try {
            applyBundle(cached);
          } catch {
            // The compile lands next, with a toast of its own if it must.
          }
        }
      }

      const [result] = await Promise.all([compiling, loading]);
      if (disposed || current !== generation) return;

      // A broken edit keeps the last good render on the canvas.
      if (!result.ok) {
        console.error('[projects] compile failed:', result.error);
        toast.error('Project failed to compile', { description: result.error });
        return;
      }

      try {
        applyBundle(result.code);
        // What an export renders a second time, and the next open's head
        // start (see `rememberProjectBundle`) — recorded only once it has
        // actually mounted, so the record never runs ahead of the canvas.
        rememberProjectBundle(untrack(project.id), result.code).catch((error) =>
          console.error('[projects] could not save the bundle', error));
      } catch (error) {
        console.error('[projects] render failed:', error);
        toast.error('Project failed to render', { description: (error as Error).message });
      }
    };

    const load = (): void => {
      loadProject().catch((error) => {
        console.error('[projects] load failed:', error);
        toast.error('Project failed to load', { description: (error as Error).message });
      });
    };

    load();
  
    const unwatch = watchProject(dir, (path) => {
      if (isCacheFile(path)) return;
      if (isLibraryFile(path)) {
        library.load();
      } else {
        // package.json is the config and the record (`main`, `displayName`)
        // in one, so a hand edit to it reloads both; the app's own config
        // writes never reach here (main keeps them from the watcher).
        if (isProjectConfigFile(path)) {
          config.load();
          void project.refresh();
        }
        load();
      }
    });

    onCleanup(() => {
      disposed = true;
      if (persistTimer) clearTimeout(persistTimer);
      fitSequence += 1;
      if (fitFrame !== undefined) cancelAnimationFrame(fitFrame);
      captureProjectCover(dir, engine.snapshot());
      unwatch();
      unmount();
      config.dispose();
      library.dispose();
    });
  });

  /** The dock's full height on screen: its title row plus the lanes, or the ruler alone in Peek. */
  const dockHeight = createMemo(() => (timelineMinimized() ? RULER_HEIGHT + 8 : timelineHeight() + TIMELINE_TITLE_HEIGHT));
  /** Where the side instruments end: just above the dock. */
  const dockBottom = createMemo(() => INSTRUMENT_INSET * 2 + dockHeight());

  /** What the instruments cover, for fitting the composition between them. */
  const insets = createMemo<Insets>(() => {
    if (!uiVisible()) return { left: 0, right: 0, top: 0, bottom: 0 };
    // The left instrument carries a 52px rail beside its drawer.
    const left = INSTRUMENT_INSET * 2 + sideWidth() + 52;
    const right = INSTRUMENT_INSET * 2 + sideWidth();
    // The top inset leaves room for the scene headers drawn above the frames.
    return { left, right, top: SIDE_TOP + 44, bottom: dockBottom() };
  });

  // Focus fade: rest the pointer on the canvas and the instruments step back;
  // touch one and they return. Keyboard use counts as touching them.
  const [focusMode, setFocusMode] = createSignal<'canvas' | ''>('');
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  const armFocusFade = () => {
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => setFocusMode('canvas'), FOCUS_FADE_MS);
  };
  const clearFocusFade = () => {
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = undefined;
    setFocusMode('');
  };
  onMount(() => {
    window.addEventListener('keydown', clearFocusFade);
    onCleanup(() => {
      window.removeEventListener('keydown', clearFocusFade);
      if (focusTimer) clearTimeout(focusTimer);
    });
  });

  // Telemetry corner: zoom and playhead, the HUD readout heritage made useful.
  const zoomPercent = useDerived(() => Math.round(getCameraScale(world) * 100));
  const playheadClock = useDerived(() => {
    const active = getActiveEntity(world);
    const fps = world.get(FrameRate)?.value ?? 30;
    const frame = active ? (store(world, Computed).localTime[active.id()] ?? 0) : 0;
    return formatClock(frame / fps, fps);
  });

  const handleResizeStart = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (timelineMinimized()) return;
    const startY = e.clientY;
    const startHeight = timelineHeight();
    setResizing(true);

    const handleMove = (ev: PointerEvent) => {
      const deltaY = startY - ev.clientY;
      const maxHeight = Math.max(
        MIN_TIMELINE_HEIGHT,
        window.innerHeight - MIN_CANVAS_HEIGHT - TIMELINE_TITLE_HEIGHT - INSTRUMENT_INSET * 2,
      );
      const next = Math.max(MIN_TIMELINE_HEIGHT, Math.min(maxHeight, startHeight + deltaY));
      setTimelineHeight(next);
    };

    const handleEnd = () => {
      setResizing(false);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleEnd);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleEnd);
  };

  return (
    <div
      class="posterract-editor-shell relative h-screen w-full overflow-hidden"
      data-focus={focusMode()}
      data-resizing={resizing()}
      data-theme={editorTheme()}
      style={{ '--canvas-bottom-inset': uiVisible() ? `${dockBottom() + 4}px` : '16px' }}
    >
      {/* With the instruments hidden there is no command bar to drag the
          window by, so a bare strip along the top stands in for it. With them
          shown, the bar is the drag area — a strip here would sit over it
          and swallow its clicks. */}
      <Show when={isDesktop && !isFullscreen() && !uiVisible()}>
        <div class="fixed top-0 left-0 right-0 h-10 z-20" style="-webkit-app-region: drag;" />
      </Show>

      {/* The canvas is the whole window; everything else floats over it. */}
      <div class="absolute inset-0" onPointerMove={armFocusFade} onPointerLeave={clearFocusFade}>
        <Canvas />
      </div>

      <div
        class="posterract-telemetry"
        classList={{ 'opacity-0': !uiVisible() }}
        style={{ left: `${INSTRUMENT_INSET * 2 + sideWidth() + 52 + 8}px`, bottom: `${dockBottom() + 2}px` }}
      >
        <span>ZOOM <b>{zoomPercent()}%</b></span>
        <span>T <b>{playheadClock()}</b></span>
      </div>

      <Show when={uiVisible()}>
        <div class="posterract-instrument-layer" onPointerMove={clearFocusFade}>
          {/* The command bar: wordmark, project, scenes, save state, zoom, layout toggles. */}
          <div
            class="posterract-instrument posterract-bar"
            style={{ left: `${barLeft()}px`, right: `${INSTRUMENT_INSET}px`, top: `${BAR_TOP}px`, height: `${BAR_HEIGHT}px` }}
          >
            <CommandBar />
          </div>

          <div
            class="posterract-instrument"
            style={{ left: `${INSTRUMENT_INSET}px`, top: `${SIDE_TOP}px`, width: `${sideWidth() + 52}px`, bottom: `${dockBottom()}px` }}
          >
            <SidebarLeft />
          </div>

          <div
            class="posterract-instrument"
            style={{ right: `${INSTRUMENT_INSET}px`, top: `${SIDE_TOP}px`, width: `${sideWidth()}px`, bottom: `${dockBottom()}px` }}
          >
            <Inspector />
          </div>

          {/* The timeline dock: grab the top edge to resize, double-click it for Peek. */}
          <div
            class="posterract-instrument posterract-dock"
            style={{
              left: `${INSTRUMENT_INSET}px`,
              right: `${mixerShown() ? INSTRUMENT_INSET * 2 + MIXER_WIDTH : INSTRUMENT_INSET}px`,
              bottom: `${INSTRUMENT_INSET}px`,
              height: `${dockHeight()}px`,
            }}
          >
            <div
              class="posterract-instrument-grab"
              classList={{ 'bg-primary': resizing() }}
              onPointerDown={handleResizeStart}
              onDblClick={toggleTimeline}
              title="Drag to resize · double-click for Peek"
            />
            <div
              class="grid h-full min-h-0"
              style={{ 'grid-template-rows': timelineMinimized() ? '1fr' : `${TIMELINE_TITLE_HEIGHT}px 1fr` }}
            >
              <Show when={!timelineMinimized()}>
                <VideoTimelineTitle />
              </Show>
              <div class="grid min-h-0" style={{ 'grid-template-columns': '220px 1px minmax(0, 1fr)' }}>
                <div class="min-h-0 overflow-hidden">
                  <Layers />
                </div>
                <div class="bg-border-strong" />
                <Timeline />
              </div>
            </div>
          </div>

          {/* The audio mixer: its own instrument beside the dock, the same height. */}
          <Show when={mixerShown()}>
            <div
              class="posterract-instrument posterract-mixer"
              style={{ right: `${INSTRUMENT_INSET}px`, bottom: `${INSTRUMENT_INSET}px`, width: `${MIXER_WIDTH}px`, height: `${dockHeight()}px` }}
            >
              <div class="flex h-8 items-center px-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                Audio mixer
              </div>
              <div class="min-h-0" style={{ height: `${dockHeight() - 32}px` }}>
                <Soundboard />
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={!uiVisible()}>
        <FloatingProjectHeader />
      </Show>
      {/* Always mounted: both answer keys that work with the rest of the UI
          hidden. */}
      <SceneDeleteDialog />
      <ShortcutSheet />
    </div>
  );
}
