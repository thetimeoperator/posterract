/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Bring-your-own-keys AI generation, entirely on the user's machine.
 *
 * The keys are the person's, not a project's: they are saved once, beside the
 * app's own settings, and every project they open has them. A project may
 * still keep an `api-keys.json` of its own — one shared with a teammate, or a
 * separate account for one job — and that file wins for that project. Keys
 * never leave this machine. Generation calls the providers directly from the
 * desktop main process and writes the finished media into the project's
 * `assets/generated/`, where the editor's asset library picks it up like any
 * other file.
 *
 * Provider contracts (verified against public docs, 2026-09-01):
 * - MiniMax H3 video: POST https://api.minimax.io/v2/video_generation with a
 *   content array (text + optional first_frame image), poll
 *   /v2/query/video_generation/{task_id}, download content.url.
 * - Gemini image (Nano Banana 2): models/{model}:generateContent with
 *   responseModalities IMAGE; inlineData base64 comes back.
 * - Fish Audio TTS: POST https://api.fish.audio/v1/tts, model in a header,
 *   optional reference_id voice; mp3 bytes come back.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { app, shell } from "electron";
import { requireProjectDir, requireProjectPath } from "./projects.ts";

const KEYS_FILE = "api-keys.json";

/**
 * Where the person's own keys live: beside the app's settings, so a project
 * made tomorrow can already talk. A key typed into the panel goes here.
 */
const myKeysFile = (): string => join(app.getPath("userData"), KEYS_FILE);

const MINIMAX_BASE = "https://api.minimax.io";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const FISH_BASE = "https://api.fish.audio/v1";

const MINIMAX_MODEL = "MiniMax-H3";
const GEMINI_MODEL = "gemini-3.1-flash-image-preview";
const FISH_MODEL = "s2-pro";

const TRANSCRIBE_BASE = "https://api.openai.com/v1";
const TRANSCRIBE_MODEL = "whisper-1";

/** Groq's OpenAI-compatible endpoint, and the model the voice bar asks it for. */
const GROQ_BASE = "https://api.groq.com/openai/v1";
const GROQ_MODEL = "whisper-large-v3-turbo";
/** xAI speech-to-text, behind the `voiceProvider` switch. */
const XAI_STT_URL = "https://api.x.ai/v1/stt";
const XAI_STT_MODEL = "grok-voice-transcribe-2.0";
/**
 * OpenRouter's typed-decision endpoint for Jev. It is `/alpha/` and may move,
 * so the path lives here and nowhere else; the model is pinned so behaviour
 * does not shift under the editor.
 */
const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const DECISIONS_MODEL = "typesafe/jev-1.13-20260917";

/** How long a spoken command may wait for its words, and a typed one for its reading. */
const COMMAND_TRANSCRIBE_TIMEOUT_MS = 8_000;
const DECIDE_TIMEOUT_MS = 4_000;
/** Groq takes 224 tokens of prompt; this many characters stays inside that. */
const COMMAND_PROMPT_CHARS = 800;
/** What the endpoints accept, and what fits in one request. */
const TRANSCRIBE_LIMIT = 25 * 1024 * 1024;

const VIDEO_POLL_MS = 5_000;
const VIDEO_MAX_POLLS = 120;

type AiKeys = {
  minimax: string;
  fish: string;
  gemini: string;
  /**
   * Any OpenAI-compatible transcription endpoint: OpenAI itself, Groq, or a
   * whisper server on this machine. That shape is the one that returns word
   * timestamps, which is what captions need — a transcript without them can
   * only be a block of text on screen.
   */
  transcribe: string;
  /** Where to send it. Defaults to OpenAI; set it for anything else. */
  transcribeUrl: string;
  /** The model that endpoint expects. Defaults to `whisper-1`. */
  transcribeModel: string;
  /** Which service turns a spoken command into words. */
  voiceProvider: "openai-compatible" | "xai";
  xai: string;
  /** For Jev, which reads free-form commands (the voice bar's own words). */
  openrouter: string;
  /** Where decisions go; the OpenRouter endpoint unless a local stand-in is set. */
  decisionsUrl: string;
};

