import { expect, test } from "@playwright/test";

test.describe("Agent harness", () => {
  test("connects a BYOK agent in demo mode without persisting the secret", async ({ page }) => {
    await page.goto("/forge");
    await page.getByRole("button", { name: /Connect agent/i }).click();
    await page.getByLabel("Connection name").fill("Launch agent");
    await page.getByLabel("OpenAI API key").fill("sk-test-secret-1234");
    await page.getByRole("button", { name: "Test & connect" }).click();
    await expect(page.getByText("Launch agent").first()).toBeVisible();
    const storage = await page.evaluate(() => localStorage.getItem("posterract.harness") ?? "");
    expect(storage).not.toContain("sk-test-secret-1234");
    expect(storage).toContain("1234");
  });

  test("loads private skills and exposes safe metadata only", async ({ page }) => {
    await page.goto("/skills");
    await expect(page.getByRole("heading", { name: "Hook Architect" })).toBeVisible();
    await expect(page.getByText("Instruction source is never exposed.")).toHaveCount(0);
    await page.getByRole("button", { name: "Details" }).first().click();
    await expect(page.getByText("Instruction source is never exposed.")).toBeVisible();
    await expect(page.getByText(/private prompt/i)).toHaveCount(0);
  });

  test("creates a scoped Posterract API key and reveals it once", async ({ page }) => {
    await page.goto("/uplink");
    await page.getByRole("button", { name: "Create API key" }).first().click();
    await page.getByLabel("Key name").fill("Codex publishing agent");
    await page.getByRole("button", { name: "Create key" }).click();
    await expect(page.getByRole("heading", { name: "This key is shown once." })).toBeVisible();
    await expect(page.locator("code")).toContainText("pr_demo_");
    await page.getByRole("button", { name: "I saved the key" }).click();
    await expect(page.getByText("Codex publishing agent")).toBeVisible();
    await expect(page.locator("code")).toHaveCount(0);
  });
});
