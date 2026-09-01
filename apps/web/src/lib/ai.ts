/**
 * AI generation + credits API client. Rides the same authenticated transport
 * as the rest of the /v1 interface (`cloudFetch`: cookies in the browser,
 * the Electron main process on Desktop), but keeps STRUCTURED error bodies —
 * a 402 insufficient_credits response carries {needed, balance, cycleResetsAt}
 * that the editor needs verbatim, not a flattened message string.
 */
import { cloudFetch } from "@/lib/cloudRequest";
import { desktopRequest, isPosterractDesktop } from "@/lib/desktop";
import type { CreditLedgerEntry, CreditsSummary } from "@/billing/plans";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";

export class AiRequestError extends Error {
  status: number;
  body: Record<string, unknown> | undefined;

  constructor(status: number, body: unknown) {
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
    const message =
      (typeof record?.detail === "string" && record.detail) ||
      (typeof record?.error === "string" && record.error) ||
      `Posterract API failed (${status})`;
    super(message);
    this.name = "AiRequestError";
    this.status = status;
    this.body = record;
  }
}

async function aiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await cloudFetch(API_BASE, path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => undefined)) as T | undefined;
  if (!response.ok) throw new AiRequestError(response.status, payload);
  if (response.status === 204 || payload === undefined) return undefined as T;
  return payload;
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

export function fetchCredits(): Promise<CreditsSummary> {
  return aiJson<CreditsSummary>("/v1/credits");
}

export function fetchCreditsLedger(limit = 50): Promise<{ entries: CreditLedgerEntry[] }> {
  return aiJson<{ entries: CreditLedgerEntry[] }>(`/v1/credits/ledger?limit=${limit}`);
}

// ---------------------------------------------------------------------------
// Generations
// ---------------------------------------------------------------------------

export type AiGenerateInput = {
  kind: "image" | "video" | "voice";
  model: string;
  params: Record<string, unknown>;
  declarationHash: string;
};

export function quoteGeneration(input: AiGenerateInput) {
  return aiJson<{ credits: number; lineItems: unknown[] }>("/v1/ai/generate", {
    method: "POST",
    body: JSON.stringify({ ...input, mode: "quote" }),
  });
}

export function executeGeneration(input: AiGenerateInput) {
  return aiJson<{ generationId: string; credits: number; status: string }>("/v1/ai/generate", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ ...input, mode: "execute" }),
  });
}

export function fetchGeneration(id: string) {
  return aiJson<Record<string, unknown>>(`/v1/ai/generations/${encodeURIComponent(id)}`);
}

export function listGenerations(limit = 25) {
  return aiJson<Record<string, unknown>>(`/v1/ai/generations?limit=${limit}`);
}

// ---------------------------------------------------------------------------
// Transcription
//
// POST /v1/ai/transcribe takes either JSON {mediaId, durationSec} for media
// already in the workspace, or a multipart upload for bytes the editor holds
// locally. Both shapes REQUIRE an Idempotency-Key: without one the endpoint
// answers 400 idempotency_key_required before it ever reads the body.
// ---------------------------------------------------------------------------

/** The endpoint's ceiling on one inline upload. */
const MAX_TRANSCRIBE_AUDIO_BYTES = 25 * 1024 * 1024;

export type TranscriptionResult = { segments: unknown[]; creditsSettled: number };

/** Transcribe media already uploaded to the workspace, by id. */
export function transcribeMedia(payload: Record<string, unknown>) {
  return aiJson<TranscriptionResult>("/v1/ai/transcribe", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(payload),
  });
}

export type TranscribeUpload = {
  bytes: ArrayBuffer | ArrayBufferView;
  fileName?: unknown;
  mimeType?: unknown;
  durationSec?: unknown;
};

type DesktopCloudResponse = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
};

/**
 * The same authenticated transport as `cloudFetch` — browser cookies, or the
 * Electron main process where Desktop's access token lives — but carrying a
 * binary body. `cloudFetch` refuses anything but a serialized string on
 * Desktop, which a multipart upload cannot be; the bytes travel over IPC by
 * structured clone instead. Fold this back into `cloudFetch` once it learns
 * to carry binary.
 */
async function cloudPostBinary(
  path: string,
  headers: Record<string, string>,
  body: Uint8Array<ArrayBuffer>,
): Promise<Response> {
  if (!isPosterractDesktop()) {
    return fetch(`${API_BASE}${path}`, { method: "POST", headers, body, credentials: "include" });
  }
  const result = await desktopRequest<DesktopCloudResponse>("cloud:request", {
    path,
    method: "POST",
    headers,
    body,
  });
  return new Response(result.body || null, { status: result.status, headers: result.headers });
}

/** One text field plus one file part, in the layout the API's parser expects. */
function encodeMultipart(
  boundary: string,
  fields: Array<[string, string]>,
  file: { field: string; fileName: string; mimeType: string; bytes: Uint8Array },
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const text = fields
    .map(([name, value]) => `--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
    .join("");
  const head = encoder.encode(
    `${text}--${boundary}\r\n` +
      `content-disposition: form-data; name="${file.field}"; filename="${file.fileName}"\r\n` +
      `content-type: ${file.mimeType}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + file.bytes.length + tail.length);
  body.set(head, 0);
  body.set(file.bytes, head.length);
  body.set(tail, head.length + file.bytes.length);
  return body;
}

