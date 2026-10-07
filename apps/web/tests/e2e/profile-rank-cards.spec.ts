import { expect, test } from "@playwright/test";

test("the profile shows only the current rank card, and Post opens a new post with the card's video", async ({ page }) => {
  await page.goto("/profile");
  const stage = page.getByRole("region", { name: "Your rank card" });
  await expect(stage.locator("canvas.rc-side--face")).toBeVisible();
  await expect(stage.getByRole("heading", { name: "Rank card" })).toBeVisible();
  await expect(page.locator("canvas.rc-side--face")).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Cards for your videos/ })).toBeVisible();

  // The account menu leads here.
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Profile" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Post card" }).click();
  await page.waitForURL(/\/compose\?/, { timeout: 60_000 });
  const url = new URL(page.url());
  expect(url.searchParams.get("artifact")).toBeTruthy();
  expect(url.searchParams.get("platforms")).toBe("instagram,facebook,threads");
  await expect(page.getByRole("textbox")).toHaveValue(/on Posterract/);
  await expect(page.locator(".web-compose-video video")).toHaveCount(1);
});

test("every video in Recent points makes its own rank card, ready to post", async ({ page }) => {
  await page.goto("/points");
  const feed = page.getByRole("region", { name: "Recent points" });
  const cards = feed.getByRole("button", { name: /^Make a rank card for / });
  await expect(cards.first()).toBeVisible();
  // One Card button per video; the streak and follower lines have none.
  await expect(cards).toHaveCount(await feed.locator("li.feed-item").count());

  await cards.first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("canvas.rc-side--face")).toBeVisible();
  await expect(dialog.getByText("Video card")).toBeVisible();
  await dialog.getByRole("button", { name: "Post card" }).click();
  await page.waitForURL(/\/compose\?/, { timeout: 60_000 });
  await expect(page.getByRole("textbox")).toHaveValue(/views and .* points on .*Scored on Posterract/);
  await expect(page.locator(".web-compose-video video")).toHaveCount(1);
});
