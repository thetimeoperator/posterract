import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { app, safeStorage, shell } from "electron";

export type DesktopSession = {
  user: { id: string; email: string; name?: string };
  workspaceId: string;
  role: string;
  device: {
    id: string;
    name: string;
    platform: string;
    appVersion?: string;
    createdAt: number;
    lastSeenAt: number;
  };
};

export type DesktopAuthState = {
  status: "loading" | "signed_out" | "authorizing" | "signed_in" | "error";
  session?: DesktopSession;
  error?: string;
  secureStorageAvailable: boolean;
};

type TokenPair = {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
};

type CloudRequest = {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  // Binary bodies (multipart transcription uploads) arrive as Uint8Array over
  // the structured-clone IPC boundary; Node's fetch accepts ArrayBufferView.
  body?: string | Uint8Array;
};

type CloudResponse = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
};

type UploadResult = { mediaId: string; key: string; status: "ready" };

const SAFE_HEADERS = new Set([
  "accept",
  "content-type",
  "idempotency-key",
  "if-match",
  "if-none-match",
]);

function apiBase(): string {
  const configured = process.env.POSTERRACT_API_URL?.replace(/\/+$/, "");
  if (!configured) return "https://api.posterract.app";
  const url = new URL(configured);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("POSTERRACT_API_URL must use HTTPS (or localhost for development)");
  }
  return url.origin;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return fallback;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, rejectDelay) => {
    if (signal?.aborted) return rejectDelay(signal.reason);
    const timer = setTimeout(resolveDelay, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        rejectDelay(signal.reason);
      },
      { once: true },
    );
  });
}

export class DesktopAuthManager {
  private state: DesktopAuthState = {
    status: "loading",
    secureStorageAvailable: false,
  };

  private accessToken?: string;
  private accessExpiresAt = 0;
  private refreshToken?: string;
  private refreshExpiresAt = 0;
  private refreshPromise?: Promise<void>;
  private authorization?: AbortController;

  constructor(private readonly onChange: (state: DesktopAuthState) => void) {}

  getState(): DesktopAuthState {
    return structuredClone(this.state);
  }

  private setState(next: DesktopAuthState): DesktopAuthState {
    this.state = next;
    this.onChange(this.getState());
    return this.getState();
  }

  private credentialPath(): string {
    return join(app.getPath("userData"), "desktop-session.bin");
  }

  private async storeRefreshToken(pair: Pick<TokenPair, "refreshToken" | "refreshExpiresAt">): Promise<void> {
    this.refreshToken = pair.refreshToken;
    this.refreshExpiresAt = pair.refreshExpiresAt;
    if (!safeStorage.isEncryptionAvailable()) return;
    const envelope = JSON.stringify({
      refreshToken: pair.refreshToken,
      refreshExpiresAt: pair.refreshExpiresAt,
    });
    const encrypted = safeStorage.encryptString(envelope);
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(this.credentialPath(), encrypted, { mode: 0o600 });
  }

  private async loadRefreshToken(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) return;
    try {
      const encrypted = await readFile(this.credentialPath());
      const parsed = JSON.parse(safeStorage.decryptString(encrypted)) as {
        refreshToken?: string;
        refreshExpiresAt?: number;
      };
      if (parsed.refreshToken?.startsWith("pd_refresh_") && Number(parsed.refreshExpiresAt) > Date.now()) {
        this.refreshToken = parsed.refreshToken;
        this.refreshExpiresAt = Number(parsed.refreshExpiresAt);
      } else {
        await this.clearCredentials();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") await this.clearCredentials();
    }
  }

  private async clearCredentials(): Promise<void> {
    this.accessToken = undefined;
    this.accessExpiresAt = 0;
    this.refreshToken = undefined;
    this.refreshExpiresAt = 0;
    await unlink(this.credentialPath()).catch(() => undefined);
  }

