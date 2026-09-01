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
import { editor, errnoCode, GENERATE_TIMEOUT_MS, waitForCliSocket } from "./cli-client";
import { listLocalFonts } from "./fonts";
import { createDiagnosticZip, sanitize } from "./report";
import { fetchVideo } from "./ytdlp";
import { CLI_PROTOCOL_VERSION, MAX_FRAMES_PER_SHEET } from "./protocol";
import { servePosterractMcp } from "./mcp";
import type { AssetRef, CheckIssue, FrameQuality, LogEntry, LogLevel, TimecodedImage } from "./protocol";

// Captures and exports can legitimately exceed the interactive timeout.
const LONG_RUNNING = { context: { timeoutMs: GENERATE_TIMEOUT_MS } };

const APP_NAME = "Posterract";

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

type ExportOptions = { output: string; format?: string };

async function exportScene(id: string, opts: ExportOptions): Promise<void> {
  const allowed = ["mp4", "webm", "ogg", "mov"] as const;
  if (opts.format !== undefined && !allowed.includes(opts.format as (typeof allowed)[number])) {
    console.error(`--format must be one of ${allowed.join(", ")} (got "${opts.format}")`);
    process.exit(1);
  }
  try {
    const result = await editor.export.query(
      {
        id,
        output: resolve(opts.output),
        format: opts.format as (typeof allowed)[number] | undefined,
      },
      LONG_RUNNING,
    );
    console.log(JSON.stringify(result));
  } catch (error) {
    handleSocketError(error);
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

const program = new Command();

program
  .name("posterract")
  .description(
    `The Posterract CLI: inspect local media, validate compositions, capture representative frames, and export videos through the desktop editor.`,
  )
  .version(version);

program
  .command("open")
  .description(
    `Launch ${APP_NAME} (or surface the running instance) and, given a path, open that folder as a project.`,
  )
  .argument("[path]", "project folder to open or create (default: none — just launch the app)")
  .option("-b, --background", "launch or keep the app in the background, without raising a window")
  .action((path: string | undefined, opts: OpenOptions) => openProject(path, opts));

program
  .command("context")
  .alias("ctx")
  .description(
    `Print lightweight local editor state: project, source revision, active video, playhead, compile state, fonts, and inspector variables.`,
  )
  .option("--json", "emit only JSON (the default; retained for agent scripts)")
  .option("--tree", "include the current Posterract runtime hierarchy")
  .action((opts: { tree?: boolean }) => context(opts));

program
  .command("validate")
  .description("Compile, evaluate, and candidate-mount the open project without replacing the last valid canvas on failure.")
  .option("--json", "emit the stable JSON result")
  .action(() => validate());

program
  .command("doctor")
  .description("Verify the CLI, desktop bridge, open project, and composition compiler.")
  .option("--json", "emit only JSON")
  .action((opts: { json?: boolean }) => doctor(Boolean(opts.json)));

program
  .command("version")
  .description("Print the installed Posterract CLI version.")
  .action(() => console.log(version));

const mcp = program
  .command("mcp")
  .description("Run and inspect the official local Posterract MCP connection for coding agents.");

mcp
  .command("serve")
  .description("Serve the active Posterract project over MCP stdio. Normally launched by an agent client, not by the user.")
  .option("--project <dir>", "explicit Posterract project directory (default: discover from the process working directory)")
  .action((opts: { project?: string }) => servePosterractMcp(opts.project));

program
  .command("capture")
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
  .description(
    `Check a node's subtree for obvious structural mistakes, without rendering (local analysis, no credits): spans where no visual is scheduled (likely black frames), children that never become visible, zero-duration or fully transparent nodes, and assets that failed to load or generate — plus subtree stats (node count by kind, nesting depth, played duration). Prints one JSON object; times in issue ranges are seconds relative to the node's start — for a scene whose workarea starts at 0, the same clock \`capture --time\` uses. Exits 1 when an error-severity issue is found. Structural only: a scheduled clip can still render black (dark footage, content smaller than the canvas), so confirm suspicious spans visually with \`capture\`.`,
  )
  .argument("<id>", 'node id to check or `file:id` when two files use the same id')
  .option("--json", "emit only the stable JSON result")
  .action((id: string, opts: { json?: boolean }) => checkNode(id, opts));

program
  .command("export")
  .description("Export one scene to a local file. This never uploads or schedules the result.")
  .argument("<id>", "scene id to export")
  .requiredOption("-o, --output <file>", "local .mp4, .webm, .ogg, or .mov output path")
  .option("-f, --format <format>", "override the format inferred from the output extension")
  .action((id: string, opts: ExportOptions) => exportScene(id, opts));

const media = program
  .command("media")
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
  .description(`Print the local editor identity boundary. Publishing credentials are intentionally unavailable to the CLI.`)
  .option("--json", "emit only JSON (the default; retained for agent scripts)")
  .action(() => whoami());

program
  .command("logs")
  .description(
    `Print recent console output from the running app (what the devtools console shows: page logs, worker logs, uncaught errors), oldest first, one line per entry: local time, level, message, source location. The app buffers the last 2000 entries across reloads and project switches, so this replaces relaunching with ELECTRON_ENABLE_LOGGING=1 when debugging renderer-side behavior.`,
  )
  .option("-n, --tail <n>", "output only the last <n> entries")
  .option("-l, --level <level>", `minimum level to include: "debug", "info", "warning", or "error"`)
  .option("-f, --follow", "continue printing new entries until interrupted")
  .action((opts: LogsOptions) => showLogs(opts));

program
  .command("screenshot")
  .description(
    `Capture the entire application window as a PNG — the full UI as the user sees it (panels, timeline, asset library, canvas viewport), at the window's current size. The tool for checking what the app itself looks like; to render a node or scene cleanly for composition checks use \`capture\` instead.`,
  )
  .option("-o, --output <dir>", "directory to write the PNG into (default: system temp dir)")
  .action((opts: ScreenshotOptions) => appScreenshot(opts));

program
  .command("report")
  .description(
    "Create a local sanitized diagnostic ZIP. Nothing is uploaded and no public issue is filed.",
  )
  .option("-o, --output <zip>", "output ZIP path")
  .action((opts: ReportOptions) => reportDiagnostics(opts));

program
  .command("fonts")
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
