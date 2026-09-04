/**
 * Deterministic mock outputs so the whole AI feature runs, demos, and tests
 * with zero provider keys. Every provider returns one of these when
 * POSTERRACT_AI_MOCK=1 or its API key is missing.
 */

export const MOCK_DELAY_MS = 50;

/** 1x1 transparent PNG. */
export const MOCK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Minimal MP4 ftyp box — a stable placeholder, not a playable clip. */
export const MOCK_MP4_BASE64 = "AAAAGGZ0eXBtcDQyAAAAAG1wNDJpc29t";

/** Empty ID3v2.4 header — a stable audio placeholder. */
export const MOCK_MP3_BASE64 = "SUQzBAAAAAAAAA==";

export const MOCK_TRANSCRIPTION_SEGMENTS = [
  {
    text: "Posterract mock transcription.",
    words: [
      { text: "Posterract", start: 0, end: 0.6 },
      { text: "mock", start: 0.6, end: 0.9 },
      { text: "transcription.", start: 0.9, end: 1.5 },
    ],
  },
];

export function mockEnabled(apiKey) {
  return process.env.POSTERRACT_AI_MOCK === "1" || !apiKey;
}

export function mockDelay(signal) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new Error("Generation was aborted"));
      return;
    }
    const timer = setTimeout(resolvePromise, MOCK_DELAY_MS);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Generation was aborted"));
      },
      { once: true },
    );
  });
}
