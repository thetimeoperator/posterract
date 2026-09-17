import { expect, type Page } from "@playwright/test";

/** Exercise the actual HTTP engine against intercepted local requests, keeping
 * the isolated demo shell so tests never sign in or contact production. */
export async function useApiEngine(page: Page) {
  await page.route("**/src/engine/useEngine.ts", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const body = source.replace(/const impl = POSTGRES\s*\? postgresEngine\s*:\s*CLOUD\s*\? cloudEngine\s*:\s*localEngine;/, "const impl = postgresEngine;");
    expect(body).not.toBe(source);
    await route.fulfill({ response, body });
  });
}

export function emptyBootstrap() {
  return {
    workspaceId: "00000000-0000-4000-8000-000000000001",
    artifacts: [] as any[], accountSets: [] as any[], portals: [] as any[],
    transmissions: [], projections: [], events: [],
    points: { lifetimeRP: 0, weekRP: 0, streakDays: 0, badges: [], recent: [] },
  };
}
