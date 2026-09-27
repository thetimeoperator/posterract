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

export type ContextRequest = {
  tree?: boolean;
  /** Limit the tree to one scene, by id. Every scene when omitted. */
  scene?: string;
  /** How many levels below the stage to descend. Everything when omitted. */
  depth?: number;
  /**
   * List every keyframe, track and animation as a node of its own. Off by
   * default: a composition is mostly keyframes by count, and an element says
   * what moves it in one line (`motion`) instead.
   */
  motion?: boolean;
};

export type RuntimeTreeNode = {
  id: string | null;
  source: string | null;
  name: string | null;
  kind: string;
  /**
   * What the source says about the element, for the props an edit usually
   * starts from: where it is, how big, when it plays, what it shows. Literals
   * only — a prop the code computes is named in `live` instead.
   */
  props?: Record<string, unknown>;
  /** What a `<text>` says. */
  text?: string;
  /**
   * What moves the element, when its motion nodes are not listed: keyframes
   * per animated property, and its animation presets as `type phase`.
   */
  motion?: { keyframes?: Record<string, number>; animations?: string[] };
  /** Children a `depth` limit left out. */
  more?: number;
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
  /**
   * Render only this stretch of the scene, in seconds of scene time: a look at
   * three seconds of a two minute video costs three seconds of rendering.
   * Without them the scene's work area decides, as it does in the app.
   */
  from?: number;
  to?: number;
  /** Output size as a fraction of the scene's own, 0–1: `0.5` renders a 1080×1920 scene at 540×960. */
  scale?: number;
};

/** How far the render in flight has got; null when none is. */
export type ExportProgress = {
  /** 0–100. */
  progress: number;
  /** Seconds of video being rendered. */
  duration: number;
  /** The encoder's own estimate of what is left, in seconds. */
  remainingSeconds?: number;
} | null;

export type ExportResult = {
  path: string;
  format: "mp4" | "webm" | "ogg" | "mov";
};

export type MediaFilmstripRequest = AssetRef & { start?: number; end?: number; scale?: number };
export type MediaFilmstripResult = { base64: string };

export type MediaWaveformRequest = AssetRef & { start?: number; end?: number; scale?: number };

export type MediaBeatsRequest = AssetRef & { minBpm?: number; maxBpm?: number; meter?: number };
export type MediaBeatsResult = {
  /** Tempo, 0 when nothing steady was found. */
  bpm: number;
  /** Where beat 1 of a bar is, seconds into the file: trim the song by this much to put its bars on the timeline's. */
  downbeat: number;
  meter: number;
  confidence: number;
  duration: number;
  beats: number[];
};
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

export type ProjectSourceReadRequest = {
  path: string;
  /** One element, children included, by its stable id. */
  id?: string;
  /** 1-based, inclusive line range. */
  lines?: [from: number, to: number];
  /** One line per element, with the lines each spans, instead of the text. */
  outline?: boolean;
  /** The whole file however large. Without it a very large file answers with its outline. */
  full?: boolean;
};

export type ProjectSourceReadResult = {
  path: string;
  /** Empty when the answer is an outline. */
  content: string;
  /** Revision of the whole file, whatever part of it was read. */
  revisionId: string;
  totalLines: number;
  totalChars: number;
  range?: { from: number; to: number };
  outline?: string[];
  note?: string;
};

export type ProjectSourceWriteRequest = {
  path: string;
  content: string;
  expectedRevisionId: string;
};

/** Replace one string of a source with another: what a file tool's edit does, for an agent that has none. */
export type ProjectSourceEditRequest = {
  path: string;
  oldString: string;
  newString: string;
  /** Replace every occurrence; without it `oldString` has to be there exactly once. */
  replaceAll?: boolean;
};

export type ProjectSourceEditResult = ProjectSourceWriteResult & {
  replaced: number;
  /** The line the (first) replacement starts on. */
  line: number;
};

export type ProjectSourceWriteResult = {
  revisionId: string;
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

/**
 * What a tool that changes the document answers with: the canvas state, and
 * what became of the change on disk. The canvas shows a value the moment it is
 * set; the source has it only after the write, and a caller that cannot see the
 * canvas needs to know which of the two it is looking at.
 */
export type CanvasWriteResult = CanvasStateResult & {
  /** Revision of the entry source once the change was written (the id `read_source` hands out). */
  revisionId: string | null;
  /**
   * Edits the source could not take, as `source` or `source (prop)`: a prop the
   * code computes rather than spells, an element inside a loop. The canvas shows
   * them until the next reload; the file does not have them.
   */
  skipped?: string[];
  note?: string;
  /**
   * The edit was applied, and these are worth knowing: a prop the runtime
   * accepts that the element does not document (`fill` on a `<text>` works as
   * `color` does), with the documented name to prefer.
   */
  warnings?: string[];
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

/**
 * What an edit of named elements may say about when its author last looked:
 * the revision a read or an earlier edit handed out. With it, the edit is
 * refused if someone has changed one of those elements since — and only then;
 * a change anywhere else in the file is no conflict, and the edit lands on top
 * of it.
 */
export type ExpectedRevision = { expectedRevisionId?: string };

/** One of several edits applied together: one undo step, one write, all or nothing. */
export type CanvasEdit =
  | ({ op: "set" } & CanvasSetPropertiesRequest)
  | ({ op: "text" } & CanvasSetTextRequest)
  | ({ op: "create" } & CanvasCreateRequest)
  | ({ op: "move" } & CanvasMoveRequest)
  | ({ op: "delete" } & CanvasIdsRequest)
  | ({ op: "duplicate" } & CanvasIdsRequest);

export type CanvasApplyRequest = ExpectedRevision & { edits: CanvasEdit[] };

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
