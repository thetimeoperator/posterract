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
export const DEFAULT_TRANSCRIBE_MODEL = "whisper-1";

export const IMAGE_MODELS = new Set([GEMINI_IMAGE_MODEL]);
export const VIDEO_MODELS = new Set([MINIMAX_VIDEO_MODEL]);
export const VOICE_MODELS = new Set([FISH_VOICE_MODEL]);
export const TRANSCRIBE_MODELS = new Set([DEFAULT_TRANSCRIBE_MODEL]);

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
