/**
 * Stands in for `electron` when a main-process module is unit tested under
 * plain node. Only the surface the tested modules touch is provided.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.env.POSTERRACT_TEST_USER_DATA ?? join(tmpdir(), "posterract-test-userdata");

export const app = {
  getPath: (name: string) => (name === "userData" ? root : tmpdir()),
  getAppPath: () => process.cwd(),
  getVersion: () => "0.0.0-test",
};

/** Value stand-in so `import { BrowserWindow }` links; tests fake instances structurally. */
export class BrowserWindow {}

type IpcListener = (event: unknown, payload: unknown) => void;
const ipcListeners = new Map<string, Set<IpcListener>>();

/** Minimal ipcMain: enough for modules that register/remove channel listeners. */
export const ipcMain = {
  on(channel: string, listener: IpcListener): void {
    let listeners = ipcListeners.get(channel);
    if (!listeners) {
      listeners = new Set();
      ipcListeners.set(channel, listeners);
    }
    listeners.add(listener);
  },
  removeListener(channel: string, listener: IpcListener): void {
    ipcListeners.get(channel)?.delete(listener);
  },
};

/** Test hook: deliver a renderer message to whatever main registered. */
export function emitIpcMainEvent(channel: string, event: unknown, payload: unknown): void {
  for (const listener of ipcListeners.get(channel) ?? []) listener(event, payload);
}
