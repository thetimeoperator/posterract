/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { Canvas } from "@/components/canvas";
import { Timeline, Layers, VideoTimelineTitle } from "@/components/timeline";
import { Soundboard, Inspector } from "@/components/sidebar-right";
import { FloatingProjectHeader, SidebarLeft } from "@/components/sidebar-left";
import { useLayout, MIN_TIMELINE_HEIGHT } from "@/context/layout";
import { useEditorApi } from "@/context/agent-api";
import { RULER_HEIGHT } from "@/engine/timeline";
import { toast } from 'somoto';
import { useWorld } from '@posterract/koota-solid';
import { mount } from '@posterract/video-reconciler';
import { getDocumentEditor } from '@/engine/editor';
import { getEditHistory } from '@/engine/history';
import { setInspectEntries } from '@/engine/inspect';
import { attachLibrary, isLibraryFile } from '@/engine/library';
import { attachProjectConfig, isProjectConfigFile } from '@/engine/project-config';
import { loadProjectBundle, rememberProjectBundle } from '@/lib/db';
import { isCacheFile } from '@posterract/video-assets';
import { createEditWriter } from '@/projects/edits';
import { compileProject, watchProject } from '@/projects/host';
import { captureProjectCover } from '@/projects/cover';
import { useProject } from "@/context/project";
import { useEngineContext } from "@/engine";
import {
  focusContent,
  getActiveEntity,
  getCameraMatrix,
  getContentBounds,
  getParentNode,
  getViewport,
  RenderSurface,
  Root,
  Scene,
} from '@posterract/video-runtime';

import type { Mount } from '@posterract/video-reconciler';
import type { EditWriter } from '@/projects/edits';

const MIN_CANVAS_HEIGHT = 200;
const TIMELINE_TITLE_HEIGHT = 32;

export function EditorPage() {
  const { uiVisible, timelineMinimized, timelineHeight, setTimelineHeight } = useLayout();
  const { isDesktop, isFullscreen } = useEditorApi();
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
          focusContent(world, 32);
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
      mounted?.dispose();
      mounted = undefined;
      mountedCode = undefined;
      setInspectEntries(world, []);
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
      // replaced cannot be replayed against this one.
      getEditHistory(world).reset();
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
      fitSequence += 1;
      if (fitFrame !== undefined) cancelAnimationFrame(fitFrame);
      captureProjectCover(dir, engine.snapshot());
      unwatch();
      unmount();
      config.dispose();
      library.dispose();
    });
  });

  const timelineStyles = createMemo(() => {
    if (!uiVisible()) return;

    const height = timelineMinimized() ? RULER_HEIGHT : timelineHeight();

    return {
      'grid-template-rows': `1fr 1px ${TIMELINE_TITLE_HEIGHT}px ${height}px`,
    };
  });

  const handleResizeStart = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startHeight = timelineHeight();
    setResizing(true);

    const handleMove = (ev: PointerEvent) => {
      const deltaY = startY - ev.clientY;
      const maxHeight = Math.max(
        MIN_TIMELINE_HEIGHT,
        window.innerHeight - MIN_CANVAS_HEIGHT - TIMELINE_TITLE_HEIGHT - 1,
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
      class="posterract-editor-shell h-screen w-full overflow-hidden grid"
      classList={{
        'grid-cols-[264px_1px_1fr_1px_264px]': uiVisible(),
        'grid-cols-[1fr]': !uiVisible(),
        'grid-rows-[1fr]': !uiVisible(),
      }}
      style={timelineStyles()}
    >
      <Show when={isDesktop && !isFullscreen()}>
        <div class="fixed top-0 left-0 right-0 h-10 z-20" style="-webkit-app-region: drag;" />
      </Show>
      <Show when={uiVisible()}>
        <SidebarLeft />
        <div class="bg-border-strong" />
      </Show>
      <Canvas />
      <Show when={uiVisible()}>
        <div class="bg-border-strong" />
        <Inspector />
      </Show>
      <Show when={uiVisible()}>
        <div class="col-span-full bg-border-strong relative">
          <Show when={!timelineMinimized()}>
            <div
              class="absolute left-0 right-0 -top-px h-0.75 z-10 cursor-ns-resize group"
              onPointerDown={handleResizeStart}
            >
              <div
                class="absolute left-0 right-0 top-px h-px transition-colors group-hover:bg-primary"
                classList={{ 'bg-primary': resizing() }}
              />
            </div>
          </Show>
        </div>
      </Show>
      <Show when={uiVisible()}>
        <VideoTimelineTitle />
      </Show>
      <Show when={uiVisible()}>
        <Layers />
        <div class="bg-border-strong" />
      </Show>
      <Show when={uiVisible()}>
        <Timeline />
      </Show>
      <Show when={uiVisible()}>
        <div class="bg-border-strong" />
        <Show when={!timelineMinimized()}>
          <Soundboard />
        </Show>
      </Show>
      <Show when={!uiVisible()}>
        <FloatingProjectHeader />
      </Show>
    </div>
  );
}