export type AiLocalRequest = {
  kind: "image" | "video" | "voice";
  prompt?: string;
  text?: string;
  aspectRatio?: string;
  /** Image tier: "1K" | "2K". */
  resolution?: string;
  /** Video tier: "768P" | "2K". */
  quality?: string;
  durationSec?: number;
  voiceId?: string;
  /** Image-to-video first frame, as a data URL. */
  referenceImage?: string;
};

export type AiLocalResult = {
  /** Project-relative path of the finished media. */
  path: string;
  mimeType: string;
  /** Inline preview for images, so the panel can thumbnail and re-animate. */
  previewDataUrl?: string;
};

function keyField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const NO_KEYS: AiKeys = {
  minimax: "", fish: "", gemini: "",
  transcribe: "", transcribeUrl: TRANSCRIBE_BASE, transcribeModel: TRANSCRIBE_MODEL,
  voiceProvider: "openai-compatible", xai: "", openrouter: "", decisionsUrl: DECISIONS_URL,
};

/** One keys file, as keys; everything missing is empty. */
async function readKeysFile(path: string): Promise<AiKeys | null> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    return {
      minimax: keyField(raw.minimax),
      fish: keyField(raw.fish),
      gemini: keyField(raw.gemini),
      transcribe: keyField(raw.transcribe),
      transcribeUrl: keyField(raw.transcribeUrl) || TRANSCRIBE_BASE,
      transcribeModel: keyField(raw.transcribeModel) || TRANSCRIBE_MODEL,
      voiceProvider: keyField(raw.voiceProvider) === "xai" ? "xai" : "openai-compatible",
      xai: keyField(raw.xai),
      openrouter: keyField(raw.openrouter),
      decisionsUrl: keyField(raw.decisionsUrl) || DECISIONS_URL,
    };
  } catch {
    return null;
  }
}

/**
 * The keys a project works with: the person's own, with anything the project
 * states itself on top. A project that has never been given a key of its own
 * simply uses theirs — which is the whole point of saving them once.
 */
async function readKeys(dir: string): Promise<AiKeys> {
  const [mine, theirs] = await Promise.all([readKeysFile(myKeysFile()), readKeysFile(join(dir, KEYS_FILE))]);
  if (!mine && !theirs) return NO_KEYS;
  // Keys added before they were the person's rather than a project's: the
  // first project opened with them lends them to every other, once.
  if (!mine && theirs) {
    await mkdir(app.getPath("userData"), { recursive: true }).catch(() => undefined);
    await writeFile(myKeysFile(), `${JSON.stringify(theirs, null, 2)}\n`, "utf8").catch(() => undefined);
  }
  const base = mine ?? NO_KEYS;
  if (!theirs) return base;
  // Only what the project actually states wins: a blank field there is not a
  // decision to have no key.
  return {
    minimax: theirs.minimax || base.minimax,
    fish: theirs.fish || base.fish,
    gemini: theirs.gemini || base.gemini,
    transcribe: theirs.transcribe || base.transcribe,
    transcribeUrl: theirs.transcribeUrl !== TRANSCRIBE_BASE ? theirs.transcribeUrl : base.transcribeUrl,
    transcribeModel: theirs.transcribeModel !== TRANSCRIBE_MODEL ? theirs.transcribeModel : base.transcribeModel,
    voiceProvider: theirs.voiceProvider === "xai" || base.voiceProvider === "xai" ? (theirs.voiceProvider ?? base.voiceProvider) : "openai-compatible",
    xai: theirs.xai || base.xai,
    openrouter: theirs.openrouter || base.openrouter,
    decisionsUrl: theirs.decisionsUrl !== DECISIONS_URL ? theirs.decisionsUrl : base.decisionsUrl,
  };
}

export async function aiKeysStatus({ dir }: { dir: string }) {
  const projectDir = await requireProjectDir(dir);
  const keys = await readKeys(projectDir);
  return {
    minimax: Boolean(keys.minimax),
    fish: Boolean(keys.fish),
    gemini: Boolean(keys.gemini),
    transcribe: Boolean(keys.transcribe),
    openrouter: Boolean(keys.openrouter),
    xai: Boolean(keys.xai),
    voiceProvider: keys.voiceProvider,
    path: (await readKeysFile(join(projectDir, KEYS_FILE))) ? KEYS_FILE : myKeysFile(),
  };
}

