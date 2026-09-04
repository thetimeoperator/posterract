import { MOCK_MP3_BASE64, mockDelay, mockEnabled } from "../mock.js";

const API_BASE = "https://api.fish.audio/v1";

/** Fish Audio Speech-2 Pro TTS; the model travels in the `model` header. */
export async function generate({ model, params, signal }) {
  const apiKey = process.env.FISH_AUDIO_API_KEY;
  if (mockEnabled(apiKey)) {
    await mockDelay(signal);
    return {
      bytes: Buffer.from(MOCK_MP3_BASE64, "base64"),
      mimeType: "audio/mpeg",
      meta: { mock: true, provider: "fish-audio", model, params },
    };
  }

  const timeout = AbortSignal.timeout(120_000);
  const response = await fetch(`${API_BASE}/tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      model,
    },
    body: JSON.stringify({
      text: params.text,
      format: "mp3",
      ...(params.voiceId ? { reference_id: params.voiceId } : {}),
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message =
      payload?.message ?? `Fish Audio request failed (${response.status})`;
    throw new Error(String(message).slice(0, 300));
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    mimeType: "audio/mpeg",
    meta: { provider: "fish-audio", model, voiceId: params.voiceId },
  };
}
