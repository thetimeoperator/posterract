/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { pickInformativeTimes } from './frame-triage';
import { composeSheet, planSheet, planSheetSizes, sheetTimecode } from '@posterract/video-encoder';
import { assert } from '@/utils';
import { filmstripAsset, formatTimecode, getAssetFile, getLibrary, transcodeForAnalysis, waveformAsset } from '@posterract/video-runtime';
import { AssetLibrary, assetName, isAbsoluteSource, isUrlSource } from '@posterract/video-assets';
import { createProjectFS } from '@/projects/fs';
import { ElectronWritableFileHandle } from '@/lib/electron-file-writable';
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';
import {
  AI_TRANSCRIBE_MAX_BYTES,
  AI_TRANSCRIBE_MAX_SECONDS,
  AI_TRANSCRIBE_NO_HOST_MESSAGE,
  AI_TRANSCRIBE_TIMEOUT_MS,
  AiBridgeError,
  aiRequest,
  hasAiHost,
} from '@/lib/ai-bridge';

import type { AiTranscriptionResult } from '@/lib/ai-bridge';
import type { Accessor } from 'solid-js';
import type { Asset } from '@posterract/video-assets';
import type { EditorSession } from './session';
import type { MediaExtractRequest, MediaExtractResult, MediaFrameRequest, MediaFrameResult, TimecodedImage, MediaProbeRequest, MediaFilmstripRequest, MediaFilmstripResult, MediaWaveformRequest, MediaWaveformResult } from "@posterract/cli/channels";
import type { StreamTargetChunk } from 'mediabunny';

type ResolveAsset = (path: string) => Promise<Asset>;

/**
 * Resolves a command target by path. With a project open, its library answers:
 * library paths look assets up, absolute paths and URLs are described in place
 * without being added (transient assets). With none open, a throwaway library
 * over a project-less FS describes absolute paths and URLs the same way — a
 * fresh one per request, so nothing is remembered between calls.
 */
export function createAssetResolver(session: Accessor<EditorSession | null>): ResolveAsset {
  return (path) => {
    const world = session()?.world;
    if (world) return getLibrary(world).resolve(path);
    assert(
      isAbsoluteSource(path) || isUrlSource(path),
      `Could not resolve "${path}": with no project mounted only absolute paths and URLs resolve — open a project in Posterract Desktop to use library paths.`,
    );
    return new AssetLibrary(createProjectFS("")).resolve(path);
  };
}

const PROBE_SAMPLE_PACKETS = 200;

export function handleMediaProbe(resolve: ResolveAsset) {
  return async (req: MediaProbeRequest): Promise<unknown> => {
    const asset = await resolve(req.path);

    const blob = await getAssetFile(asset);
    const base = {
      id: asset.id,
      name: assetName(asset),
      path: asset.path,
      type: asset.type,
      mimeType: asset.mimeType,
      size: blob.size,
      ...("width" in asset && { width: asset.width, height: asset.height }),
    };

    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
      const format = await input.getFormat();
      const mimeType = await input.getMimeType();
      const duration = await input.computeDuration();
      const { images, ...tags } = await input.getMetadataTags();
      delete tags.raw;

      const tracks: Array<Record<string, unknown>> = [];
      for (const track of await input.getTracks()) {
        const stats = await track.computePacketStats(PROBE_SAMPLE_PACKETS);
        tracks.push({
          id: track.id,
          type: track.type,
          codec: track.codec,
          language: track.languageCode,
          firstTimestamp: await track.getFirstTimestamp(),
          duration: await track.computeDuration(),
          ...stats,
          ...(track.isVideoTrack() && {
            codedWidth: track.codedWidth,
            codedHeight: track.codedHeight,
            displayWidth: track.displayWidth,
            displayHeight: track.displayHeight,
            rotation: track.rotation,
          }),
          ...(track.isAudioTrack() && {
            sampleRate: track.sampleRate,
            channels: track.numberOfChannels,
          }),
        });
      }

      return {
        ...base,
        format: format.name,
        mimeType,
        duration,
        tags: { ...tags, ...(images?.length && { attachedImages: images.length }) },
        tracks,
      };
    } catch {
      return { ...base, format: null, tracks: [] };
    } finally {
      input.dispose();
    }
  };
}

