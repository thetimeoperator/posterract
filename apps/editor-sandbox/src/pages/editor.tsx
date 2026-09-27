/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js";
import { Canvas } from "@/components/canvas";
import { Timeline, Layers, VideoTimelineTitle } from "@/components/timeline";
import { Soundboard, Inspector } from "@/components/sidebar-right";
import { FloatingProjectHeader, SidebarLeft } from "@/components/sidebar-left";
import { CommandBar } from "@/components/shell/command-bar";
import { SceneSwitcher } from "@/components/shell/scene-switcher";
import { Button } from "@/components/ui/button";
import { InspectorHeader } from "@/components/sidebar-right/inspector/inspector-header";
import { useActiveScene } from "@/engine/hooks/use-active-scene";
import { bindWorkspaceCamera } from "@/engine/camera";
import { workspaceFit, type WorkspaceInsets } from "@/engine/workspace-fit";
import { useLayout, MIN_TIMELINE_HEIGHT } from "@/context/layout";
import { useDerived } from "@/engine/hooks";
import { useEditorApi } from "@/context/agent-api";
import { RULER_HEIGHT } from "@/engine/timeline";
import { toast } from 'somoto';
import { useWorld } from '@posterract/koota-solid';
import { prepareMount } from '@posterract/video-reconciler';
import { getDocumentEditor } from '@/engine/editor';
import { getProject, readProjectSource } from '@/projects';
import { loadUndoCache, saveUndoCache } from '@/projects/undo-cache';
import { getEditHistory, type EditHistory } from '@/engine/history';
import { onVoiceHistory } from '@/engine/voice';
import { setInspectEntries } from '@/engine/inspect';
import { attachLibrary, isLibraryFile } from '@/engine/library';
import { attachProjectConfig, isProjectConfigFile } from '@/engine/project-config';
import { loadProjectBundle, rememberProjectBundle } from '@/lib/db';
import { isCacheFile } from '@posterract/video-assets';
import { createEditWriter } from '@/projects/edits';
import { createViewStateStore, splitViewEdit } from '@/projects/view-state';
import { applySourcePatch } from '@/projects/hot-reload';
import { publishShownRevisions } from '@/projects/shown';
import { bindSaveState, resetSaveState } from '@/context/save-state';
import { SceneDeleteDialog } from '@/components/scene-delete-dialog';
import { ShortcutSheet } from '@/components/shortcut-sheet';
import { compileProject, requestSourcePatch, watchProject } from '@/projects/host';
import { captureProjectCover } from '@/projects/cover';
import { useProject } from "@/context/project";
import { useEngineContext } from "@/engine";
import {
  Computed,
  FrameRate,
  getActiveEntity,
  getCameraMatrix,
  getContentBounds,
  getEntityBounds,
  getParentNode,
  getViewport,
  RenderSurface,
  Root,
  Scene,
  setCamera,
  store,
  WorkspaceTheme,
  transformSystem,
} from '@posterract/video-runtime';

import type { Mount } from '@posterract/video-reconciler';
import type { EditWriter } from '@/projects/edits';

const MIN_CANVAS_HEIGHT = 200;
const TIMELINE_TITLE_HEIGHT = 44;
/** Instruments float this far from the window edge and from each other. */
const INSTRUMENT_INSET = 12;
const SIDE_INSTRUMENT_WIDTH = 232;
const MIXER_WIDTH = 248;
const BAR_HEIGHT = 52;
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
type Insets = WorkspaceInsets;

/** A file the composition is written in, as opposed to the project's config, library or media. */
const isCompositionSource = (path: string): boolean => /\.[cm]?[jt]sx?$/i.test(path);

/**
 * Fit the composition into the part of the canvas the instruments leave
 * uncovered. `focusContent` fits to the whole surface, which is now the whole
 * window — with panels floating over it, that would park scenes underneath
 * them.
 */
function fitVisible(world: ReturnType<typeof useWorld>, insets: Insets, padding: number, activeOnly = true): boolean {
  if (!world.get(Root)) return false;
  // A resize and the initial fit can land in one animation frame. Bounds
  // must use the current camera before its inverse is applied to them.
  transformSystem(world);
  const active = getActiveEntity(world);
  const bounds = activeOnly && active ? getEntityBounds(world, [active]) : getContentBounds(world);
  const viewport = getViewport(world);
  if (!bounds || !viewport) return false;
  const camera = workspaceFit(bounds, viewport, insets, padding);
  if (!camera) return false;
  const previous = getCameraMatrix(world);
  const next = [camera.a, camera.b, camera.c, camera.d, camera.e, camera.f];
  if (next.some((value, i) => Math.abs(value - previous[i]!) > 0.0001)) {
    setCamera(world, camera);
    const root = world.get(Root);
    if (root) getDocumentEditor(world).reportEdit(root, 'camera', getCameraMatrix(world));
  }
  return true;
}

