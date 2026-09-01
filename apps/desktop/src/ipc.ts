import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { MAIN_WIRE, type MainChannel, type MainEvent, type MainReply, type MainRequest } from "./channels.ts";

type MainIpcEvent = IpcMainEvent | IpcMainInvokeEvent;
type Handler = (data: never, event: MainIpcEvent) => unknown | Promise<unknown>;

const handlers = new Map<MainChannel, Handler>();
let installed = false;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validRequest(value: unknown): value is MainRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<MainRequest>;
  return (
    typeof request.id === "string" &&
    request.id.length >= 8 &&
    request.id.length <= 128 &&
    typeof request.channel === "string"
  );
}

export function installMainBridge(): void {
  if (installed) return;
  installed = true;
  ipcMain.on(MAIN_WIRE.REQUEST, async (event, envelope: unknown) => {
    if (!validRequest(envelope)) return;
    const handler = handlers.get(envelope.channel);
    let reply: MainReply;
    if (!handler) {
      reply = { id: envelope.id, ok: false, error: `Unsupported desktop request: ${envelope.channel}` };
    } else {
      try {
        const data = await handler(envelope.data as never, event);
        reply = { id: envelope.id, ok: true, data };
      } catch (error) {
        reply = { id: envelope.id, ok: false, error: errorMessage(error) };
      }
    }
    // `event.sender.send` always targets the WebContents main frame. The
    // creative editor runs in a child frame, so reply through the originating
    // IPC event to deliver the response back to the preload that requested it.
    if (!event.sender.isDestroyed()) event.reply(MAIN_WIRE.RESPONSE, reply);
  });
}

export function handle(channel: MainChannel, handler: Handler): void {
  if (handlers.has(channel)) throw new Error(`Desktop handler already registered: ${channel}`);
  handlers.set(channel, handler);
}

export function invoke(channel: MainChannel, data: unknown, event: MainIpcEvent): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) return Promise.reject(new Error(`Unsupported desktop request: ${channel}`));
  return Promise.resolve(handler(data as never, event));
}

export function emit(window: BrowserWindow | null, channel: MainChannel, data: unknown): void {
  if (!window || window.isDestroyed()) return;
  const event: MainEvent = { channel, data };
  for (const frame of window.webContents.mainFrame.framesInSubtree) {
    if (!frame.isDestroyed()) frame.send(MAIN_WIRE.EVENT, event);
  }
}