export function handleMediaExtract(resolve: ResolveAsset) {
  return async (req: MediaExtractRequest): Promise<MediaExtractResult> => {
    const asset = await resolve(req.path);
    assert(asset.type === "VIDEO" || asset.type === "AUDIO", `Asset ${asset.id} is not video or audio.`);
    const format = asset.type === "VIDEO" && !req.audioOnly ? "mp4" : "ogg";
    const authorized = await mainBridge.call(MAIN_CHANNELS.FILE_AUTHORIZE_CLI_MEDIA, {
      path: req.output,
      format,
    });
    const target = new ElectronWritableFileHandle(authorized.path);
    const { readable, run } = await transcodeForAnalysis(asset, {
      start: req.start,
      end: req.end,
      stripVideo: Boolean(req.audioOnly),
    });
    let position = 0;
    const positioned = new TransformStream<Uint8Array<ArrayBuffer>, StreamTargetChunk>({
      transform(chunk, controller) {
        controller.enqueue({ type: "write", data: chunk, position });
        position += chunk.byteLength;
      },
    });
    try {
      const writable = await target.createWritable();
      await Promise.all([run(), readable.pipeThrough(positioned).pipeTo(writable)]);
      return { path: authorized.path, format };
    } catch (error) {
      await target.dispose().catch(() => undefined);
      throw error;
    }
  };
}

// Named quality presets mapped to a per-frame total-pixel budget (aspect ratio
// preserved). A budget of 0 means native resolution. `small` keeps frames small
// enough for vision models and is the default.
const FRAME_QUALITY_BUDGETS = {
  small: 384 * 384,    // 147,456
  medium: 768 * 768,   // 589,824
  large: 1536 * 1536,  // 2,359,296
  fullres: 0,          // native
} as const;

// Default cap on frames returned by auto selection when `count` is not given.
const AUTO_MAX_FRAMES = 30;

