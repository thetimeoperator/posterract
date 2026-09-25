/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { version } from "../package.json";
import { formatInspect, formatLook, type InspectResult, type LookResult } from "./format";
import { createEditFeedback, memoryStore } from "./edit-feedback";
import { offline } from "./offline-loader";
import { canRunOnEngine, engineRequest } from "./cli-client";
import { DesktopUnavailableError, readLocalControlSession, requestProjectControl, resolveProjectDir } from "./project-control";
import { fetchVideo } from "./ytdlp";
import { join as joinPath } from "node:path";

const DEFAULT_TIMEOUT_MS = 60_000;
const RENDER_TIMEOUT_MS = 600_000;
/** Connection checks must answer fast even when Desktop is wedged. */
const STATUS_TIMEOUT_MS = 10_000;

const OPEN_PROJECT_HINT = "Open a project in Posterract Desktop, then retry.";
const START_DESKTOP_HINT =
  "Start Posterract Desktop and open this project, then retry. " +
  "If this MCP server was registered while your agent client was already running, restart your agent client so it picks up the new MCP server.";

type ToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { result: value };
}

/**
 * No tool answers with more than this. An agent reads a result into its
 * context whole — it cannot page or filter it the way a shell pipeline can —
 * so a result past this size is not a bigger answer, it is no answer: the
 * client rejects it or the agent's context is spent on it. Roughly fifteen
 * thousand tokens; every tool that can exceed it has a way to ask for less.
 */
const MAX_RESULT_CHARS = 60_000;

function jsonResult(value: unknown, narrowWith = "Ask for less: name the ids, scene, time or lines you need."): ToolResult {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= MAX_RESULT_CHARS) {
    return { content: [{ type: "text", text }], structuredContent: record(value) };
  }

  const note = `Result was ${text.length.toLocaleString("en-US")} characters; only the first ${MAX_RESULT_CHARS.toLocaleString("en-US")} are shown. ${narrowWith}`;
  return {
    content: [{ type: "text", text: `${note}\n\n${text.slice(0, MAX_RESULT_CHARS)}\n… [truncated]` }],
    structuredContent: { truncated: true, totalChars: text.length, note },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorResult(error: unknown): ToolResult {
  const message = errorText(error);
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: { error: message },
  };
}

function imageResult(value: unknown): ToolResult {
  const images = Array.isArray(value) ? value : [value];
  const content: ToolResult["content"] = [];
  const metadata: Array<Record<string, unknown>> = [];
  for (const image of images) {
    if (!image || typeof image !== "object") continue;
    const candidate = image as Record<string, unknown>;
    const base64 = candidate.base64;
    if (typeof base64 !== "string") continue;
    const { base64: _discarded, ...rest } = candidate;
    metadata.push(rest);
    content.push({ type: "text", text: JSON.stringify(rest) });
    content.push({ type: "image", data: base64, mimeType: "image/png" });
  }
  return {
    content: content.length ? content : [{ type: "text", text: "No image was returned." }],
    structuredContent: { images: metadata },
  };
}

/**
 * The element ids a call names.
 *
 * Every tool that acts on elements spells them as `id` or `ids`, so the
 * activity log can point at what a turn touched without each tool having to
 * describe itself. Anything else contributes nothing rather than guessing.
 */
function targetsOf(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const value = input as { id?: unknown; ids?: unknown; parentId?: unknown };
  const ids: string[] = [];
  if (typeof value.id === "string") ids.push(value.id);
  if (typeof value.parentId === "string") ids.push(value.parentId);
  if (Array.isArray(value.ids)) {
    for (const id of value.ids) if (typeof id === "string") ids.push(id);
  }
  return ids.slice(0, 12);
}

/**
 * Generation is slow — a video can take minutes — so it gets its own budget
 * rather than the default tool timeout, which is sized for canvas edits.
 */
const GENERATE_TIMEOUT_MS = 10 * 60 * 1000;

