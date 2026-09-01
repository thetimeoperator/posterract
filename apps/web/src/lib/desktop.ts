export const isPosterractDesktop = (): boolean =>
  Boolean(window.desktop && window.desktop.platform !== "web");

export function desktopRequest<T>(channel: string, data?: unknown): Promise<T> {
  if (!isPosterractDesktop() || !window.desktop) {
    return Promise.reject(new Error("Posterract Desktop bridge is unavailable"));
  }
  return window.desktop.request<T>(channel, data);
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isPosterractDesktop()) {
    await desktopRequest<void>("app:open-external", { url });
    return;
  }
  window.location.assign(url);
}