function bytesOf(value: unknown): Uint8Array | undefined {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return undefined;
}

/** A header-safe filename: quotes and newlines would break the part's headers. */
function safeFileName(value: unknown): string {
  const name = typeof value === "string" ? value.split("/").pop()?.trim() : "";
  return (name || "audio").replace(/["\\\r\n]/g, "_").slice(0, 120);
}

/** Transcribe bytes the editor holds locally, as a multipart upload. */
export async function transcribeUpload(input: TranscribeUpload): Promise<TranscriptionResult> {
  const bytes = bytesOf(input.bytes);
  if (!bytes?.byteLength) {
    throw new AiRequestError(400, {
      error: "invalid_transcription_request",
      detail: "Transcription upload carried no audio bytes",
    });
  }
  if (bytes.byteLength > MAX_TRANSCRIBE_AUDIO_BYTES) {
    throw new AiRequestError(413, {
      error: "audio_too_large",
      detail: `Transcription accepts at most ${MAX_TRANSCRIBE_AUDIO_BYTES / 1_048_576} MB per upload`,
    });
  }
  const seconds = Number(input.durationSec);
  if (!Number.isFinite(seconds) || seconds < 1) {
    throw new AiRequestError(400, {
      error: "invalid_generation_params",
      detail: "Transcription needs durationSec, a whole number of seconds",
    });
  }
  const mimeType = typeof input.mimeType === "string" && input.mimeType.includes("/")
    ? input.mimeType
    : "application/octet-stream";

  const boundary = `posterract${crypto.randomUUID().replace(/-/g, "")}`;
  const body = encodeMultipart(boundary, [["durationSec", String(Math.ceil(seconds))]], {
    field: "audio",
    fileName: safeFileName(input.fileName),
    mimeType,
    bytes,
  });
  const response = await cloudPostBinary("/v1/ai/transcribe", {
    // Built by hand, so the boundary has to be declared by hand too.
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "Idempotency-Key": crypto.randomUUID(),
    accept: "application/json",
  }, body);
  const payload = (await response.json().catch(() => undefined)) as TranscriptionResult | undefined;
  if (!response.ok) throw new AiRequestError(response.status, payload);
  if (!payload) throw new AiRequestError(response.status, { error: "empty_response" });
  return payload;
}

// ---------------------------------------------------------------------------
// Editor bridge dispatcher — the Create iframe posts
//   {type:'posterract-ai-request', id, action, payload}
// and the host answers {type:'posterract-ai-response', id, ok, data|error}.
// ---------------------------------------------------------------------------

export type AiBridgeAction = "credits" | "quote" | "execute" | "status" | "generations" | "transcribe";

export type AiBridgeError = {
  /** Machine-readable code, e.g. "insufficient_credits" or "unknown_action". */
  error: string;
  /** HTTP status when the failure came from the API. */
  status?: number;
  message: string;
  [key: string]: unknown;
};

export function serializeAiBridgeError(cause: unknown): AiBridgeError {
  if (cause instanceof AiRequestError) {
    return {
      status: cause.status,
      message: cause.message,
      ...cause.body,
      error: typeof cause.body?.error === "string" ? cause.body.error : "request_failed",
    };
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return { error: "request_failed", message };
}

function record(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

function generateInput(payload: unknown): AiGenerateInput {
  const { kind, model, params, declarationHash } = record(payload);
  if (kind !== "image" && kind !== "video" && kind !== "voice") {
    throw new Error("AI request needs kind: 'image' | 'video' | 'voice'");
  }
  if (typeof model !== "string" || !model) throw new Error("AI request needs a model id");
  if (typeof declarationHash !== "string" || !declarationHash) {
    throw new Error("AI request needs a declarationHash");
  }
  return { kind, model, params: record(params), declarationHash };
}

/**
 * Map one editor AI request to the API. Unknown actions resolve to a rejected
 * promise (never a crash) so the host can answer {ok:false} deterministically.
 */
export async function handleAiBridgeRequest(action: unknown, payload: unknown): Promise<unknown> {
  switch (action) {
    case "credits":
      return fetchCredits();
    case "quote":
      return quoteGeneration(generateInput(payload));
    case "execute":
      return executeGeneration(generateInput(payload));
    case "status": {
      const { id, generationId } = record(payload);
      const target = typeof generationId === "string" ? generationId : typeof id === "string" ? id : "";
      if (!target) throw new Error("AI status request needs a generationId");
      return fetchGeneration(target);
    }
    case "generations": {
      const { limit } = record(payload);
      const parsed = Number(limit);
      return listGenerations(Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 25);
    }
    case "transcribe": {
      // Two shapes reach the same endpoint: bytes from the editor's own asset
      // library go up as multipart, an already-uploaded asset by mediaId as
      // JSON. The presence of `bytes` is what tells them apart.
      const request = record(payload);
      if ("bytes" in request) {
        const { bytes } = request;
        if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) {
          throw new AiRequestError(400, {
            error: "invalid_transcription_request",
            detail: "Transcription bytes must cross the bridge as an ArrayBuffer",
          });
        }
        return transcribeUpload({ ...request, bytes });
      }
      return transcribeMedia(request);
    }
    default:
      throw new AiRequestError(400, {
        error: "unknown_action",
        detail: `Unknown AI bridge action: ${String(action)}`,
      });
  }
}
