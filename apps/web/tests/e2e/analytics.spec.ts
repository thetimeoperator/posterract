import { expect, test } from "@playwright/test";

test.describe("Echoes analytics", () => {
  test("filters real platform-shaped signals by network and date range", async ({ page }) => {
    await page.goto("/echoes");

    await expect(page.getByTestId("analytics-dashboard")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What returned from the transmission." })).toBeVisible();
    await expect(page.getByRole("radio", { name: "All signals" })).toBeChecked();

    await page.getByRole("radio", { name: "Instagram" }).click();
    await page.getByRole("radio", { name: "7D" }).click();

    await expect(page.getByRole("radio", { name: "Instagram" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "7D" })).toBeChecked();
    await expect(page.getByRole("heading", { name: "Views · last 7 days" })).toBeVisible();
    await expect(page.getByText("Followers", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("radio", { name: "YouTube" })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "TikTok" })).toHaveCount(0);
  });

  test("keeps the analytics surface inside the tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/echoes");
    await expect(page.getByTestId("analytics-dashboard")).toBeVisible();
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);
  });
});
