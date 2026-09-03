/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Wire-level channels for one local CLI request. The CLI is always a client:
// it sends the request through the desktop-owned per-user socket, desktop
// relays it to the renderer, and the renderer returns the reply through IPC.
// This intentionally requires no listening port in coding-agent sandboxes.
export const CLI_WIRE = {
  REQUEST: "cli:request",
  RESPONSE: "cli:response",
} as const;

export const CLI_PROTOCOL_VERSION = 2;

/**
 * Version of the project-local request mailbox. This is deliberately
 * independent from the CLI wire version: the CLI, MCP server, and Desktop
 * can negotiate local transport changes without changing editor procedures.
 */
export const LOCAL_CONTROL_PROTOCOL_VERSION = 1;

export const LOCAL_CONTROL_RUNTIME = {
  dir: ".posterract/runtime",
  session: "session.json",
  requests: "requests",
  responses: "responses",
  captures: "captures",
} as const;

export type CliActivityMetadata = {
  cliVersion: string;
  command: string;
  projectDir: string;
  invokedAt: number;
  /** The element ids the call named, so the activity log can point at them. */
  targets?: string[];
};

export type CliRequest = {
  path: string;
  input: unknown;
};

export type CliReply =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

// Sent by the CLI through the per-user Unix socket / Windows named pipe.
// The socket remains open until the renderer has produced the final reply.
export type CliSocketRequest = {
  protocolVersion: number;
  request: CliRequest;
  timeoutMs: number;
  activity?: CliActivityMetadata;
};

// Relayed from desktop main to the renderer. The one-time token prevents a
// forged or stale renderer response from completing another CLI request.
export type CliRendererRequest = {
  protocolVersion: number;
  id: string;
  token: string;
  request: CliRequest;
  activity?: CliActivityMetadata;
};

export type CliRendererReply = {
  protocolVersion: number;
  id: string;
  token: string;
  reply: CliReply;
};

export type CliSocketReply =
  | { ok: true; protocolVersion: number; data: unknown }
  | { ok: false; protocolVersion: number; error: string };

export type LocalControlSession = {
  protocolVersion: number;
  cliProtocolVersion: number;
  desktopVersion: string;
  projectId: string;
  projectDir: string;
  instanceId: string;
  capability: string;
  createdAt: number;
  expiresAt: number;
  /**
   * Refreshed every few seconds while Desktop is alive. Optional because
   * sessions published by older Desktop builds do not carry it; when present,
   * a stale value means Desktop crashed or was killed without cleaning up,
   * and callers must treat the session as unreachable instead of trusting
   * `expiresAt` (which spans a day).
   */
  heartbeatAt?: number;
  rendererAvailable: boolean;
};

export type LocalControlRequest = {
  protocolVersion: number;
  id: string;
  instanceId: string;
  capability: string;
  projectDir: string;
  deadline: number;
  request: CliRequest;
  activity?: CliActivityMetadata;
};

export type LocalControlResponse =
  | {
      protocolVersion: number;
      id: string;
      ok: true;
      data: unknown;
      completedAt: number;
    }
  | {
      protocolVersion: number;
      id: string;
      ok: false;
      error: string;
      completedAt: number;
    };

export type AssetRef = { path: string };

export type ContextRequest = { tree?: boolean };

export type RuntimeTreeNode = {
  id: string | null;
  source: string | null;
  name: string | null;
  kind: string;
  /**
   * The project's own component this element was written inside, when it was
   * written inside one. A component compiles away, so this is the only trace
   * of it in the tree.
   */
  component?: string;
  /**
   * Props this element gets from code rather than from literals. Setting one
   * of these through a tool is overwritten on the next tick: change the
   * expression in the source, or bake the prop into keyframes first
   * (`posterract_bake_keyframes`), which then wins over the code.
   */
  live?: string[];
  /**
   * Kind-specific detail an agent cannot infer from the tree shape alone: the
   * property a `keyframe-track` drives, a `keyframe`'s time/value/easing, an
   * `animation`'s preset and timing, a vector figure's own `d`/`points` and
   * how much of it a trim is drawing. Absent for kinds that carry none.
   */
  detail?: Record<string, string | number | boolean | null>;
  children: RuntimeTreeNode[];
};

export type MediaProbeRequest = AssetRef;

/** One word with the window it was spoken in. */
export type TranscribedWord = { text: string; start: number; end: number };

export type MediaTranscribeRequest = AssetRef;

export type MediaTranscribeResult = {
  text: string;
  words: TranscribedWord[];
  segments: Array<{ text: string; start: number; end: number }>;
  /** True when the project's cache answered instead of the provider. */
  cached: boolean;
};

export type FrameQuality = "small" | "medium" | "large" | "fullres";
export type MediaFrameRequest = AssetRef & {
  times?: number[];
  count?: number;
  start?: number;
  end?: number;
  quality?: FrameQuality;
  auto?: boolean;
  combine?: boolean;
  perSheet?: number;
};

/** Beyond this the cells get too small to be worth the tokens; use `filmstrip`. */
export const MAX_FRAMES_PER_SHEET = 12;

/**
 * One written image: a single frame stamped with its timecode, or a contact
 * sheet stamped with the span it covers (`0f-08s10f`).
 */
export type TimecodedImage = { timecode: string; base64: string };

export type MediaFrameResult = TimecodedImage[];