async function ensureGitignored(projectDir: string): Promise<void> {
  const gitignore = join(projectDir, ".gitignore");
  try {
    const current = await readFile(gitignore, "utf8");
    if (!current.includes(KEYS_FILE)) {
      await appendFile(gitignore, `\n# Your private AI provider keys\n${KEYS_FILE}\n`, "utf8");
    }
  } catch {
    // No .gitignore — nothing to protect against; the folder isn't a repo.
  }
}

/**
 * Saves the keys the user typed into the panel. Only non-empty fields are
 * written, and existing keys are preserved when a field is left blank, so the
 * panel can send just the one key a user is adding. Keys never leave this
 * machine; the file is kept out of git.
 */
export async function aiKeysSave({
  dir,
  keys,
}: {
  dir: string;
  keys: Partial<AiKeys>;
}) {
  const projectDir = await requireProjectDir(dir);
  const current = await readKeys(projectDir);
  const next: AiKeys = {
    minimax: keyField(keys.minimax ?? current.minimax),
    fish: keyField(keys.fish ?? current.fish),
    gemini: keyField(keys.gemini ?? current.gemini),
    transcribe: keyField(keys.transcribe ?? current.transcribe),
    transcribeUrl: keyField(keys.transcribeUrl ?? current.transcribeUrl) || TRANSCRIBE_BASE,
    transcribeModel: keyField(keys.transcribeModel ?? current.transcribeModel) || TRANSCRIBE_MODEL,
    voiceProvider: (keys.voiceProvider ?? current.voiceProvider) === "xai" ? "xai" : "openai-compatible",
    xai: keyField(keys.xai ?? current.xai),
    openrouter: keyField(keys.openrouter ?? current.openrouter),
    decisionsUrl: keyField(keys.decisionsUrl ?? current.decisionsUrl) || DECISIONS_URL,
  };
  // The endpoint override is for a local stand-in only; the default is not written.
  const { decisionsUrl, ...stored } = next;
  const file = decisionsUrl === DECISIONS_URL ? stored : next;
  const text = `${JSON.stringify(file, null, 2)}\n`;

  // A key typed once is a key for every project: it is saved with the app's
  // own settings. A project that already keeps its own file is kept in step,
  // so what it says and what the person just typed cannot drift apart.
  await mkdir(join(app.getPath("userData")), { recursive: true }).catch(() => undefined);
  await writeFile(myKeysFile(), text, "utf8");
  if (await readKeysFile(join(projectDir, KEYS_FILE))) {
    await writeFile(join(projectDir, KEYS_FILE), text, "utf8");
  }
  await ensureGitignored(projectDir);
  return {
    minimax: Boolean(next.minimax),
    fish: Boolean(next.fish),
    gemini: Boolean(next.gemini),
    transcribe: Boolean(next.transcribe),
    openrouter: Boolean(next.openrouter),
    xai: Boolean(next.xai),
    voiceProvider: next.voiceProvider,
  };
}

/** Reveals api-keys.json in the file manager (creating it first if needed). */
export async function aiKeysReveal({ dir }: { dir: string }) {
  const projectDir = await requireProjectDir(dir);
  // Whichever file is actually in use: the project's own, or the person's.
  const theirs = join(projectDir, KEYS_FILE);
  const file = (await readKeysFile(theirs)) ? theirs : myKeysFile();
  if (file === myKeysFile() && !(await readKeysFile(file))) {
    await mkdir(app.getPath("userData"), { recursive: true }).catch(() => undefined);
    await writeFile(file, `${JSON.stringify({ transcribe: "", openrouter: "" }, null, 2)}\n`, "utf8");
  }
  shell.showItemInFolder(file);
  return { path: file };
}

