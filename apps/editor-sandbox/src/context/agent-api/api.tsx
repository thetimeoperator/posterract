/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createContext, useContext, onCleanup } from "solid-js";
import { useWorld } from '@posterract/koota-solid';
import { Project } from '@posterract/video-runtime';
import { useProject } from '@/context/project';
import { t, q, q0, m, m0 } from "@/lib/cli-rpc";
import { editorSession, requireEditorSession, setEditorSession } from "./session";
import { handleContextGet } from "./context";
import { handleGenerateImage, handleGenerateVideo, handleGenerateVoice } from "./generate";
import { createAssetResolver, handleMediaProbe, handleMediaExtract,
  handleMediaTranscribe, handleMediaFrame, handleMediaFilmstrip, handleMediaWaveform } from "./media";
import { handleCapture } from "./capture";
import { handleCheck } from "./check";
import { handleLogs } from "./logs";
import { cliBridge, mainBridge } from '@/lib/ipc';
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { createRouterCaller } from '@/lib/cli-rpc';
import { openProjectFolder } from '@/projects';
import { projectRoute } from '@/hooks/use-project-route';
import { readProjectSource, writeProjectSource } from "@/projects/host";
import { assert } from "@/utils/common";
import { useEngineContext } from "@/engine";
import { handleExport } from "./export";
import { handleWindowScreenshot } from "./window";
import { useFullscreenState } from "@/hooks/use-fullscreen-state";
import {
  canvasActivate,
  canvasCreate,
  canvasDuplicate,
  canvasGroup,
  canvasMove,
  canvasRedo,
  canvasRemove,
  canvasSeek,
  canvasSelect,
  canvasSetProperties,
  canvasSetText,
  canvasSetVariable,
  canvasBake,
  canvasState,
  canvasUngroup,
  canvasUndo,
} from "./canvas";

import type {
  CanvasActivateRequest,
  CanvasCreateRequest,
  CanvasGroupRequest,
  CanvasIdsRequest,
  CanvasMoveRequest,
  CanvasSeekRequest,
  CanvasSelectRequest,
  CanvasSetPropertiesRequest,
  CanvasSetTextRequest,
  CanvasUngroupRequest,
  CanvasVariableRequest,
  CanvasBakeRequest,
  ProjectSourceReadRequest,
  ProjectSourceWriteRequest,
} from "@posterract/cli/channels";

import type { JSX, Accessor } from 'solid-js';
import { readGeometry, type GeometryRequest } from './geometry';

type EditorApiProviderProps = {
  children: JSX.Element;
};

type EditorApiContextValue = {
  isFullscreen: Accessor<boolean>;
  isDesktop: boolean;
  /** macOS draws its window controls over the page; no other platform does. */
  isMac: boolean;
};

const EditorApiContext = createContext<EditorApiContextValue>();

/**
 * The one CLI router, registered for as long as the app runs. Every endpoint
 * is reachable whether or not a project is open; the ones that need one read
 * the session slot (see ./session) per request and fail with a clear error —
 * or, for `context`, report that nothing is open. Renders nothing; must sit
 * inside the router tree for `useNavigate` and inside the auth provider.
 */
export function EditorApi() {
  const router = createAppRouter({
    navigate: (path) => {
      window.location.hash = path;
    },
  });
  onCleanup(cliBridge.register(createRouterCaller(router)));
  return null;
}

/**
 * Publishes the editor session for the CLI router while the project is open,
 * and provides the editor UI's own view of the app shell (fullscreen state,
 * desktop-ness). Mounted per project page.
 */
export function EditorApiProvider(props: EditorApiProviderProps) {
  const project = useProject();
  const isFullscreen = useFullscreenState();
  const world = useWorld();
  const engine = useEngineContext();

  createEffect(() => {
    if (!window.desktop || project.id() !== world.get(Project)?.id) return;

    setEditorSession({ world, project, engine });
    onCleanup(() => setEditorSession(null));
  });

  createEffect(() => {
    const dir = project.dir();
    if (!window.desktop || !dir) return;
    void mainBridge.call(MAIN_CHANNELS.AGENT_SET_ACTIVE_PROJECT, { dir }).catch((error) => {
      console.warn("[agent-connection] could not publish the active project", error);
    });
  });

  return (
    <EditorApiContext.Provider
      value={{
        isFullscreen,
        isDesktop: !!window.desktop,
        isMac: window.desktop?.platform === "darwin",
      }}
    >
      {props.children}
    </EditorApiContext.Provider>
  );
}


type AppRouterDeps = {
  navigate: (path: string) => void;
};

/**
 * Desktop main's read-only sibling of PROJECTS_COMPILE: the same compile,
 * stable-ID stamping included, but entirely in memory — it never writes to
 * disk. `posterract_validate` is annotated `readOnlyHint`, so the mutating
 * PROJECTS_COMPILE (which persists freshly minted IDs) must not back it.
 * The channel is registered in apps/desktop/src/main.ts; the shared bridge
 * channel map predates it, hence the assertion onto the compile channel's
 * slot, whose request/response shapes it matches exactly.
 */
