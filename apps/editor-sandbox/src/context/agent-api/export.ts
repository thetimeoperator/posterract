/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { isScene } from "@posterract/video-runtime";
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { mainBridge } from "@/lib/ipc";
import { ElectronWritableFileHandle } from "@/lib/electron-file-writable";
import { renderScene } from "@/context/render";
import { getDefaultExportTemplate } from "@/components/sidebar-right/inspector/export-templates";
import { resolveNode } from "./nodes";

import type { ExportRequest, ExportResult } from "@posterract/cli/channels";
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
    const defaults = getDefaultExportTemplate();
    const config = {
      ...defaults,
      format,
      video: format === "ogg" ? { ...defaults.video, enabled: false } : defaults.video,
      audio: format === "webm" || format === "ogg" ? { ...defaults.audio, codec: "opus" as const } : defaults.audio,
    };
    const result = await renderScene(engine, {
      scene,
      target: new ElectronWritableFileHandle(authorized.path),
      config,
      dir: project.dir(),
    });
    if (result.type === "canceled") throw new Error("Export canceled");
    if (result.type === "error") throw result.error;
    return { path: authorized.path, format };
  };
}