export async function servePosterractMcp(explicitProjectDir?: string): Promise<void> {
  const projectDir = () => resolveProjectDir(explicitProjectDir);
  const call = async (tool: string, path: string, input: unknown = undefined, timeoutMs = DEFAULT_TIMEOUT_MS) => {
    const activeProjectDir = projectDir();
    try {
      return await requestProjectControl(
        activeProjectDir,
        { path, input },
        timeoutMs,
        {
          cliVersion: version,
          command: `mcp:${tool}`,
          projectDir: activeProjectDir,
          invokedAt: Date.now(),
          targets: targetsOf(input),
        },
      );
    } catch (error) {
      // Desktop is closed. What only needs a renderer — a frame, an export, an
      // inspection — is answered by the engine, which this starts for itself
      // (see cli-client); what needs the person's editor still says so.
      if (!(error instanceof DesktopUnavailableError) || !canRunOnEngine(path)) throw error;
      return engineRequest(activeProjectDir, { path, input }, timeoutMs);
    }
  };
  // What is newly wrong with the video, attached to whatever the agent asked
  // for next (see ./edit-feedback): every agent gets it, because every agent
  // that is connected talks to this server. The layout half goes through `call`,
  // so it is answered by Desktop when it is open and by the engine when not.
  const feedback = createEditFeedback({
    projectDir,
    store: memoryStore(),
    lint: (dir) => offline().lint(dir, dir).lines,
    inspect: async (dir) => {
      // The canvas shows a file change a moment after it is made; measuring before that is measuring the old video.
      for (let waited = 0; waited < 3_000; waited += 150) {
        const context = await call("feedback", "context", { tree: false }) as { sourceRevision?: string | null; shownRevision?: string | null };
        if (!context.shownRevision || context.shownRevision === context.sourceRevision) break;
        await new Promise((done) => setTimeout(done, 150));
      }
      const scenes = offline().outline(dir, dir).entries.filter((entry) => entry.tag === "scene" && entry.id && entry.depth <= 1);
      const results: InspectResult[] = [];
      for (const scene of scenes) results.push(await call("feedback", "inspect", { id: scene.id }, RENDER_TIMEOUT_MS) as InspectResult);
      return results;
    },
  });
  // The server starts with the agent's session: what is wrong already is not news, what goes wrong from here on is.
  feedback.baseline();

  /** `result` with what is newly wrong attached. A tool that *is* a check says its own findings, so they are only recorded as heard. */
  const withFeedback = async (result: ToolResult, checksItself?: "lint" | "inspect"): Promise<ToolResult> => {
    try {
      if (checksItself) {
        // (A lint that found errors answers as an error, and is heard all the same.)
        feedback.heard(result.content.flatMap((item) => (item.type === "text" ? item.text.split("\n") : [])), checksItself);
        return result;
      }
      if (result.isError) return result;
      const note = await feedback.since();
      return note ? { ...result, content: [...result.content, { type: "text", text: note }] } : result;
    } catch {
      return result;
    }
  };

  const safely = (fn: () => Promise<ToolResult>, checksItself?: "lint" | "inspect") => async () => {
    try { return await withFeedback(await fn(), checksItself); } catch (error) { return errorResult(error); }
  };
  const safelyWith = <T>(fn: (value: T) => Promise<ToolResult>, checksItself?: "lint" | "inspect") => async (value: T) => {
    try { return await withFeedback(await fn(value), checksItself); } catch (error) { return errorResult(error); }
  };

  const handle = serveStdio(() => {
    const server = new McpServer(
      { name: "posterract", version },
      {
        instructions:
          "Posterract canvas. File-first: the project's TSX is the document, so edit it with your own file tools (read a range, search, replace a string) like any code. " +
          "Desktop watches the file and shows the change on the canvas: a change to values or text in place, as one step of the user's undo history (Cmd+Z takes it back); " +
          "adding, removing or moving elements by reloading the canvas, which keeps the user's own undo steps and records yours in Version History. " +
          "Before you write, posterract_changes with the revisionId you last saw shows what the user changed since: work around it, not over it. " +
          "Start a turn with posterract_look (what the author has selected, their playhead, their `@agent` notes); " +
          "read with posterract_outline, then posterract_read_source by `id` or `lines`, never a whole large file; ask posterract_describe instead of guessing an element or prop name. " +
          "After you edit, your next call to any of these tools comes back with what is newly wrong attached (unknown props, text off the frame, with the fix), each problem once: fix it when you hear it. " +
          "posterract_inspect reports facts and every open problem across the whole video: fix every error before looking at a capture, and capture only to judge taste. " +
          "Say where things go with `place` (\"lower-third\", \"bottom-right\" + `inset`) rather than computing x/y; keep anything that repeats a few keyframes and a `loop`; tune a preset with `distance`/`amount`/`easing` before writing keyframes. " +
          "With Desktop closed, inspect, geometry, validate, capture and export still answer: the engine (the app with no window) is started for them. " +
          "A scene's `skill` names the SKILL.md folder to follow for it; export only when asked. Cannot post, schedule, or access credentials.",
      },
    );

    server.registerTool("posterract_connection_status", {
      title: "Posterract connection status",
      description:
        "Verify the project-local Desktop bridge and report renderer, project, and compiler context. " +
        "`connected` is true only when Desktop answered a live round-trip with a project mounted; " +
        "otherwise `state` (\"desktop_unreachable\" | \"no_project_mounted\") and `hint` say what to do.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    }, safely(async () => {
      // Never report `connected` from static state: only a completed health +
      // context round-trip through the running Desktop proves the bridge.
      let activeProjectDir: string;
      try {
        activeProjectDir = projectDir();
      } catch (error) {
        return jsonResult({
          connected: false,
          state: "no_project_mounted",
          hint: OPEN_PROJECT_HINT,
          detail: errorText(error),
        });
      }
      let desktopVersion: string | undefined;
      try {
        desktopVersion = readLocalControlSession(activeProjectDir).desktopVersion;
      } catch (error) {
        return jsonResult({
          connected: false,
          state: "desktop_unreachable",
          projectDir: activeProjectDir,
          hint: START_DESKTOP_HINT,
          detail: errorText(error),
        });
      }
      try {
        const [health, context] = await Promise.all([
          call("connection_status", "health", undefined, STATUS_TIMEOUT_MS),
          call("connection_status", "context", { tree: false }, STATUS_TIMEOUT_MS),
        ]);
        const mounted = context !== null && typeof context === "object" &&
          typeof (context as { projectDir?: unknown }).projectDir === "string";
        if (!mounted) {
          return jsonResult({
            connected: false,
            state: "no_project_mounted",
            projectDir: activeProjectDir,
            desktopVersion,
            hint: OPEN_PROJECT_HINT,
            health,
            context,
          });
        }
        return jsonResult({ connected: true, state: "connected", projectDir: activeProjectDir, desktopVersion, health, context });
      } catch (error) {
        return jsonResult({
          connected: false,
          state: "desktop_unreachable",
          projectDir: activeProjectDir,
          desktopVersion,
          hint: START_DESKTOP_HINT,
          detail: errorText(error),
        });
      }
    }));

    server.registerTool("posterract_get_context", {
      title: "Get Posterract project context",
      description:
        "Read active video, playhead, source revision, variables and fonts. Small by default. " +
        "`tree: true` adds the runtime node tree: each element with its id, kind, the props that place it " +
        "(x, y, width, height, start, end, src, ...), its text, and its motion in one line (keyframes per property, animation presets). " +
        "Narrow a large tree with `scene` (one scene id) and `depth`; `motion: true` lists every keyframe as a node, which is rarely needed.",
      inputSchema: z.object({
        tree: z.boolean().optional().default(false),
        scene: z.string().min(1).optional(),
        depth: z.number().int().min(0).max(32).optional(),
        motion: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async (input: { tree: boolean; scene?: string; depth?: number; motion?: boolean }) =>
      jsonResult(
        await call("get_context", "context", input),
        "Narrow the tree: pass `scene` (one scene id) and/or `depth`, and leave `motion` off.",
      )));

    server.registerTool("posterract_read_source", {
      title: "Read composition source",
      description:
        "Read a local Posterract TSX source file and its conflict-safe revision ID. " +
        "The default path \"auto\" resolves to the project's actual entry file (src/index.tsx, index.tsx, ...), " +
        "which some migrated projects keep at the project root; the result reports the resolved path. " +
        "Read a part instead of the whole file: `outline: true` gives one line per element with the lines it spans " +
        "(keyframes folded to counts); `id` gives one element with its children; `lines: [from, to]` gives a range. " +
        "A very large file answers with its outline unless `full: true`. The revision is always the whole file's.",
      inputSchema: z.object({
        path: z.string().min(1).default("auto"),
        id: z.string().min(1).optional(),
        lines: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(),
        outline: z.boolean().optional(),
        full: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async (input: { path: string; id?: string; lines?: [number, number]; outline?: boolean; full?: boolean }) =>
      jsonResult(
        await call("read_source", "source.read", input),
        "Read a part: `outline: true`, `id`, or `lines: [from, to]`.",
      )));

    server.registerTool("posterract_write_source", {
      title: "Write composition source",
      description: "Atomically replace a Posterract TSX source file only if its revision still matches. Returns compiler diagnostics.",
      inputSchema: z.object({
        path: z.string().min(1).default("auto"),
        content: z.string(),
        expectedRevisionId: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: { path: string; content: string; expectedRevisionId: string }) =>
      jsonResult(await call("write_source", "source.write", input))));

    server.registerTool("posterract_edit_source", {
      title: "Edit composition source",
      description:
        "Replace one string of a TSX source with another — the edit a file tool makes. If you have file tools of your own (Edit, apply_patch, an IDE), " +
        "use those on the file instead: Desktop shows the change either way. This is for a client that has only these tools. `old_string` has to match the file " +
        "exactly (read it first with posterract_read_source by `id` or `lines`) and be there once, unless `replace_all`. Costs the two strings, where " +
        "posterract_write_source costs the whole file. Answers with the new revisionId and what the compiler and the vocabulary lint say about the result.",
      inputSchema: z.object({
        path: z.string().min(1).default("auto"),
        old_string: z.string().min(1),
        new_string: z.string(),
        replace_all: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: { path: string; old_string: string; new_string: string; replace_all?: boolean }) =>
      jsonResult(await call("edit_source", "source.edit", {
        path: input.path,
        oldString: input.old_string,
        newString: input.new_string,
        ...(input.replace_all ? { replaceAll: true } : {}),
      }))));

    // The three below read the project folder themselves (see ./offline): they
    // answer with Desktop closed, the way `ffprobe` needs no player running.
    server.registerTool("posterract_describe", {
      title: "Describe the composition vocabulary",
      description:
        "What can be written in a composition. With no `element`: every element in one line, led by the common tasks and the element " +
        "that does each. With an `element` (e.g. \"text\"): the props it takes, their types and allowed values. Generated from the SDK's " +
        "types, so it is never out of date. Ask this instead of guessing a prop name. Works with Desktop closed.",
      inputSchema: z.object({ element: z.string().min(1).optional() }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async ({ element }: { element?: string }) => {
      const report = offline().describe(element);
      return { content: [{ type: "text", text: report.lines.join("\n") }] };
    }));

    server.registerTool("posterract_outline", {
      title: "Outline composition source",
      description:
        "One line per element of the composition source: id, name, when it plays, where it sits, what it shows, and the lines it spans " +
        "in the file — keyframes folded to a count per property, long runs of look-alike siblings to one line. Start here instead of " +
        "reading a large source whole, then read only the lines (or the `id`) you need. Works with Desktop closed.",
      inputSchema: z.object({ path: z.string().min(1).optional() }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async ({ path }: { path?: string }) => {
      const dir = projectDir();
      const report = offline().outline(path ?? dir, dir);
      const header = `${report.path} · ${report.totalLines} lines · ${report.totalChars.toLocaleString("en-US")} chars · ${report.entries.length} elements`;
      return { content: [{ type: "text", text: [header, ...report.lines].join("\n") }] };
    }));

    server.registerTool("posterract_lint", {
      title: "Lint composition source",
      description:
        "Check the composition source against the vocabulary: a prop an element does not take (with what was probably meant — `fill` on " +
        "a <text> is `color`), a value an enumeration does not name, a required prop left out. The runtime silently ignores what it does " +
        "not know, so without this such a mistake shows up only as a render that looks wrong. Works with Desktop closed.",
      inputSchema: z.object({ path: z.string().min(1).optional() }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async ({ path }: { path?: string }) => {
      const dir = projectDir();
      const report = offline().lint(path ?? dir, dir);
      const errors = report.diagnostics.filter((entry) => entry.severity === "error").length;
      const text = report.diagnostics.length
        ? [...report.lines, `${errors} error(s), ${report.diagnostics.length - errors} warning(s)`].join("\n")
        : `✓ ${report.path}: every prop and value is one the editor understands`;
      return {
        content: [{ type: "text", text }],
        structuredContent: { path: report.path, ok: errors === 0, diagnostics: report.diagnostics },
        ...(errors ? { isError: true } : {}),
      };
    }, "lint"));

    server.registerTool("posterract_changes", {
      title: "See what changed, and who changed it",
      description:
        "What changed in the project's source, element by element, and who changed it: the person on the canvas, an agent's tool, a direct " +
        "edit of the file, or the app's own housekeeping — `person  text#hook  y  1480 → 1200`. Pass `since` (a revisionId an earlier read or " +
        "edit handed you) to see everything written after the source last stood there. Run it before you write, so you work around what your " +
        "collaborator decided instead of over it. Works with Desktop closed.",
      inputSchema: z.object({ since: z.string().min(6).optional(), limit: z.number().int().min(1).max(50).optional() }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async (input: { since?: string; limit?: number }) => {
      const report = offline().changes(projectDir(), input);
      return {
        content: [{ type: "text", text: report.lines.join("\n") }],
        structuredContent: { path: report.path, revisionId: report.revisionId, since: report.since },
      };
    }));

    server.registerTool("posterract_validate", {
      title: "Validate composition",
      description:
        "Compile and evaluate the project's composition sources in memory and report diagnostics — compiler errors, and the vocabulary " +
        "lint's findings (props an element does not take, values an enumeration does not name). `ok` is false when either has an error. " +
        "Genuinely read-only: stable-ID stamping runs on an in-memory copy, nothing is written to disk, and the live canvas is untouched.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    }, safely(async () => jsonResult(await call("validate", "validate")), "lint"));

    server.registerTool("posterract_get_canvas_state", {
      title: "Get live canvas state",
      description: "Read the active video, selection, playhead, frame rate, and undo/redo availability.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    }, safely(async () => jsonResult(await call("get_canvas_state", "canvas.state"))));

    server.registerTool("posterract_select", {
      title: "Select canvas elements",
      description: "Select one or more stable source IDs on the live canvas.",
      inputSchema: z.object({ ids: z.array(z.string()).default([]), extend: z.boolean().optional() }),
      annotations: { readOnlyHint: false },
    }, safelyWith(async (input: { ids: string[]; extend?: boolean }) => jsonResult(await call("select", "canvas.select", input))));

    server.registerTool("posterract_activate_video", {
      title: "Activate video",
      description: "Activate a scene/video by stable source ID, synchronizing canvas and timeline. Pass null to clear it.",
      inputSchema: z.object({ id: z.string().nullable() }),
      annotations: { readOnlyHint: false },
    }, safelyWith(async (input: { id: string | null }) => jsonResult(await call("activate_video", "canvas.activate", input))));

    server.registerTool("posterract_seek", {
      title: "Seek active video",
      description: "Move the active video's live playhead to a time in seconds.",
      inputSchema: z.object({ time: z.number().nonnegative() }),
      annotations: { readOnlyHint: false },
    }, safelyWith(async (input: { time: number }) => jsonResult(await call("seek", "canvas.seek", input))));

    // Every edit of named elements takes this. It is a conflict check about those
    // elements only: a change anywhere else in the file does not refuse the edit.
    const expectedRevisionId = z.string().min(1).optional().describe(
      "The revisionId you last saw (from a read or an earlier edit). If someone changed the element(s) this edit names since then, " +
        "nothing is changed and the answer says what they changed. A change elsewhere in the file is no conflict.",
    );
    const elementTree = z.object({
      tag: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
      props: z.record(z.string(), z.any()).optional(),
      text: z.string().optional(),
      children: z.array(z.any()).optional(),
    });

    server.registerTool("posterract_set_properties", {
      title: "Set element properties",
      description: "Apply source-backed properties such as position, size, timing, opacity, rotation, volume, and styles to a stable element ID.",
      inputSchema: z.object({ id: z.string().min(1), properties: z.record(z.string(), z.any()), expectedRevisionId }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: { id: string; properties: Record<string, unknown> }) =>
      jsonResult(await call("set_properties", "canvas.setProperties", input))));

    server.registerTool("posterract_set_text", {
      title: "Set text content",
      description: "Replace the source-backed text content of a text element.",
      inputSchema: z.object({ id: z.string().min(1), text: z.string(), expectedRevisionId }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: { id: string; text: string }) => jsonResult(await call("set_text", "canvas.setText", input))));

    server.registerTool("posterract_apply_edits", {
      title: "Apply several edits as one",
      description:
        "Several element edits in one call: one step of the user's undo history, one write of the source, and all of them or none " +
        "(everything is checked before anything changes). Each edit is `{op, ...}` with the same fields as the single tools: " +
        "`set` {id, properties} · `text` {id, text} · `create` {parentId, beforeId?, element} · `move` {id, parentId, beforeId?} · " +
        "`delete` {ids} · `duplicate` {ids}. A later edit may name an element an earlier `create` of the same call makes, by the `id` in its props. " +
        "Use this instead of a run of single calls whenever a change is more than one edit: a caption that is a group, a shape and a text is one thing to the user.",
      inputSchema: z.object({
        edits: z.array(z.discriminatedUnion("op", [
          z.object({ op: z.literal("set"), id: z.string().min(1), properties: z.record(z.string(), z.any()) }),
          z.object({ op: z.literal("text"), id: z.string().min(1), text: z.string() }),
          z.object({ op: z.literal("create"), parentId: z.string().min(1), beforeId: z.string().optional(), element: elementTree }),
          z.object({ op: z.literal("move"), id: z.string().min(1), parentId: z.string().min(1), beforeId: z.string().optional() }),
          z.object({ op: z.literal("delete"), ids: z.array(z.string()).min(1) }),
          z.object({ op: z.literal("duplicate"), ids: z.array(z.string()).min(1) }),
        ])).min(1).max(200),
        expectedRevisionId,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: Record<string, unknown>) => jsonResult(await call("apply_edits", "canvas.batch", input))));

    server.registerTool("posterract_create_element", {
      title: "Create composition element",
      description: "Insert a new Posterract element tree under a source-backed parent and select it on the live canvas.",
      inputSchema: z.object({ parentId: z.string().min(1), beforeId: z.string().optional(), element: elementTree }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: Record<string, unknown>) => jsonResult(await call("create_element", "canvas.create", input))));

    server.registerTool("posterract_bake_keyframes", {
      title: "Bake motion into keyframes",
      description: "Sample what a property actually does across an element's span and write it back as a keyframe track, so motion written in code becomes motion the timeline can retime. The original expression stays in the source; the track wins over it.",
      inputSchema: z.object({
        id: z.string().min(1),
        property: z.string().min(1),
        tolerance: z.number().min(0).max(100).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: { id: string; property: string; tolerance?: number }) =>
      jsonResult(await call("bake_keyframes", "canvas.bake", input))));

    server.registerTool("posterract_set_variable", {
      title: "Set inspector variable",
      description: "Change a documented source-backed inspector variable by file and name.",
      inputSchema: z.object({ file: z.string().min(1), name: z.string().min(1), value: z.union([z.string(), z.number(), z.boolean()]) }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: { file: string; name: string; value: string | number | boolean }) =>
      jsonResult(await call("set_variable", "canvas.setVariable", input))));

    server.registerTool("posterract_group", {
      title: "Group composition elements",
      description: "Wrap selected elements in a group, timed sequence, or new scene/video while preserving their visual placement.",
      inputSchema: z.object({ ids: z.array(z.string()).min(1), kind: z.enum(["group", "sequence", "scene"]).default("group") }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: { ids: string[]; kind: "group" | "sequence" | "scene" }) =>
      jsonResult(await call("group", "canvas.group", input))));

    server.registerTool("posterract_ungroup", {
      title: "Ungroup composition container",
      description: "Dissolve a group, sequence, or scene while baking placement and timing into its children.",
      inputSchema: z.object({ id: z.string().min(1), kind: z.enum(["group", "sequence", "scene"]).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: { id: string; kind?: "group" | "sequence" | "scene" }) =>
      jsonResult(await call("ungroup", "canvas.ungroup", input))));

    server.registerTool("posterract_duplicate", {
      title: "Duplicate elements",
      description: "Duplicate source-backed elements and select the copies.",
      inputSchema: z.object({ ids: z.array(z.string()).min(1) }),
      annotations: { readOnlyHint: false },
    }, safelyWith(async (input: { ids: string[] }) => jsonResult(await call("duplicate", "canvas.duplicate", input))));

    server.registerTool("posterract_delete", {
      title: "Delete elements",
      description: "Delete source-backed elements by stable ID. This can be undone in the editor.",
      inputSchema: z.object({ ids: z.array(z.string()).min(1), expectedRevisionId }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: { ids: string[] }) => jsonResult(await call("delete", "canvas.remove", input))));

    server.registerTool("posterract_move", {
      title: "Move element",
      description: "Move an element under another source-backed parent, optionally before a sibling.",
      inputSchema: z.object({ id: z.string(), parentId: z.string(), beforeId: z.string().optional(), expectedRevisionId }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: { id: string; parentId: string; beforeId?: string }) =>
      jsonResult(await call("move", "canvas.move", input))));

    server.registerTool("posterract_undo", {
      title: "Undo editor change",
      description: "Undo the latest source-backed visual edit.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false },
    }, safely(async () => jsonResult(await call("undo", "canvas.undo"))));

    server.registerTool("posterract_redo", {
      title: "Redo editor change",
      description: "Redo the latest undone visual edit.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false },
    }, safely(async () => jsonResult(await call("redo", "canvas.redo"))));

    server.registerTool("posterract_get_geometry", {
      title: "Measure rendered layout",
      description:
        "Read post-transform bounding boxes, draw order, opacity, and text content for the elements on screen at `time` " +
        "(the current playhead when omitted) in the active video, with the pairs that partly overlap and the ones that fall off " +
        "or cross the frame. Use this to check layout from data instead of inferring it from a capture. Boxes are in the same " +
        "scene space as the source's x/y/width/height. Elements that are not playing at that time are left out unless named in " +
        "`ids` or `all` is set (they come back with `visible: false`). Reading does not move the author's playhead.",
      inputSchema: z.object({
        ids: z.array(z.string()).optional(),
        time: z.number().nonnegative().optional(),
        all: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async (input: { ids?: string[]; time?: number; all?: boolean }) =>
      jsonResult(await call("get_geometry", "geometry", input), "Pass `ids`, or a `time` when fewer elements are on screen.")));

    server.registerTool("posterract_inspect", {
      title: "Inspect a video",
      description:
        "What is in a video and what is wrong with it, as text — the `ffprobe` of a composition. Visits the whole duration and reports the " +
        "timeline (when each element plays, where it sits, what it says), the markers, and ranked problems with the element, the numbers and " +
        "the fix: text running off the frame, an element never in frame or never opaque, something on screen too briefly to read, text " +
        "overlapping text or hidden under a later layer, spans where nothing draws, sources that failed. Nothing is rendered and the author's " +
        "playhead does not move. Use this to check your work before looking at a capture; run it before and after an edit to see what changed.",
      inputSchema: z.object({ scene: z.string().min(1).optional() }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async ({ scene }: { scene?: string }) => {
      const result = await call("inspect", "inspect", scene === undefined ? {} : { id: scene }, RENDER_TIMEOUT_MS) as InspectResult;
      return {
        content: [{ type: "text", text: formatInspect(result).join("\n") }],
        structuredContent: { scene: result.scene, problems: result.problems },
      };
    }, "inspect"));

    server.registerTool("posterract_look", {
      title: "See what the author is looking at",
      description:
        "What your collaborator is looking at right now: the active scene, where the playhead is parked, what is selected (with the props an " +
        "edit starts from), and the markers on the timeline — those starting `@agent` are notes addressed to you. Call it at the start of a " +
        "turn: \"make this bigger\" means the selected element at that playhead.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    }, safely(async () => {
      const result = await call("look", "look") as LookResult;
      return { content: [{ type: "text", text: formatLook(result).join("\n") }], structuredContent: record(result) };
    }));

    server.registerTool("posterract_show", {
      title: "Show the author an element",
      description:
        "Bring the editor to an element: activate its scene, move the playhead to `at` seconds (default: the middle of the element's span), " +
        "select it and frame it in the canvas. View only — nothing in the source changes. Use it to show your collaborator what you changed.",
      inputSchema: z.object({ id: z.string().min(1), at: z.number().nonnegative().optional() }),
      annotations: { readOnlyHint: false },
    }, safelyWith(async (input: { id: string; at?: number }) => jsonResult(await call("show", "show", input))));

    server.registerTool("posterract_check", {
      title: "Check video structure",
      description: "Run fast structural checks for empty spans, invisible elements, invalid durations, and failed sources.",
      inputSchema: z.object({ id: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async ({ id }: { id: string }) => jsonResult(await call("check", "check", { id }))));

    server.registerTool("posterract_capture", {
      title: "Capture video frames",
      description: "Render representative frames or contact sheets through the same composition path as export for visual inspection.",
      inputSchema: z.object({
        id: z.string().min(1),
        times: z.array(z.number().nonnegative()).optional(),
        combine: z.boolean().optional().default(true),
        perSheet: z.number().int().min(1).max(12).optional(),
      }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async ({ id, times, combine, perSheet }: { id: string; times?: number[]; combine: boolean; perSheet?: number }) => {
      const context = await call("capture", "context", { tree: false }) as { frameRate?: number };
      const fps = Number(context.frameRate) || 30;
      return imageResult(await call("capture", "capture", {
        id,
        frames: times?.map((time) => Math.round(time * fps)),
        combine,
        perSheet,
      }, RENDER_TIMEOUT_MS));
    }));

    server.registerTool("posterract_screenshot", {
      title: "Screenshot Posterract editor",
      description: "Capture the complete live editor window, including canvas, layers, inspector, and timeline.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    }, safely(async () => imageResult(await call("screenshot", "screenshot", undefined, RENDER_TIMEOUT_MS))));

    server.registerTool("posterract_media_probe", {
      title: "Probe media",
      description: "Read technical metadata for a local project media path without uploading it.",
      inputSchema: z.object({ path: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async ({ path }: { path: string }) => jsonResult(await call("media_probe", "media.probe", { path }))));

    // Generation on the user's plan, through the desktop app. An agent asks
    // for what it wants; the price, the balance and the provider call all
    // happen on the server, so a skill never handles a key and never has to
    // know what anything costs.
    server.registerTool("posterract_generate_image", {
      title: "Generate an image",
      description:
        "Generate an image into the open project on the user's Posterract plan. Returns the project-relative path, ready to use as a `src`. Costs credits; refuses with an upgrade message if the plan does not include generation.",
      inputSchema: z.object({
        prompt: z.string().min(1),
        resolution: z.enum(["1k", "2k"]).default("1k"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, safelyWith(async (input: { prompt: string; resolution?: "1k" | "2k" }) =>
      jsonResult(await call("generate_image", "ai.image", input, GENERATE_TIMEOUT_MS))));

    server.registerTool("posterract_generate_video", {
      title: "Generate a video clip",
      description:
        "Generate a video clip into the open project on the user's Posterract plan. 2k needs the Pro plan. Returns the project-relative path.",
      inputSchema: z.object({
        prompt: z.string().min(1),
        resolution: z.enum(["768p", "2k"]).default("768p"),
        durationSec: z.number().int().min(4).max(15).default(6),
        aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:3", "3:4"]).default("9:16"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, safelyWith(async (input: Record<string, unknown>) =>
      jsonResult(await call("generate_video", "ai.video", input, GENERATE_TIMEOUT_MS))));

    server.registerTool("posterract_generate_voice", {
      title: "Generate a voice track",
      description:
        "Speak text into an audio file in the open project on the user's Posterract plan. Returns the project-relative path.",
      inputSchema: z.object({
        text: z.string().min(1),
        voiceId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, safelyWith(async (input: { text: string; voiceId?: string }) =>
      jsonResult(await call("generate_voice", "ai.voice", input, GENERATE_TIMEOUT_MS))));

    server.registerTool("posterract_fetch", {
      title: "Fetch a video into the project",
      description:
        "Download a video or its audio from a URL into the open project's assets/video folder, using yt-dlp on this machine. Nothing is uploaded; the file lands in the project and the asset library picks it up. Requires yt-dlp on PATH.",
      inputSchema: z.object({
        url: z.string().min(1),
        /** Audio only, for a music bed or a voice track. */
        audio: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, safelyWith(async ({ url, audio }: { url: string; audio?: boolean }) => {
      const dir = projectDir();
      // Into the project's own media folder, named by the source's title, so
      // the library adopts it exactly as it would a dragged-in file.
      const paths = await fetchVideo(url, {
        audio,
        output: joinPath(dir, "assets", audio ? "audio" : "video", "%(title).80s.%(ext)s"),
      });
      return jsonResult({ paths });
    }));

    server.registerTool("posterract_media_transcribe", {
      title: "Transcribe media",
      description: "Transcribe a local project audio or video file to text with word timings, using the user's own transcription key. Nothing is uploaded except to the endpoint they configured; results are cached in the project by content hash.",
      inputSchema: z.object({ path: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async ({ path }: { path: string }) => jsonResult(await call("media_transcribe", "media.transcribe", { path }))));

    server.registerTool("posterract_media_grab", {
      title: "Grab media frames",
      description: "Decode specific or evenly sampled frames from local media and return them as vision-ready images.",
      inputSchema: z.object({
        path: z.string().min(1),
        times: z.array(z.number()).optional(),
        count: z.number().int().min(1).max(100).optional(),
        start: z.number().nonnegative().optional(),
        end: z.number().nonnegative().optional(),
        quality: z.enum(["small", "medium", "large", "fullres"]).optional(),
        auto: z.boolean().optional(),
        combine: z.boolean().optional().default(true),
        perSheet: z.number().int().min(1).max(12).optional(),
      }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async (input: Record<string, unknown>) => imageResult(await call("media_grab", "media.frame", input, RENDER_TIMEOUT_MS))));

    server.registerTool("posterract_media_filmstrip", {
      title: "Render media filmstrip",
      description: "Render a timestamped filmstrip for fast visual understanding of a local video.",
      inputSchema: z.object({ path: z.string(), start: z.number().nonnegative().optional(), end: z.number().nonnegative().optional(), scale: z.number().positive().optional() }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async (input: Record<string, unknown>) => imageResult(await call("media_filmstrip", "media.filmstrip", input, RENDER_TIMEOUT_MS))));

    server.registerTool("posterract_media_waveform", {
      title: "Render media waveform",
      description: "Render a timestamped audio waveform and report silent spans.",
      inputSchema: z.object({ path: z.string(), start: z.number().nonnegative().optional(), end: z.number().nonnegative().optional(), scale: z.number().positive().optional() }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async (input: Record<string, unknown>) => imageResult(await call("media_waveform", "media.waveform", input, RENDER_TIMEOUT_MS))));

    server.registerTool("posterract_export", {
      title: "Export local video",
      description: "Export one video to an explicit local path. This never uploads, posts, or schedules.",
      inputSchema: z.object({
        id: z.string().min(1),
        output: z.string().min(1),
        format: z.enum(["mp4", "webm", "ogg", "mov"]).optional(),
      }),
      annotations: { readOnlyHint: false },
    }, safelyWith(async (input: { id: string; output: string; format?: "mp4" | "webm" | "ogg" | "mov" }) =>
      jsonResult(await call("export", "export", input, RENDER_TIMEOUT_MS))));

    return server;
  }, {
    onerror: (error) => process.stderr.write(`[posterract-mcp] ${error.message}\n`),
  });

  await new Promise<void>((resolveEnd) => {
    if (process.stdin.readableEnded) resolveEnd();
    else {
      process.stdin.once("end", resolveEnd);
      process.stdin.once("close", resolveEnd);
    }
  });
  await handle.close().catch(() => {});
}