function required(value: string | undefined, message: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function missingKey(provider: string, site: string): Error {
  return new Error(
    `No ${provider} API key yet. Open ${KEYS_FILE} in the project folder (the panel's button creates it) and paste your key from ${site}.`,
  );
}

async function providerJson(response: Response, label: string): Promise<Record<string, unknown>> {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const base = payload as { base_resp?: { status_msg?: unknown }; error?: { message?: unknown }; message?: unknown };
    const message =
      base.base_resp?.status_msg ?? base.error?.message ?? base.message ?? `${label} request failed (${response.status})`;
    throw new Error(String(message).slice(0, 300));
  }
  const baseResp = (payload as { base_resp?: { status_code?: number; status_msg?: unknown } }).base_resp;
  if (baseResp?.status_code !== undefined && baseResp.status_code !== 0) {
    throw new Error(String(baseResp.status_msg ?? `${label} error ${baseResp.status_code}`).slice(0, 300));
  }
  return payload;
}

async function generateImage(keys: AiKeys, request: AiLocalRequest): Promise<{ bytes: Buffer; mimeType: string }> {
  if (!keys.gemini) throw missingKey("Google Gemini", "aistudio.google.com/apikey");
  const prompt = required(request.prompt, "Describe the image to generate.");
  const response = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": keys.gemini, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          imageSize: request.resolution === "2K" ? "2K" : "1K",
          ...(request.aspectRatio && request.aspectRatio !== "adaptive"
            ? { aspectRatio: request.aspectRatio }
            : {}),
        },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await providerJson(response, "Gemini image");
  const candidates = (payload as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
  }).candidates;
  const part = candidates?.[0]?.content?.parts?.find((entry) => entry?.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error("Gemini returned no image data");
  return {
    bytes: Buffer.from(part.inlineData.data, "base64"),
    mimeType: part.inlineData.mimeType ?? "image/png",
  };
}

async function generateVoice(keys: AiKeys, request: AiLocalRequest): Promise<{ bytes: Buffer; mimeType: string }> {
  if (!keys.fish) throw missingKey("Fish Audio", "fish.audio");
  const text = required(request.text, "Write what the voice should say.");
  const response = await fetch(`${FISH_BASE}/tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${keys.fish}`,
      "Content-Type": "application/json",
      model: FISH_MODEL,
    },
    body: JSON.stringify({
      text,
      format: "mp3",
      ...(request.voiceId ? { reference_id: request.voiceId } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: unknown };
    throw new Error(String(payload.message ?? `Fish Audio request failed (${response.status})`).slice(0, 300));
  }
  return { bytes: Buffer.from(await response.arrayBuffer()), mimeType: "audio/mpeg" };
}

async function generateVideo(keys: AiKeys, request: AiLocalRequest): Promise<{ bytes: Buffer; mimeType: string }> {
  if (!keys.minimax) throw missingKey("MiniMax", "platform.minimax.io");
  const prompt = required(request.prompt, "Describe the video to generate.");
  const durationSec = Math.min(15, Math.max(4, Math.round(request.durationSec ?? 6)));
  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  if (request.referenceImage) {
    content.push({ type: "image_url", image_url: { url: request.referenceImage }, role: "first_frame" });
  }
  const headers = { Authorization: `Bearer ${keys.minimax}`, "Content-Type": "application/json" };
  const created = await providerJson(
    await fetch(`${MINIMAX_BASE}/v2/video_generation`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        content,
        duration: durationSec,
        resolution: request.quality === "2K" ? "2K" : "768P",
        ratio: request.aspectRatio ?? "9:16",
      }),
      signal: AbortSignal.timeout(60_000),
    }),
    "MiniMax video",
  );
  const taskId = (created.task_id ?? created.id) as string | undefined;
  if (!taskId) throw new Error("MiniMax did not return a video task id");

  let downloadUrl: string | undefined;
  for (let attempt = 0; attempt < VIDEO_MAX_POLLS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_MS));
    const task = await providerJson(
      await fetch(`${MINIMAX_BASE}/v2/query/video_generation/${encodeURIComponent(taskId)}`, {
        headers,
        signal: AbortSignal.timeout(60_000),
      }),
      "MiniMax video",
    );
    const status = String(task.status ?? "").toLowerCase();
    if (status === "success" || status === "succeeded") {
      const body = task as { content?: { url?: string }; video?: { url?: string }; file?: { download_url?: string } };
      downloadUrl = body.content?.url ?? body.video?.url ?? body.file?.download_url;
      if (!downloadUrl) throw new Error("MiniMax finished without a video URL");
      break;
    }
    if (status === "fail" || status === "failed" || status === "error") {
      const body = task as { base_resp?: { status_msg?: unknown }; error?: unknown };
      throw new Error(String(body.base_resp?.status_msg ?? body.error ?? "MiniMax video generation failed").slice(0, 300));
    }
  }
  if (!downloadUrl) throw new Error("MiniMax video generation timed out");

  const download = await fetch(downloadUrl, { signal: AbortSignal.timeout(300_000) });
  if (!download.ok) throw new Error(`MiniMax video download failed (${download.status})`);
  return { bytes: Buffer.from(await download.arrayBuffer()), mimeType: "video/mp4" };
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "video/mp4": "mp4",
};

