/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Wire-level channels — the only raw ipcRenderer/ipcMain channels in play for
// the main↔renderer request/event protocol. Everything else multiplexes
// through these via an envelope carrying the logical MAIN_CHANNELS name and
// (for requests) a UUID for correlation.
//
// CLI traffic uses a separate wire pair (CLI_WIRE in @posterract/cli/protocol);
// main forwards it opaquely without inspecting channel names.
import type { LogEntry, ScreenshotResult } from "@posterract/cli/channels";
import type {
  LocalAgentActivity,
  LocalAgentConnectionState,
  LocalAgentKind,
} from "@posterract/contract/local-agent";
import type { SourceEdit, WriteResult } from "./edit";

export const MAIN_WIRE = {
  REQUEST: "main:request",
  RESPONSE: "main:response",
  EVENT: "main:event",
} as const;

export type MainWireChannel = (typeof MAIN_WIRE)[keyof typeof MAIN_WIRE];

// Logical channels. Two categories:
//   • Renderer→Main requests (request + response)
//   • Main→Renderer events   (push, no response)
// Renderer-state queries used to live here; they now answer CLI requests
// directly via the CLI bridge.
export const MAIN_CHANNELS = {
  // Renderer→Main requests
  AI_KEYS_STATUS: "ai:keys-status",
  AI_KEYS_SAVE: "ai:keys-save",
  AI_KEYS_REVEAL: "ai:keys-reveal",
  AI_GENERATE: "ai:generate",
  AI_TRANSCRIBE: "ai:transcribe",
  APP_OPEN_EXTERNAL: "app:open-external",
  APP_OPEN_PROJECT_EDITOR: "app:open-project-editor",
  APP_SHOW_IN_FOLDER: "app:show-in-folder",
  AGENT_GET_STATUS: "agent:get-status",
  AGENT_SET_ACTIVE_PROJECT: "agent:set-active-project",
  AGENT_SELECT: "agent:select",
  AGENT_INSTALL_CLI: "agent:install-cli",
  AGENT_INSTALL_MCP: "agent:install-mcp",
  AGENT_INSTALL_SKILL: "agent:install-skill",
  AGENT_LAUNCH: "agent:launch",
  AGENT_TEST_CONNECTION: "agent:test-connection",
  AGENT_RECORD_ACTIVITY: "agent:record-activity",
  AGENT_RESET: "agent:reset",
  AUTH_GET_PENDING_CALLBACK: "auth:get-pending-callback",
  CHECKOUT_GET_PENDING_CALLBACK: "checkout:get-pending-callback",
  WINDOW_IS_FULLSCREEN: "window:is-fullscreen",
  WINDOW_CAPTURE: "window:capture",
  FILE_TRANSFER: "file:transfer",
  FILE_PICK_EXPORT: "file:pick-export",
  FILE_AUTHORIZE_CLI_EXPORT: "file:authorize-cli-export",
  FILE_AUTHORIZE_CLI_MEDIA: "file:authorize-cli-media",
  FILE_WRITE_OPEN: "file:write-open",
  FILE_WRITE_CHUNK: "file:write-chunk",
  FILE_WRITE_CLOSE: "file:write-close",
  FILE_WRITE_ABORT: "file:write-abort",
  HEADLESS_GET_MODE: "headless:get-mode",
  LOGS_GET: "logs:get",
  PROJECTS_PICK_ROOT: "projects:pick-root",
  PROJECTS_DEFAULT_ROOT: "projects:default-root",
  PROJECTS_LIST: "projects:list",
  PROJECTS_GET: "projects:get",
  PROJECTS_INIT: "projects:init",
  PROJECTS_RESOLVE: "projects:resolve",
  PROJECTS_CREATE: "projects:create",
  PROJECTS_RENAME: "projects:rename",
  PROJECTS_DUPLICATE: "projects:duplicate",
  PROJECTS_DELETE: "projects:delete",
  PROJECTS_COMPILE: "projects:compile",
  PROJECTS_WRITE: "projects:write",
  PROJECTS_WATCH: "projects:watch",
  PROJECTS_UNWATCH: "projects:unwatch",
  PROJECTS_MANIFEST_READ: "projects:manifest-read",
  PROJECTS_MANIFEST_WRITE: "projects:manifest-write",
  PROJECTS_CONFIG_READ: "projects:config-read",
  PROJECTS_CONFIG_WRITE: "projects:config-write",
  PROJECTS_SOURCE_READ: "projects:source-read",
  PROJECTS_SOURCE_WRITE: "projects:source-write",
  PROJECTS_REVISIONS_LIST: "projects:revisions-list",
  PROJECTS_REVISIONS_READ: "projects:revisions-read",
  PROJECTS_REVISIONS_RESTORE: "projects:revisions-restore",
  PROJECTS_TRASH_PUT: "projects:trash-put",
  PROJECTS_TRASH_LIST: "projects:trash-list",
  PROJECTS_TRASH_READ: "projects:trash-read",
  PROJECTS_TRASH_REMOVE: "projects:trash-remove",
  PROJECTS_HISTORY_READ: "projects:history-read",
  PROJECTS_HISTORY_WRITE: "projects:history-write",
  PROJECTS_SOURCE_LOCATE: "projects:source-locate",
  EXPORTS_RECORD: "exports:record",
  EXPORTS_LIST: "exports:list",
  EXPORTS_REVEAL: "exports:reveal",
  EXPORTS_DELETE: "exports:delete",
  EXPORTS_RENAME: "exports:rename",
  PROJECTS_FS_LIST: "projects:fs-list",
  PROJECTS_FS_STAT: "projects:fs-stat",
  PROJECTS_FS_FILE: "projects:fs-file",
  PROJECTS_FS_WRITE: "projects:fs-write",
  PROJECTS_FS_COPY: "projects:fs-copy",
  PROJECTS_FS_REMOVE: "projects:fs-remove",
  PROJECTS_FS_REAL_PATH: "projects:fs-real-path",
  PROJECTS_IMPORT_LOTTIE_URL: "projects:import-lottie-url",

  // Local agent connection events
  AGENT_CONNECTION_CHANGED: "agent:connection-changed",

  // Main→Renderer events
  AUTH_CALLBACK: "auth:callback",
  CHECKOUT_CALLBACK: "checkout:callback",
  WINDOW_FULLSCREEN_CHANGE: "window:fullscreen-change",
  HEADLESS_MODE: "headless:mode",
  PROJECTS_CHANGED: "projects:changed",
  PROJECTS_SOURCE_CHANGED: "projects:source-changed",
} as const;

