#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Command } from "commander";
import { version } from "../package.json";
import { parseTime, TIME_FPS } from "@posterract/composition";
import { editor, errnoCode, GENERATE_TIMEOUT_MS, usingEngine, waitForCliSocket } from "./cli-client";
import { listLocalFonts } from "./fonts";
import { createDiagnosticZip, sanitize } from "./report";
import { fetchVideo } from "./ytdlp";
import { CLI_PROTOCOL_VERSION, MAX_FRAMES_PER_SHEET } from "./protocol";
import { servePosterractMcp } from "./mcp";
import { formatInspect, formatLook, type InspectResult, type LookResult } from "./format";
import { createEditFeedback, fileStore, type EditFeedback } from "./edit-feedback";
import { offline } from "./offline-loader";
import { resolveProjectDir } from "./project-control";
import { outputPathFor, readBatchRows, type BatchRow } from "./batch";
import type { AssetRef, CheckIssue, FrameQuality, LogEntry, LogLevel, TimecodedImage } from "./protocol";
import type { ExportProgress } from "./cli-channels";

// Captures and exports can legitimately exceed the interactive timeout.
const LONG_RUNNING = { context: { timeoutMs: GENERATE_TIMEOUT_MS } };

const APP_NAME = "Posterract";

/**
 * What is newly wrong with the video since this agent last heard, said on
 * stderr after whatever it ran (see ./edit-feedback). An agent that works from
 * a terminal edits the file with its own tools and then runs *something* here;
 * that is when it hears. Stdout is left alone: it may be JSON someone parses.
 */
let editFeedback: EditFeedback | undefined;
function feedback(): EditFeedback | undefined {
  if (editFeedback) return editFeedback;
  let dir: string;
  try {
    dir = resolveProjectDir(undefined, { here: true });
  } catch {
    return undefined;
  }
  editFeedback = createEditFeedback({
    projectDir: () => dir,
    store: fileStore(dir),
    lint: (projectDir) => offline().lint(projectDir, projectDir).lines,
    inspect: async (projectDir) => {
      // From whoever is already up — the app, or an engine this command started. A note is not worth starting one for.
      const before = process.env.POSTERRACT_NO_ENGINE;
      if (!usingEngine()) process.env.POSTERRACT_NO_ENGINE = "1";
      try {
        for (let waited = 0; waited < 3_000; waited += 150) {
          const context = await editor.context.query({ tree: false }) as { sourceRevision?: string | null; shownRevision?: string | null };
          if (!context.shownRevision || context.shownRevision === context.sourceRevision) break;
          await new Promise((done) => setTimeout(done, 150));
        }
        const scenes = offline().outline(projectDir, projectDir).entries.filter((entry) => entry.tag === "scene" && entry.id && entry.depth <= 1);
        const results: InspectResult[] = [];
        for (const scene of scenes) results.push(await editor.inspect.query({ id: scene.id }, LONG_RUNNING) as InspectResult);
        return results;
      } finally {
        if (before === undefined) delete process.env.POSTERRACT_NO_ENGINE;
        else process.env.POSTERRACT_NO_ENGINE = before;
      }
    },
  });
  return editFeedback;
}

/** The commands an agent runs while it works on a video. The checks themselves (`inspect`, `lint`, `validate`) say their own findings. */
const FEEDBACK_AFTER = new Set([
  "outline", "read", "look", "show", "geometry", "changes", "context", "check", "capture",
  "set", "text", "create", "move", "delete", "duplicate", "apply", "undo", "redo",
]);

function handleSocketError(e: unknown): never {
  const code = errnoCode(e);
  if (code === "ENOENT" || code === "ECONNREFUSED") {
    console.error(`${APP_NAME} is not running. Launch the app first, then retry.`);
  } else {
    console.error((e as Error).message);
  }
  process.exit(1);
}

const FRAME_QUALITIES: FrameQuality[] = ["small", "medium", "large", "fullres"];

// Guardrail against accidentally decoding a huge number of frames; --uncapped lifts it.
const FRAME_CAP = 100;

type MediaFrameOptions = {
  time?: string[];
  count?: string;
  start?: string;
  end?: string;
  quality?: string;
  uncapped?: boolean;
  output?: string;
  auto?: boolean;
  separate?: boolean;
  perSheet?: string;
};

