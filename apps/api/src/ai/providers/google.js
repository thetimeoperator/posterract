import { GEMINI_IMAGE_SIZE_MAP } from "../constants.js";
import { MOCK_PNG_BASE64, mockDelay, mockEnabled } from "../mock.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Google Nano Banana 2 image generation through the Gemini API. */
export async function generate({ model, params, signal }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (mockEnabled(apiKey)) {
    await mockDelay(signal);
    return {
      bytes: Buffer.from(MOCK_PNG_BASE64, "base64"),
      mimeType: "image/png",
      meta: { mock: true, provider: "google", model, params },
    };
  }

  const safeModel = encodeURIComponent(model.replace(/^models\//, ""));
  const timeout = AbortSignal.timeout(120_000);
  const response = await fetch(`${API_BASE}/models/${safeModel}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: params.prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          imageSize: GEMINI_IMAGE_SIZE_MAP[params.resolution],
          ...(params.aspectRatio && params.aspectRatio !== "adaptive"
            ? { aspectRatio: params.aspectRatio }
            : {}),
        },
      },
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.error?.message ?? `Gemini image request failed (${response.status})`;
    throw new Error(String(message).slice(0, 300));
  }
  const part = payload.candidates?.[0]?.content?.parts?.find(
    (candidate) => candidate?.inlineData?.data,
  );
  if (!part) throw new Error("Gemini returned no image data");
  return {
    bytes: Buffer.from(part.inlineData.data, "base64"),
    mimeType: part.inlineData.mimeType ?? "image/png",
    meta: { provider: "google", model },
  };
}