function formatClock(seconds: number, fps: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const frames = Math.round((seconds - whole) * fps);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${String(frames).padStart(2, '0')}`;
}

export function EditorPage() {
  const { uiVisible, timelineMinimized, timelineHeight, setTimelineHeight, toggleTimeline, mixerOpen, editorTheme, workspace, leftOpen, inspectorOpen } = useLayout();
  // Narrower windows get narrower instruments; the mixer steps out first, so
  // the timeline keeps its room. The canvas is never the thing that shrinks.
  const compact = useMedia('(max-width: 1320px)');
  const narrow = useMedia('(max-width: 1080px)');
  const sideWidth = createMemo(() => (narrow() ? 200 : compact() ? 212 : SIDE_INSTRUMENT_WIDTH));
  const leftWidth = createMemo(() => leftOpen() ? sideWidth() + 52 : 52);
  const inspectorWidth = createMemo(() => narrow() ? 248 : 280);
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
  const activeScene = useActiveScene();
  const [fitMode, setFitMode] = createSignal<'active' | 'all' | 'manual'>(workspace() === 'storyboard' ? 'all' : 'active');
  const [windowHeight, setWindowHeight] = createSignal(window.innerHeight);
  onMount(() => {
    const resized = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', resized);
    onCleanup(() => window.removeEventListener('resize', resized));
  });
  const visibleTimelineHeight = createMemo(() => Math.min(timelineHeight(), Math.max(MIN_TIMELINE_HEIGHT, windowHeight() - SIDE_TOP - 260)));

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
          if (untrack(fitMode) !== 'manual') fitVisible(world, untrack(insets), 24, untrack(fitMode) !== 'all');
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
    // Where the author is looking — selection, active scene, camera, timeline
    // rows — is remembered beside the project, not in its source, so a click
    // is not a revision of the document (see @/projects/view-state).
    const view = createViewStateStore(dir, world);
    const viewLoading = view.load();
    // What is typed or said to the voice bar is kept beside the project, like the view.
    const stopVoiceHistory = onVoiceHistory(() => view.touch());
    let unlistenRenames: (() => void) | undefined;

    const unmount = (): void => {
      // While the entities are still there to be read: the view they show is
      // what the next mount is made to look like.
      if (mounted) view.detach();
      unlistenRenames?.();
      unlistenRenames = undefined;
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

    /**
     * Which revision of each source the canvas is showing. A mount sets it from
     * the compile; the person's own writes move it forward; a change made to
     * the file by someone else is patched in from it (see `hotReload`). Empty
     * while only a cached bundle is up, whose sources nobody vouches for.
     */
    const shown = new Map<string, string>();
    onCleanup(publishShownRevisions(dir, shown));
    /** Set while a change that is already in the file is being shown: the writer must not write it again. */
    let showingFileChange = false;
    /**
     * Set when the file is about to be mounted again because someone else
     * changed it (see `hotReload`): the revision that mount has to be of, and
     * where the elements addressed by position are in it. The mount that
     * matches carries the person's undo history over instead of clearing it.
     */
    let carry: { path: string; revisionId: string; renames: Record<string, string> } | undefined;

    /** Puts `code` on the stage, unless it is what is there already. */
    const applyBundle = (code: string, revisions?: Record<string, string>): void => {
      if (code === mountedCode) {
        if (revisions) for (const [path, revision] of Object.entries(revisions)) shown.set(path, revision);
        return;
      }
      // The person's steps, while they are still whole: they name elements by
      // address, not by entity, so they can outlive the render they were made on.
      const carried = carry && mounted && revisions?.[carry.path] === carry.revisionId
        ? { steps: getEditHistory(world).serialize(), renames: carry.renames }
        : undefined;
      carry = undefined;
      // Evaluated while the old render is still up: code that cannot run (an
      // agent's write read half done, no default export) throws here and the
      // last good render stays on the stage, as a broken compile's does.
      const render = prepareMount(code);
      // The old render goes first: there is only one stage per world.
      unmount();
      mounted = render(world);
      mountedCode = code;
      shown.clear();
      for (const [path, revision] of Object.entries(revisions ?? {})) shown.set(path, revision);
      setInspectEntries(world, mounted.inspect);
      // The rendered scene knows which element every entity came from, so
      // from here on an edit in the editor can find its way back.
      writer = createEditWriter(dir, world, (result) => {
        // The canvas showed these edits before they were written, so it now
        // shows the revision they produced — unless the file had moved on
        // underneath them, in which case it is still owed what moved it.
        for (const [path, revision] of Object.entries(result.revisions ?? {})) {
          if (result.bases?.[path] === shown.get(path)) shown.set(path, revision);
          // Written on top of a change the canvas has not seen. The watcher
          // cannot be relied on to report that change: what is on disk now is
          // this editor's own write, which it takes for an echo. So it is
          // fetched here, like any change made to the file.
          else if (shown.has(path)) void hotReload(path);
        }
      });
      unbindSaveState?.();
      unbindSaveState = bindSaveState(writer, (state) => {
        if (state.status === 'saved') persistUndo();
      });
      const editor = getDocumentEditor(world);
      // One funnel, two destinations: what an edit says about the video goes
      // to the file, what it says about the view goes to the sidecar.
      unlisten = editor.onEdit((edit) => {
        const split = splitViewEdit(edit);
        if (split.view) view.touch();
        // A change being shown *from* the file is not owed *to* the file.
        if (split.edit && !showingFileChange) writer?.push(split.edit);
      });
      // An element the file has just named can be remembered by that name.
      unlistenRenames = editor.onRename(() => view.touch());

      // The view first, so the fallback below only has to act when nothing
      // was remembered.
      view.attach();

      // A project with frames but no active frame renders correctly on the
      // canvas, but leaves the timeline with no video to describe: a new
      // project, or one whose remembered scene is gone. Choose the first
      // top-level frame through the normal editor route, which remembers it.
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
      if (carried) {
        // The same document with someone else's change in it: undo stays the
        // person's own edits, followed to where their elements are now.
        undoRestored = true;
        if (history.restore(carried.steps)) history.follow(carried.renames);
        persistUndo();
      } else {
        void adoptCachedUndo(history);
      }
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
          // The remembered view is read before anything is put on the stage:
          // a mount that has to guess (which scene is active) would otherwise
          // be remembered over what the author actually left.
          Promise.all([loadProjectBundle(untrack(project.id)), loading, viewLoading])
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

      const [result] = await Promise.all([compiling, loading, viewLoading]);
      // A source from before the view left it has just had its view lifted
      // into the sidecar by the compile; a first read that found nothing
      // finds it now. A no-op once anything is remembered.
      await view.load();
      if (disposed || current !== generation) return;

      // A broken edit keeps the last good render on the canvas.
      if (!result.ok) {
        console.error('[projects] compile failed:', result.error);
        toast.error('Project failed to compile', { description: result.error });
        return;
      }

      try {
        applyBundle(result.code, result.revisions);
        // What an export renders a second time, and the next open's head
        // start (see `rememberProjectBundle`) — recorded only once it has
        // actually mounted, so the record never runs ahead of the canvas.
        rememberProjectBundle(untrack(project.id), result.code).catch((error) =>
          console.error('[projects] could not save the bundle', error));
        void catchUp(current);
      } catch (error) {
        console.error('[projects] render failed:', error);
        toast.error('Project failed to render', { description: (error as Error).message });
      }
    };

    /**
     * The file can move on while it compiles: the person kept working, and the
     * writer of the render that was replaced wrote what it still owed on its
     * way out. The app's own writes are not reported by the watcher, so nothing
     * else would notice that the canvas now shows an older file than the disk
     * holds — the person's last drag would be in the file and gone from the
     * screen. One look after a mount, and the difference is shown like any
     * other change made to the file.
     */
    const catchUp = async (current: number): Promise<void> => {
      for (const [path, revision] of [...shown]) {
        try {
          const { revisionId } = await readProjectSource(dir, path, { lines: [1, 1] });
          if (disposed || current !== generation) return;
          // Not recorded: what the file gained while compiling is the person's
          // own last edits, which their history already holds.
          if (revisionId !== revision && shown.get(path) === revision) void hotReload(path, false);
        } catch {
          // A source that cannot be read is the next compile's to report.
        }
      }
    };

    const load = (): void => {
      loadProject().catch((error) => {
        console.error('[projects] load failed:', error);
        toast.error('Project failed to load', { description: (error as Error).message });
      });
    };

    load();

    /**
     * A source changed on disk and it was not this editor that changed it: an
     * agent edited the file, or an IDE did. When the change can be shown
     * exactly as the few edits it comes to, it is — through the same editor
     * commands a drag goes through, as one step of the undo history, so the
     * person keeps their history and can take the change back with ⌘Z. When it
     * cannot (an element came or went, code changed, anything uncertain), the
     * file is mounted again, as it always was.
     */
    let hotGeneration = 0;
    const hotReload = async (path: string, record = true): Promise<void> => {
      const current = ++hotGeneration;
      if (!mounted || !writer) return load();
      try {
        // What the person has done and the file has not heard yet goes first:
        // it is written on top of whatever is on disk, and only then is the
        // difference between what the canvas shows and what the file says real.
        await writer.settled();
        if (disposed || current !== hotGeneration) return;
        const base = shown.get(path);
        if (!base || !mounted) return load();

        const { revisionId, patch } = await requestSourcePatch(dir, path, base);
        if (disposed || current !== hotGeneration) return;
        if (!patch.ok) {
          console.info(`[projects] ${path} changed on disk; mounting it again: ${patch.reason}`);
          carry = patch.renames ? { path, revisionId, renames: patch.renames } : undefined;
          return load();
        }

        // The person kept working while the file was read: what they changed
        // since is on its way to the file, and stays on the canvas.
        const owing = writer;
        const applied = applySourcePatch(world, patch.ops, (apply) => {
          showingFileChange = true;
          try {
            apply();
          } finally {
            showingFileChange = false;
          }
        }, { record, owed: (op) => owing?.owes(op.source, op.kind === 'text' ? undefined : op.name) ?? false });
        if (!applied) {
          console.info(`[projects] ${path} changed on disk; the change could not be shown in place, mounting it again`);
          return load();
        }

        // A write of the person's landed while the file was read and moved this
        // on from a revision the patch knows nothing of: setting it back would
        // say the canvas is behind its own edit. One more look settles it.
        if (shown.get(path) !== base) {
          void hotReload(path, record);
          return;
        }
        shown.set(path, revisionId);
        persistUndo();
        // The bundle on the stage was compiled from the older source. Compile
        // the new one quietly and call it the mounted one — the canvas already
        // shows what it would — so the next open starts from it and an
        // unrelated reload does not remount for nothing.
        void compileProject(dir).then((result) => {
          if (disposed || current !== hotGeneration || !result.ok || result.revisions?.[path] !== revisionId) return;
          mountedCode = result.code;
          rememberProjectBundle(untrack(project.id), result.code).catch(() => undefined);
        }).catch(() => undefined);
      } catch (error) {
        console.warn('[projects] could not show the change in place, mounting the file again', error);
        load();
      }
    };

    const unwatch = watchProject(dir, (path) => {
      if (isCacheFile(path)) return;
      if (isLibraryFile(path)) {
        library.load();
      } else if (isCompositionSource(path)) {
        void hotReload(path);
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
      stopVoiceHistory();
      // While the world still shows it: the last look is what is remembered.
      view.dispose();
      unmount();
      config.dispose();
      library.dispose();
    });
  });

  /** The dock's full height on screen: its title row plus the lanes, or the ruler alone in Peek. */
  const dockHeight = createMemo(() => (timelineMinimized() ? RULER_HEIGHT + 8 : visibleTimelineHeight() + TIMELINE_TITLE_HEIGHT));
  /** Where the side instruments end: just above the dock. */
  const dockBottom = createMemo(() => INSTRUMENT_INSET * 2 + dockHeight());

  /** What the instruments cover, for fitting the composition between them. */
  const insets = createMemo<Insets>(() => {
    if (!uiVisible()) return { left: 0, right: 0, top: 0, bottom: 0 };
    // The left instrument carries a 52px rail beside its drawer.
    const left = INSTRUMENT_INSET * 2 + leftWidth();
    const right = inspectorOpen() ? INSTRUMENT_INSET * 2 + inspectorWidth() : INSTRUMENT_INSET;
    // The top inset leaves room for the scene headers drawn above the frames.
    return { left, right, top: SIDE_TOP + 44, bottom: dockBottom() + 38 };
  });

  // Fit follows dock size and the active scene until the user deliberately
  // pans or zooms. A recompile does not turn a manual camera back into Fit.
  let adaptiveFitFrame: number | undefined;
  const fit = (mode: 'active' | 'all') => {
    setFitMode(mode);
    fitVisible(world, insets(), 24, mode === 'active');
  };
  onCleanup(bindWorkspaceCamera(world, {
    fit: () => fit(workspace() === 'storyboard' ? 'all' : 'active'),
    manual: () => setFitMode('manual'),
  }));
  createEffect(on(workspace, (mode) => setFitMode(mode === 'storyboard' ? 'all' : 'active')));
  const viewportSize = useDerived(() => {
    const view = getViewport(world);
    return view ? `${view.width}:${view.height}` : '';
  });
  createEffect(() => {
    const covered = insets();
    const mode = fitMode();
    activeScene();
    viewportSize();
    if (adaptiveFitFrame !== undefined) cancelAnimationFrame(adaptiveFitFrame);
    if (mode === 'manual') return;
    adaptiveFitFrame = requestAnimationFrame(() => {
      adaptiveFitFrame = requestAnimationFrame(() => fitVisible(world, covered, 24, mode === 'active'));
    });
  });
  onCleanup(() => { if (adaptiveFitFrame !== undefined) cancelAnimationFrame(adaptiveFitFrame); });

  // Telemetry corner: zoom and playhead, the HUD readout heritage made useful.
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
    const startHeight = visibleTimelineHeight();
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
      data-workspace={workspace()}
      data-resizing={resizing()}
      data-theme={editorTheme()}
      style={{ '--canvas-bottom-inset': uiVisible() ? `${dockBottom() + 4}px` : '16px', '--canvas-tools-top': `${SIDE_TOP}px`, '--canvas-tools-right': `${insets().right + 4}px` }}
    >
      {/* With the instruments hidden there is no command bar to drag the
          window by, so a bare strip along the top stands in for it. With them
          shown, the bar is the drag area — a strip here would sit over it
          and swallow its clicks. */}
      <Show when={isDesktop && !isFullscreen() && !uiVisible()}>
        <div class="fixed top-0 left-0 right-0 h-10 z-20" style="-webkit-app-region: drag;" />
      </Show>

      {/* The canvas is the whole window; everything else floats over it. */}
      <div class="absolute inset-0">
        <Canvas />
      </div>

      <Show when={uiVisible()}>
        <div class="posterract-instrument-layer">
          {/* The command bar: wordmark, project, scenes, save state, zoom, layout toggles. */}
          <div
            class="posterract-instrument posterract-bar"
            style={{ left: `${barLeft()}px`, right: `${INSTRUMENT_INSET}px`, top: `${BAR_TOP}px`, height: `${BAR_HEIGHT}px` }}
          >
            <CommandBar />
          </div>

          <div
            class="posterract-instrument"
            style={{ left: `${INSTRUMENT_INSET}px`, top: `${SIDE_TOP}px`, width: `${leftWidth()}px`, bottom: `${dockBottom()}px` }}
          >
            <SidebarLeft />
          </div>

          <Show when={inspectorOpen()}>
            <div
              class="posterract-instrument posterract-inspector"
              style={{ right: `${INSTRUMENT_INSET}px`, top: `${SIDE_TOP}px`, width: `${inspectorWidth()}px`, bottom: `${dockBottom()}px` }}
            >
              <Inspector />
            </div>
          </Show>

          <div class="posterract-preview-heading" style={{ left: `${insets().left + 4}px`, right: `${insets().right + 4}px`, top: `${SIDE_TOP}px` }}>
            <SceneSwitcher />
          </div>
          <div class="posterract-preview-controls" style={{ left: `${insets().left + 4}px`, right: `${insets().right + 4}px`, bottom: `${dockBottom() + 3}px` }}>
            <span class="posterract-preview-time">{playheadClock()}</span>
            <div class="flex items-center gap-1">
              <Button variant="ghost" size="small" onClick={() => fit('active')} aria-pressed={fitMode() === 'active'}>Fit video</Button>
              <Button variant="ghost" size="small" onClick={() => fit('all')} aria-pressed={fitMode() === 'all'}>All scenes</Button>
              <InspectorHeader />
            </div>
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
              title="Drag to resize the timeline · double-click to collapse"
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
              <div class="flex h-8 items-center px-3 text-xs font-medium text-muted-foreground">
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