async function mediaFrame(ref: string, opts: MediaFrameOptions): Promise<void> {
  if (opts.time !== undefined && opts.count !== undefined) {
    console.error("Pass either --time or --count, not both.");
    process.exit(1);
  }
  if (opts.auto && opts.time !== undefined) {
    console.error("--auto picks its own timestamps; it cannot be combined with --time.");
    process.exit(1);
  }

  let times: number[] | undefined;
  if (opts.time !== undefined) {
    times = opts.time.map((t) => parseTimeArg(t, "--time", true));
  }

  let count: number | undefined;
  if (opts.count !== undefined) {
    count = Number(opts.count);
    if (!Number.isInteger(count) || count < 1) {
      console.error(`--count must be a positive integer (got "${opts.count}")`);
      process.exit(1);
    }
  }

  const start = opts.start !== undefined ? parseTimeArg(opts.start, "--start") : undefined;
  const end = opts.end !== undefined ? parseTimeArg(opts.end, "--end") : undefined;
  if (start !== undefined && end !== undefined && start >= end) {
    console.error(`--start (${start}s) must be less than --end (${end}s).`);
    process.exit(1);
  }
  if ((start !== undefined || end !== undefined) && count === undefined && !opts.auto) {
    console.error("--start and --end only apply together with --count or --auto.");
    process.exit(1);
  }

  const requested = count ?? times?.length ?? 1;
  if (!opts.uncapped && requested > FRAME_CAP) {
    console.error(`Grabbing ${requested} frames exceeds the ${FRAME_CAP}-frame cap; pass --uncapped to override.`);
    process.exit(1);
  }

  let quality: FrameQuality | undefined;
  if (opts.quality !== undefined) {
    if (!FRAME_QUALITIES.includes(opts.quality as FrameQuality)) {
      console.error(`--quality must be one of ${FRAME_QUALITIES.join(", ")} (got "${opts.quality}")`);
      process.exit(1);
    }
    quality = opts.quality as FrameQuality;
  }

  const perSheet = parsePerSheet(opts.perSheet, opts.separate);
  const target = resolveAssetRef(ref);
  const dir = opts.output ?? join(tmpdir(), `posterract-grab-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  try {
    const images = await editor.media.frame.query({
      ...target,
      times,
      count,
      start,
      end,
      quality,
      auto: opts.auto,
      combine: !opts.separate,
      perSheet,
    });
    writeImages(images, dir);
  } catch (e) {
    handleSocketError(e);
  }
}

/**
 * A local file (or frames folder) that exists is sent as its absolute path;
 * anything else — a URL, or a library path (`b-roll/clip.mp4`) — is passed
 * through for the app to resolve. Library paths need an open project.
 */
function resolveAssetRef(ref: string): AssetRef {
  const absPath = isAbsolute(ref) ? ref : resolve(process.cwd(), ref);
  if (existsSync(absPath)) return { path: absPath };
  if (isAbsolute(ref)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }
  return { path: ref };
}

async function mediaProbe(ref: string): Promise<void> {
  const target = resolveAssetRef(ref);
  const stop = startSpinner("Probing asset");
  try {
    const result = await editor.media.probe.query(target);
    stop();
    console.log(JSON.stringify(result));
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

type MediaPreviewOptions = { start?: string; end?: string; scale?: string; output?: string };

function parseTimeArg(value: string, flag: string, allowNegative = false): number {
  const seconds = parseTime(value);
  if (seconds === undefined || (!allowNegative && seconds < 0)) {
    console.error(
      `${flag} must be a ${allowNegative ? "" : "non-negative "}Time — seconds ("1.5"), frames ("45f"), or "MM:SS" (got "${value}")`,
    );
    process.exit(1);
  }
  return seconds;
}

// Frames and contact sheets arrive in the same shape: the app stamps each
// image with its timecode (`08s10f`, or `0f-08s10f` for a sheet), which is the
// filename too.
function writeImages(images: TimecodedImage[], dir: string): void {
  for (const { timecode, base64 } of images) {
    const path = join(dir, `${timecode}.png`);
    writeFileSync(path, Buffer.from(base64, "base64"));
    console.log(JSON.stringify({ timecode, path }));
  }
}

function parsePerSheet(value: string | undefined, separate?: boolean): number | undefined {
  if (value === undefined) return undefined;
  if (separate) {
    console.error("--per-sheet lays out contact sheets; it cannot be combined with --separate.");
    process.exit(1);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_FRAMES_PER_SHEET) {
    console.error(`--per-sheet must be an integer between 1 and ${MAX_FRAMES_PER_SHEET} (got "${value}")`);
    process.exit(1);
  }
  return n;
}

// Parse the window/scale flags shared by `filmstrip` and `waveform`.
function parsePreviewWindow(opts: MediaPreviewOptions): { start?: number; end?: number; scale?: number } {
  const start = opts.start !== undefined ? parseTimeArg(opts.start, "--start") : undefined;
  const end = opts.end !== undefined ? parseTimeArg(opts.end, "--end") : undefined;
  if (start !== undefined && end !== undefined && start >= end) {
    console.error(`--start (${start}s) must be less than --end (${end}s).`);
    process.exit(1);
  }

  let scale: number | undefined;
  if (opts.scale !== undefined) {
    scale = Number(opts.scale);
    if (!Number.isFinite(scale) || scale <= 0) {
      console.error(`--scale must be a positive number (got "${opts.scale}")`);
      process.exit(1);
    }
  }

  return { start, end, scale };
}

async function mediaFilmstrip(ref: string, opts: MediaPreviewOptions): Promise<void> {
  const { start, end, scale } = parsePreviewWindow(opts);
  const target = resolveAssetRef(ref);
  const path = opts.output ?? join(tmpdir(), `${randomUUID()}.png`);
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const stop = startSpinner("Rendering filmstrip");
  try {
    const { base64, ...rest } = await editor.media.filmstrip.query({ ...target, start, end, scale });
    stop();
    writeFileSync(path, Buffer.from(base64, "base64"));
    console.log(JSON.stringify({ path, ...rest }));
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

async function mediaWaveform(ref: string, opts: MediaPreviewOptions): Promise<void> {
  const { start, end, scale } = parsePreviewWindow(opts);
  const target = resolveAssetRef(ref);
  const path = opts.output ?? join(tmpdir(), `${randomUUID()}.png`);
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const stop = startSpinner("Rendering waveform");
  try {
    const { base64, ...rest } = await editor.media.waveform.query({ ...target, start, end, scale });
    stop();
    writeFileSync(path, Buffer.from(base64, "base64"));
    console.log(JSON.stringify({ path, ...rest }));
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

type MediaExtractOptions = { start?: string; end?: string; audioOnly?: boolean; output: string };

async function mediaExtract(ref: string, opts: MediaExtractOptions): Promise<void> {
  const start = opts.start !== undefined ? parseTimeArg(opts.start, "--start") : undefined;
  const end = opts.end !== undefined ? parseTimeArg(opts.end, "--end") : undefined;
  if (start !== undefined && end !== undefined && start >= end) {
    console.error(`--start (${start}s) must be less than --end (${end}s).`);
    process.exit(1);
  }
  try {
    const result = await editor.media.extract.query(
      { ...resolveAssetRef(ref), output: resolve(opts.output), start, end, audioOnly: Boolean(opts.audioOnly) },
      LONG_RUNNING,
    );
    console.log(JSON.stringify(result));
  } catch (error) {
    handleSocketError(error);
  }
}

type CaptureOptions = { time?: string[]; output?: string; separate?: boolean; perSheet?: string };

async function captureNode(id: string, opts: CaptureOptions): Promise<void> {
  const times = (opts.time ?? ["0"]).map((t) => parseTimeArg(t, "--time"));
  const frames = times.map((t) => Math.round(t * TIME_FPS));
  const perSheet = parsePerSheet(opts.perSheet, opts.separate);

  const dir = opts.output ?? join(tmpdir(), `posterract-capture-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  try {
    const images = await editor.capture.query(
      { id, frames, combine: !opts.separate, perSheet },
      LONG_RUNNING,
    );
    writeImages(images, dir);
  } catch (e) {
    handleSocketError(e);
  }
}

async function checkNode(id: string, _options: { json?: boolean } = {}): Promise<void> {
  try {
    const result = await editor.check.query({ id });
    console.log(JSON.stringify(result));
    // Linter convention: issues found is a different failure than "could not run".
    if (result.issues.some((issue: CheckIssue) => issue.severity === "error")) process.exitCode = 1;
  } catch (e) {
    handleSocketError(e);
  }
}

type ExportOptions = { output: string; format?: string; from?: string; to?: string; scale?: string; json?: boolean };

/**
 * Says how far a render has got, on stderr, while the one long request that is
 * the render is pending. On a terminal it is one line that updates; piped — an
 * agent reading the output — it is a line every ten percent, because a progress
 * bar's worth of carriage returns is noise in a transcript. Returns what stops it.
 */
function showRenderProgress(): () => void {
  const live = Boolean(process.stderr.isTTY);
  let said = -1;
  let drew = false;
  const timer = setInterval(() => {
    void editor.exportProgress.query().then((state: ExportProgress) => {
      if (!state) return;
      const percent = Math.max(0, Math.min(100, Math.round(state.progress)));
      const left = state.remainingSeconds === undefined ? "" : ` · ${Math.floor(state.remainingSeconds / 60)}:${String(state.remainingSeconds % 60).padStart(2, "0")} left`;
      if (live) {
        process.stderr.write(`\rrendering ${String(percent).padStart(3)}%${left}   `);
        drew = true;
      } else if (Math.floor(percent / 10) > Math.floor(said / 10)) {
        process.stderr.write(`rendering ${percent}%${left}\n`);
      }
      said = percent;
    }).catch(() => undefined);
  }, 1_000);
  return () => {
    clearInterval(timer);
    if (drew) process.stderr.write("\r\u001b[K");
  };
}

/** `--from 2 --to 5.5 --scale 0.5` as the request spells them, or exits saying what is wrong. */
function renderRange(opts: ExportOptions): { from?: number; to?: number; scale?: number } {
  const range: { from?: number; to?: number; scale?: number } = {};
  if (opts.from !== undefined) range.from = parseTimeArg(opts.from, "--from");
  if (opts.to !== undefined) range.to = parseTimeArg(opts.to, "--to");
  if (opts.scale !== undefined) {
    const scale = Number(opts.scale);
    if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
      console.error(`--scale is a fraction of the scene's size, more than 0 and at most 1 (got "${opts.scale}")`);
      process.exit(1);
    }
    range.scale = scale;
  }
  return range;
}

async function exportScene(id: string, opts: ExportOptions): Promise<void> {
  const allowed = ["mp4", "webm", "ogg", "mov"] as const;
  if (opts.format !== undefined && !allowed.includes(opts.format as (typeof allowed)[number])) {
    console.error(`--format must be one of ${allowed.join(", ")} (got "${opts.format}")`);
    process.exit(1);
  }
  const range = renderRange(opts);
  const started = Date.now();
  const stop = showRenderProgress();
  try {
    const result = await editor.export.query(
      {
        id,
        output: resolve(opts.output),
        format: opts.format as (typeof allowed)[number] | undefined,
        ...range,
      },
      LONG_RUNNING,
    );
    stop();
    if (opts.json) console.log(JSON.stringify(result));
    else console.log(`✓ ${result.path} · ${((Date.now() - started) / 1000).toFixed(1)}s${usingEngine() ? " · rendered by the engine (the app was not open)" : ""}`);
  } catch (error) {
    stop();
    handleSocketError(error);
  }
}

/**
 * `render` is `export` for someone who has a file and wants a video: the scene
 * can be left out when the project has one, and the project is the folder the
 * command is run in. A file that holds several videos has to say which.
 */
async function renderCommand(scene: string | undefined, opts: ExportOptions & { project?: string }): Promise<void> {
  let id = scene;
  if (id === undefined) {
    try {
      const projectDir = opts.project ? resolve(opts.project) : resolveProjectDir(undefined, { here: true });
      const scenes = offline().outline(projectDir, projectDir).entries.filter((entry) => entry.tag === "scene" && entry.id);
      if (scenes.length !== 1) {
        console.error(
          scenes.length
            ? `This project holds ${scenes.length} videos. Say which to render: ${scenes.map((entry) => entry.id).join(", ")}.`
            : "No <scene> with an id in this project's entry file: there is nothing to render.",
        );
        process.exit(1);
      }
      id = scenes[0]!.id!;
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }
  }
  if (opts.project) process.chdir(resolve(opts.project));
  return exportScene(id, opts);
}

type BatchOptions = { data: string; output: string; format?: string; file?: string };

/**
 * One render per row of a data file.
 *
 * A project is code with named inspector variables, so a spreadsheet is
 * already a list of takes. Each row sets the variables whose names match its
 * columns and exports; anything the project does not declare is skipped with a
 * note rather than failing the run, because a data file usually carries
 * columns for other purposes too.
 *
 * Sequential by design: the encoder owns the GPU, so two at once is slower
 * than one after another and far harder to read when one fails.
 */
