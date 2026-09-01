/// <reference types="vite/client" />

type PosterractDesktopBridge = {
  platform: string;
  getPathForFile(file: File): string;
  send(channel: string, payload: unknown): void;
  on(channel: string, callback: (payload: unknown) => void): () => void;
  request<T = unknown>(channel: string, data?: unknown): Promise<T>;
};

interface Window {
  desktop?: PosterractDesktopBridge;
  __posterractPendingCliRequests?: unknown[];
}
