import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import { MAIN_WIRE } from "./channels.ts";
import { CLI_WIRE } from "@posterract/cli/channels";

const PRIVATE_REQUEST = "posterract:desktop-request";
const PRIVATE_FILE_GRANT = "posterract:file-grant";
const ALLOWED_SEND = new Set<string>([MAIN_WIRE.REQUEST, CLI_WIRE.RESPONSE]);
const ALLOWED_RECEIVE = new Set<string>([MAIN_WIRE.RESPONSE, MAIN_WIRE.EVENT, CLI_WIRE.REQUEST]);

function getPathForFile(file: File): string {
  const path = webUtils.getPathForFile(file);
  if (path) ipcRenderer.send(PRIVATE_FILE_GRANT, path);
  return path;
}

function send(channel: string, payload: unknown): void {
  if (!ALLOWED_SEND.has(channel)) return;
  const request = payload as {
    channel?: string;
    data?: { blob?: Blob; [key: string]: unknown };
  };
  if (request.channel === "projects:fs-write" && request.data?.blob instanceof Blob) {
    const { blob, ...data } = request.data;
    void blob.arrayBuffer().then((buffer) => {
      ipcRenderer.send(channel, {
        ...(payload as Record<string, unknown>),
        data: { ...data, bytes: new Uint8Array(buffer) },
      });
    });
    return;
  }
  ipcRenderer.send(channel, payload);
}

function on(channel: string, callback: (payload: unknown) => void): () => void {
  if (!ALLOWED_RECEIVE.has(channel)) return () => undefined;
  const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  getPathForFile,
  send,
  on,
  request: (channel: string, data?: unknown) => ipcRenderer.invoke(PRIVATE_REQUEST, channel, data),
});
