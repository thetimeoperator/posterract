import { expect, test, type Page } from "@playwright/test";

// Isolated local demo data only: these tests do not connect to or publish on TikTok.
async function seed(page: Page, multiple = false) {
  await page.goto("/compose");
  await page.waitForFunction(() => !!window.__engine);
  await page.evaluate(({ multiple }) => {
    const engine = (window as any).__engine;
    const portals = engine.getState().portals.map((account: any) => ({
      ...account, avatarUrl: "/brand/platforms/tiktok.png",
      displayName: account.provider === "tiktok" ? "TikTok Creator" : "Posterract",
    }));
    const first = portals.find((account: any) => account.provider === "tiktok");
    const second = { ...first, id: "tiktok_second", displayName: "Second Creator", handle: "@second.creator" };
    engine.setState({ portals: multiple ? [...portals, second] : portals, businesses: multiple ? [
      { id: "first-set", name: "First creator", accounts: [first], accountIds: [first.id], workspaceId: "ws_local", createdAt: Date.now(), updatedAt: Date.now() },
    ] : [] });
  }, { multiple });
  await page.reload();
  await expect(page.getByRole("list", { name: "Selected posting accounts" })).toBeVisible();
}

test("selected account names sit below unchanged avatars and wrap without clipping", async ({ page }) => {
  await seed(page);
  const names = page.getByRole("list", { name: "Selected posting accounts" });
  const targets = page.getByRole("group", { name: "Target accounts" });
  await expect(names.getByRole("listitem")).toHaveText(["Instagram: Posterract", "TikTok: TikTok Creator"]);
  await expect(page.getByRole("dialog", { name: "Platform settings" })).not.toBeVisible();
  for (const provider of ["Facebook", "Threads"]) await targets.getByRole("button", { name: provider, exact: true }).click();
  await expect(names.getByRole("listitem")).toHaveCount(4);
  await page.screenshot({ path: "/tmp/posterract-account-names-desktop.png", fullPage: true });

  const longName = "Creator".repeat(24);
  await page.evaluate((longName) => {
    const engine = (window as any).__engine;
    engine.setState({ portals: engine.getState().portals.map((account: any) => account.provider === "instagram" ? { ...account, displayName: longName } : account) });
  }, longName);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(names).toContainText(longName);
    expect(await names.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const avatar = (await targets.getByRole("button", { name: "TikTok", exact: true }).boundingBox())!;
    const label = (await names.boundingBox())!;
    expect(avatar.width).toBe(44);
    expect(avatar.height).toBe(44);
    expect(label.y).toBeGreaterThanOrEqual(avatar.y + avatar.height);
    const content = (await page.locator(".web-compose-content").boundingBox())!;
    expect(content.y).toBeGreaterThanOrEqual(label.y + label.height);
  }
  await page.screenshot({ path: "/tmp/posterract-account-names-mobile-long.png", fullPage: true });
  await targets.getByRole("button", { name: "TikTok", exact: true }).click();
  await expect(names).not.toContainText("TikTok:");
  for (const provider of ["Instagram", "Facebook", "Threads"]) await targets.getByRole("button", { name: provider, exact: true }).click();
  await expect(names).toHaveCount(0);
});

test("name line follows exact account selection, Account Sets and disconnection", async ({ page }) => {
  await seed(page, true);
  const names = page.getByRole("list", { name: "Selected posting accounts" });
  await expect(names).toContainText("TikTok: Choose account");
  await expect(names).not.toContainText("Second Creator");
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Accounts", exact: true });
  await picker.getByLabel("TikTok account", { exact: true }).selectOption("tiktok_second");
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await expect(names).toContainText("TikTok: Second Creator");
  await page.getByLabel("Business", { exact: true }).selectOption("first-set");
  await expect(names.getByRole("listitem")).toHaveText(["TikTok: TikTok Creator"]);
  await page.evaluate(() => (window as any).__engine.getState().setPortalStatus("tiktok", "disconnected"));
  await expect(names).toContainText("TikTok: TikTok Creator (disconnected)");
  await expect(page.getByRole("button", { name: "Publish now", exact: true })).toBeDisabled();
});

test("visible TikTok name uses refreshed creator information rather than the cached account label", async ({ page }) => {
  await page.route("**/src/engine/local.ts", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const updated = source.replace(/creator_nickname:\s*account.displayName \|\| account.handle/, 'creator_nickname: "Fresh TikTok Nickname"');
    expect(updated).not.toBe(source);
    await route.fulfill({ response, body: updated });
  });
  await seed(page);
  await expect(page.getByRole("list", { name: "Selected posting accounts" })).toContainText("TikTok: Fresh TikTok Nickname");
});

test("five TikTok choices are visible square checkboxes with existing behavior intact", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Platform settings" });
  await dialog.getByRole("tab", { name: "TikTok", exact: true }).click();
  await dialog.getByLabel("Disclose commercial content").check();
  const boxes = dialog.locator('.web-compose-checkbox-row input[type="checkbox"]');
  await expect(boxes).toHaveCount(5);
  for (const box of await boxes.all()) {
    await expect(box).toBeVisible();
    await expect(box).toHaveCSS("opacity", "1");
    await expect(box).toHaveCSS("appearance", "auto");
    await expect(box).not.toBeChecked();
    const bounds = (await box.boundingBox())!;
    expect(bounds.width).toBe(16);
    expect(bounds.height).toBe(16);
  }
  const duet = dialog.getByLabel("Allow Duet", { exact: true });
  await expect(duet).toBeDisabled();
  await expect(duet.locator("..")).toHaveCSS("opacity", "0.45");
  const comments = dialog.getByLabel("Allow comments", { exact: true });
  await comments.focus();
  await comments.press("Space");
  await expect(comments).toBeChecked();
  await dialog.getByLabel(/Your brand —/).check();
  await expect(dialog.getByText(/labeled as “Promotional content”/)).toBeVisible();
  await dialog.getByLabel(/Branded content —/).check();
  await expect(dialog.getByText(/labeled as “Paid partnership”/)).toBeVisible();
  await expect(dialog.locator(".web-compose-toggle-row .web-compose-toggle")).toHaveCount(2);
  await page.screenshot({ path: "/tmp/posterract-tiktok-checkboxes-desktop.png", fullPage: true });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(comments).toBeChecked();
  await expect(dialog.getByLabel(/Your brand —/)).toBeChecked();
  await dialog.getByLabel(/Branded content —/).uncheck();
  await dialog.getByRole("combobox", { name: "TikTok privacy" }).click();
  await dialog.getByRole("option", { name: "Only me", exact: true }).click();
  await expect(dialog.getByLabel(/Branded content —/)).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/posterract-tiktok-checkboxes-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
