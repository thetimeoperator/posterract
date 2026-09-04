import {
  MOCK_TRANSCRIPTION_SEGMENTS,
  mockDelay,
  mockEnabled,
} from "../mock.js";

/**
 * Transcription over an OpenAI-compatible endpoint
 * (TRANSCRIBE_API_URL + TRANSCRIBE_API_KEY), in either of the two shapes that
 * exist in the wild:
 *
 * - **Whisper-class** (`whisper-1`, Groq, a local server): multipart upload to
 *   `/audio/transcriptions`, answering `verbose_json` with word timings.
 * - **Qwen ASR** (`qwen3-asr-flash`): a chat completion carrying the audio as
 *   an `input_audio` part. It is the cheaper option — about 13 cents an hour
 *   against Whisper's 36 — but returns text without word timings.
 *
 * Both normalize to `{ segments: [{ text, words: [...] }] }`. Where a provider
 * gives no word timings the caller synthesizes them from word length, exactly
 * as it does for an imported `.srt`, so captions animate the same either way.
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

  if (isQwenAsr(model)) {
    return transcribeWithQwen({ apiUrl, apiKey, model, params, signal });
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


/** Qwen's ASR models answer on the chat endpoint rather than /audio/transcriptions. */
function isQwenAsr(model) {
  return typeof model === "string" && model.startsWith("qwen");
}

/**
 * Qwen ASR through the OpenAI-compatible chat endpoint.
 *
 * The audio travels as a base64 data URL inside an `input_audio` content part
 * — there is no multipart form and no `/audio/transcriptions` path. The reply
 * is a chat message whose content is the transcript, so there is one segment
 * and no word timings; `segmentFromLine` in the runtime fills those in from
 * word length when the captions are built.
 */
async function transcribeWithQwen({ apiUrl, apiKey, model, params, signal }) {
  const base = String(apiUrl).replace(/\/+$/, "");
  const audio = Buffer.from(params.bytes).toString("base64");
  const format = (params.mimeType ?? "audio/mpeg").split("/")[1]?.split(";")[0] ?? "mp3";

  const timeout = AbortSignal.timeout(300_000);
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: `data:${params.mimeType ?? "audio/mpeg"};base64,${audio}`, format } },
          ],
        },
      ],
    }),
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

  const content = payload?.choices?.[0]?.message?.content;
  // The content may be a plain string or the multimodal array form.
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (typeof part === "string" ? part : part?.text ?? "")).join("")
      : "";

  return {
    mimeType: "application/json",
    meta: {
      provider: "transcribe",
      model,
      segments: [{ text: text.trim(), words: [] }],
    },
  };
}