/** Runs one generation with the project's own keys; returns the new asset's project-relative path. */
export async function aiGenerate({ dir, generation }: { dir: string; generation: AiLocalRequest }): Promise<AiLocalResult> {
  const projectDir = await requireProjectDir(dir);
  const keys = await readKeys(projectDir);

  let result: { bytes: Buffer; mimeType: string };
  if (generation.kind === "image") result = await generateImage(keys, generation);
  else if (generation.kind === "voice") result = await generateVoice(keys, generation);
  else if (generation.kind === "video") result = await generateVideo(keys, generation);
  else throw new Error(`Unknown generation kind: ${String(generation.kind)}`);

  const extension = EXTENSIONS[result.mimeType] ?? "bin";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `gen-${stamp}-${generation.kind}.${extension}`;
  const relative = join("assets", "generated", name);
  await mkdir(join(projectDir, "assets", "generated"), { recursive: true });
  await writeFile(join(projectDir, relative), result.bytes);
  const previewDataUrl =
    result.mimeType.startsWith("image/") && result.bytes.byteLength < 8_000_000
      ? `data:${result.mimeType};base64,${result.bytes.toString("base64")}`
      : undefined;
  return { path: relative.split("\\").join("/"), mimeType: result.mimeType, previewDataUrl };
}

/** One word, with the window it was spoken in. */
export interface TranscribedWord {
  text: string;
  start: number;
  end: number;
}

export interface TranscribeResult {
  text: string;
  words: TranscribedWord[];
  /** Sentence-ish groups, when the provider reports them. */
  segments: Array<{ text: string; start: number; end: number }>;
  /** True when this came back from the project's cache rather than a request. */
  cached: boolean;
}

/**
 * Transcribe a local audio or video file with the user's own key.
 *
 * The audio never leaves this machine except to the endpoint the user chose,
 * and the answer is cached in the project by the content hash of the file —
 * so re-captioning the same take, in this session or next year, costs nothing
 * and produces exactly the same words. That determinism matters as much as
 * the saving: captions that changed on every open would not be editable.
 */