export function handleMediaFrame(resolve: ResolveAsset) {
  return async (req: MediaFrameRequest): Promise<MediaFrameResult> => {
    const { times, count, start, end, quality, auto } = req;
    const combine = req.combine ?? true;
    const asset = await resolve(req.path);
    const id = asset.id;
    assert(asset.type === "VIDEO", `Asset ${id} is not a video.`);

    // `count` samples evenly across a window (default the whole clip); `auto`
    // scans the window and keeps frames where the footage settles into a new
    // visual state, capped at `count` (resolved once the track is open).
    // Otherwise grab the explicit `times` (falling back to a single frame at 0).
    const from = Math.min(Math.max(start ?? 0, 0), asset.duration);
    const to = Math.min(Math.max(end ?? asset.duration, from), asset.duration);
    let requested: number[] = [];
    if (auto || count !== undefined) {
      assert(to > from, `The requested window is empty; start (${from.toFixed(2)}s) is at or past end (${to.toFixed(2)}s).`);
      if (!auto && count !== undefined) {
        const interval = (to - from) / count;
        requested = Array.from({ length: count }, (_, i) => from + i * interval);
      }
    } else {
      const raw = times && times.length ? times : [0];
      // A negative time is an offset back from the end of the clip: -1 is one
      // second before the end, -1f one frame before it.
      requested = raw.map((t) => {
        if (t >= 0) {
          assert(t <= asset.duration, `--time ${t}s is past the asset's duration (${asset.duration.toFixed(2)}s).`);
          return t;
        }
        const resolved = asset.duration + t;
        assert(resolved >= 0, `--time ${t} counts past the start of the clip (duration ${asset.duration.toFixed(2)}s).`);
        return resolved;
      });
    }

    const budget = FRAME_QUALITY_BUDGETS[quality ?? (combine ? "fullres" : "small")];

    const blob = await getAssetFile(asset);
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
      const track = await input.getPrimaryVideoTrack();
      assert(track, `Asset ${id} has no video track.`);

      // Track timestamps may not start at 0; offset content time by the first.
      const firstTimestamp = (await track.getFirstTimestamp()) ?? 0;

      if (auto) {
        const picked = await pickInformativeTimes(track, {
          from: firstTimestamp + from,
          to: firstTimestamp + to,
          max: count ?? AUTO_MAX_FRAMES,
        });
        requested = picked.map((t) => Math.max(0, t - firstTimestamp));
      }

      // Downscale to fit the pixel budget while preserving aspect ratio; setting
      // only the width lets the sink derive a matching height.
      const displayWidth = await track.getDisplayWidth();
      const displayHeight = await track.getDisplayHeight();
      let sourceWidth = displayWidth;
      let sourceHeight = displayHeight;
      if (budget > 0 && displayWidth * displayHeight > budget) {
        const scale = Math.sqrt(budget / (displayWidth * displayHeight));
        sourceWidth = Math.max(1, Math.round(displayWidth * scale));
        sourceHeight = Math.max(1, Math.round(displayHeight * scale));
      }

      // Lay the sheets out up front: the largest cell across them sets the
      // decode size, so no frame is decoded bigger than it will be drawn.
      const sizes = combine ? planSheetSizes(requested.length, req.perSheet) : [];
      const plans = sizes.map((n) => planSheet(n, { width: sourceWidth, height: sourceHeight }));
      const width = combine
        ? Math.min(sourceWidth, Math.max(...plans.map((plan) => plan.cellWidth)))
        : sourceWidth;

      // Decode in ascending order (the sink's fast path), remember each
      // entry's original slot so output mirrors the requested order.
      const ordered = requested.map((time, index) => ({ time, index })).sort((a, b) => a.time - b.time);

      // No pool: each yielded canvas is fresh, so converting to PNG can't race
      // the generator's read-ahead reusing a pooled canvas.
      const sink = new CanvasSink(track, width < displayWidth ? { width } : undefined);
      const timestamps = ordered.map(({ time }) => firstTimestamp + time);

      // Which sheet each frame belongs to, and where that sheet starts.
      const sheetOf: number[] = [];
      const sheetStart: number[] = [];
      for (const [sheet, size] of sizes.entries()) {
        sheetStart.push(sheetOf.length);
        for (let k = 0; k < size; k++) sheetOf.push(sheet);
      }
      const missing = [...sizes];

      const cells: Array<{ at: number; timecode: string }> = new Array(requested.length);
      const canvases: Array<CanvasImageSource | undefined> = new Array(requested.length);
      const result: TimecodedImage[] = new Array(combine ? sizes.length : requested.length);

      let i = 0;
      for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
        const { time, index } = ordered[i++];
        assert(wrapped, `No frame found at ${time}s.`);
        const timecode = formatTimecode(time, asset.frameRate);
        cells[index] = { at: time, timecode };

        if (!combine) {
          result[index] = { timecode, base64: await canvasToPngBase64(wrapped.canvas) };
          continue;
        }

        // Compose a sheet as soon as its last frame lands and drop the
        // canvases, so a long run never holds every decoded frame at once.
        canvases[index] = wrapped.canvas;
        const sheet = sheetOf[index];
        if (--missing[sheet] > 0) continue;

        const from = sheetStart[sheet];
        const to = from + sizes[sheet];
        result[sheet] = {
          timecode: sheetTimecode(cells.slice(from, to)),
          base64: await composeSheet(
            canvases.slice(from, to).map((canvas, k) => ({ image: canvas!, label: cells[from + k].timecode })),
            plans[sheet],
          ),
        };
        for (let k = from; k < to; k++) canvases[k] = undefined;
      }

      return result;
    } finally {
      input.dispose();
    }
  };
}

export function handleMediaFilmstrip(resolve: ResolveAsset) {
  return async (req: MediaFilmstripRequest): Promise<MediaFilmstripResult> => {
    const asset = await resolve(req.path);
    const { dataUrl, ...rest } = await filmstripAsset(asset, { start: req.start, end: req.end, scale: req.scale });
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return { base64, ...rest };
  };
}