const PROJECTS_VALIDATE = "projects:validate" as unknown as typeof MAIN_CHANNELS.PROJECTS_COMPILE;

async function waitForEditorSession(dir: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (editorSession()?.project.dir() === dir) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Project opened but the editor did not mount it within ${timeoutMs / 1_000} seconds`);
}

function createAppRouter({ navigate }: AppRouterDeps) {
  const resolveAsset = createAssetResolver(editorSession);

  return t.router({
    ping: t.procedure.query(() => {}),
    health: t.procedure.query(() => ({
      renderer: true,
      offscreenCanvas: typeof OffscreenCanvas !== "undefined",
      videoDecoder: typeof VideoDecoder !== "undefined",
      videoEncoder: typeof VideoEncoder !== "undefined",
      webGpu: Boolean(navigator.gpu),
      fonts: document.fonts.status,
      desktopBridge: Boolean(window.desktop),
    })),
    open: m(async ({ dir }: { dir: string }) => {
      const project = await openProjectFolder(dir);
      navigate(projectRoute(project.id || project.name));
      await waitForEditorSession(project.dir);
      return { id: project.id, name: project.displayName, dir: project.dir };
    }),
    whoami: t.procedure.query(() => ({
      authenticated: false,
      scope: "local-editor",
      message: "Publishing identity remains isolated in the authenticated Posterract desktop cloud bridge.",
    })),
    context: q(handleContextGet(editorSession)),
    validate: q0(async () => {
      const { project } = requireEditorSession();
      const result = await mainBridge.call(PROJECTS_VALIDATE, { dir: project.dir() });
      return result.ok
        ? { ok: true, diagnostics: [] }
        : { ok: false, diagnostics: [{ message: result.error }] };
    }),
    source: t.router({
      read: q(async ({ path }: ProjectSourceReadRequest) => {
        const { project } = requireEditorSession();
        return readProjectSource(project.dir(), path);
      }),
      write: m(async ({ path, content, expectedRevisionId }: ProjectSourceWriteRequest) => {
        const { project } = requireEditorSession();
        return writeProjectSource(project.dir(), path, content, expectedRevisionId);
      }),
    }),
    geometry: q((request: GeometryRequest) => readGeometry(requireEditorSession, request)),
    canvas: t.router({
      state: q0(() => canvasState(requireEditorSession)),
      select: m((request: CanvasSelectRequest) => canvasSelect(requireEditorSession, request)),
      activate: m((request: CanvasActivateRequest) => canvasActivate(requireEditorSession, request)),
      seek: m((request: CanvasSeekRequest) => canvasSeek(requireEditorSession, request)),
      setProperties: m((request: CanvasSetPropertiesRequest) => canvasSetProperties(requireEditorSession, request)),
      setText: m((request: CanvasSetTextRequest) => canvasSetText(requireEditorSession, request)),
      create: m((request: CanvasCreateRequest) => canvasCreate(requireEditorSession, request)),
      setVariable: m((request: CanvasVariableRequest) => canvasSetVariable(requireEditorSession, request)),
      bake: m((request: CanvasBakeRequest) => canvasBake(requireEditorSession, request)),
      group: m((request: CanvasGroupRequest) => canvasGroup(requireEditorSession, request)),
      ungroup: m((request: CanvasUngroupRequest) => canvasUngroup(requireEditorSession, request)),
      duplicate: m((request: CanvasIdsRequest) => canvasDuplicate(requireEditorSession, request)),
      remove: m((request: CanvasIdsRequest) => canvasRemove(requireEditorSession, request)),
      move: m((request: CanvasMoveRequest) => canvasMove(requireEditorSession, request)),
      undo: m0(() => canvasUndo(requireEditorSession)),
      redo: m0(() => canvasRedo(requireEditorSession)),
    }),
    capture: q(handleCapture(requireEditorSession)),
    export: q(handleExport(requireEditorSession)),
    check: q(handleCheck(requireEditorSession)),
    logs: q(handleLogs()),
    screenshot: q0(handleWindowScreenshot()),
    media: t.router({
      probe: q(handleMediaProbe(resolveAsset)),
      frame: q(handleMediaFrame(resolveAsset)),
      filmstrip: q(handleMediaFilmstrip(resolveAsset)),
      waveform: q(handleMediaWaveform(resolveAsset)),
      extract: q(handleMediaExtract(resolveAsset)),
      transcribe: q(handleMediaTranscribe(resolveAsset, () => editorSession()?.project.dir() ?? "")),
    }),
    ai: t.router({
      image: m(handleGenerateImage(() => editorSession()?.project.dir() ?? "")),
      video: m(handleGenerateVideo(() => editorSession()?.project.dir() ?? "")),
      voice: m(handleGenerateVoice(() => editorSession()?.project.dir() ?? "")),
    }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

export function useEditorApi() {
  const ctx = useContext(EditorApiContext);
  assert(ctx, "useEditorApi must be used within EditorApiProvider");
  return ctx;
}
