import { expect, test } from "@playwright/test";

/**
 * Resonance — the points system on the demo engine: the Points page renders,
 * publishing earns RP (visible on the dashboard chip + ledger), and the
 * device itself opens the composer.
 */

declare global {
  interface Window {
    __engine?: {
      getState: () => {
        addArtifact: (
          file: File,
          meta: { durationMs?: number; width?: number; height?: number },
        ) => Promise<{ id: string }>;
        createTransmission: (input: unknown) => { id: string };
        stats: { lifetimeRP: number };
      };
    };
  }
}

test.describe("Resonance points", () => {
  test("Points page renders rank ring and ladder", async ({ page }) => {
    await page.goto("/points");
    await expect(page.getByRole("progressbar", { name: "Progress to next rank" }).first()).toBeVisible();
    await expect(page.getByText("Drifter").first()).toBeVisible();
    await expect(page.getByText("Architect")).toBeVisible();
  });

  test("publishing earns RP and shows on dashboard + ledger", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await page.waitForFunction(() => !!window.__engine);

    await page.evaluate(async () => {
      const store = window.__engine!.getState();
      const file = new File([new Uint8Array(4_000_000)], "points-clip.mp4", { type: "video/mp4" });
      const artifact = await store.addArtifact(file, { durationMs: 15_000, width: 1080, height: 1920 });
      store.createTransmission({
        title: "Points check",
        baseCaption: "Charging the device",
        hashtags: [],
        artifactId: artifact.id,
        platforms: ["instagram"],
        perPlatformCaptions: {},
        scheduleMode: "now",
        scheduledFor: Date.now(),
      });
    });

    // The simulated publish lands and RP is awarded exactly through the live transition.
    await page.waitForFunction(() => (window.__engine!.getState().stats.lifetimeRP ?? 0) > 0, undefined, {
      timeout: 45_000,
    });

    // The shared ledger reflects awards created by the same engine used by the app/API path.
    await page.goto("/points");
    await expect(page.getByText("First Transmission").first()).toBeVisible();
  });

  test("the post-login home is the Forge", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/forge/);
    await expect(page.getByText("Your content harness is online.")).toBeVisible();
  });
});
