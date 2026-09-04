import {
  MOCK_TRANSCRIPTION_SEGMENTS,
  mockDelay,
  mockEnabled,
} from "../mock.js";

/**
 * Pluggable Whisper-class transcription over an OpenAI-compatible
 * /audio/transcriptions endpoint (TRANSCRIBE_API_URL + TRANSCRIBE_API_KEY).
 * Normalizes verbose_json into { segments: [{ text, words: [...] }] }.
 */
export async function generate({ model, params, signal }) {
  const apiUrl = process.env.TRANSCRIBE_API_URL;
  const apiKey = process.env.TRANSCRIBE_API_KEY;
  if (mockEnabled(apiUrl && apiKey)) {
    await mockDelay(signal);
    return {
      mimeType: "application/json",
      meta: { mock: true, provider: "transcribe", model, segments: MOCK_TRANSCRIPTION_SEGMENTS },
    };
  }
  if (!params.bytes) {
    throw new Error("Transcription requires audio bytes outside mock mode");
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([params.bytes], { type: params.mimeType ?? "audio/mpeg" }),
    params.filename ?? "audio.mp3",
  );
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");

  const timeout = AbortSignal.timeout(300_000);
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.error?.message ??
      payload?.message ??
      `Transcription request failed (${response.status})`;
    throw new Error(String(message).slice(0, 300));
  }
  return {
    mimeType: "application/json",
    meta: { provider: "transcribe", model, segments: normalizeSegments(payload) },
  };
}

function normalizeSegments(payload) {
  const words = Array.isArray(payload.words)
    ? payload.words.map((word) => ({
        text: String(word.word ?? word.text ?? ""),
        start: Number(word.start ?? 0),
        end: Number(word.end ?? 0),
      }))
    : [];
  if (Array.isArray(payload.segments) && payload.segments.length > 0) {
    return payload.segments.map((segment) => {
      const start = Number(segment.start ?? 0);
      const end = Number(segment.end ?? Number.MAX_SAFE_INTEGER);
      return {
        text: String(segment.text ?? "").trim(),
        words: words.filter((word) => word.start >= start && word.start < end),
      };
    });
  }
  return [{ text: String(payload.text ?? "").trim(), words }];
}
