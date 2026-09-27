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
  handleMediaTranscribe, handleMediaFrame, handleMediaFilmstrip, handleMediaWaveform, handleMediaBeats } from "./media";
import { handleCapture } from "./capture";
import { handleCheck } from "./check";
import { handleLogs } from "./logs";
import { cliBridge, mainBridge } from '@/lib/ipc';
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { createRouterCaller } from '@/lib/cli-rpc';
import { openProjectFolder } from '@/projects';
import { projectRoute } from '@/hooks/use-project-route';
import { editProjectSource, readProjectSource, requestSourceTouched, writeProjectSource } from "@/projects/host";
import { asAgent, getEditWriter } from "@/projects/edits";
import { shownRevision } from "@/projects/shown";
import { assert } from "@/utils/common";
import { useEngineContext } from "@/engine";
import { handleExport, handleExportProgress } from "./export";
import { handleWindowScreenshot } from "./window";
import { useFullscreenState } from "@/hooks/use-fullscreen-state";
import {
  canvasActivate,
  canvasApply,
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
  takeEditWarnings,
} from "./canvas";

import type {
  CanvasActivateRequest,
  CanvasApplyRequest,
  CanvasStateResult,
  CanvasWriteResult,
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
  ProjectSourceEditRequest,
  ProjectSourceReadRequest,
  ProjectSourceWriteRequest,
} from "@posterract/cli/channels";

import type { JSX, Accessor } from 'solid-js';
import { readGeometry, type GeometryRequest } from './geometry';
import { handleInspect } from './inspect';
import { look, show, type ShowRequest } from './collab';

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

/**
 * Until the project is open *and on the canvas*. The session exists as soon as
 * the editor page does, a compile before anything is mounted — and a caller
 * that was told "open" and then names an element would be told there is no such
 * node. `entry`'s shown revision is set by the first mount of the compiled
 * source (see @/projects/shown), so that is what is waited for. A source that
 * does not compile never mounts: the wait ends without an error after
 * `mountMs`, and the next call says what is wrong with it.
 */
