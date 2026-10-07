/**
 * What the app remembers between visits so it can paint at once: the last
 * workspace data and whether the plan was active, each kept for one signed-in
 * user and shown only to that user, then refreshed in the background. Both are
 * wiped at sign-out. Storage that is full, blocked or private is simply skipped.
 */

const ENGINE_KEY = "posterract.engine.v1";
const ENTITLED_KEY = "posterract.entitled.v1";

export function readCached<T>(key: "engine" | "entitled", userId: string | undefined): T | undefined {
  if (!userId) return undefined;
  try {
    const raw = window.localStorage.getItem(key === "engine" ? ENGINE_KEY : ENTITLED_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { userId?: string; value?: T };
    return parsed.userId === userId ? parsed.value : undefined;
  } catch {
    return undefined;
  }
}

export function writeCached(key: "engine" | "entitled", userId: string | undefined, value: unknown) {
  if (!userId) return;
  try {
    window.localStorage.setItem(key === "engine" ? ENGINE_KEY : ENTITLED_KEY, JSON.stringify({ userId, value }));
  } catch {
    // Full or blocked storage: the next visit just loads the usual way.
  }
}

export function forgetCached(key: "engine" | "entitled") {
  try {
    window.localStorage.removeItem(key === "engine" ? ENGINE_KEY : ENTITLED_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Sign-out: nothing of this account stays on the device. */
export function clearSessionCaches() {
  forgetCached("engine");
  forgetCached("entitled");
}
