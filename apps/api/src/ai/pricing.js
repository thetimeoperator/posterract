import { RequestValidationError } from "../domain.js";
import {
  IMAGE_MODELS,
  IMAGE_RESOLUTIONS,
  TRANSCRIBE_MODELS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_MODELS,
  VIDEO_RESOLUTIONS,
  VOICE_MODELS,
} from "./constants.js";

/** Contract v1 credit prices. Pure math: no I/O, no environment reads. */
export const IMAGE_CREDITS = { "1k": 10, "2k": 15 };
export const VIDEO_CREDITS_PER_SECOND = { "768p": 12, "2k": 20 };
export const VOICE_CREDITS_PER_1K_CHARS = 3;
export const TRANSCRIBE_CREDITS_PER_MINUTE = 1;
export const VIDEO_MIN_DURATION_SECONDS = 4;
export const VIDEO_MAX_DURATION_SECONDS = 15;
export const MAX_PROMPT_CHARS = 4_000;
export const MAX_VOICE_CHARS = 50_000;
export const MAX_TRANSCRIBE_DURATION_SECONDS = 14_400;

export const GENERATION_KINDS = new Set(["image", "video", "voice"]);

const MODELS_BY_KIND = {
  image: IMAGE_MODELS,
  video: VIDEO_MODELS,
  voice: VOICE_MODELS,
  transcribe: TRANSCRIBE_MODELS,
};

function invalid(field, detail) {
  throw new RequestValidationError("invalid_generation_params", {
    field,
    detail,
  });
}

function requireObject(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    invalid("params", "params must be an object");
  }
  return params;
}

function requirePrompt(params) {
  const prompt = params.prompt;
  if (
    typeof prompt !== "string" ||
    prompt.trim().length === 0 ||
    prompt.length > MAX_PROMPT_CHARS
  ) {
    invalid("prompt", `prompt must be 1 to ${MAX_PROMPT_CHARS} characters`);
  }
  return prompt.trim();
}

function requireModel(kind, model) {
  const models = MODELS_BY_KIND[kind];
  if (!models) {
    throw new RequestValidationError("invalid_generation_kind", { kind });
  }
  if (typeof model !== "string" || !models.has(model)) {
    throw new RequestValidationError("invalid_generation_model", {
      kind,
      model,
      supported: [...models],
    });
  }
  return model;
}

/** Validate one generation request hard; returns normalized params. */
export function validateGeneration(kind, model, params) {
  requireModel(kind, model);
  requireObject(params);
  if (kind === "image") {
    const prompt = requirePrompt(params);
    const resolution = params.resolution;
    if (!IMAGE_RESOLUTIONS.has(resolution)) {
      invalid("resolution", "image resolution must be '1k' or '2k'");
    }
    const aspectRatio = params.aspectRatio ?? "adaptive";
    if (!VIDEO_ASPECT_RATIOS.has(aspectRatio)) {
      invalid("aspectRatio", `unsupported aspect ratio ${aspectRatio}`);
    }
    return { prompt, resolution, aspectRatio };
  }
  if (kind === "video") {
    const prompt = requirePrompt(params);
    const resolution = params.resolution;
    if (!VIDEO_RESOLUTIONS.has(resolution)) {
      invalid("resolution", "video resolution must be '768p' or '2k'");
    }
    const durationSec = params.durationSec;
    if (
      !Number.isInteger(durationSec) ||
      durationSec < VIDEO_MIN_DURATION_SECONDS ||
      durationSec > VIDEO_MAX_DURATION_SECONDS
    ) {
      invalid(
        "durationSec",
        `durationSec must be an integer between ${VIDEO_MIN_DURATION_SECONDS} and ${VIDEO_MAX_DURATION_SECONDS}`,
      );
    }
    const aspectRatio = params.aspectRatio ?? "9:16";
    if (!VIDEO_ASPECT_RATIOS.has(aspectRatio)) {
      invalid("aspectRatio", `unsupported aspect ratio ${aspectRatio}`);
    }
    return { prompt, resolution, durationSec, aspectRatio };
  }
  if (kind === "voice") {
    const text = params.text;
    if (
      typeof text !== "string" ||
      text.trim().length === 0 ||
      text.length > MAX_VOICE_CHARS
    ) {
      invalid("text", `text must be 1 to ${MAX_VOICE_CHARS} characters`);
    }
    const voiceId = params.voiceId;
    if (
      voiceId !== undefined &&
      (typeof voiceId !== "string" || voiceId.length === 0 || voiceId.length > 120)
    ) {
      invalid("voiceId", "voiceId must be a short identifier");
    }
    return { text, voiceId };
  }
  if (kind === "transcribe") {
    const durationSec = params.durationSec;
    if (
      !Number.isInteger(durationSec) ||
      durationSec < 1 ||
      durationSec > MAX_TRANSCRIBE_DURATION_SECONDS
    ) {
      invalid(
        "durationSec",
        `durationSec must be an integer between 1 and ${MAX_TRANSCRIBE_DURATION_SECONDS}`,
      );
    }
    return { durationSec };
  }
  throw new RequestValidationError("invalid_generation_kind", { kind });
}

/** quote(kind, model, params) → { credits, lineItems: [{ label, credits }] } */
export function quote(kind, model, params) {
  const normalized = validateGeneration(kind, model, params);
  if (kind === "image") {
    const credits = IMAGE_CREDITS[normalized.resolution];
    return {
      credits,
      lineItems: [
        { label: `Image ${normalized.resolution}`, credits },
      ],
    };
  }
  if (kind === "video") {
    const perSecond = VIDEO_CREDITS_PER_SECOND[normalized.resolution];
    const credits = perSecond * normalized.durationSec;
    return {
      credits,
      lineItems: [
        {
          label: `Video ${normalized.resolution} × ${normalized.durationSec}s @ ${perSecond}/s`,
          credits,
        },
      ],
    };
  }
  if (kind === "voice") {
    const blocks = Math.ceil(normalized.text.length / 1_000);
    const credits = blocks * VOICE_CREDITS_PER_1K_CHARS;
    return {
      credits,
      lineItems: [
        {
          label: `Voice ${normalized.text.length} chars (${blocks} × 1k block${blocks === 1 ? "" : "s"})`,
          credits,
        },
      ],
    };
  }
  const minutes = Math.ceil(normalized.durationSec / 60);
  const credits = minutes * TRANSCRIBE_CREDITS_PER_MINUTE;
  return {
    credits,
    lineItems: [
      {
        label: `Transcription ${minutes} min${minutes === 1 ? "" : "s"}`,
        credits,
      },
    ],
  };
}