export async function transcribeLocal({
  dir,
  path,
}: {
  dir: string;
  path: string;
}): Promise<TranscribeResult> {
  const projectDir = await requireProjectDir(dir);
  const absolute = await requireProjectPath(projectDir, path);
  const bytes = await readFile(absolute);

  if (bytes.byteLength > TRANSCRIBE_LIMIT) {
    throw new Error(
      `That file is ${Math.round(bytes.byteLength / 1024 / 1024)} MB; transcription takes up to 25 MB. Extract just the audio first.`,
    );
  }

  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const cacheDir = join(projectDir, ".posterract", "cache", "transcripts");
  const cacheFile = join(cacheDir, `${hash}.json`);

  try {
    const cached = JSON.parse(await readFile(cacheFile, "utf8")) as TranscribeResult;
    if (Array.isArray(cached.words)) return { ...cached, cached: true };
  } catch {
    // No cache entry yet, or an unreadable one: transcribe and replace it.
  }

  const keys = await readKeys(projectDir);
  if (!keys.transcribe) {
    throw new Error(
      `No transcription key yet. Open ${KEYS_FILE} in the project folder and set "transcribe" to a key for any OpenAI-compatible /v1/audio/transcriptions endpoint (OpenAI, Groq, or a local server via "transcribeUrl").`,
    );
  }

  const form = new FormData();
  form.append("file", new Blob([bytes as unknown as ArrayBuffer]), basename(absolute));
  form.append("model", keys.transcribeModel);
  form.append("response_format", "verbose_json");
  // Word timings are the point: without them captions can only be blocks.
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");

  const response = await fetch(`${keys.transcribeUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${keys.transcribe}` },
    body: form,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    text?: unknown;
    words?: Array<{ word?: unknown; start?: unknown; end?: unknown }>;
    segments?: Array<{ text?: unknown; start?: unknown; end?: unknown }>;
    error?: { message?: unknown };
  };
  if (!response.ok) {
    throw new Error(String(payload.error?.message ?? `Transcription failed (${response.status})`).slice(0, 300));
  }

  const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const words: TranscribedWord[] = (payload.words ?? [])
    .map((word) => ({ text: String(word.word ?? "").trim(), start: number(word.start), end: number(word.end) }))
    .filter((word) => word.text.length > 0 && word.end > word.start);

  const segments = (payload.segments ?? [])
    .map((segment) => ({ text: String(segment.text ?? "").trim(), start: number(segment.start), end: number(segment.end) }))
    .filter((segment) => segment.text.length > 0 && segment.end > segment.start);

  const result: TranscribeResult = {
    text: typeof payload.text === "string" ? payload.text : words.map((word) => word.text).join(" "),
    words,
    segments,
    cached: false,
  };

  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

// ---------------------------------------------------------------------------
// The voice bar: a spoken command in, its words out; a sentence in, a reading
// of it out. Both are short requests on the user's own keys, made from here so
// no key ever reaches the renderer.
// ---------------------------------------------------------------------------

/** Sends once, and once more after a moment when the service was busy or broken. */
async function withRetry(send: () => Promise<Response>): Promise<Response> {
  const first = await send();
  if (first.status !== 429 && first.status < 500) return first;
  await new Promise((resolve) => setTimeout(resolve, 400));
  return send();
}

/** What went wrong, in the provider's words when it gave any. */
async function providerError(response: Response, fallback: string): Promise<Error> {
  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: unknown } | string; message?: unknown };
  const message = typeof payload.error === "string" ? payload.error : payload.error?.message ?? payload.message;
  return new Error(String(message ?? `${fallback} (${response.status})`).slice(0, 300));
}

function timedOut(error: unknown, what: string): Error {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new Error(`${what} took too long to answer.`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** A spoken command's words as a command reads: trimmed, and no full stop after a short one. */
function tidyTranscript(text: string): string {
  const trimmed = text.trim();
  return trimmed.split(/\s+/).length <= 3 ? trimmed.replace(/\.$/, "") : trimmed;
}

async function transcribeOpenAiCompatible(keys: AiKeys, audio: Uint8Array, mime: string, prompt?: string): Promise<string> {
  if (!keys.transcribe) throw new Error("Add your Groq key to talk to the editor.");
  // A Groq key (gsk_…) with the endpoint still on the OpenAI default can only
  // mean Groq: send it there, with the model Groq serves.
  const groqKey = keys.transcribe.startsWith("gsk_");
  const base = (keys.transcribeUrl === TRANSCRIBE_BASE && groqKey ? GROQ_BASE : keys.transcribeUrl).replace(/\/+$/, "");
  const model = keys.transcribeModel === TRANSCRIBE_MODEL && groqKey ? GROQ_MODEL : keys.transcribeModel;

  const form = () => {
    const body = new FormData();
    body.append("file", new Blob([audio as unknown as ArrayBuffer], { type: mime }), "command.webm");
    body.append("model", model);
    body.append("response_format", "json");
    body.append("language", "en");
    body.append("temperature", "0");
    if (prompt) body.append("prompt", prompt.slice(0, COMMAND_PROMPT_CHARS));
    return body;
  };
  const response = await withRetry(() => fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${keys.transcribe}` },
    body: form(),
    signal: AbortSignal.timeout(COMMAND_TRANSCRIBE_TIMEOUT_MS),
  }));
  if (!response.ok) throw await providerError(response, "Transcription failed");
  const payload = (await response.json().catch(() => ({}))) as { text?: unknown };
  return typeof payload.text === "string" ? payload.text : "";
}

async function transcribeWithXai(keys: AiKeys, audio: Uint8Array, mime: string, prompt?: string): Promise<string> {
  if (!keys.xai) throw new Error("Add your xAI key to talk to the editor.");
  const terms = (prompt ?? "")
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term.length > 0 && term.length <= 50)
    .slice(0, 100);

  const form = () => {
    const body = new FormData();
    body.append("model", XAI_STT_MODEL);
    body.append("language", "en");
    body.append("format", "true");
    for (const term of terms) body.append("keyterm", term);
    // The file goes last: xAI reads the fields before it.
    body.append("file", new Blob([audio as unknown as ArrayBuffer], { type: mime }), "command.webm");
    return body;
  };
  const response = await withRetry(() => fetch(XAI_STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${keys.xai}` },
    body: form(),
    signal: AbortSignal.timeout(COMMAND_TRANSCRIBE_TIMEOUT_MS),
  }));
  if (!response.ok) throw await providerError(response, "Transcription failed");
  const payload = (await response.json().catch(() => ({}))) as { text?: unknown };
  return typeof payload.text === "string" ? payload.text : "";
}

