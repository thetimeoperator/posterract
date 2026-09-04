/**
 * Canonical provider model identifiers and option maps for AI generation.
 * Every externally visible model id lives here so a provider rename is a
 * one-line change. VERIFY the exact ids in each provider console when the
 * production API keys are created — they are recorded from the July 2026
 * provider documentation and may shift before launch.
 */

// Google Nano Banana 2 image generation via the Gemini API.
// VERIFY at signup: the preview id may graduate to a stable alias.
export const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image-preview";

// MiniMax Hailuo 3 (H3) text-to-video via the official async task API.
// VERIFY at signup: MiniMax also publishes dated ids such as "MiniMax-Hailuo-03".
export const MINIMAX_VIDEO_MODEL = "hailuo-3";

// Fish Audio Speech-2 Pro TTS; sent as the `model` request header.
export const FISH_VOICE_MODEL = "s2-pro";

// Whisper-class transcription model name forwarded to TRANSCRIBE_API_URL.
/**
 * Transcription runs on Alibaba's Qwen ASR through its OpenAI-compatible
 * endpoint, so the provider below needs no adapter.
 *
 * `qwen3-asr-flash` is the batch (file) model at $0.000035/second — about
 * $0.13 an hour, roughly a third of OpenAI Whisper's $0.36. The `-realtime`
 * and `-streaming` variants cost $0.00009/second for live transcription,
 * which captions never need: they are made from a finished file.
 *
 * Set TRANSCRIBE_API_URL to
 * https://dashscope-intl.aliyuncs.com/compatible-mode/v1 and
 * TRANSCRIBE_API_KEY to a DashScope key. Any other OpenAI-compatible endpoint
 * (Groq, OpenAI, a local Whisper server) works by changing those two values
 * and this model name.
 */
export const DEFAULT_TRANSCRIBE_MODEL = "qwen3-asr-flash";

export const IMAGE_MODELS = new Set([GEMINI_IMAGE_MODEL]);
export const VIDEO_MODELS = new Set([MINIMAX_VIDEO_MODEL]);
export const VOICE_MODELS = new Set([FISH_VOICE_MODEL]);
export const TRANSCRIBE_MODELS = new Set([
  DEFAULT_TRANSCRIBE_MODEL,
  "qwen-audio-3.0-asr-flash",
  "qwen-audio-3.0-asr-flash-filetrans",
  // Kept accepted so an existing key on another provider keeps working.
  "whisper-1",
  "whisper-large-v3-turbo",
]);

export const IMAGE_RESOLUTIONS = new Set(["1k", "2k"]);
export const VIDEO_RESOLUTIONS = new Set(["768p", "2k"]);

/** Pricing/API resolution names → MiniMax video API values. */
export const MINIMAX_RESOLUTION_MAP = { "768p": "768P", "2k": "2K" };

/** Pricing/API resolution names → Gemini imageConfig.imageSize values. */
export const GEMINI_IMAGE_SIZE_MAP = { "1k": "1K", "2k": "2K" };

export const VIDEO_ASPECT_RATIOS = new Set([
  "9:16",
  "16:9",
  "1:1",
  "4:3",
  "3:4",
  "21:9",
  "adaptive",
]);
