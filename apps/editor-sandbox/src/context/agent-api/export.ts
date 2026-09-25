/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Computed, isScene } from "@posterract/video-runtime";
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { mainBridge } from "@/lib/ipc";
import { ElectronWritableFileHandle } from "@/lib/electron-file-writable";
import { renderOverlay, renderScene } from "@/context/render";
import { getDefaultExportTemplate } from "@/components/sidebar-right/inspector/export-templates";
import { resolveNode } from "./nodes";

import type { ExportProgress, ExportRequest, ExportResult } from "@posterract/cli/channels";
import type { EditorSession } from "./session";

function outputFormat(path: string, requested?: ExportRequest["format"]): ExportResult["format"] {
  if (requested) return requested;
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension === "mp4" || extension === "webm" || extension === "ogg" || extension === "mov") return extension;
  throw new Error("Export output must end in .mp4, .webm, .ogg, or .mov");
}

export function handleExport(session: () => EditorSession) {
  return async (request: ExportRequest): Promise<ExportResult> => {
    const { world, project, engine } = session();
    const scene = resolveNode(world, request.id);
    if (!isScene(scene)) throw new Error(`"${request.id}" is not an exportable scene`);

    const format = outputFormat(request.output, request.format);
    const authorized = await mainBridge.call(MAIN_CHANNELS.FILE_AUTHORIZE_CLI_EXPORT, {
      projectDir: project.dir(),
      path: request.output,
    });
    for (const [name, value] of [["from", request.from], ["to", request.to]] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`\`${name}\` is a time in seconds, 0 or more.`);
    }
    if (request.from !== undefined && request.to !== undefined && request.to <= request.from) {
      throw new Error(`\`to\` (${request.to}s) has to come after \`from\` (${request.from}s).`);
    }
    if (request.scale !== undefined && (!Number.isFinite(request.scale) || request.scale <= 0 || request.scale > 1)) {
      throw new Error("`scale` is a fraction of the scene's size: more than 0, at most 1.");
    }

    const defaults = getDefaultExportTemplate();
    // The encoder sizes its output by the shorter side (`resolution`); a scale is that, as a fraction of the scene's.
    const size = scene.get(Computed);
    const shorter = Math.min(size?.width ?? 0, size?.height ?? 0);
    const video = request.scale !== undefined && shorter > 0
      ? { ...defaults.video, resolution: Math.max(2, Math.round((shorter * request.scale) / 2) * 2) }
      : defaults.video;
    const config = {
      ...defaults,
      format,
      video: format === "ogg" ? { ...video, enabled: false } : video,
      audio: format === "webm" || format === "ogg" ? { ...defaults.audio, codec: "opus" as const } : defaults.audio,
    };
    const result = await renderScene(engine, {
      scene,
      target: new ElectronWritableFileHandle(authorized.path),
      config,
      dir: project.dir(),
      ...(request.from !== undefined || request.to !== undefined
        ? { range: { ...(request.from === undefined ? {} : { from: request.from }), ...(request.to === undefined ? {} : { to: request.to }) } }
        : {}),
    });
    if (result.type === "canceled") throw new Error("Export canceled");
    if (result.type === "error") throw result.error;
    return { path: authorized.path, format };
  };
}

/**
 * How far the render in flight has got. A render is one long request, and
 * whoever is waiting on it from a terminal has nothing to look at; this is the
 * same state the app's own progress overlay reads, asked for beside it.
 */
export function handleExportProgress() {
  return (): ExportProgress => {
    const state = renderOverlay();
    if (!state) return null;
    return {
      progress: state.progress,
      duration: state.duration,
      ...(state.remaining ? { remainingSeconds: state.remaining.minutes * 60 + state.remaining.seconds } : {}),
    };
  };
}