/**
 * A project folder under the projects root: a real npm package with a JSX
 * entry. Its package.json is the project record: `projectId` is what the
 * project is, `displayName` the human name, `main` the entry file.
 */
export type ProjectInfo = {
  /**
   * package.json `projectId`: the project's identity, and the segment its URL
   * carries. Empty for a folder that predates ids and has not been opened
   * since — `PROJECTS_RESOLVE` is what gives one out.
   */
  id: string;
  /** Folder name. Renaming the project moves it, so it is not the identity. */
  name: string;
  /** Human name from package.json `displayName` (falls back to the folder name). */
  displayName: string;
  /** Absolute path of the project folder. */
  dir: string;
  /** Entry file relative to `dir`: package.json `main`, else index.tsx/ts/jsx/js. */
  entry: string;
  /** mtime of the entry file, ISO string. */
  modifiedAt: string;
  /** birthtime of the folder, ISO string. */
  createdAt: string;
};

export type CompileResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

export type { SourceEdit, WriteResult };

export type MainChannel = (typeof MAIN_CHANNELS)[keyof typeof MAIN_CHANNELS];

// Events fed by a `diffusion://` deep link. Main routes each link to exactly
// one of these by its host, so auth and checkout never consume each other's.
export type DeepLinkChannel =
  | typeof MAIN_CHANNELS.AUTH_CALLBACK
  | typeof MAIN_CHANNELS.CHECKOUT_CALLBACK;

/** One bring-your-own-keys generation ask, mirrored by desktop's ai-local. */
export type AiLocalGeneration = {
  kind: "image" | "video" | "voice";
  prompt?: string;
  text?: string;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  durationSec?: number;
  voiceId?: string;
  referenceImage?: string;
};

/** Mirrors `apps/desktop/src/revisions.ts`. */
export type RevisionEntry = {
  id: string;
  path: string;
  savedAt: number;
  bytes: number;
  deleted: boolean;
};

/** Mirrors `apps/desktop/src/trash.ts`. */
export type TrashEntry = {
  id: string;
  sceneId: string;
  name: string;
  deletedAt: number;
  bytes: number;
};

/** Mirrors `apps/desktop/src/exports-library.ts`. */
export type ExportEntry = {
  id: string;
  projectId: string | null;
  projectDir: string | null;
  sceneId: string | null;
  sourceRevision: string | null;
  path: string;
  fileName: string;
  contentType: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  createdAt: number;
};

export type ListedExport = ExportEntry & { bytes: number | null; missing: boolean };

