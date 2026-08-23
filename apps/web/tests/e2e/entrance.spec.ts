import { expect, test } from "@playwright/test";

test.describe("Posterract interactive entrance", () => {
  test("renders without errors and completes once from the keyboard", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/enter");
    const open = page.getByRole("button", { name: "Open Posterract and continue to sign in" });
    await expect(open).toBeVisible();

    await open.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/continuum/);
    expect(errors).toEqual([]);
  });

  test("uses the short transition when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/enter");
    await page.getByRole("button", { name: "Open Posterract and continue to sign in" }).click();
    await expect(page).toHaveURL(/\/continuum/);
  });

  test("fits a mobile viewport without horizontal overflow", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/enter");

    await expect(page.getByRole("button", { name: "Open Posterract and continue to sign in" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasOverflow).toBe(false);
  });
});