async function batchExport(id: string, opts: BatchOptions): Promise<void> {
  let rows: BatchRow[];
  try {
    rows = readBatchRows(opts.data);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  if (!rows.length) {
    console.error(`${opts.data} has no rows.`);
    process.exit(1);
  }

  let context: { variables?: Array<{ file: string; name: string }> };
  try {
    context = await editor.context.query({ tree: false }) as typeof context;
  } catch (error) {
    handleSocketError(error);
  }
  const declared = new Map((context!.variables ?? []).map((entry) => [entry.name, entry.file]));
  if (!declared.size) {
    console.error("This project declares no @inspect variables, so a data file has nothing to set.");
    process.exit(1);
  }

  const unknown = [...new Set(rows.flatMap(Object.keys))].filter((name) => !declared.has(name));
  if (unknown.length) {
    console.error(`Ignoring columns the project does not declare: ${unknown.join(", ")}`);
  }

  let failures = 0;
  for (const [index, row] of rows.entries()) {
    const output = outputPathFor(opts.output, row, index);
    try {
      for (const [name, value] of Object.entries(row)) {
        const file = declared.get(name);
        if (!file) continue;
        // Numbers and booleans written as text in a spreadsheet should reach
        // the variable as the type the project declared them with.
        const parsed = value === "true" ? true : value === "false" ? false
          : value !== "" && Number.isFinite(Number(value)) ? Number(value)
          : value;
        await editor.canvas.setVariable.mutate({ file, name, value: parsed });
      }
      const result = await editor.export.query(
        { id, output, format: opts.format as "mp4" | "webm" | "ogg" | "mov" | undefined },
        LONG_RUNNING,
      );
      console.log(JSON.stringify({ row: index + 1, ...result }));
    } catch (error) {
      failures += 1;
      // One bad row should not lose the rest of a long batch.
      console.error(`Row ${index + 1} failed: ${(error as Error).message}`);
    }
  }

  if (failures) {
    console.error(`${failures} of ${rows.length} rows failed.`);
    process.exit(1);
  }
}

type OpenOptions = { background?: boolean };

/** `open -a` on a running app only activates it, so this is safe to always run. */
function launchApp(background: boolean): Promise<boolean> {
  const args = background ? ["-g", "-a", APP_NAME, "--args", "--hidden"] : ["-a", APP_NAME];
  return new Promise((res) => execFile("open", args, (err) => res(!err)));
}

async function openProject(path: string | undefined, opts: OpenOptions): Promise<void> {
  // Launching is macOS's job; elsewhere (and when the app is not installed,
  // e.g. a dev checkout run from the terminal) fall through to the socket,
  // which answers if the app is running and errors usefully if not.
  const launched = process.platform === "darwin" && (await launchApp(opts.background ?? false));

  try {
    // A cold launch needs the renderer up before the app can answer; when
    // nothing was launched there is nothing to wait for, so fail fast.
    if (launched) await waitForCliSocket();
    else await editor.ping.query();

    if (path !== undefined) {
      const result = await editor.open.mutate({ dir: resolve(path) });
      console.log(JSON.stringify(result));
    }
  } catch (e) {
    handleSocketError(e);
  }
}

async function context(options: { tree?: boolean } = {}): Promise<void> {
  try {
    const result = await editor.context.query({ tree: Boolean(options.tree) });
    console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function validate(): Promise<void> {
  try {
    const result = await editor.validate.query();
    console.log(JSON.stringify({ protocolVersion: CLI_PROTOCOL_VERSION, ...result }));
    if (!result.ok) process.exitCode = 1;
  } catch (e) {
    handleSocketError(e);
  }
}

type DoctorCheck = { name: string; ok: boolean; detail: string; recovery?: string };

function packagedResourceRoot(): string | null {
  const configured = process.env.POSTERRACT_APP_PATH;
  if (!configured) return null;
  for (const candidate of [
    join(configured, "Resources", "app"),
    join(configured, "resources", "app"),
    join(configured, "app"),
    configured,
  ]) {
    if (existsSync(join(candidate, "package.json"))) return candidate;
  }
  return null;
}

function fileCheck(name: string, path: string, recovery: string): DoctorCheck {
  return { name, ok: existsSync(path), detail: path, recovery };
}

async function doctor(json = false): Promise<void> {
  const resources = packagedResourceRoot();
  const checks: DoctorCheck[] = [
    { name: "cli", ok: existsSync(process.argv[1] ?? ""), detail: process.argv[1] ?? "unknown" },
    {
      name: "desktop-path",
      ok: process.platform === "darwin" || Boolean(process.env.POSTERRACT_APP_PATH),
      detail: process.env.POSTERRACT_APP_PATH ?? "resolved by macOS application registration",
      recovery: "Install the CLI from the Posterract desktop app.",
    },
  ];
  if (resources) {
    checks.push(
      fileCheck(
        "sdk",
        join(resources, "sdk", "node_modules", "@posterract", "composition", "dist", "index.d.ts"),
        "Reinstall Posterract Desktop; its compatible SDK types are missing.",
      ),
      fileCheck(
        "compiler",
        join(resources, "dist", "application.cjs"),
        "Reinstall Posterract Desktop; the compiler bundle is missing.",
      ),
      fileCheck(
        "esbuild",
        join(resources, "dist", process.platform === "win32" ? "esbuild.exe" : "esbuild"),
        "Reinstall Posterract Desktop; the native compiler executable is missing.",
      ),
      fileCheck(
        "documentation",
        join(resources, "docs", "module-contract.md"),
        "Reinstall Posterract Desktop; versioned SDK documentation is missing.",
      ),
    );
  }
  try {
    const output = mkdtempSync(join(tmpdir(), "posterract-doctor-"));
    accessSync(output, constants.R_OK | constants.W_OK);
    rmSync(output, { recursive: true, force: true });
    checks.push({ name: "output-directory", ok: true, detail: tmpdir() });
  } catch (error) {
    checks.push({
      name: "output-directory",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      recovery: "Choose a writable local output directory.",
    });
  }
  try {
    await editor.ping.query();
    checks.push({ name: "desktop-bridge", ok: true, detail: `CLI protocol ${CLI_PROTOCOL_VERSION} connected` });
    const renderer = await editor.health.query();
    checks.push(
      { name: "headless-renderer", ok: Boolean(renderer.renderer && renderer.offscreenCanvas), detail: `renderer=${renderer.renderer} offscreenCanvas=${renderer.offscreenCanvas}` },
      { name: "media-decoder", ok: Boolean(renderer.videoDecoder), detail: `VideoDecoder=${renderer.videoDecoder}` },
      { name: "media-encoder", ok: Boolean(renderer.videoEncoder), detail: `VideoEncoder=${renderer.videoEncoder}` },
      { name: "font-access", ok: renderer.fonts === "loaded" || renderer.fonts === "loading", detail: `document.fonts=${renderer.fonts}` },
    );
  } catch (error) {
    checks.push({
      name: "desktop-bridge",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      recovery: "Launch Posterract, then run `posterract doctor` again.",
    });
  }
  if (checks.at(-1)?.ok) {
    try {
      const current = await editor.context.query();
      checks.push({
        name: "project",
        ok: true,
        detail: current.projectDir ?? "no project open (project checks skipped)",
        recovery: current.projectDir ? undefined : "Run `posterract open <project-path>` before project-specific work.",
      });
      if (current.projectDir) {
        const result = await editor.validate.query();
        checks.push({
          name: "composition",
          ok: Boolean(result.ok),
          detail: result.ok ? "source compiles and mounts" : JSON.stringify(result.diagnostics),
          recovery: "Fix the reported source diagnostics, then run `posterract validate`.",
        });
      }
    } catch (error) {
      checks.push({ name: "project", ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }
  const result = { protocolVersion: CLI_PROTOCOL_VERSION, ok: checks.every((check) => check.ok), version, platform: process.platform, arch: process.arch, checks };
  if (json) console.log(JSON.stringify(result));
  else for (const check of checks) console.log(`${check.ok ? "ok" : "fail"}\t${check.name}\t${check.detail}${!check.ok && check.recovery ? `\n  recovery: ${check.recovery}` : ""}`);
  if (!result.ok) process.exitCode = 1;
}

async function whoami(): Promise<void> {
  try {
    const result = await editor.whoami.query();
    console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

const LOG_LEVELS = ["debug", "info", "warning", "error"] as const;

type LogsOptions = { tail?: string; level?: string; follow?: boolean };

async function showLogs(opts: LogsOptions): Promise<void> {
  if (opts.level !== undefined && !LOG_LEVELS.includes(opts.level as LogLevel)) {
    console.error(`--level must be one of ${LOG_LEVELS.join(", ")} (got "${opts.level}")`);
    process.exit(1);
  }
  let tail: number | undefined;
  if (opts.tail !== undefined) {
    const n = Number(opts.tail);
    if (!Number.isInteger(n) || n <= 0) {
      console.error(`--tail must be a positive integer (got "${opts.tail}")`);
      process.exit(1);
    }
    tail = n;
  }

  try {
    let entries = await editor.logs.query({ tail, level: opts.level as LogLevel | undefined });
    for (const entry of entries) console.log(formatLogEntry(entry));
    if (!opts.follow) return;

    let following = true;
    const stop = () => {
      following = false;
    };
    process.once("SIGINT", stop);
    let latest = entries.at(-1)?.ts ?? 0;
    let seenAtLatest = new Set(entries.filter((entry: LogEntry) => entry.ts === latest).map(formatLogEntry));
    while (following) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
      entries = await editor.logs.query({ tail: 2_000, level: opts.level as LogLevel | undefined });
      for (const entry of entries as LogEntry[]) {
        const formatted = formatLogEntry(entry);
        if (entry.ts < latest || (entry.ts === latest && seenAtLatest.has(formatted))) continue;
        console.log(formatted);
        if (entry.ts > latest) {
          latest = entry.ts;
          seenAtLatest = new Set();
        }
        seenAtLatest.add(formatted);
      }
    }
    process.removeListener("SIGINT", stop);
  } catch (e) {
    handleSocketError(e);
  }
}

function formatLogEntry(entry: LogEntry): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const d = new Date(entry.ts);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  const source = entry.source ? `  (${entry.source})` : "";
  return `${time} [${entry.level}] ${entry.message}${source}`;
}

type ScreenshotOptions = { output?: string };

// `posterract_2026-07-31_08-55-12.png`
function screenshotFilename(taken: Date, attempt: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = [taken.getFullYear(), pad(taken.getMonth() + 1), pad(taken.getDate())].join("-");
  const time = [pad(taken.getHours()), pad(taken.getMinutes()), pad(taken.getSeconds())].join("-");
  const slug = APP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${slug}_${date}_${time}${attempt > 1 ? `-${attempt}` : ""}.png`;
}

async function appScreenshot(opts: ScreenshotOptions): Promise<void> {
  const dir = opts.output ?? tmpdir();
  mkdirSync(dir, { recursive: true });
  try {
    const { base64, width, height } = await editor.screenshot.query();
    const taken = new Date();
    let attempt = 1;
    let path = join(dir, screenshotFilename(taken, attempt));
    while (existsSync(path)) {
      path = join(dir, screenshotFilename(taken, ++attempt));
    }
    writeFileSync(path, Buffer.from(base64, "base64"));
    console.log(JSON.stringify({ path, width, height }));
  } catch (e) {
    handleSocketError(e);
  }
}

type ReportOptions = { output?: string };

async function reportDiagnostics(opts: ReportOptions): Promise<void> {
  const output = resolve(opts.output ?? join(process.cwd(), `posterract-report-${Date.now()}.zip`));
  mkdirSync(dirname(output), { recursive: true });

  let contextValue: unknown = { status: "desktop unavailable" };
  let validation: unknown = { status: "not run" };
  let logs: unknown = [];
  try {
    contextValue = await editor.context.query();
    logs = await editor.logs.query({ tail: 100, level: "debug" });
    if ((contextValue as { projectDir?: string | null }).projectDir) validation = await editor.validate.query();
  } catch (error) {
    contextValue = { status: "unreachable", error: error instanceof Error ? error.message : String(error) };
  }

  let projectConfig: unknown = null;
  const projectDir = (contextValue as { projectDir?: string | null }).projectDir;
  if (projectDir) {
    try {
      projectConfig = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
    } catch (error) {
      projectConfig = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  createDiagnosticZip(output, {
    "environment.json": {
      cliVersion: version,
      protocolVersion: CLI_PROTOCOL_VERSION,
      os: process.platform,
      architecture: process.arch,
      node: process.version,
    },
    "context.json": contextValue,
    "validation.json": validation,
    "project-config.json": sanitize(projectConfig),
    "recent-logs.json": logs,
  });
  console.log(JSON.stringify({ path: output }));
}

function startSpinner(label: string): () => void {
  if (!process.stderr.isTTY) {
    process.stderr.write(`${label}…\n`);
    return () => { };
  }
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const start = Date.now();
  let i = 0;
  const render = () => {
    const secs = Math.floor((Date.now() - start) / 1000);
    process.stderr.write(`\r${frames[i]} ${label}… ${secs}s`);
    i = (i + 1) % frames.length;
  };
  render();
  const timer = setInterval(render, 80);
  return () => {
    clearInterval(timer);
    process.stderr.write("\r\x1b[K"); // carriage return + clear to end of line
  };
}

type ListFontsOptions = {
  family?: string;
  weight?: string[];
  style?: string;
  limit?: string;
  namesOnly?: boolean;
};

function listFonts(opts: ListFontsOptions): void {
  let style: "normal" | "italic" | undefined;
  if (opts.style !== undefined) {
    if (opts.style !== "normal" && opts.style !== "italic") {
      console.error(`--style must be "normal" or "italic" (got "${opts.style}")`);
      process.exit(1);
    }
    style = opts.style;
  }

  let limit: number | undefined;
  if (opts.limit !== undefined) {
    const n = Number(opts.limit);
    if (!Number.isInteger(n) || n <= 0) {
      console.error(`--limit must be a positive integer (got "${opts.limit}")`);
      process.exit(1);
    }
    limit = n;
  }

  try {
    const families = listLocalFonts({
      familyPattern: opts.family,
      weights: opts.weight,
      style,
      limit,
    });
    if (opts.namesOnly) {
      for (const family of families) console.log(family.family);
    } else {
      for (const family of families) console.log(JSON.stringify(family));
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

type FetchCliOptions = { output?: string; format?: string; audio?: boolean };

// `raw` is every operand after `url` — the yt-dlp passthrough placed after `--`.
// No spinner here: yt-dlp renders its own progress to the inherited stderr.
async function fetch(url: string, opts: FetchCliOptions, raw: string[]): Promise<void> {
  try {
    const paths = await fetchVideo(url, { ...opts, raw });
    for (const path of paths) console.log(JSON.stringify({ path }));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

function outlineCommand(target: string | undefined, opts: { project?: string; json?: boolean }): void {
  try {
    const projectDir = opts.project ? resolve(opts.project) : target === undefined ? resolveProjectDir(undefined, { here: true }) : undefined;
    const report = offline().outline(target ?? projectDir!, projectDir);
    if (opts.json) {
      console.log(JSON.stringify({ path: report.path, totalLines: report.totalLines, totalChars: report.totalChars, entries: report.entries }));
      return;
    }
    console.log(`${report.path} · ${report.totalLines} lines · ${report.totalChars.toLocaleString("en-US")} chars · ${report.entries.length} elements`);
    for (const line of report.lines) console.log(line);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function inspectCommand(id: string | undefined, opts: { json?: boolean; all?: boolean; problems?: boolean }): Promise<void> {
  try {
    let ids: Array<string | undefined> = [id];
    if (opts.all) {
      // Every video in the project: the scenes directly under the stage.
      const context = await editor.context.query({ tree: true, depth: 1 });
      const scenes = ((context.tree?.children ?? []) as Array<{ id: string | null; kind: string }>)
        .filter((node) => node.kind === "scene" && node.id)
        .map((node) => node.id!);
      if (scenes.length) ids = scenes;
    }

    const results: InspectResult[] = [];
    for (const scene of ids) {
      results.push((await editor.inspect.query(scene === undefined ? {} : { id: scene }, LONG_RUNNING)) as InspectResult);
    }

    if (opts.json) {
      console.log(JSON.stringify(opts.all ? results : results[0]));
    } else {
      const reports = results.map((result) => {
        const lines = formatInspect(result);
        if (!opts.problems) return lines.join("\n");
        // Just the verdict and what is wrong: what an edit's author wants back.
        return [lines[0], ...lines.slice(lines.indexOf("PROBLEMS"))].join("\n");
      });
      console.log(reports.join("\n\n"));
    }
    // What this just said does not need saying again by the note after the next command.
    feedback()?.heard(results.flatMap((result) => formatInspect(result)), "inspect");
    // Linter convention: a broken video is a failure a script can branch on.
    if (results.some((result) => result.problems.some((problem) => problem.severity === "error"))) process.exitCode = 1;
  } catch (e) {
    handleSocketError(e);
  }
}

async function lookCommand(opts: { json?: boolean }): Promise<void> {
  try {
    const result = (await editor.look.query()) as LookResult;
    console.log(opts.json ? JSON.stringify(result) : formatLook(result).join("\n"));
  } catch (e) {
    handleSocketError(e);
  }
}

async function showCommand(id: string, opts: { at?: string; json?: boolean }): Promise<void> {
  try {
    const at = opts.at === undefined ? undefined : parseTimeArg(opts.at, "--at", true);
    const result = await editor.show.mutate({ id, ...(at === undefined ? {} : { at }) });
    console.log(opts.json ? JSON.stringify(result) : `showing ${result.id} in scene ${result.scene ?? "?"} at ${result.at ?? 0}s`);
  } catch (e) {
    handleSocketError(e);
  }
}

function changesCommand(opts: { since?: string; project?: string; limit?: string; json?: boolean }): void {
  try {
    const projectDir = opts.project ? resolve(opts.project) : resolveProjectDir(undefined, { here: true });
    const report = offline().changes(projectDir, {
      ...(opts.since ? { since: opts.since } : {}),
      ...(opts.limit ? { limit: Math.max(1, Number.parseInt(opts.limit, 10) || 8) } : {}),
    });
    console.log(opts.json ? JSON.stringify(report) : report.lines.join("\n"));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

function diffCommand(before: string, after: string): void {
  try {
    console.log(offline().diffFiles(before, after).lines.join("\n"));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

function describeCommand(element: string | undefined, opts: { json?: boolean }): void {
  try {
    const report = offline().describe(element);
    console.log(opts.json ? JSON.stringify(report.data) : report.lines.join("\n"));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

function readCommand(target: string | undefined, opts: { project?: string; id?: string; lines?: string; json?: boolean }): void {
  try {
    const projectDir = opts.project ? resolve(opts.project) : target === undefined ? resolveProjectDir(undefined, { here: true }) : undefined;
    let lines: [number, number] | undefined;
    if (opts.lines !== undefined) {
      const match = /^(\d+)(?:\s*[-:,]\s*(\d+))?$/.exec(opts.lines.trim());
      if (!match) throw new Error(`--lines takes a range like 120-180, not "${opts.lines}".`);
      lines = [Number(match[1]), Number(match[2] ?? match[1])];
    }
    const report = offline().read(target ?? projectDir!, projectDir, { ...(opts.id === undefined ? {} : { id: opts.id }), ...(lines ? { lines } : {}) });
    if (opts.json) {
      console.log(JSON.stringify(report));
      return;
    }
    console.log(`${report.path} · lines ${report.from}-${report.to} of ${report.totalLines} · revision ${report.revisionId.slice(0, 12)}`);
    for (const line of report.lines) console.log(line);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

type GeometryBox = { id: string | null; kind: string; x: number; y: number; width: number; height: number; z: number; opacity: number; visible: boolean; offscreen: boolean; clipped: boolean; text?: string };

async function geometryCommand(ids: string[], opts: { at?: string; all?: boolean; json?: boolean }): Promise<void> {
  try {
    const time = opts.at === undefined ? undefined : parseTimeArg(opts.at, "--at");
    const result = await editor.geometry.query({ ...(ids.length ? { ids } : {}), ...(time === undefined ? {} : { time }), ...(opts.all ? { all: true } : {}) });
    if (opts.json) {
      console.log(JSON.stringify(result));
      return;
    }
    const boxes = (result.boxes ?? []) as GeometryBox[];
    const scene = result.scene as { id: string | null; width: number; height: number };
    console.log(`scene${scene.id ? `#${scene.id}` : ""} ${scene.width}×${scene.height} at ${Number(result.time).toFixed(2)}s · ${boxes.length} element${boxes.length === 1 ? "" : "s"} (later draws on top)`);
    for (const box of [...boxes].sort((a, b) => a.z - b.z)) {
      const flags = [
        box.visible ? "" : "not playing",
        box.offscreen ? "outside the frame" : box.clipped ? "past an edge of the frame" : "",
        box.opacity < 1 ? `opacity ${box.opacity}` : "",
      ].filter(Boolean);
      console.log(
        `  ${box.kind}${box.id ? `#${box.id}` : ""}  ${Math.round(box.width)}×${Math.round(box.height)} at ${Math.round(box.x)},${Math.round(box.y)}` +
          (box.text ? `  "${box.text}"` : "") + (flags.length ? `  (${flags.join(", ")})` : ""),
      );
    }
    for (const [a, b] of (result.overlaps ?? []) as Array<[string, string]>) console.log(`  overlap: ${a} × ${b}`);
    if (result.truncated) console.log(`  … ${String((result.truncated as { hint: string }).hint)}`);
  } catch (e) {
    handleSocketError(e);
  }
}

/** `x=550 muted=true color=#fff transition={"type":"dissolve"} fill=null`: JSON where it parses, a string where it does not. */
function parseAssignments(pairs: string[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at < 1) throw new Error(`"${pair}" is not prop=value.`);
    const raw = pair.slice(at + 1);
    let value: unknown = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      // Not JSON: the text itself, which is what a color or an easing name is.
    }
    properties[pair.slice(0, at)] = value;
  }
  return properties;
}

type CliEdit =
  | { op: "set"; id: string; properties: Record<string, unknown> }
  | { op: "text"; id: string; text: string }
  | { op: "create"; parentId: string; beforeId?: string; element: unknown }
  | { op: "move"; id: string; parentId: string; beforeId?: string }
  | { op: "delete"; ids: string[] }
  | { op: "duplicate"; ids: string[] };

function readJsonArgument(inline: string | undefined, file: string | undefined, what: string): unknown {
  const text = inline ?? readFileSync(file === undefined || file === "-" ? 0 : resolve(file), "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${what} is not valid JSON: ${(error as Error).message}`);
  }
}

/**
 * Edits by element id. With the app open they go through the canvas — shown at
 * once, one step of the person's undo history. With it closed they are written
 * to the file by the same writer the app uses, and the app shows them when it
 * next opens. Either way the file ends up the same.
 */
async function applyEdits(edits: CliEdit[], opts: { since?: string; project?: string; json?: boolean }): Promise<void> {
  try {
    let result: Record<string, unknown>;
    try {
      result = await editor.canvas.batch.mutate({ edits, ...(opts.since ? { expectedRevisionId: opts.since } : {}) });
    } catch (e) {
      const code = errnoCode(e);
      if (code !== "ENOENT" && code !== "ECONNREFUSED") throw e;
      if (edits.some((entry) => entry.op === "duplicate")) throw new Error(`${APP_NAME} is not running, and duplicate needs the canvas. Launch the app, or copy the element in the file.`);
      const projectDir = opts.project ? resolve(opts.project) : resolveProjectDir(undefined, { here: true });
      const report = await offline().edit(projectDir, edits as never);
      result = { ...report, note: `${APP_NAME} is not running: the file was edited directly.` };
    }
    if (opts.json) {
      console.log(JSON.stringify(result));
      return;
    }
    const written = (result.written as Array<{ path: string; revisionId: string }> | undefined) ?? [];
    const revision = (result.revisionId as string | null | undefined) ?? written[0]?.revisionId;
    console.log(`✓ ${edits.length} edit${edits.length === 1 ? "" : "s"} written${revision ? ` · revision ${revision.slice(0, 12)}` : ""}${result.note ? ` · ${String(result.note)}` : ""}`);
    for (const line of (result.warnings as string[] | undefined) ?? []) console.log(`⚠ ${line}`);
    for (const line of (result.lint as string[] | undefined) ?? []) console.log(line);
    const skipped = (result.skipped as string[] | undefined) ?? [];
    if (skipped.length) {
      console.log(`⚠ not written to the source (computed by code there, or inside a loop): ${skipped.join(", ")}`);
      process.exitCode = 1;
    }
  } catch (e) {
    handleSocketError(e);
  }
}

async function canvasCommand(path: "undo" | "redo", opts: { json?: boolean }): Promise<void> {
  try {
    const result = await editor.canvas[path].mutate();
    console.log(opts.json ? JSON.stringify(result) : `✓ ${path}${result.revisionId ? ` · revision ${String(result.revisionId).slice(0, 12)}` : ""}`);
  } catch (e) {
    handleSocketError(e);
  }
}

function lintCommand(target: string | undefined, opts: { project?: string; json?: boolean }): void {
  try {
    const projectDir = opts.project ? resolve(opts.project) : target === undefined ? resolveProjectDir(undefined, { here: true }) : undefined;
    const report = offline().lint(target ?? projectDir!, projectDir);
    const errors = report.diagnostics.filter((entry) => entry.severity === "error").length;
    feedback()?.heard(report.lines, "lint");
    if (opts.json) {
      console.log(JSON.stringify({ path: report.path, ok: errors === 0, diagnostics: report.diagnostics }));
    } else if (!report.diagnostics.length) {
      console.log(`✓ ${report.path}: every prop and value is one the editor understands`);
    } else {
      for (const line of report.lines) console.log(line);
      console.log(`${errors} error${errors === 1 ? "" : "s"}, ${report.diagnostics.length - errors} warning${report.diagnostics.length - errors === 1 ? "" : "s"}`);
    }
    // The way a compiler exits: a wrong prop is a failure a script can branch on.
    if (errors) process.exit(1);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(2);
  }
}

const program = new Command();

program
  .name("posterract")
  .description(
    `Read and edit a Posterract video from the command line.

A project is a folder, and the video is a TSX file in it — the document.
Edit that file with your own tools; the editor shows the change as you
make it. These commands read it, check it, and make the edits that are
easier to say by element id.

  posterract outline           what is in the file, line by line
  posterract read --id hook    just that element's source
  posterract set hook y=1200   change it (or edit the file yourself)
  posterract inspect           what is wrong with the video, and the fix

Most of it works with the app closed. \`<command> --help\` says what one does.`,
  )
  .version(version);

program
  .command("open")
  .summary("open a project in the app")
  .description(
    `Launch ${APP_NAME} (or surface the running instance) and, given a path, open that folder as a project.`,
  )
  .argument("[path]", "project folder to open or create (default: none — just launch the app)")
  .option("-b, --background", "launch or keep the app in the background, without raising a window")
  .action((path: string | undefined, opts: OpenOptions) => openProject(path, opts));

program
  .command("context")
  .summary("what the editor has open right now")
  .alias("ctx")
  .description(
    `Print lightweight local editor state: project, source revision, active video, playhead, compile state, fonts, and inspector variables.`,
  )
  .option("--json", "emit only JSON (the default; retained for agent scripts)")
  .option("--tree", "include the current Posterract runtime hierarchy")
  .action((opts: { tree?: boolean }) => context(opts));

program
  .command("outline")
  .summary("one line per element of a source, with its lines")
  .description(
    "One line per element of a composition source: id, name, when it plays, where it sits, what it shows, and the lines it spans in the file — keyframes folded to a count per property, long runs of look-alike siblings to one line. Reads the text only, so it works with the app closed. Start here instead of reading a large source whole, then read just the lines you need.",
  )
  .argument("[target]", "a source file or a project folder (default: the project found from the working directory)")
  .option("--project <dir>", "explicit Posterract project directory")
  .option("--json", "emit the entries as JSON instead of text")
  .action((target: string | undefined, opts: { project?: string; json?: boolean }) => outlineCommand(target, opts));

program
  .command("inspect")
  .summary("what is in a video and what is wrong with it")
  .description(
    "What is in a video and what is wrong with it, as text — the `ffprobe` of a composition. Visits the whole duration (every element's first, middle and last frame, its keyframes, the ends of its entrances and exits) and reports: the timeline (when each element plays, where it sits, what it says), the markers, and ranked problems with the element, the numbers and the fix — text running off the frame, an element never in frame or never opaque, something on screen too briefly to read, text overlapping text or hidden under a later layer, spans where nothing draws, sources that failed. Nothing is rendered or decoded and the playhead does not move. Run it before and after an edit and diff the two. Exits 1 when an error is found.",
  )
  .argument("[scene]", "scene id to inspect (default: the active scene)")
  .option("--all", "inspect every scene of the project, not only one")
  .option("--problems", "print only each scene's verdict and its problems, not the timeline")
  .option("--json", "emit the full result as JSON")
  .action((scene: string | undefined, opts: { json?: boolean; all?: boolean; problems?: boolean }) => inspectCommand(scene, opts));

program
  .command("look")
  .summary("what your collaborator has selected, and their notes to you")
  .description(
    "What your collaborator is looking at: the active scene, where the playhead is parked, what is selected (with the props an edit starts from), and the markers on the timeline — those starting `@agent` are notes addressed to you. One call at the start of a turn; \"make this bigger\" means the selected element at that playhead.",
  )
  .option("--json", "emit JSON")
  .action((opts: { json?: boolean }) => lookCommand(opts));

program
  .command("show")
  .summary("bring the editor to an element, so they can see it")
  .description(
    "Bring the editor to an element: activate its scene, move the playhead to `--at` (default: the middle of the element's span, where it is sure to be on screen), select it and frame it in the canvas. View only — nothing in the source changes. Use it to show your collaborator what you changed.",
  )
  .argument("<id>", "element id")
  .option("--at <time>", 'scene time to park the playhead on — seconds ("3.2"), frames ("96f") or "MM:SS"')
  .option("--json", "emit JSON")
  .action((id: string, opts: { at?: string; json?: boolean }) => showCommand(id, opts));

program.hook("postAction", async (_program, action) => {
  if (!FEEDBACK_AFTER.has(action.name()) || process.env.POSTERRACT_NO_FEEDBACK === "1") return;
  try {
    const note = await feedback()?.since();
    if (note) process.stderr.write(`\n${note}\n`);
  } catch {
    // A note that could not be made is not a reason for the command to fail.
  }
});

program
  .command("read")
  .summary("one element's source, or a range of lines")
  .description(
    "One part of a composition source, with line numbers: an element by `--id` (children included) or `--lines 120-180`. `outline` says which lines an element spans. Works with the app closed.",
  )
  .argument("[target]", "a source file or a project folder (default: the project found from the working directory)")
  .option("--id <id>", "the element to read, by its id")
  .option("--lines <from-to>", "a 1-based line range")
  .option("--project <dir>", "explicit Posterract project directory")
  .option("--json", "emit JSON")
  .action((target: string | undefined, opts: { project?: string; id?: string; lines?: string; json?: boolean }) => readCommand(target, opts));

program
  .command("geometry")
  .summary("where things are on the frame, measured")
  .description(
    "Where elements are on the frame, measured after layout and transforms: x, y, width, height, what a text says, overlaps. At `--at` (default: the playhead) for the elements on screen then; name ids to measure just those.",
  )
  .argument("[ids...]", "element ids (default: everything on screen)")
  .option("--at <time>", 'scene time — seconds ("3.2"), frames ("96f") or "MM:SS"')
  .option("--all", "include elements that are not on screen at that time")
  .option("--json", "emit JSON")
  .action((ids: string[], opts: { at?: string; all?: boolean; json?: boolean }) => geometryCommand(ids, opts));

const SINCE = "the revision you last saw: refuse if someone changed these elements since (a change elsewhere is no conflict)";

program
  .command("set")
  .summary("set props of an element by id")
  .description(
    "Set props of an element by id: `posterract set hook y=1200 color=#ffe600 muted=true`. A value is JSON where it parses (numbers, true, null, {…}) and text where it does not. With the app open it shows at once and is one undo step; with it closed the file is edited directly. For anything larger, edit the file yourself: the app shows that too.",
  )
  .argument("<id>", "element id")
  .argument("<assignments...>", "prop=value pairs")
  .option("--since <revisionId>", SINCE)
  .option("--project <dir>", "explicit Posterract project directory (used when the app is closed)")
  .option("--json", "emit JSON")
  .action((id: string, pairs: string[], opts: { since?: string; project?: string; json?: boolean }) => {
    try {
      return applyEdits([{ op: "set", id, properties: parseAssignments(pairs) }], opts);
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }
  });

program
  .command("text")
  .summary("change what a <text> says")
  .description("Change what a <text> says: `posterract text hook \"Everybody talks about this\"`.")
  .argument("<id>", "element id")
  .argument("<text>", "the new text")
  .option("--since <revisionId>", SINCE)
  .option("--project <dir>", "explicit Posterract project directory (used when the app is closed)")
  .option("--json", "emit JSON")
  .action((id: string, text: string, opts: { since?: string; project?: string; json?: boolean }) => applyEdits([{ op: "text", id, text }], opts));

program
  .command("create")
  .summary("add an element under a parent")
  .description(
    "Add an element under a parent: `posterract create main --element '{\"tag\":\"text\",\"props\":{\"id\":\"cta\",\"x\":90,\"y\":1500},\"text\":\"Follow\"}'`. The element is `{tag, props?, text?, children?}`; give it an `id`. `--file` reads it from a file (`-` for stdin).",
  )
  .argument("<parentId>", "the element to add it under")
  .option("--element <json>", "the element, as JSON")
  .option("--file <path>", "read the element from a JSON file, or - for stdin")
  .option("--before <id>", "insert in front of this sibling (default: last, which draws on top)")
  .option("--project <dir>", "explicit Posterract project directory (used when the app is closed)")
  .option("--json", "emit JSON")
  .action((parentId: string, opts: { element?: string; file?: string; before?: string; project?: string; json?: boolean }) => {
    try {
      const element = readJsonArgument(opts.element, opts.file, "The element");
      return applyEdits([{ op: "create", parentId, ...(opts.before ? { beforeId: opts.before } : {}), element }], opts);
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }
  });

program
  .command("move")
  .summary("move an element, or reorder it among its siblings")
  .description("Move an element under another parent, or among its siblings: later in the file draws on top.")
  .argument("<id>", "element id")
  .argument("<parentId>", "the parent to move it under (its current one to reorder)")
  .option("--before <id>", "place it in front of this sibling (default: last)")
  .option("--since <revisionId>", SINCE)
  .option("--project <dir>", "explicit Posterract project directory (used when the app is closed)")
  .option("--json", "emit JSON")
  .action((id: string, parentId: string, opts: { before?: string; since?: string; project?: string; json?: boolean }) =>
    applyEdits([{ op: "move", id, parentId, ...(opts.before ? { beforeId: opts.before } : {}) }], opts));

program
  .command("delete")
  .summary("remove elements by id")
  .description("Remove elements by id, children included. With the app open the person can undo it; either way the replaced file is kept in Version History.")
  .argument("<ids...>", "element ids")
  .option("--since <revisionId>", SINCE)
  .option("--project <dir>", "explicit Posterract project directory (used when the app is closed)")
  .option("--json", "emit JSON")
  .action((ids: string[], opts: { since?: string; project?: string; json?: boolean }) => applyEdits([{ op: "delete", ids }], opts));

program
  .command("duplicate")
  .summary("copy elements in place")
  .description("Copy elements in place, children included. Needs the app open.")
  .argument("<ids...>", "element ids")
  .option("--json", "emit JSON")
  .action((ids: string[], opts: { json?: boolean }) => applyEdits([{ op: "duplicate", ids }], opts));

program
  .command("apply")
  .summary("several edits as one undo step, all or nothing")
  .description(
    "Several edits as one — one undo step, one write, all or nothing. Reads a JSON array from a file or stdin: `[{\"op\":\"set\",\"id\":\"hook\",\"properties\":{\"y\":1200}},{\"op\":\"text\",\"id\":\"hook\",\"text\":\"Hi\"}]`. Ops: set {id, properties} · text {id, text} · create {parentId, beforeId?, element} · move {id, parentId, beforeId?} · delete {ids} · duplicate {ids}. A later edit may name an element an earlier create makes.",
  )
  .argument("[file]", "JSON file of edits (default: stdin)")
  .option("--since <revisionId>", SINCE)
  .option("--project <dir>", "explicit Posterract project directory (used when the app is closed)")
  .option("--json", "emit JSON")
  .action((file: string | undefined, opts: { since?: string; project?: string; json?: boolean }) => {
    try {
      const edits = readJsonArgument(undefined, file, "The edits");
      if (!Array.isArray(edits) || !edits.length) throw new Error("The edits must be a non-empty JSON array.");
      return applyEdits(edits as CliEdit[], opts);
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }
  });

program.command("undo").summary("take back the last edit").description("Take back the last edit on the canvas (the person's or yours).").option("--json", "emit JSON")
  .action((opts: { json?: boolean }) => canvasCommand("undo", opts));
program.command("redo").summary("put back the last edit undone").description("Put back the last edit that was undone.").option("--json", "emit JSON")
  .action((opts: { json?: boolean }) => canvasCommand("redo", opts));

program
  .command("changes")
  .summary("what changed and who changed it")
  .description(
    "What changed in the project's source, element by element, and who changed it: the person on the canvas, an agent's tool, a direct edit of the file, or the app's own housekeeping — `person  text#hook  y  1480 → 1200`. With `--since <revisionId>` (the id an earlier read or edit handed you), everything written after the source last stood there: run it before you write, so you work around what your collaborator decided instead of over it. Without it, the last few writes. Reads the project's journal and the app's source history, so it works with the app closed.",
  )
  .option("--since <revisionId>", "a revision id from an earlier read or edit (a prefix is enough)")
  .option("--limit <n>", "without --since: how many writes to show (default 8)")
  .option("--project <dir>", "explicit Posterract project directory")
  .option("--json", "emit JSON")
  .action((opts: { since?: string; project?: string; limit?: string; json?: boolean }) => changesCommand(opts));

program
  .command("diff")
  .summary("two versions of a source, element by element")
  .description(
    "The difference between two versions of a composition source, element by element rather than line by line: which elements came, went, moved or were reordered, and which props of which element changed. Keyframes are counted against the element they move. Works with the app closed.",
  )
  .argument("<before>", "the earlier source file")
  .argument("<after>", "the later source file")
  .action((before: string, after: string) => diffCommand(before, after));

program
  .command("describe")
  .summary("every element and prop, from the SDK's own types")
  .description(
    "The composition vocabulary: with no argument, every element in one line plus the common tasks and the element that does each; with an element (`describe text`), the props it takes, their types and allowed values. Generated from the SDK's types, so it is never out of date. Works with the app closed.",
  )
  .argument("[element]", "an element name, e.g. text, video, keyframeTrack")
  .option("--json", "emit the vocabulary (or the element) as JSON")
  .action((element: string | undefined, opts: { json?: boolean }) => describeCommand(element, opts));

program
  .command("lint")
  .summary("props and values the editor does not understand")
  .description(
    "Check a composition source against the vocabulary: a prop an element does not take (with what was probably meant — `fill` on a <text> is `color`), a value an enumeration does not name, a required prop left out. The runtime ignores what it does not know, so without this such a mistake is silent. Prints `file:line:col` findings and exits 1 on any error. Reads the text only, so it works with the app closed.",
  )
  .argument("[target]", "a source file or a project folder (default: the project found from the working directory)")
  .option("--project <dir>", "explicit Posterract project directory")
  .option("--json", "emit the findings as JSON")
  .action((target: string | undefined, opts: { project?: string; json?: boolean }) => lintCommand(target, opts));

program
  .command("validate")
  .summary("does it compile, and does the editor understand it")
  .description("Compile, evaluate, and candidate-mount the open project without replacing the last valid canvas on failure.")
  .option("--json", "emit the stable JSON result")
  .action(() => validate());

program
  .command("doctor")
  .summary("diagnose the local runtime")
  .description("Verify the CLI, desktop bridge, open project, and composition compiler.")
  .option("--json", "emit only JSON")
  .action((opts: { json?: boolean }) => doctor(Boolean(opts.json)));

program
  .command("version")
  .summary("the version of the app and the CLI")
  .description("Print the installed Posterract CLI version.")
  .action(() => console.log(version));

const mcp = program
  .command("mcp")
  .summary("run the MCP server (agent clients launch this themselves)")
  .description("Run and inspect the official local Posterract MCP connection for coding agents.");

mcp
  .command("serve")
  .description("Serve the active Posterract project over MCP stdio. Normally launched by an agent client, not by the user.")
  .option("--project <dir>", "explicit Posterract project directory (default: discover from the process working directory)")
  .action((opts: { project?: string }) => servePosterractMcp(opts.project));

program
  .command("capture")
  .summary("frames of a scene as images")
  .description(
    `Render single frames of a scene to PNGs — each frame is the frame an export of that scene would encode, drawn offscreen at the scene's own size. By default the positions are merged into contact sheets: up to 12 per image, each cell labelled with its timecode (\`08s10f\`, zero segments dropped) and rendered as large as fits, so a few positions arrive as one high-resolution picture instead of a directory to open one by one (\`--separate\` writes a PNG per position, at 720p height). The tool for checking composition ("what plays at time T": layout, overlaps, text, timing) and for verifying frames before an export. Scenes only — a single element renders inside its scene, so capture the scene at the times it plays. For a video asset's own full-resolution pixels use \`media grab\`.`,
  )
  .argument("<id>", 'scene id to capture or `file:id` when two files use the same id')
  .option("-t, --time <time...>", `one or more positions to capture, relative to the export's first frame, the workarea's start (0 = the export's frame 0) — seconds ("1.5"), frames ("45f"), or "MM:SS" (default: 0)`)
  .option("-S, --separate", "write one PNG per position instead of merging them into contact sheets")
  .option("--per-sheet <n>", "positions per contact sheet, 1-12; fewer means a larger cell each (default: as many as fit)")
  .option("-o, --output <dir>", "directory to write the PNGs into (default: a fresh dir in the system temp dir)")
  .action((id: string, opts: CaptureOptions) => captureNode(id, opts));

program
  .command("check")
  .summary("timing and visibility problems of one subtree")
  .description(
    `Check a node's subtree for obvious structural mistakes, without rendering (local analysis, no credits): spans where no visual is scheduled (likely black frames), children that never become visible, zero-duration or fully transparent nodes, and assets that failed to load or generate — plus subtree stats (node count by kind, nesting depth, played duration). Prints one JSON object; times in issue ranges are seconds relative to the node's start — for a scene whose workarea starts at 0, the same clock \`capture --time\` uses. Exits 1 when an error-severity issue is found. Structural only: a scheduled clip can still render black (dark footage, content smaller than the canvas), so confirm suspicious spans visually with \`capture\`.`,
  )
  .argument("<id>", 'node id to check or `file:id` when two files use the same id')
  .option("--json", "emit only the stable JSON result")
  .action((id: string, opts: { json?: boolean }) => checkNode(id, opts));

program
  .command("export")
  .summary("render a scene to a video file")
  .description("Export one scene to a local file. This never uploads or schedules the result. Works with the app closed (see `render`).")
  .argument("<id>", "scene id to export")
  .requiredOption("-o, --output <file>", "local .mp4, .webm, .ogg, or .mov output path")
  .option("-f, --format <format>", "override the format inferred from the output extension")
  .option("--from <time>", "render from this scene time on (default: the scene's work area)")
  .option("--to <time>", "render up to this scene time")
  .option("--scale <fraction>", "output size as a fraction of the scene's, e.g. 0.5 for a quick look")
  .option("--json", "emit JSON")
  .action((id: string, opts: ExportOptions) => exportScene(id, opts));

program
  .command("render")
  .summary("a project's video as a file — no app needed")
  .description(
    "Render a video to a local file: `posterract render -o out.mp4` in a project folder. If the app is open it renders there; if not, the CLI starts the engine (the app with no window) for itself, renders, and the engine quits a little later on its own. Same renderer either way, so the file is the one the app's Export makes. The scene can be left out when the project has one. `--from`/`--to`/`--scale` render a part of it, or a smaller version, for a quick look. Progress goes to stderr; the exit code is nonzero when the render failed. Never uploads or posts.",
  )
  .argument("[scene]", "scene id (default: the project's only scene)")
  .requiredOption("-o, --output <file>", "local .mp4, .webm, .ogg, or .mov output path")
  .option("-f, --format <format>", "override the format inferred from the output extension")
  .option("--from <time>", "render from this scene time on (default: the scene's work area)")
  .option("--to <time>", "render up to this scene time")
  .option("--scale <fraction>", "output size as a fraction of the scene's, e.g. 0.5 for a quick look")
  .option("--project <dir>", "the project folder (default: the one the command is run in)")
  .option("--json", "emit JSON")
  .action((scene: string | undefined, opts: ExportOptions & { project?: string }) => renderCommand(scene, opts));

program
  .command("batch")
  .summary("one video per row of a spreadsheet")
  .description(
    "Render one video per row of a CSV or JSON file. Each column whose name matches an `@inspect` variable sets that variable before the row is exported, so a project is a template and the data file is the list of takes. Renders run one at a time and a failed row does not stop the rest.",
  )
  .argument("<id>", "scene id to export for every row")
  .requiredOption("-d, --data <file>", "CSV or JSON file; the first CSV line names the columns")
  .requiredOption(
    "-o, --output <template>",
    'output path per row, e.g. "out/{name}.mp4" — {column} inserts a cell, {n} the row number; without a placeholder the row number is appended',
  )
  .option("-f, --format <format>", "override the format inferred from the output extension")
  .action((id: string, opts: BatchOptions) => batchExport(id, opts));

// Held in a name of its own: the subcommands below hang off it. (It used to be
// the `batch` command above that was bound to `media`, which registered every
// media subcommand under `batch` and left `posterract media probe` an error.)
const media = program
  .command("media")
  .summary("probe, grab, filmstrip, waveform, extract — local files")
  .alias("m")
  .description(
    "Inspect a media file by path without adding it to the project: probe metadata, grab representative frames, and render local previews. Local files work without an open project; library paths need one.",
  );

media
  .command("probe")
  .description(
    `Read the container and per-track technical metadata of a media file (local read, no credits): container format, duration, tags, and each track's codec params, without decoding. Commonly useful for a quick technical read, e.g. checking codec compatibility or duration before cutting. Packet stats (fps, bitrate) are estimated from a leading sample; images and transcripts report file-level info only.`,
  )
  .argument("<path>", "local file path")
  .action((ref: string) => mediaProbe(ref));

media
  .command("grab")
  .alias("sample")
  .description(
    `Decode frames of a video file and write them as PNGs (local render, no credits). By default the frames are merged into contact sheets: up to 12 per image, each cell labelled with its timecode (\`08s10f\`, zero segments dropped) and drawn as large as fits, so a handful of frames arrives as one high-resolution picture instead of a directory to open one by one (\`--separate\` writes a PNG per frame). Grabs the asset's own pixels, unlike \`capture\` which renders the composited node. The recommended tool for understanding a video at the frame level; past ~12 frames prefer \`media filmstrip\`.`,
  )
  .argument("<path>", "local video file path to grab frames from")
  .option("-t, --time <time...>", `one or more timestamps to grab — seconds ("1.5"), frames ("45f"), or "MM:SS"; negatives count back from the end, so -1 is one second before the end and -1f one frame before it (default: 0)`)
  .option("-c, --count <n>", "instead of --time, grab this many frames evenly spaced across the clip (or across the --start/--end window)")
  .option("-a, --auto", "scan the clip at 2fps and keep a frame each time the footage settles into a new visual state (transitions are waited out, so picks stay sharp); returns at most --count frames (default cap: 30), static footage like screen recordings returns far fewer; requires WebGPU")
  .option("-s, --start <time>", `with --count or --auto, start of the window to sample (seconds, "45f" frames, or "MM:SS"; default: 0)`)
  .option("-e, --end <time>", `with --count or --auto, end of the window to sample (seconds, "45f" frames, or "MM:SS"; default: asset duration)`)
  .option("-q, --quality <preset>", "frame resolution: small (384x384), medium (768x768), large (1536x1536), or fullres (native); default: as large as the sheet cell allows, or small with --separate")
  .option("-S, --separate", "write one PNG per frame instead of merging them into contact sheets")
  .option("--per-sheet <n>", "frames per contact sheet, 1-12; fewer frames means a larger cell each (default: as many as fit)")
  .option("--uncapped", "lift the 100-frame safety cap (grabbing many frames is slow and token-heavy)")
  .option("-o, --output <dir>", "directory to write the PNGs into (default: a fresh dir in the system temp dir)")
  .action((ref: string, opts: MediaFrameOptions) => mediaFrame(ref, opts));

media
  .command("filmstrip")
  .alias("film")
  .description(
    `Render a grid of thumbnails sampled across the timeline to a PNG (local render, no credits), each row stamped with an HH:MM:SS:FF ruler. A fast, token-efficient video track preview; narrow the window to zoom into a region of interest. Video only (use \`media waveform\` for audio).`,
  )
  .argument("<path>", "local video file path to preview")
  .option("-s, --start <time>", `start of the window to preview — seconds, "45f" frames, or "MM:SS" (default: 0)`)
  .option("-e, --end <time>", `end of the window to preview — seconds, "45f" frames, or "MM:SS" (default: asset duration)`)
  .option("-x, --scale <factor>", "scale factor for the thumbnails; smaller thumbnails fit more rows and columns, larger fit fewer (default: 1)")
  .option("-o, --output <path>", "write the PNG here instead of a temp file")
  .action((ref: string, opts: MediaPreviewOptions) => mediaFilmstrip(ref, opts));

media
  .command("waveform")
  .alias("wave")
  .description(
    `Render the audio track of a video or audio file as a waveform PNG (local render, no credits) with a timestamp ruler: loudness over time, with silent stretches highlighted in red. A fast, token-efficient audio track preview; the silent spans are also returned as second ranges.`,
  )
  .argument("<path>", "local video or audio file path to preview")
  .option("-s, --start <time>", `start of the window to preview — seconds, "45f" frames, or "MM:SS" (default: 0)`)
  .option("-e, --end <time>", `end of the window to preview — seconds, "45f" frames, or "MM:SS" (default: asset duration)`)
  .option("-x, --scale <factor>", "scale factor for the waveform; smaller fits more rows and columns, larger fits fewer (default: 1)")
  .option("-o, --output <path>", "write the PNG here instead of a temp file")
  .action((ref: string, opts: MediaPreviewOptions) => mediaWaveform(ref, opts));

media
  .command("extract")
  .description("Extract a local time range for agent inspection. Writes MP4 video or OGG audio and never uploads it.")
  .argument("<path>", "local media path or project asset-library path")
  .option("-s, --start <time>", "start of the extracted range")
  .option("-e, --end <time>", "end of the extracted range")
  .option("--audio-only", "discard video and write a mono OGG audio file")
  .requiredOption("-o, --output <file>", "output .mp4 or .ogg file")
  .action((ref: string, opts: MediaExtractOptions) => mediaExtract(ref, opts));

program
  .command("whoami")
  .summary("who this CLI is acting as")
  .description(`Print the local editor identity boundary. Publishing credentials are intentionally unavailable to the CLI.`)
  .option("--json", "emit only JSON (the default; retained for agent scripts)")
  .action(() => whoami());

program
  .command("logs")
  .summary("the app's log")
  .description(
    `Print recent console output from the running app (what the devtools console shows: page logs, worker logs, uncaught errors), oldest first, one line per entry: local time, level, message, source location. The app buffers the last 2000 entries across reloads and project switches, so this replaces relaunching with ELECTRON_ENABLE_LOGGING=1 when debugging renderer-side behavior.`,
  )
  .option("-n, --tail <n>", "output only the last <n> entries")
  .option("-l, --level <level>", `minimum level to include: "debug", "info", "warning", or "error"`)
  .option("-f, --follow", "continue printing new entries until interrupted")
  .action((opts: LogsOptions) => showLogs(opts));

program
  .command("screenshot")
  .summary("a picture of the editor window")
  .description(
    `Capture the entire application window as a PNG — the full UI as the user sees it (panels, timeline, asset library, canvas viewport), at the window's current size. The tool for checking what the app itself looks like; to render a node or scene cleanly for composition checks use \`capture\` instead.`,
  )
  .option("-o, --output <dir>", "directory to write the PNG into (default: system temp dir)")
  .action((opts: ScreenshotOptions) => appScreenshot(opts));

program
  .command("report")
  .summary("a diagnostic bundle to attach to a bug report")
  .description(
    "Create a local sanitized diagnostic ZIP. Nothing is uploaded and no public issue is filed.",
  )
  .option("-o, --output <zip>", "output ZIP path")
  .action((opts: ReportOptions) => reportDiagnostics(opts));

program
  .command("fonts")
  .summary("the fonts this machine can render with")
  .description(
    `List the local fonts available on this machine (macOS only; does not require the app). These family names are valid \`fontFamily\` values on <text>; each family lists its variants.`,
  )
  .option("-f, --family <pattern>", "filter to families whose name contains <pattern> (case-insensitive)")
  .option("-w, --weight <weights...>", "filter to variants with the given CSS weight(s), e.g. -w 400 700")
  .option("-s, --style <style>", `filter to variants with the given style: "normal" or "italic"`)
  .option("-l, --limit <n>", "output at most <n> families")
  .option("-n, --names-only", "output only family names (one per line, no variant detail)")
  .option("--json", "emit JSON Lines (the default; retained for agent scripts)")
  .action((opts: ListFontsOptions) => listFonts(opts));

program
  .command("fetch")
  .summary("download a video from a URL into the project")
  .description(
    `Download a video with yt-dlp (installed separately; does not require the app). Writes files to disk only (a single URL can yield several, e.g. a playlist).`,
  )
  .argument("<url>", "video or page URL to download")
  .option("-o, --output <path>", "output file path or directory (yt-dlp -o template; default: yt-dlp's default)")
  .option("-f, --format <selector>", `yt-dlp format selector (default: prefer mp4), e.g. "bv*+ba/b"`)
  .option("-a, --audio", "extract audio only (yt-dlp -x)")
  .allowExcessArguments()
  .addHelpText("after", `\nForward raw yt-dlp flags after --, e.g. posterract fetch <url> -- --sponsorblock-remove all`)
  .action((url: string, opts: FetchCliOptions, cmd: Command) => fetch(url, opts, cmd.args.slice(1)));

// Explicit argv convention: the packaged wrapper runs this bundle on
// Electron in ELECTRON_RUN_AS_NODE mode, where commander would otherwise
// detect Electron and drop the script path from argv.
void program.parseAsync(process.argv, { from: "node" }).finally(() => {
  // AppImage launches the CLI through the normal Electron entry point; once
  // the async command is complete, Electron would otherwise keep its app
  // event loop alive despite having no window.
  if (process.env.POSTERRACT_CLI_FORCE_EXIT === "1") {
    process.exit(process.exitCode ?? 0);
  }
});
