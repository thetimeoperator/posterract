/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import {
  CLI_PROTOCOL_VERSION,
  CLI_WIRE,
  SOCKET_PATH,
  type CliRendererReply,
  type CliRendererRequest,
  type CliSocketReply,
  type CliSocketRequest,
} from "@posterract/cli/protocol";

type PendingRequest = {
  token: string;
  webContentsId: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (reply: CliSocketReply) => void;
};

const MAX_REQUEST_BYTES = 1_048_576;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;

let server: Server | null = null;
let headless = false;
let responseListener: ((event: IpcMainEvent, payload: unknown) => void) | null = null;
const pendingRequests = new Map<string, PendingRequest>();

export function isCliHeadless(): boolean {
  return headless;
}

function staleSocketCleanup(): void {
  if (process.platform === "win32") return;
  try {
    if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);
  } catch {
    // Best effort. A bind error below remains visible in the desktop logs.
  }
}

function waitForRenderer(window: BrowserWindow, timeoutMs = 30_000): Promise<void> {
  if (window.isDestroyed() || window.webContents.isCrashed()) {
    return Promise.reject(new Error("The Posterract renderer is unavailable"));
  }
  if (!window.webContents.isLoading()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(() => reject(new Error("The Posterract renderer did not become ready"))),
      timeoutMs,
    );
    const loaded = () => finish(resolve);
    const failed = () => finish(() => reject(new Error("The Posterract renderer failed to load")));
    const finish = (done: () => void) => {
      clearTimeout(timeout);
      window.webContents.off("did-finish-load", loaded);
      window.webContents.off("did-fail-load", failed);
      done();
    };
    window.webContents.once("did-finish-load", loaded);
    window.webContents.once("did-fail-load", failed);
  });
}

function sendToRenderers(window: BrowserWindow, request: CliRendererRequest): void {
  // The desktop shell is the single router for editor requests. Sending to
  // every subframe can execute one command twice while an iframe is loading.
  window.webContents.send(CLI_WIRE.REQUEST, request);
}

function socketReply(socket: Socket, reply: CliSocketReply): void {
  if (socket.destroyed) return;
  try {
    socket.end(JSON.stringify(reply));
  } catch (error) {
    socket.destroy(error instanceof Error ? error : new Error(String(error)));
  }
}

function errorReply(socket: Socket, error: unknown): void {
  socketReply(socket, {
    ok: false,
    protocolVersion: CLI_PROTOCOL_VERSION,
    error: error instanceof Error ? error.message : String(error),
  });
}

function finishPending(id: string, reply: CliSocketReply): void {
  const pending = pendingRequests.get(id);
  if (!pending) return;
  pendingRequests.delete(id);
  clearTimeout(pending.timer);
  pending.resolve(reply);
}

export async function relayCliRequest(
  envelope: CliSocketRequest,
  getWindow: () => BrowserWindow | null,
): Promise<CliSocketReply> {
  try {
    if (envelope.protocolVersion !== CLI_PROTOCOL_VERSION) {
      throw new Error(
        `CLI protocol ${envelope.protocolVersion} is incompatible with desktop protocol ${CLI_PROTOCOL_VERSION}`,
      );
    }
    if (!envelope.request || typeof envelope.request.path !== "string" || !envelope.request.path) {
      throw new Error("Invalid CLI request");
    }
    const window = getWindow();
    if (!window || window.isDestroyed()) throw new Error("No Posterract window is available");
    await waitForRenderer(window);

    const id = randomBytes(16).toString("hex");
    const token = randomBytes(32).toString("hex");
    const requestedTimeout = Number.isFinite(envelope.timeoutMs) ? envelope.timeoutMs : 60_000;
    const timeoutMs = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, requestedTimeout));
    installResponseListener();
    return await new Promise<CliSocketReply>((resolve) => {
      const timer = setTimeout(() => {
        finishPending(id, {
          ok: false,
          protocolVersion: CLI_PROTOCOL_VERSION,
          error: `The Posterract editor did not answer ${envelope.request.path} within ${timeoutMs}ms`,
        });
      }, timeoutMs);

      pendingRequests.set(id, {
        token,
        webContentsId: window.webContents.id,
        timer,
        resolve,
      });

      sendToRenderers(window, {
        protocolVersion: CLI_PROTOCOL_VERSION,
        id,
        token,
        request: envelope.request,
        activity: envelope.activity,
      });
    });
  } catch (error) {
    return {
      ok: false,
      protocolVersion: CLI_PROTOCOL_VERSION,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function deliver(
  envelope: CliSocketRequest,
  socket: Socket,
  getWindow: () => BrowserWindow | null,
): Promise<void> {
  socketReply(socket, await relayCliRequest(envelope, getWindow));
}

function installResponseListener(): void {
  if (responseListener) return;
  responseListener = (event, payload) => {
    const response = payload as CliRendererReply;
    if (
      !response ||
      response.protocolVersion !== CLI_PROTOCOL_VERSION ||
      typeof response.id !== "string" ||
      typeof response.token !== "string" ||
      !response.reply
    ) return;
    const pending = pendingRequests.get(response.id);
    if (!pending) return;
    if (event.sender.id !== pending.webContentsId || response.token !== pending.token) return;
    finishPending(response.id, response.reply.ok
      ? { ok: true, protocolVersion: CLI_PROTOCOL_VERSION, data: response.reply.data }
      : { ok: false, protocolVersion: CLI_PROTOCOL_VERSION, error: response.reply.error });
  };
  ipcMain.on(CLI_WIRE.RESPONSE, responseListener);
}

export function startCliServer(getWindow: () => BrowserWindow | null): void {
  if (server) return;
  staleSocketCleanup();
  installResponseListener();
  server = createServer({ allowHalfOpen: true }, (socket) => {
    headless = true;
    let body = "";
    socket.setEncoding("utf8");
    socket.setTimeout(60_000, () => socket.destroy());
    socket.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
        socket.destroy(new Error("CLI request is too large"));
      }
    });
    socket.on("end", () => {
      socket.setTimeout(0);
      try {
        const request = JSON.parse(body) as CliSocketRequest;
        if (!request || typeof request !== "object") throw new Error("Invalid CLI request");
        void deliver(request, socket, getWindow);
      } catch {
        errorReply(socket, new Error("Invalid CLI request"));
      }
    });
    socket.on("error", () => undefined);
  });
  server.on("error", (error) => console.error("[posterract-cli]", error));
  server.listen(SOCKET_PATH, () => {
    if (process.platform !== "win32") chmodSync(SOCKET_PATH, 0o600);
  });
}

export function stopCliServer(): void {
  for (const [id] of pendingRequests) {
    finishPending(id, {
      ok: false,
      protocolVersion: CLI_PROTOCOL_VERSION,
      error: "Posterract Desktop is closing",
    });
  }
  if (responseListener) {
    ipcMain.removeListener(CLI_WIRE.RESPONSE, responseListener);
    responseListener = null;
  }
  server?.close();
  server = null;
  staleSocketCleanup();
}
