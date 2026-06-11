import { expect, test } from "@playwright/test";

test.describe("Posterract shell", () => {
  test("Bridge renders with shell chrome and no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.getByRole("banner").getByText("The Bridge")).toBeVisible();
    await expect(page.getByRole("link", { name: /New Post/i }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Navigator opens with Cmd+K and jumps to Portals", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByPlaceholder("Jump to… or type a command");
    await expect(input).toBeVisible();
    await input.fill("portals");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/portals/);
  });

  test("Signals panel opens from the bell", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Open Signals/i }).click();
    await expect(page.getByRole("dialog", { name: /Signals/i })).toBeVisible();
  });

  test("Hyperkit gallery renders every section", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/dev/hyperkit");
    for (const section of ["Buttons", "Status badges", "Platform chips & runes", "Fields", "Progress", "Panels"]) {
      await expect(page.getByRole("heading", { name: section })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("unknown route shows the Lost Dimension page", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page.getByText("Lost in a dimension")).toBeVisible();
  });
});