export type MainRequestMap = {
  [MAIN_CHANNELS.AI_KEYS_STATUS]: {
    request: { dir: string };
    response: { minimax: boolean; fish: boolean; gemini: boolean; transcribe: boolean; path: string };
  };
  [MAIN_CHANNELS.AI_KEYS_SAVE]: {
    request: {
      dir: string;
      keys: {
        minimax?: string;
        fish?: string;
        gemini?: string;
        transcribe?: string;
        transcribeUrl?: string;
        transcribeModel?: string;
      };
    };
    response: { minimax: boolean; fish: boolean; gemini: boolean; transcribe: boolean };
  };
  [MAIN_CHANNELS.AI_KEYS_REVEAL]: { request: { dir: string }; response: { path: string } };
  [MAIN_CHANNELS.AI_GENERATE]: {
    request: { dir: string; generation: AiLocalGeneration };
    response: { path: string; mimeType: string; previewDataUrl?: string };
  };
  [MAIN_CHANNELS.AI_TRANSCRIBE]: {
    request: { dir: string; path: string };
    response: {
      text: string;
      words: Array<{ text: string; start: number; end: number }>;
      segments: Array<{ text: string; start: number; end: number }>;
      cached: boolean;
    };
  };
  [MAIN_CHANNELS.APP_OPEN_EXTERNAL]: { request: { url: string }; response: void };
  [MAIN_CHANNELS.APP_OPEN_PROJECT_EDITOR]: {
    request: { dir: string; editor: "codex" | "claude" | "cursor" | "vscode" | "terminal" };
    response: void;
  };
  [MAIN_CHANNELS.AUTH_GET_PENDING_CALLBACK]: { request: void; response: string | null };
  [MAIN_CHANNELS.CHECKOUT_GET_PENDING_CALLBACK]: { request: void; response: string | null };
  [MAIN_CHANNELS.WINDOW_IS_FULLSCREEN]: { request: void; response: boolean };
  [MAIN_CHANNELS.WINDOW_CAPTURE]: { request: void; response: ScreenshotResult };
  [MAIN_CHANNELS.FILE_TRANSFER]: {
    request: { selector: string; absolutePath: string };
    response: void;
  };
  [MAIN_CHANNELS.FILE_PICK_EXPORT]: {
    request: { suggestedName: string; extension: string; description: string };
    response: { path: string } | null;
  };
  [MAIN_CHANNELS.FILE_AUTHORIZE_CLI_EXPORT]: {
    request: { projectDir: string; path: string };
    response: { path: string };
  };
  [MAIN_CHANNELS.FILE_AUTHORIZE_CLI_MEDIA]: {
    request: { path: string; format: "mp4" | "ogg" };
    response: { path: string };
  };
  [MAIN_CHANNELS.FILE_WRITE_OPEN]: {
    request: { path: string; exclusive?: boolean };
    response: { id: string };
  };
  [MAIN_CHANNELS.FILE_WRITE_CHUNK]: {
    request: { id: string; data: Uint8Array; position: number };
    response: void;
  };
  [MAIN_CHANNELS.FILE_WRITE_CLOSE]: {
    request: { id: string };
    response: void;
  };
  [MAIN_CHANNELS.FILE_WRITE_ABORT]: {
    request: { id: string };
    response: void;
  };
  // Reveals a file or folder in the OS file manager (Finder on macOS).
  [MAIN_CHANNELS.APP_SHOW_IN_FOLDER]: { request: { path: string }; response: void };
  [MAIN_CHANNELS.AGENT_GET_STATUS]: { request: void; response: LocalAgentConnectionState };
  [MAIN_CHANNELS.AGENT_SET_ACTIVE_PROJECT]: {
    request: { dir: string };
    response: LocalAgentConnectionState;
  };
  [MAIN_CHANNELS.AGENT_SELECT]: {
    request: { agent: LocalAgentKind };
    response: LocalAgentConnectionState;
  };
  [MAIN_CHANNELS.AGENT_INSTALL_CLI]: { request: void; response: LocalAgentConnectionState };
  [MAIN_CHANNELS.AGENT_INSTALL_MCP]: {
    request: { agent?: LocalAgentKind };
    response: LocalAgentConnectionState;
  };
  [MAIN_CHANNELS.AGENT_INSTALL_SKILL]: {
    request: { mode?: "install" | "download" };
    response: LocalAgentConnectionState;
  };
  [MAIN_CHANNELS.AGENT_LAUNCH]: {
    request: { agent?: LocalAgentKind };
    response: LocalAgentConnectionState;
  };
  [MAIN_CHANNELS.AGENT_TEST_CONNECTION]: { request: void; response: LocalAgentConnectionState };
  [MAIN_CHANNELS.AGENT_RECORD_ACTIVITY]: { request: LocalAgentActivity; response: void };
  [MAIN_CHANNELS.AGENT_RESET]: { request: void; response: LocalAgentConnectionState };
  [MAIN_CHANNELS.HEADLESS_GET_MODE]: { request: void; response: boolean };
  [MAIN_CHANNELS.LOGS_GET]: { request: void; response: LogEntry[] };
  [MAIN_CHANNELS.PROJECTS_PICK_ROOT]: { request: void; response: string | null };
  [MAIN_CHANNELS.PROJECTS_DEFAULT_ROOT]: { request: void; response: string | null };
  [MAIN_CHANNELS.PROJECTS_LIST]: { request: { root: string }; response: ProjectInfo[] };
  [MAIN_CHANNELS.PROJECTS_GET]: { request: { dir: string }; response: ProjectInfo | null };
  [MAIN_CHANNELS.PROJECTS_INIT]: { request: { dir: string }; response: ProjectInfo };
  [MAIN_CHANNELS.PROJECTS_RESOLVE]: {
    request: { root: string; ref: string };
    response: ProjectInfo | null;
  };
  [MAIN_CHANNELS.PROJECTS_CREATE]: {
    request: { root: string; displayName: string };
    response: ProjectInfo;
  };
  // Renames the project: `displayName` in the record, and the folder with it.
  [MAIN_CHANNELS.PROJECTS_RENAME]: {
    request: { dir: string; displayName: string };
    response: ProjectInfo;
  };
  [MAIN_CHANNELS.PROJECTS_DUPLICATE]: { request: { dir: string }; response: ProjectInfo };
  [MAIN_CHANNELS.PROJECTS_DELETE]: { request: { dir: string }; response: void };
  [MAIN_CHANNELS.PROJECTS_COMPILE]: { request: { dir: string }; response: CompileResult };
  [MAIN_CHANNELS.PROJECTS_WRITE]: {
    request: { dir: string; edits: SourceEdit[] };
    response: WriteResult;
  };
  [MAIN_CHANNELS.PROJECTS_WATCH]: { request: { dir: string }; response: void };
  [MAIN_CHANNELS.PROJECTS_UNWATCH]: { request: { dir: string }; response: void };
  // The asset manifest (`assets.yml`) as plain data; null when there is none.
  [MAIN_CHANNELS.PROJECTS_MANIFEST_READ]: { request: { dir: string }; response: unknown };
  [MAIN_CHANNELS.PROJECTS_MANIFEST_WRITE]: { request: { dir: string; manifest: unknown }; response: void };
  // The project's config: the `posterract` field of its package.json, as
  // parsed (null when absent). The renderer owns its shape; see
  // `engine/project-config` in the web app.
  [MAIN_CHANNELS.PROJECTS_CONFIG_READ]: { request: { dir: string }; response: unknown };
  [MAIN_CHANNELS.PROJECTS_CONFIG_WRITE]: { request: { dir: string; config: unknown }; response: void };
  [MAIN_CHANNELS.PROJECTS_SOURCE_READ]: {
    request: { dir: string; path: string };
    response: { path: string; content: string; revisionId: string };
  };
  [MAIN_CHANNELS.PROJECTS_SOURCE_WRITE]: {
    request: { dir: string; path: string; content: string; expectedRevisionId: string };
    response: { revisionId: string; content: string; diagnostics: Array<{ message: string; line?: number; column?: number }> };
  };
  // Version history and trash. The revision store lives outside the project
  // (see `apps/desktop/src/revisions.ts`); trash lives inside it.
  [MAIN_CHANNELS.PROJECTS_REVISIONS_LIST]: {
    request: { dir: string; path: string };
    response: RevisionEntry[];
  };
  [MAIN_CHANNELS.PROJECTS_REVISIONS_READ]: {
    request: { dir: string; path: string; id: string };
    response: string;
  };
  [MAIN_CHANNELS.PROJECTS_REVISIONS_RESTORE]: {
    request: { dir: string; path: string; id: string };
    response: { path: string; revisionId: string; diagnostics: Array<{ message: string; line?: number; column?: number }> };
  };
  [MAIN_CHANNELS.PROJECTS_TRASH_PUT]: {
    request: { dir: string; sceneId: string; name: string };
    response: TrashEntry;
  };
  [MAIN_CHANNELS.PROJECTS_TRASH_LIST]: { request: { dir: string }; response: TrashEntry[] };
  [MAIN_CHANNELS.PROJECTS_TRASH_READ]: {
    request: { dir: string; id: string };
    response: { sceneId: string; name: string; source: string };
  };
  [MAIN_CHANNELS.PROJECTS_TRASH_REMOVE]: { request: { dir: string; id: string }; response: void };
  // The editor's undo stack, cached beside the project so undo survives a
  // reload. `value: null` clears it.
  [MAIN_CHANNELS.PROJECTS_HISTORY_READ]: { request: { dir: string }; response: unknown };
  [MAIN_CHANNELS.PROJECTS_HISTORY_WRITE]: { request: { dir: string; value: unknown }; response: void };
  // Opens the project source in the user's own editor and reports where the
  // element sits; null when the id is not in the file.
  [MAIN_CHANNELS.PROJECTS_SOURCE_LOCATE]: {
    request: { dir: string; id: string };
    response: { path: string; line: number; column: number } | null;
  };
  // The local exports library. Nothing here uploads; the cloud handoff is a
  // separate, explicit action.
  [MAIN_CHANNELS.EXPORTS_RECORD]: {
    request: Omit<ExportEntry, 'id' | 'createdAt'>;
    response: ExportEntry;
  };
  [MAIN_CHANNELS.EXPORTS_LIST]: { request: void; response: ListedExport[] };
  [MAIN_CHANNELS.EXPORTS_REVEAL]: { request: { id: string }; response: void };
  [MAIN_CHANNELS.EXPORTS_DELETE]: { request: { id: string; removeFile?: boolean }; response: void };
  [MAIN_CHANNELS.EXPORTS_RENAME]: { request: { id: string; name: string }; response: ExportEntry | null };
  // Project file system, for the asset library. `source` is project-relative
  // or absolute; `path` is always project-relative. Writes stream through the
  // FILE_WRITE_* channels (which create parent directories).
  [MAIN_CHANNELS.PROJECTS_FS_LIST]: { request: { dir: string; source: string }; response: FsEntry[] };
  [MAIN_CHANNELS.PROJECTS_FS_STAT]: { request: { dir: string; source: string }; response: FsStat | null };
  [MAIN_CHANNELS.PROJECTS_FS_FILE]: {
    request: { dir: string; source: string };
    response: { name: string; mimeType: string; mtime: number; url?: string; blob?: Blob };
  };
  [MAIN_CHANNELS.PROJECTS_FS_WRITE]: {
    request: { dir: string; path: string; blob: Blob };
    response: void;
  };
  [MAIN_CHANNELS.PROJECTS_FS_COPY]: {
    request: { dir: string; source: string; path: string };
    response: void;
  };
  [MAIN_CHANNELS.PROJECTS_FS_REMOVE]: { request: { dir: string; path: string }; response: void };
  [MAIN_CHANNELS.PROJECTS_FS_REAL_PATH]: { request: { dir: string; source: string }; response: string | null };
  [MAIN_CHANNELS.PROJECTS_IMPORT_LOTTIE_URL]: {
    request: { dir: string; url: string; name?: string };
    response: { path: string; width: number; height: number; duration: number };
  };
};

