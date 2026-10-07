import { isPosterractDesktop } from "./desktop";

/**
 * A tab left open keeps running the code it opened with: a deploy only reaches
 * it on a full reload. So the app asks the server which build is live when the
 * window comes back into view and every few minutes, and once a newer one is
 * out, the next click loads it (a page that isn't being looked at reloads at once).
 */

declare const __POSTERRACT_BUILD__: string;

type Router = {
  subscribe: (event: "onBeforeNavigate", listener: (event: { toLocation: { href: string }; pathChanged: boolean }) => void) => () => void;
};

export function watchForNewBuild(router: Router) {
  if (import.meta.env.DEV || isPosterractDesktop() || typeof __POSTERRACT_BUILD__ === "undefined") return;
  let stale = false;
  let checking = false;

  const check = async () => {
    if (stale || checking) return;
    checking = true;
    try {
      const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const { build } = (await response.json()) as { build?: string };
      if (build && build !== __POSTERRACT_BUILD__) {
        stale = true;
        if (document.visibilityState === "hidden") window.location.reload();
      }
    } catch {
      // Offline or between deploys: ask again later.
    } finally {
      checking = false;
    }
  };

  router.subscribe("onBeforeNavigate", (event) => {
    if (stale && event.pathChanged) window.location.assign(event.toLocation.href);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
    else if (stale) window.location.reload();
  });
  window.addEventListener("focus", () => void check());
  window.setInterval(() => void check(), 5 * 60_000);
}
