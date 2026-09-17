import { expect, test } from "@playwright/test";

/**
 * The product loop, end to end on the local engine:
 * add a video → schedule a post → watch it publish → verify it in the
 * queue and the Vault.
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
      };
    };
  }
}

test.describe("Posterract product loop", () => {
  test("schedule → publish → live in queue and Vault", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await expect(page.getByRole("toolbar", { name: "Posterract navigation" })).toBeVisible();
    await page.waitForFunction(() => !!window.__engine);

    // Agent-style creation through the engine (what the public API will do)
    await page.evaluate(async () => {
      const store = window.__engine!.getState();
      const file = new File([new Uint8Array(8_000_000)], "e2e-clip.mp4", { type: "video/mp4" });
      const artifact = await store.addArtifact(file, { durationMs: 18_000, width: 1080, height: 1920 });
      store.createTransmission({
        title: "E2E happy path",
        baseCaption: "Automated check",
        hashtags: ["e2e"],
        artifactId: artifact.id,
        platforms: ["instagram", "tiktok"],
        perPlatformCaptions: {},
        scheduleMode: "now",
        scheduledFor: Date.now(),
      });
    });

    // Queue shows it and it goes fully Live (simulator pacing + retry budget)
    await page.goto("/transmissions");
    const row = page.locator("li", { hasText: "E2E happy path" }).first();
    await expect(row).toBeVisible();
    await expect(row.locator('[data-status="live"]').first()).toBeVisible({ timeout: 45_000 });

    // Projection log shows platform URLs
    await row.getByRole("button", { name: "Expand log" }).click();
    await expect(row.getByText("Instagram", { exact: true }).last()).toBeVisible();
    await expect(row.getByRole("link", { name: /View/ }).first()).toBeVisible();

    // The artifact lives in the Vault
    await page.goto("/vault");
    await expect(page.getByText("e2e-clip.mp4").first()).toBeVisible();
  });

  test("composer pre-flight blocks launch until an artifact is added", async ({ page }) => {
    await page.goto("/compose");
    const launch = page.getByRole("button", { name: /Publish now|Schedule post/ });
    await expect(launch).toBeDisabled();
    await expect(page.getByText("Add a video to continue.")).toBeVisible();
  });

  test("composer exposes only the four approved publishing targets", async ({ page }) => {
    await page.goto("/compose");
    const targets = page.getByRole("group", { name: "Target accounts" });
    for (const platform of ["Instagram", "TikTok", "Facebook", "Threads"]) {
      await expect(targets.getByRole("button", { name: new RegExp(platform, "i") })).toBeVisible();
    }
    await expect(targets.getByRole("button", { name: /YouTube/i })).toHaveCount(0);
    await expect(targets.getByRole("button", { name: /X/, exact: true })).toHaveCount(0);
  });

  test("web composer keeps shared and platform captions in the same editor", async ({ page }) => {
    await page.goto("/compose");

    await expect(page.getByLabel("Title (internal)")).toHaveCount(0);
    const captions = page.getByRole("tablist", { name: "Caption variants" });
    await expect(captions.getByRole("tab", { name: "Base", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Base caption", exact: true })).toBeVisible();
    for (const platform of ["Instagram", "TikTok", "Facebook", "Threads"]) {
      const target = page.getByRole("group", { name: "Target accounts" }).getByRole("button", { name: platform, exact: true });
      if (await target.getAttribute("aria-pressed") === "false") await target.click();
      await captions.getByRole("tab", { name: platform, exact: true }).click();
      await expect(page.getByRole("textbox", { name: `${platform} caption`, exact: true })).toBeVisible();
    }
  });

  test("portals reflect connected and disconnected account identities", async ({ page }) => {
    await page.goto("/portals");
    const instagramCard = page.locator("section", { hasText: "Instagram" }).first();
    await instagramCard.getByRole("button", { name: "Disconnect" }).click();
    await expect(instagramCard.getByText("DISCONNECTED", { exact: true })).toBeVisible();
    await page.evaluate(() => (window.__engine!.getState() as unknown as { setPortalStatus(provider: string, status: string): void }).setPortalStatus("instagram", "connected"));
    await expect(instagramCard.getByText("● CONNECTED")).toBeVisible();

    const youtubeCard = page.locator("section", { hasText: "YouTube" }).first();
    await expect(youtubeCard.getByText("Connection not available yet")).toBeVisible();
  });
});