  private async publicJson(path: string, body: unknown): Promise<{ response: Response; payload: unknown }> {
    const response = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => undefined);
    return { response, payload };
  }

  private acceptPair(pair: TokenPair): void {
    this.accessToken = pair.accessToken;
    this.accessExpiresAt = Number(pair.accessExpiresAt);
  }

  async initialize(): Promise<DesktopAuthState> {
    this.state.secureStorageAvailable = safeStorage.isEncryptionAvailable();
    await this.loadRefreshToken();
    if (!this.refreshToken) {
      return this.setState({
        status: "signed_out",
        secureStorageAvailable: safeStorage.isEncryptionAvailable(),
      });
    }
    try {
      await this.refresh();
      return await this.loadSession();
    } catch {
      await this.clearCredentials();
      return this.setState({
        status: "signed_out",
        secureStorageAvailable: safeStorage.isEncryptionAvailable(),
      });
    }
  }

  async signIn(): Promise<DesktopAuthState> {
    this.authorization?.abort();
    const controller = new AbortController();
    this.authorization = controller;
    this.setState({
      status: "authorizing",
      secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    });
    try {
      const codeVerifier = randomBytes(48).toString("base64url");
      const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
      const started = await this.publicJson("/v1/desktop/auth/start", {
        deviceName: hostname() || "Posterract Desktop",
        platform: process.platform,
        appVersion: app.getVersion(),
        codeChallenge,
      });
      if (!started.response.ok) {
        throw new Error(errorMessage(started.payload, `Desktop authorization failed (${started.response.status})`));
      }
      const grant = started.payload as {
        requestId: string;
        pollToken: string;
        verificationUrl: string;
        expiresIn: number;
        interval: number;
      };
      await shell.openExternal(grant.verificationUrl);
      const deadline = Date.now() + grant.expiresIn * 1_000;
      while (Date.now() < deadline) {
        await delay(Math.max(2, grant.interval) * 1_000, controller.signal);
        const exchanged = await this.publicJson("/v1/desktop/auth/exchange", {
          requestId: grant.requestId,
          pollToken: grant.pollToken,
          codeVerifier,
        });
        if (exchanged.response.status === 428) continue;
        if (!exchanged.response.ok) {
          throw new Error(errorMessage(exchanged.payload, `Desktop authorization failed (${exchanged.response.status})`));
        }
        const pair = exchanged.payload as TokenPair;
        this.acceptPair(pair);
        await this.storeRefreshToken(pair);
        return await this.loadSession();
      }
      throw new Error("Desktop authorization expired");
    } catch (error) {
      if (controller.signal.aborted) {
        return this.setState({
          status: "signed_out",
          secureStorageAvailable: safeStorage.isEncryptionAvailable(),
        });
      }
      return this.setState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        secureStorageAvailable: safeStorage.isEncryptionAvailable(),
      });
    } finally {
      if (this.authorization === controller) this.authorization = undefined;
    }
  }

  private async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      if (!this.refreshToken || this.refreshExpiresAt <= Date.now()) throw new Error("Desktop session expired");
      const refreshed = await this.publicJson("/v1/desktop/auth/refresh", {
        refreshToken: this.refreshToken,
      });
      if (!refreshed.response.ok) {
        await this.clearCredentials();
        throw new Error(errorMessage(refreshed.payload, "Desktop session expired"));
      }
      const pair = refreshed.payload as TokenPair;
      this.acceptPair(pair);
      await this.storeRefreshToken(pair);
    })();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async access(): Promise<string> {
    if (!this.accessToken || this.accessExpiresAt <= Date.now() + 30_000) await this.refresh();
    if (!this.accessToken) throw new Error("Desktop sign-in required");
    return this.accessToken;
  }

  private async authenticatedFetch(request: CloudRequest, retry = true): Promise<Response> {
    if (!request.path.startsWith("/v1/") || request.path.startsWith("/v1/desktop/auth/start")) {
      throw new Error("Unsupported Posterract cloud path");
    }
    const method = (request.method ?? "GET").toUpperCase();
    if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) {
      throw new Error("Unsupported Posterract cloud method");
    }
    const headers = new Headers({ accept: "application/json" });
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      if (SAFE_HEADERS.has(name.toLowerCase())) headers.set(name, value);
    }
    headers.set("authorization", `Bearer ${await this.access()}`);
    // AI generation/transcription legitimately runs for minutes; the server
    // allows up to 600s on /v1/ai/* while everything else keeps the tight cap.
    const timeoutMs = request.path.startsWith("/v1/ai/") ? 600_000 : 60_000;
    const body =
      method === "GET" || request.body === undefined
        ? undefined
        : typeof request.body === "string"
          ? request.body
          : new Uint8Array(request.body);
    const response = await fetch(`${apiBase()}${request.path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401 && retry) {
      await this.refresh();
      return this.authenticatedFetch(request, false);
    }
    return response;
  }

  async cloudRequest(request: CloudRequest): Promise<CloudResponse> {
    const response = await this.authenticatedFetch(request);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name] = value;
    });
    return {
      status: response.status,
      ok: response.ok,
      headers,
      body: await response.text(),
    };
  }

  private async cloudJson<T>(request: CloudRequest): Promise<T> {
    const response = await this.cloudRequest(request);
    const payload = response.body
      ? (JSON.parse(response.body) as T & { error?: string })
      : undefined;
    if (!response.ok) {
      throw new Error(payload?.error ?? `Posterract API failed (${response.status})`);
    }
    return payload as T;
  }

  /** Upload a completed local export directly to R2 without renderer IPC. */
  async uploadFile(
    path: string,
    options: { contentType: string; durationMs?: number; width?: number; height?: number },
    onProgress?: (fraction: number) => void,
  ): Promise<UploadResult> {
    const details = await stat(path);
    if (!details.isFile() || details.size <= 0) throw new Error("Export file is empty or unavailable");
    const session = await this.cloudJson<{ uploadId: string; mediaId: string; key: string }>({
      path: "/v1/uploads/multipart",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: basename(path),
        contentType: options.contentType,
        sizeBytes: details.size,
        durationMs: options.durationMs,
        width: options.width,
        height: options.height,
        purpose: "publishing",
      }),
    });
    const encodedUploadId = encodeURIComponent(session.uploadId);
    const partSize = 16 * 1024 * 1024;
    const partCount = Math.ceil(details.size / partSize);
    const parts: Array<{ PartNumber: number; ETag: string }> = [];
    const file = await open(path, "r");
    let uploaded = 0;
    let cursor = 1;
    const worker = async () => {
      while (cursor <= partCount) {
        const partNumber = cursor++;
        const offset = (partNumber - 1) * partSize;
        const length = Math.min(partSize, details.size - offset);
        const bytes = Buffer.allocUnsafe(length);
        const readResult = await file.read(bytes, 0, length, offset);
        if (readResult.bytesRead !== length) throw new Error(`Could not read export part ${partNumber}`);
        const signed = await this.cloudJson<{ url: string }>({
          path: `/v1/uploads/multipart/${encodedUploadId}/parts/${partNumber}`,
          method: "POST",
        });
        const response = await fetch(signed.url, {
          method: "PUT",
          headers: { "content-length": String(length) },
          body: bytes,
          signal: AbortSignal.timeout(15 * 60_000),
        });
        if (!response.ok) throw new Error(`R2 upload part ${partNumber} failed (${response.status})`);
        const etag = response.headers.get("etag");
        if (!etag) throw new Error(`R2 upload part ${partNumber} returned no ETag`);
        parts.push({ PartNumber: partNumber, ETag: etag });
        uploaded += length;
        onProgress?.(uploaded / details.size);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, partCount) }, () => worker()));
      const completed = await this.cloudJson<UploadResult>({
        path: `/v1/uploads/multipart/${encodedUploadId}/complete`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parts: parts.sort((a, b) => a.PartNumber - b.PartNumber) }),
      });
      onProgress?.(1);
      return completed;
    } catch (error) {
      await this.cloudRequest({
        path: `/v1/uploads/multipart/${encodedUploadId}`,
        method: "DELETE",
      }).catch(() => undefined);
      throw error;
    } finally {
      await file.close();
    }
  }

  private async loadSession(): Promise<DesktopAuthState> {
    const response = await this.authenticatedFetch({ path: "/v1/desktop/session" });
    if (!response.ok) throw new Error(`Desktop session failed (${response.status})`);
    const session = (await response.json()) as DesktopSession;
    return this.setState({
      status: "signed_in",
      session,
      secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    });
  }

  async signOut(): Promise<DesktopAuthState> {
    this.authorization?.abort();
    if (this.accessToken || this.refreshToken) {
      await this.authenticatedFetch({ path: "/v1/desktop/auth/revoke", method: "POST" }, false).catch(() => undefined);
    }
    await this.clearCredentials();
    return this.setState({
      status: "signed_out",
      secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    });
  }
}
