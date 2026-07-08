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

    // Dashboard chip reflects it (10 post + 5 streak + 25 first-post badge = 40).
    const chip = page.getByRole("link", { name: "Resonance points" });
    await expect(chip).toBeVisible();
    await expect(chip.getByText(/^[1-9]\d*$/)).toBeVisible();

    // The ledger feed shows the award.
    await page.goto("/points");
    await expect(page.getByText("First Transmission").first()).toBeVisible();
  });

  test("the device is a Start Post button", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Start a post" }).click();
    await expect(page).toHaveURL(/\/compose/);
  });
});