async function waitForEditorSession(dir: string, entry?: string, timeoutMs = 30_000, mountMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (editorSession()?.project.dir() !== dir) {
    if (Date.now() >= deadline) throw new Error(`Project opened but the editor did not mount it within ${timeoutMs / 1_000} seconds`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!entry) return;
  const mounted = Date.now() + mountMs;
  while (Date.now() < mounted && shownRevision(dir, entry) === null) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Waits for a change the editor just made to reach the source, and says what
 * became of it. The canvas shows a value the moment it is set; the file has it
 * only after the writer's debounce and the write. A caller that is looking at
 * the canvas can tell; an agent cannot, so every tool that changes the
 * document answers with the revision it produced and with anything the source
 * would not take — and fails outright when the write did, rather than
 * reporting a change that exists only on screen.
 */
async function written(): Promise<CanvasWriteResult> {
  const { world, project } = requireEditorSession();
  const outcome = (await getEditWriter(world)?.settled()) ?? { skipped: [] };
  if (outcome.error) {
    throw new Error(`${outcome.error} The canvas shows the change, but the source file does not have it.`);
  }
  // Read after the write, not before: an element the edit created is only a
  // `pending#…` placeholder until the write names it, and the id the caller
  // gets back has to be one it can use.
  const state = canvasState(requireEditorSession);

  let revisionId: string | null = null;
  try {
    revisionId = (await readProjectSource(project.dir(), "auto")).revisionId;
  } catch {
    // The change was written; only its name could not be read back.
  }

  const warnings = takeEditWarnings();
  return {
    ...state,
    revisionId,
    ...(warnings.length ? { warnings } : {}),
    ...(outcome.skipped.length
      ? {
        skipped: outcome.skipped,
        note: "These were not written to the source: the prop is computed by code there, or the element sits in a loop. Change the expression in the source instead.",
      }
      : {}),
  };
}

/** The elements an edit is about: the ones it changes, moves or removes — not the parent it puts something under. */
function targetsOf(request: unknown): string[] {
  if (!request || typeof request !== "object") return [];
  const { id, ids, edits } = request as { id?: unknown; ids?: unknown; edits?: unknown };
  return [
    ...(typeof id === "string" ? [id] : []),
    ...(Array.isArray(ids) ? ids.filter((entry): entry is string => typeof entry === "string") : []),
    ...(Array.isArray(edits) ? edits.flatMap(targetsOf) : []),
  ];
}

/**
 * The conflict check of an edit that names its elements. An agent decides on
 * what it last read; the person may have changed the file since. Refusing
 * because *the file* changed would fail a caption's edit over a clip nudged at
 * the other end of the timeline, so the question asked is narrower: did anyone
 * change *these elements* since `expectedRevisionId`? If not, the edit lands on
 * top of whatever else changed. If so, the agent is told what changed, and
 * nothing is done. Without `expectedRevisionId` there is no check, as before.
 */
async function requireUntouched(request: unknown): Promise<void> {
  const expected = (request as { expectedRevisionId?: unknown } | null)?.expectedRevisionId;
  if (typeof expected !== "string" || !expected) return;
  const ids = [...new Set(targetsOf(request))];
  if (!ids.length) return;

  const { world, project } = requireEditorSession();
  // What the person has done and the file has not heard yet counts too.
  await getEditWriter(world)?.settled();
  const result = await requestSourceTouched(project.dir(), "auto", expected, ids);
  if (!result.known) {
    throw new Error(
      `The source has changed since revision ${expected.slice(0, 12)}, and that revision is not in the history, so what changed cannot be checked. ` +
        `Nothing was changed. Read the element again (posterract_read_source with \`id\`) and retry with revision ${result.revisionId}.`,
    );
  }
  if (result.touched.length) {
    const lines = result.touched.flatMap(({ id, changes }) => changes.map((change) => `  #${id}  ${change}`));
    throw new Error(
      `Someone changed what you are editing since you read it:\n${lines.join("\n")}\n` +
        `Nothing was changed. Decide again knowing that, then retry with revision ${result.revisionId}.`,
    );
  }
}

/** A procedure that changes the document: run it, then answer once the source has the change. */
const edit = <I,>(fn: (request: I) => CanvasStateResult | Promise<CanvasStateResult>) =>
  m(async (request: I) => {
    await requireUntouched(request);
    // Journalled as the agent's: the file will say who moved the caption.
    await asAgent(() => fn(request));
    return written();
  });
const edit0 = (fn: () => CanvasStateResult | Promise<CanvasStateResult>) =>
  m0(async () => {
    await asAgent(() => fn());
    return written();
  });

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
      await waitForEditorSession(project.dir, project.entry);
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
      // Two questions in one answer: does it compile, and does the editor
      // understand what it says (a prop the element does not take is ignored
      // at runtime, silently). Either failing is a failed validation.
      const lint = (result as { lint?: Array<{ severity: "error" | "warning" }> }).lint ?? [];
      const compiled = result.ok ? [] : [{ severity: "error" as const, message: result.error }];
      return {
        ok: result.ok && !lint.some((entry) => entry.severity === "error"),
        diagnostics: [...compiled, ...lint],
      };
    }),
    source: t.router({
      // Bounded unless the caller insists: a source too large to be useful
      // whole answers with its outline and how to ask for a part.
      read: q(async ({ path, id, lines, outline, full }: ProjectSourceReadRequest) => {
        const { project } = requireEditorSession();
        return readProjectSource(project.dir(), path, {
          ...(id === undefined ? {} : { id }),
          ...(lines === undefined ? {} : { lines }),
          ...(outline ? { outline: true } : {}),
          bounded: full !== true,
        });
      }),
      write: m(async ({ path, content, expectedRevisionId }: ProjectSourceWriteRequest) => {
        const { project } = requireEditorSession();
        // The caller just sent the content; echoing a whole source back to it
        // would double what the write costs an agent for nothing.
        const { revisionId, diagnostics } = await writeProjectSource(project.dir(), path, content, expectedRevisionId, "agent");
        return { revisionId, diagnostics };
      }),
      // One string replaced by another: a file tool's edit, for an agent with none.
      edit: m(async ({ path, oldString, newString, replaceAll }: ProjectSourceEditRequest) => {
        const { world, project } = requireEditorSession();
        // On top of what the person has done, not underneath it.
        await getEditWriter(world)?.settled();
        return editProjectSource(project.dir(), path ?? "auto", { oldString, newString, ...(replaceAll ? { replaceAll: true } : {}) }, "agent");
      }),
    }),
    geometry: q((request: GeometryRequest) => readGeometry(requireEditorSession, request)),
    // What is in a video and what is wrong with it, across its whole duration.
    inspect: q(handleInspect(requireEditorSession)),
    // What the author is looking at, and "look at this" the other way round.
    look: q0(() => look(requireEditorSession)),
    show: m((request: ShowRequest) => show(requireEditorSession, request)),
    canvas: t.router({
      state: q0(() => canvasState(requireEditorSession)),
      select: m((request: CanvasSelectRequest) => canvasSelect(requireEditorSession, request)),
      activate: m((request: CanvasActivateRequest) => canvasActivate(requireEditorSession, request)),
      seek: m((request: CanvasSeekRequest) => canvasSeek(requireEditorSession, request)),
      // Everything below changes the document, so each answers only once the
      // source has the change (see `written`). Selecting, activating and
      // seeking above are the view, which the source no longer carries.
      setProperties: edit((request: CanvasSetPropertiesRequest) => canvasSetProperties(requireEditorSession, request)),
      setText: edit((request: CanvasSetTextRequest) => canvasSetText(requireEditorSession, request)),
      create: edit((request: CanvasCreateRequest) => canvasCreate(requireEditorSession, request)),
      setVariable: edit((request: CanvasVariableRequest) => canvasSetVariable(requireEditorSession, request)),
      bake: m((request: CanvasBakeRequest) => canvasBake(requireEditorSession, request)),
      group: edit((request: CanvasGroupRequest) => canvasGroup(requireEditorSession, request)),
      ungroup: edit((request: CanvasUngroupRequest) => canvasUngroup(requireEditorSession, request)),
      duplicate: edit((request: CanvasIdsRequest) => canvasDuplicate(requireEditorSession, request)),
      remove: edit((request: CanvasIdsRequest) => canvasRemove(requireEditorSession, request)),
      move: edit((request: CanvasMoveRequest) => canvasMove(requireEditorSession, request)),
      // Several of the above as one undo step and one write, all or nothing.
      // (`apply` is a name the router keeps for itself.)
      batch: edit((request: CanvasApplyRequest) => canvasApply(requireEditorSession, request)),
      undo: edit0(() => canvasUndo(requireEditorSession)),
      redo: edit0(() => canvasRedo(requireEditorSession)),
    }),
    capture: q(handleCapture(requireEditorSession)),
    export: q(handleExport(requireEditorSession)),
    exportProgress: q0(handleExportProgress()),
    check: q(handleCheck(requireEditorSession)),
    logs: q(handleLogs()),
    screenshot: q0(handleWindowScreenshot()),
    media: t.router({
      probe: q(handleMediaProbe(resolveAsset)),
      frame: q(handleMediaFrame(resolveAsset)),
      filmstrip: q(handleMediaFilmstrip(resolveAsset)),
      waveform: q(handleMediaWaveform(resolveAsset)),
      beats: q(handleMediaBeats(resolveAsset)),
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
