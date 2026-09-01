/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { version } from "../package.json";
import { readLocalControlSession, requestProjectControl, resolveProjectDir } from "./project-control";

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

function jsonResult(value: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: record(value),
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

export async function servePosterractMcp(explicitProjectDir?: string): Promise<void> {
  const projectDir = () => resolveProjectDir(explicitProjectDir);
  const call = async (tool: string, path: string, input: unknown = undefined, timeoutMs = DEFAULT_TIMEOUT_MS) => {
    const activeProjectDir = projectDir();
    return requestProjectControl(
      activeProjectDir,
      { path, input },
      timeoutMs,
      { cliVersion: version, command: `mcp:${tool}`, projectDir: activeProjectDir, invokedAt: Date.now() },
    );
  };
  const safely = (fn: () => Promise<ToolResult>) => async () => {
    try { return await fn(); } catch (error) { return errorResult(error); }
  };
  const safelyWith = <T>(fn: (value: T) => Promise<ToolResult>) => async (value: T) => {
    try { return await fn(value); } catch (error) { return errorResult(error); }
  };

  const handle = serveStdio(() => {
    const server = new McpServer(
      { name: "posterract", version },
      {
        instructions:
          "Control the open Posterract composition through its local project. Read context and source before editing. " +
          "Use revision-safe source writes or semantic canvas tools, validate after meaningful edits, and inspect captures before claiming visual success. " +
          "Export only when the user asks. This server cannot post, schedule, or access social credentials.",
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
      description: "Read active video, playhead, source revision, variables, fonts, and optionally the complete runtime node tree.",
      inputSchema: z.object({ tree: z.boolean().optional().default(true) }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async ({ tree }: { tree: boolean }) => jsonResult(await call("get_context", "context", { tree }))));

    server.registerTool("posterract_read_source", {
      title: "Read composition source",
      description:
        "Read a local Posterract TSX source file and its conflict-safe revision ID. " +
        "The default path \"auto\" resolves to the project's actual entry file (src/index.tsx, index.tsx, ...), " +
        "which some migrated projects keep at the project root; the result reports the resolved path.",
      inputSchema: z.object({ path: z.string().min(1).default("auto") }),
      annotations: { readOnlyHint: true },
    }, safelyWith(async ({ path }: { path: string }) => jsonResult(await call("read_source", "source.read", { path }))));

    server.registerTool("posterract_write_source", {
      title: "Write composition source",
      description: "Atomically replace a Posterract TSX source file only if its revision still matches. Returns compiler diagnostics.",
      inputSchema: z.object({
        path: z.string().min(1).default("src/index.tsx"),
        content: z.string(),
        expectedRevisionId: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: { path: string; content: string; expectedRevisionId: string }) =>
      jsonResult(await call("write_source", "source.write", input))));

    server.registerTool("posterract_validate", {
      title: "Validate composition",
      description:
        "Compile and evaluate the project's composition sources in memory and report diagnostics. " +
        "Genuinely read-only: stable-ID stamping runs on an in-memory copy, nothing is written to disk, and the live canvas is untouched.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    }, safely(async () => jsonResult(await call("validate", "validate"))));

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

    server.registerTool("posterract_set_properties", {
      title: "Set element properties",
      description: "Apply source-backed properties such as position, size, timing, opacity, rotation, volume, and styles to a stable element ID.",
      inputSchema: z.object({ id: z.string().min(1), properties: z.record(z.string(), z.any()) }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: { id: string; properties: Record<string, unknown> }) =>
      jsonResult(await call("set_properties", "canvas.setProperties", input))));

    server.registerTool("posterract_set_text", {
      title: "Set text content",
      description: "Replace the source-backed text content of a text element.",
      inputSchema: z.object({ id: z.string().min(1), text: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: { id: string; text: string }) => jsonResult(await call("set_text", "canvas.setText", input))));

    server.registerTool("posterract_create_element", {
      title: "Create composition element",
      description: "Insert a new Posterract element tree under a source-backed parent and select it on the live canvas.",
      inputSchema: z.object({
        parentId: z.string().min(1),
        beforeId: z.string().optional(),
        element: z.object({
          tag: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
          props: z.record(z.string(), z.any()).optional(),
          text: z.string().optional(),
          children: z.array(z.any()).optional(),
        }),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: Record<string, unknown>) => jsonResult(await call("create_element", "canvas.create", input))));

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
      inputSchema: z.object({ ids: z.array(z.string()).min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, safelyWith(async (input: { ids: string[] }) => jsonResult(await call("delete", "canvas.remove", input))));

    server.registerTool("posterract_move", {
      title: "Move element",
      description: "Move an element under another source-backed parent, optionally before a sibling.",
      inputSchema: z.object({ id: z.string(), parentId: z.string(), beforeId: z.string().optional() }),
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

    server.registerTool("posterract_media_transcribe", {
      title: "Transcribe media",
      description:
        "Transcribe the speech in a project video or audio asset through the connected Posterract account. " +
        "Returns segments with word-level timestamps in seconds, ready to drive captions or an edit. " +
        "Unlike the other media tools this one uploads the file and spends AI credits (1 credit per started minute), " +
        "so it needs Posterract Desktop with a signed-in workspace. Files must be 25 MB or smaller: " +
        "for anything larger, extract a shorter span or an audio-only file first and transcribe that.",
      inputSchema: z.object({
        path: z.string().min(1),
        durationSec: z.number().positive().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    }, safelyWith(async (input: { path: string; durationSec?: number }) =>
      jsonResult(await call("media_transcribe", "media.transcribe", input, RENDER_TIMEOUT_MS))));

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
