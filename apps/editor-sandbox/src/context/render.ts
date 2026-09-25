/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";
import { createEncoder, outputSize } from "@posterract/video-encoder";
import { Computed, FrameRate, Workarea } from "@posterract/video-runtime";

import { createCapture } from "@/engine/capture";
import { version } from "../../package.json";

import type { Entity } from "koota";
import type { EncoderConfig, ExportResult } from "@posterract/video-encoder";
import type { Capture } from "@/engine/capture";
import type { Engine } from "@/engine";
import type { ExportConfig } from "@/components/sidebar-right/inspector/export-progress";

/**
 * Unified scene render path, used by the UI export (`ExportProvider.exportScene`):
 * the "Exporting Composition" overlay, the engine stop/start lifecycle, the
 * capture world the encode runs against, progress reporting, and cancel wiring
 * all live in {@link renderScene}.
 */

export type RenderOverlayState = {
  config?: Partial<ExportConfig>;
  /** The size the file will have, px: the scene's shape at the chosen resolution. */
  size?: { width: number; height: number };
  duration: number;
  progress: number;
  remaining?: { minutes: number; seconds: number };
};

const [overlay, setOverlay] = createSignal<RenderOverlayState | null>(null);
let cancelActive: (() => void) | undefined;

/** Reactive overlay state; `null` when no render is in flight. Read by `<ExportProgress>`. */
export const renderOverlay = overlay;

/** Cancel the render currently in flight, if any. Wired to the overlay's Cancel button. */
export function cancelRender() {
  cancelActive?.();
}

export type RenderSceneOptions = {
  /** Scene entity to encode. */
  scene: Entity;
  /** Where to write the output (a save-picker handle in the UI, a file path handle from the CLI). */
  target: NonNullable<EncoderConfig["target"]>;
  /** Encoder settings (resolution, codecs, format, ...). */
  config?: Partial<EncoderConfig>;
  /** The project's folder, so the encode compiles the sources as they are now. */
  dir?: string;
  /**
   * Render only this stretch of the scene, in seconds of scene time, in place
   * of its work area. The encode runs against a world of its own (see
   * `createCapture`), so this touches nothing of the document's.
   */
  range?: { from?: number; to?: number };
};

export async function renderScene(
  engine: Engine,
  { scene, target, config, dir, range }: RenderSceneOptions,
): Promise<ExportResult> {
  const world = engine.world;

  const fps = world.get(FrameRate)?.value || 30;
  const workarea = scene.get(Workarea);
  const sceneFrames = scene.get(Computed)?.duration ?? 0;
  // What is rendered, in the document's frames: the stretch asked for, else the work area, else all of it.
  const firstFrame = range?.from !== undefined ? Math.round(range.from * fps) : (workarea?.start ?? 0);
  const lastFrame = range?.to !== undefined ? Math.round(range.to * fps) : (workarea?.end || sceneFrames);
  const frames = Math.max(0, Math.min(lastFrame, sceneFrames || lastFrame) - Math.max(0, firstFrame));
  const duration = frames / fps;

  cancelActive = undefined;
  const shape = scene.get(Computed);
  const size = shape?.width && shape?.height
    ? outputSize(shape.width, shape.height, config?.video?.resolution ?? 1080)
    : undefined;
  setOverlay({ config, ...(size ? { size: { width: size.width, height: size.height } } : {}), duration, progress: 0, remaining: undefined });

  engine.stop();

  let capture: Capture | undefined;
  try {
    capture = await createCapture(world, scene, {
      dir,
      frameRate: config?.video?.fps,
      mode: config?.video?.enabled === false || config?.format === "ogg" ? "offline-audio" : "offline-video",
    });

    if (range && (range.from !== undefined || range.to !== undefined)) {
      // The encoder renders the capture scene's work area. Its frames are the
      // capture world's, which may run at another rate than the document's.
      const captureFps = capture.world.get(FrameRate)?.value || fps;
      const total = capture.node.get(Computed)?.duration ?? 0;
      const start = Math.max(0, Math.round((range.from ?? 0) * captureFps));
      const end = range.to === undefined ? total : Math.min(total || Number.POSITIVE_INFINITY, Math.round(range.to * captureFps));
      if (end <= start) throw new Error(`Nothing to render between ${range.from ?? 0}s and ${range.to ?? "the end"}: the scene is ${(total / captureFps).toFixed(2)}s long.`);
      capture.node.add(Workarea);
      capture.node.set(Workarea, { start, end });
    }

    const encoder = await createEncoder(capture.world, {
      ...config,
      target,
      comment: `Made with Posterract v${version}`,
      onProgress(p) {
        const percent = Math.round((p.progress / p.total) * 100);
        setOverlay((prev) =>
          prev
            ? {
                ...prev,
                progress: percent,
                remaining: {
                  minutes: p.remaining.getUTCMinutes(),
                  seconds: p.remaining.getUTCSeconds(),
                },
              }
            : prev,
        );
      },
    });

    cancelActive = encoder.cancel;
    return await encoder.render();
  } finally {
    cancelActive = undefined;
    setOverlay(null);
    capture?.dispose();
    engine.start();
  }
}
