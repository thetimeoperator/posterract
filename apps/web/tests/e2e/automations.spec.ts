import { expect, test } from "@playwright/test";

test.describe("Automations", () => {
  test("sample flow exists and applies into the composer", async ({ page }) => {
    await page.goto("/automations");
    const card = page.locator("section", { hasText: "Repurpose: IG-first" }).first();
    await expect(card).toBeVisible();

    await card.getByRole("link").getByRole("button", { name: "Use" }).click();
    await expect(page).toHaveURL(/\/compose\?.*flow=/);

    // Pre-filled from the flow: platforms, hashtag, schedule mode + caption tabs
    await expect(page.getByRole("group", { name: "Target platforms" }).first().getByRole("button", { name: "X", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("#repurpose").first()).toBeVisible();
    await expect(page.getByRole("radio", { name: "Schedule" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("tab", { name: "TikTok" })).toBeVisible();
  });

  test("create a new flow via the builder", async ({ page }) => {
    await page.goto("/automations");
    await page.getByRole("button", { name: "New automation" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Flow name").fill("YT-only longform teaser");
    // Deselect defaults (instagram, x) and pick youtube only
    await dialog.getByRole("button", { name: "Instagram" }).click();
    await dialog.getByRole("button", { name: "X", exact: true }).click();
    await dialog.getByRole("button", { name: "YouTube" }).click();
    await dialog.getByRole("button", { name: "Save flow" }).click();
    await expect(page.locator("section", { hasText: "YT-only longform teaser" }).first()).toBeVisible();
  });
});