export type CaptureRequest = {
  id: string;
  frames?: number[];
  combine?: boolean;
  perSheet?: number;
};

export type CaptureResult = TimecodedImage[];

export type ExportRequest = {
  id: string;
  output: string;
  format?: "mp4" | "webm" | "ogg" | "mov";
};

export type ExportResult = {
  path: string;
  format: "mp4" | "webm" | "ogg" | "mov";
};

export type MediaFilmstripRequest = AssetRef & { start?: number; end?: number; scale?: number };
export type MediaFilmstripResult = { base64: string };

export type MediaWaveformRequest = AssetRef & { start?: number; end?: number; scale?: number };
export type MediaWaveformResult = {
  base64: string;
  silences: Array<{ start: number; end: number }>;
};

export type MediaExtractRequest = AssetRef & {
  output: string;
  start?: number;
  end?: number;
  audioOnly?: boolean;
};

export type MediaExtractResult = {
  path: string;
  format: "mp4" | "ogg";
};

/**
 * Rendered geometry, so an agent can check layout from data rather than by
 * squinting at a capture. Boxes are post-transform, in the same scene space
 * the source's own `x`/`y`/`width`/`height` use.
 */
export type GeometryRequest = {
  /** Stable source ids; every element when omitted. */
  ids?: string[];
  /** Scene-local seconds to measure at; the playhead when omitted. */
  time?: number;
};

export type GeometryBox = {
  id: string | null;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Painter order: higher draws on top. */
  z: number;
  opacity: number;
  /** Entirely outside the frame. */
  offscreen: boolean;
  /** Crosses an edge of the frame. */
  clipped: boolean;
  /** What a text element renders, for spotting overflow. */
  text?: string;
};

export type GeometryResult = {
  time: number;
  frame: number;
  scene: { id: string | null; width: number; height: number };
  boxes: GeometryBox[];
  /** Pairs whose boxes partially overlap. A box fully containing another
   * is a normal composition, not a collision, so those are left out. */
  overlaps: Array<[string, string]>;
};

export type CheckRequest = { id: string };

export type CheckIssueCode =
  | "black-frames"
  | "no-visuals"
  | "never-visible"
  | "zero-duration"
  | "transparent"
  | "source-error";

/**
 * One structural finding. `ranges` (where present) are seconds relative to
 * the checked node's start — the same clock `capture --time` uses.
 */
export type CheckIssue = {
  code: CheckIssueCode;
  severity: "error" | "warning";
  message: string;
  /** Source stamp of the offending node; absent when the issue is about the subtree as a whole. */
  node?: string;
  ranges?: Array<{ start: number; end: number }>;
};

export type CheckResult = {
  stats: {
    /** Nodes in the subtree, the checked node included. */
    nodes: number;
    byKind: Record<string, number>;
    /** Deepest nesting level below the checked node (0 = no children). */
    depth: number;
    /** Seconds the checked node plays (its workarea, when one is set). */
    duration: number;
  };
  issues: CheckIssue[];
};

export type ScreenshotResult = { base64: string; width: number; height: number };

export type LogLevel = "debug" | "info" | "warning" | "error";

export type LogEntry = { ts: number; level: LogLevel; message: string; source: string };

export type LogsRequest = { tail?: number; level?: LogLevel };

export type ProjectSourceReadRequest = { path: string };

export type ProjectSourceReadResult = {
  path: string;
  content: string;
  revisionId: string;
};

export type ProjectSourceWriteRequest = {
  path: string;
  content: string;
  expectedRevisionId: string;
};

export type ProjectSourceWriteResult = {
  revisionId: string;
  content: string;
  diagnostics: Array<{ message: string; line?: number; column?: number }>;
};

export type CanvasStateResult = {
  activeSceneId: string | null;
  selectedIds: string[];
  currentTime: number | null;
  frameRate: number;
  canUndo: boolean;
  canRedo: boolean;
};

export type CanvasSelectRequest = { ids: string[]; extend?: boolean };
export type CanvasActivateRequest = { id: string | null };
export type CanvasSeekRequest = { time: number };
export type CanvasSetPropertiesRequest = {
  id: string;
  properties: Record<string, number | string | boolean | null | unknown[] | Record<string, unknown>>;
};
export type CanvasSetTextRequest = { id: string; text: string };
export type CanvasIdsRequest = { ids: string[] };
export type CanvasMoveRequest = { id: string; parentId: string; beforeId?: string };
export type CanvasElementTree = {
  tag: string;
  props?: Record<string, number | string | boolean | null | unknown[] | Record<string, unknown>>;
  text?: string;
  children?: CanvasElementTree[];
};
export type CanvasCreateRequest = {
  parentId: string;
  beforeId?: string;
  element: CanvasElementTree;
};
export type CanvasVariableRequest = { file: string; name: string; value: string | number | boolean };

export type CanvasBakeRequest = {
  id: string;
  property: string;
  /** How far a sample may sit off the line before it earns a keyframe. */
  tolerance?: number;
};

export type CanvasBakeResult = {
  /** Keyframes written. */
  keyframes: number;
  /** Frames sampled before simplification. */
  sampled: number;
};
export type CanvasGroupRequest = { ids: string[]; kind: "group" | "sequence" | "scene" };
export type CanvasUngroupRequest = { id: string; kind?: "group" | "sequence" | "scene" };
