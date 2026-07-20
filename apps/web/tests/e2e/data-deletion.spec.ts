import { expect, test } from "@playwright/test";

test("data-deletion status route remains public without an authenticated session", async ({ page }) => {
  await page.goto("/data-deletion");

  await expect(page.getByRole("heading", { name: "Data Deletion Status" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Status service unavailable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
});
