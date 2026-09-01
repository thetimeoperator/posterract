/**
 * AI generation + credits API client. Rides the same authenticated transport
 * as the rest of the /v1 interface (`cloudFetch`: cookies in the browser,
 * the Electron main process on Desktop), but keeps STRUCTURED error bodies —
 * a 402 insufficient_credits response carries {needed, balance, cycleResetsAt}
 * that the editor needs verbatim, not a flattened message string.
 */
import { cloudFetch } from "@/lib/cloudRequest";
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

export function transcribeMedia(payload: Record<string, unknown>) {
  return aiJson<{ segments: unknown[]; creditsSettled: number }>("/v1/ai/transcribe", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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
    case "transcribe":
      return transcribeMedia(record(payload));
    default:
      throw new AiRequestError(400, {
        error: "unknown_action",
        detail: `Unknown AI bridge action: ${String(action)}`,
      });
  }
}