export type FsEntry = {
  name: string;
  kind: "file" | "directory";
  size: number;
  mtime: number;
  /** Set when the entry is a symlink; `kind` is what it points at. */
  link?: boolean;
};
export type FsStat = { size: number; mtime: number };
export type MainRequestChannel = keyof MainRequestMap;

export type MainEventMap = {
  [MAIN_CHANNELS.AUTH_CALLBACK]: { url: string };
  [MAIN_CHANNELS.CHECKOUT_CALLBACK]: { url: string };
  [MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE]: { fullscreen: boolean };
  [MAIN_CHANNELS.HEADLESS_MODE]: { active: boolean };
  // A file inside a watched project folder changed (path relative to `dir`).
  [MAIN_CHANNELS.PROJECTS_CHANGED]: { dir: string; path: string };
  [MAIN_CHANNELS.PROJECTS_SOURCE_CHANGED]: { dir: string; path: string; revisionId: string };
  [MAIN_CHANNELS.AGENT_CONNECTION_CHANGED]: LocalAgentConnectionState;
};
export type MainEventChannel = keyof MainEventMap;

export type MainRequest = {
  id: string;
  channel: MainRequestChannel;
  data: unknown;
};

export type MainEvent = {
  channel: MainEventChannel;
  data: unknown;
};

export type MainReply =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: string };