/**
 * The words of a spoken command, from a short clip the voice bar recorded.
 * Not `transcribeLocal`: that takes a project file, caches by its hash and
 * asks for word timings, none of which a command needs.
 */
export async function transcribeCommand({
  dir,
  audio,
  mime,
  prompt,
}: {
  dir: string;
  audio: Uint8Array;
  mime: string;
  prompt?: string;
}): Promise<{ text: string; ms: number }> {
  const projectDir = await requireProjectDir(dir);
  if (!(audio instanceof Uint8Array) || audio.byteLength === 0) throw new Error("Nothing was recorded.");
  if (audio.byteLength > TRANSCRIBE_LIMIT) throw new Error("That recording is too long for a command.");
  const keys = await readKeys(projectDir);
  const started = Date.now();
  try {
    const text = keys.voiceProvider === "xai"
      ? await transcribeWithXai(keys, audio, mime, prompt)
      : await transcribeOpenAiCompatible(keys, audio, mime, prompt);
    return { text: tidyTranscript(text), ms: Date.now() - started };
  } catch (error) {
    throw timedOut(error, "The speech service");
  }
}

/** Decisions in flight, by the id the editor gave them, so a newer one can call an older one off. */
const decisions = new Map<string, AbortController>();

/**
 * One typed-decision request to Jev through OpenRouter: the situation, and
 * every question about it at once (they are answered in parallel).
 */
export async function decide({
  dir,
  state,
  questions,
  requestId,
}: {
  dir: string;
  state: unknown;
  questions: Record<string, unknown>;
  requestId?: string;
}): Promise<{ answers: Record<string, unknown>; usage?: unknown; ms: number }> {
  const projectDir = await requireProjectDir(dir);
  const keys = await readKeys(projectDir);
  if (!keys.openrouter) throw new Error("Add your OpenRouter key to use your own words.");

  const controller = new AbortController();
  if (requestId) decisions.set(requestId, controller);
  const started = Date.now();
  try {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(DECIDE_TIMEOUT_MS)]);
    const response = await withRetry(() => fetch(keys.decisionsUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${keys.openrouter}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: DECISIONS_MODEL, state, questions }),
      signal,
    }));
    if (!response.ok) throw await providerError(response, "Reading the command failed");
    const payload = (await response.json().catch(() => ({}))) as { answers?: Record<string, unknown>; usage?: unknown };
    return { answers: payload.answers ?? {}, usage: payload.usage, ms: Date.now() - started };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Cancelled.");
    throw timedOut(error, "Reading the command");
  } finally {
    if (requestId) decisions.delete(requestId);
  }
}

/** Calls off a decision the editor no longer wants (the person kept typing). */
export function cancelDecision({ requestId }: { requestId: string }): void {
  decisions.get(requestId)?.abort();
  decisions.delete(requestId);
}