export function handleMediaWaveform(resolve: ResolveAsset) {
  return async (req: MediaWaveformRequest): Promise<MediaWaveformResult> => {
    const asset = await resolve(req.path);
    const { dataUrl, ...rest } = await waveformAsset(asset, { start: req.start, end: req.end, scale: req.scale });
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return { base64, ...rest };
  };
}

/**
 * `media.transcribe`: the one agent-facing endpoint that leaves the machine.
 * Everything else here reads local bytes; this one hands them to the app shell,
 * which is where the workspace's credentials and credit balance live. The
 * editor holds neither, so with no shell above it (standalone dev server, plain
 * browser tab) the only honest answer is to say so.
 */
export type MediaTranscribeRequest = { path: string; durationSec?: number };
export type MediaTranscribeResult = AiTranscriptionResult;

export function handleMediaTranscribe(resolve: ResolveAsset) {
  return async (req: MediaTranscribeRequest): Promise<MediaTranscribeResult> => {
    const asset = await resolve(req.path);
    assert(
      asset.type === 'VIDEO' || asset.type === 'AUDIO',
      `Asset ${asset.id} is ${asset.type}; transcription needs a video or audio file.`,
    );

    const file = await getAssetFile(asset);
    assert(
      file.size <= AI_TRANSCRIBE_MAX_BYTES,
      `${assetName(asset)} is ${(file.size / 1_048_576).toFixed(1)} MB and transcription accepts at most ` +
        `${AI_TRANSCRIBE_MAX_BYTES / 1_048_576} MB. Extract a shorter span or an audio-only file first ` +
        `(posterract media extract --audio-only) and transcribe that instead.`,
    );

    // The library already probed this asset when it resolved it, so its
    // duration is normally right there; fall back to decoding the container
    // only when it is missing (a transient path that probed as 0).
    const declared = req.durationSec ?? asset.duration;
    const seconds = Number.isFinite(declared) && declared > 0 ? declared : await probeDuration(file);
    assert(
      Number.isFinite(seconds) && seconds > 0,
      `Could not work out how long ${assetName(asset)} is; pass durationSec explicitly.`,
    );
    assert(
      seconds <= AI_TRANSCRIBE_MAX_SECONDS,
      `${assetName(asset)} runs ${Math.round(seconds)}s; transcription accepts at most ` +
        `${AI_TRANSCRIBE_MAX_SECONDS}s. Extract a shorter span and transcribe that instead.`,
    );
    // Whole seconds, as the endpoint's validator requires; it prices by
    // started minute, so rounding up never under-charges the account.
    const durationSec = Math.max(1, Math.ceil(seconds));

    if (!hasAiHost()) throw new Error(AI_TRANSCRIBE_NO_HOST_MESSAGE);

    try {
      return await aiRequest<MediaTranscribeResult>(
        'transcribe',
        {
          fileName: assetName(asset),
          mimeType: asset.mimeType || file.type || 'application/octet-stream',
          durationSec,
          bytes: await file.arrayBuffer(),
        },
        AI_TRANSCRIBE_TIMEOUT_MS,
      );
    } catch (error) {
      throw transcribeFailure(error);
    }
  };
}

/** The wire failure as something an agent can act on, never a raw bridge object. */
function transcribeFailure(error: unknown): Error {
  if (!(error instanceof AiBridgeError)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  if (error.timedOut) {
    return new Error(
      `The Posterract app did not answer within ${Math.round(AI_TRANSCRIBE_TIMEOUT_MS / 60_000)} minutes. ` +
        'Check that the app is signed in, or transcribe a shorter span.',
    );
  }
  if (error.insufficientCredits) {
    return new Error(
      error.needed !== undefined && error.balance !== undefined
        ? `Not enough AI credits: this transcription costs ${error.needed} cr and the workspace has ${error.balance} cr.`
        : 'Not enough AI credits to transcribe this media.',
    );
  }
  return new Error(error.message);
}

async function probeDuration(blob: Blob): Promise<number> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    return await input.computeDuration();
  } catch {
    return 0;
  } finally {
    input.dispose();
  }
}

async function canvasToPngBase64(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<string> {
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return base64FromArrayBuffer(await blob.arrayBuffer());
  }
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

function base64FromArrayBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
