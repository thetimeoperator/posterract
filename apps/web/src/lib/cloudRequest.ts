import { desktopRequest, isPosterractDesktop } from "./desktop";

type DesktopCloudResponse = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
};

function serializedHeaders(value: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(value).forEach((headerValue, name) => {
    result[name] = headerValue;
  });
  return result;
}

/**
 * One authenticated transport for the shared interface. Browsers keep using
 * Better Auth cookies; Desktop sends requests through Electron's main process,
 * where its short-lived native access token lives.
 */
export async function cloudFetch(
  apiBaseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!isPosterractDesktop()) {
    return fetch(`${apiBaseUrl}${path}`, { ...init, credentials: "include" });
  }
  if (init.signal?.aborted) throw init.signal.reason;
  if (init.body !== undefined && typeof init.body !== "string") {
    throw new Error("Desktop cloud requests currently require a serialized body");
  }
  const result = await desktopRequest<DesktopCloudResponse>("cloud:request", {
    path,
    method: init.method,
    headers: serializedHeaders(init.headers),
    body: init.body,
  });
  return new Response(result.body || null, {
    status: result.status,
    headers: result.headers,
  });
}

export async function cloudJson<T>(
  apiBaseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await cloudFetch(apiBaseUrl, path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => undefined)) as
    | (T & { error?: string; detail?: string })
    | undefined;
  if (!response.ok) {
    throw new Error(payload?.detail ?? payload?.error ?? `Posterract API failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  if (payload === undefined) throw new Error("Posterract returned an empty response");
  return payload;
}
