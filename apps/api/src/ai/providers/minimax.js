import { MINIMAX_RESOLUTION_MAP } from "../constants.js";
import { MOCK_MP4_BASE64, mockDelay, mockEnabled } from "../mock.js";

const API_BASE = "https://api.minimax.io/v1";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 120;

function abortableDelay(ms, signal) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new Error("Video generation was aborted"));
      return;
    }
    const timer = setTimeout(resolvePromise, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Video generation was aborted"));
      },
      { once: true },
    );
  });
}

async function minimaxFetch(url, apiKey, init, signal) {
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.base_resp?.status_msg ??
      payload?.message ??
      `MiniMax request failed (${response.status})`;
    throw new Error(String(message).slice(0, 300));
  }
  const statusCode = payload?.base_resp?.status_code;
  if (statusCode !== undefined && statusCode !== 0) {
    throw new Error(
      String(payload.base_resp.status_msg ?? `MiniMax error ${statusCode}`).slice(0, 300),
    );
  }
  return payload;
}

/**
 * MiniMax Hailuo 3 text-to-video through the official async task API:
 * create a video_generation task, poll it, then download the finished file.
 */
export async function generate({ model, params, signal }) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (mockEnabled(apiKey)) {
    await mockDelay(signal);
    return {
      bytes: Buffer.from(MOCK_MP4_BASE64, "base64"),
      mimeType: "video/mp4",
      meta: { mock: true, provider: "minimax", model, params },
    };
  }

  const created = await minimaxFetch(
    `${API_BASE}/video_generation`,
    apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: params.prompt,
        duration: params.durationSec,
        resolution: MINIMAX_RESOLUTION_MAP[params.resolution],
        aspect_ratio: params.aspectRatio,
      }),
    },
    signal,
  );
  const taskId = created.task_id;
  if (!taskId) throw new Error("MiniMax did not return a video task id");

  let fileId;
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    await abortableDelay(POLL_INTERVAL_MS, signal);
    const task = await minimaxFetch(
      `${API_BASE}/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
      apiKey,
      { method: "GET" },
      signal,
    );
    const status = String(task.status ?? "").toLowerCase();
    if (status === "success") {
      fileId = task.file_id;
      break;
    }
    if (status === "fail") {
      throw new Error(
        String(task.base_resp?.status_msg ?? "MiniMax video generation failed").slice(0, 300),
      );
    }
  }
  if (!fileId) throw new Error("MiniMax video generation timed out");

  const file = await minimaxFetch(
    `${API_BASE}/files/retrieve?file_id=${encodeURIComponent(fileId)}`,
    apiKey,
    { method: "GET" },
    signal,
  );
  const downloadUrl = file.file?.download_url;
  if (!downloadUrl) throw new Error("MiniMax did not return a download URL");
  const download = await fetch(downloadUrl, {
    signal: signal ?? AbortSignal.timeout(120_000),
  });
  if (!download.ok) {
    throw new Error(`MiniMax video download failed (${download.status})`);
  }
  return {
    bytes: Buffer.from(await download.arrayBuffer()),
    mimeType: "video/mp4",
    meta: { provider: "minimax", model, taskId, fileId },
  };
}
