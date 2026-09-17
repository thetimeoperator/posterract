import { expect, test, type Page } from "@playwright/test";

async function withVideo(page: Page) {
  await page.goto("/compose");
  await page.waitForFunction(() => !!window.__engine);
  const id = await page.evaluate(async () => {
    const engine = (window as any).__engine;
    const store = engine.getState();
    engine.setState({ portals: store.portals.map((account: any) => ({ ...account, avatarUrl: "/brand/platforms/tiktok.png" })) });
    return (await store.addArtifact(new File([new Uint8Array(128)], "caption-check.mp4", { type: "video/mp4" }), { durationMs: 18_000, width: 1080, height: 1920 })).id;
  });
  await page.goto(`/compose?artifact=${id}`);
  await page.waitForFunction(() => !!window.__engine);
  return id;
}
async function settings(page: Page, platform = "TikTok") {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Platform settings" });
  await dialog.getByRole("tab", { name: platform, exact: true }).click();
  return dialog;
}

test("approved compact layout has no duplicate headings, hashtag bar or account notes", async ({ page }) => {
  await withVideo(page);
  await expect(page.locator(".web-compose-post h2")).toHaveCount(0);
  await expect(page.getByText("The message", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel(/Hashtags/)).toHaveCount(0);
  await expect(page.getByText(/Posting as|up to 60s|TikTok may take/)).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(1);
  const targets = page.getByRole("group", { name: "Target accounts" });
  await expect(targets.locator(".web-compose-account-photo img")).toHaveCount(4);
  const caption = (await page.getByLabel("Base caption", { exact: true }).boundingBox())!;
  const button = (await page.getByRole("button", { name: "Settings", exact: true }).boundingBox())!;
  expect(button.y).toBeGreaterThan(caption.y + caption.height);
  expect(button.width).toBeLessThan(150);
  expect(button.width).toBeLessThan(caption.width / 2);
  await expect(page.getByLabel("Account set", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Account set", { exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Create account set (opens in a new tab)" })).toHaveAttribute("href", "/portals");
  const trajectory = page.locator(".web-compose-sidebar > section").first();
  await expect(trajectory.getByRole("heading", { name: "When", exact: true })).toBeVisible();
  expect((await trajectory.boundingBox())!.height).toBeLessThan(145);
  expect((await page.locator(".web-compose-post").boundingBox())!.height).toBeLessThan(600);
  await page.screenshot({ path: "/tmp/posterract-approved-compose-desktop.png", fullPage: true });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/posterract-approved-compose-mobile.png", fullPage: true });
  const dialog = await settings(page);
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())!.height).toBeLessThan(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/posterract-approved-settings-mobile.png", fullPage: true });
});

test("TikTok declarations stay inside its direct-post settings tab", async ({ page }) => {
  await withVideo(page);
  const music = page.getByRole("link", { name: "Music Usage Confirmation", exact: true });
  await expect(music).toHaveCount(0);
  const dialog = await settings(page, "Instagram");
  await expect(music).toHaveCount(0);
  await dialog.getByRole("tab", { name: "TikTok", exact: true }).click();
  await expect(dialog.getByRole("link", { name: "Music Usage Confirmation", exact: true })).toBeVisible();
  await dialog.getByRole("radio", { name: "Send to TikTok inbox", exact: true }).click();
  await expect(music).toHaveCount(0);
  await dialog.getByRole("radio", { name: "Post directly", exact: true }).click();
  await expect(music).toHaveCount(1);
  await dialog.getByRole("combobox", { name: "TikTok privacy" }).click();
  await dialog.getByRole("option", { name: "Everyone", exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(music).toHaveCount(0);
  await page.getByRole("group", { name: "Target accounts" }).getByRole("button", { name: "Threads", exact: true }).click();
  await page.getByRole("button", { name: "Publish now", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Publish to 3 platforms now?" })).toBeVisible();
  await expect(music).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("inline hashtags and platform overrides submit once to exact accounts; copied captions survive", async ({ page }) => {
  await withVideo(page);
  const targets = page.getByRole("group", { name: "Target accounts" });
  await targets.getByRole("button", { name: "TikTok", exact: true }).click();
  await targets.getByRole("button", { name: "Threads", exact: true }).click();
  await page.getByLabel("Base caption", { exact: true }).fill("Shared story #launch");
  const tabs = page.getByRole("tablist", { name: "Caption variants" });
  await tabs.getByRole("tab", { name: "Instagram", exact: true }).click();
  await page.getByLabel("Instagram caption", { exact: true }).fill("Instagram version #instagram");
  await tabs.getByRole("tab", { name: "Base", exact: true }).click();
  await page.getByLabel("Base caption", { exact: true }).fill("Updated story #launch");
  await targets.getByRole("button", { name: "Instagram", exact: true }).click();
  await targets.getByRole("button", { name: "Instagram", exact: true }).click();
  await tabs.getByRole("tab", { name: "Instagram", exact: true }).click();
  await expect(page.getByLabel("Instagram caption", { exact: true })).toHaveValue("Instagram version #instagram");
  await tabs.getByRole("tab", { name: "Threads", exact: true }).click();
  await page.getByLabel("Threads caption", { exact: true }).fill("Discard me");
  await page.getByRole("button", { name: "Use base caption" }).click();
  await expect(page.getByLabel("Threads caption", { exact: true })).toHaveAttribute("placeholder", "Updated story #launch");
  await page.getByRole("radio", { name: "Schedule", exact: true }).click();
  await page.getByRole("button", { name: "Schedule post", exact: true }).click();
  await expect(page).toHaveURL(/transmissions/);
  const result = await page.evaluate(() => {
    const state = (window as any).__engine.getState();
    const post = state.transmissions.find((t: any) => t.title === "caption-check");
    return { post, targets: state.projections.filter((p: any) => p.transmissionId === post.id).map((p: any) => ({ provider: p.provider, caption: p.caption, account: p.portalId })) };
  });
  expect(result.post.hashtags).toEqual([]);
  expect(result.targets).toEqual(expect.arrayContaining([
    { provider: "instagram", caption: "Instagram version #instagram", account: "portal_instagram" },
    { provider: "threads", caption: "Updated story #launch", account: "portal_threads" },
  ]));
  expect(result.targets).toHaveLength(2);
  await page.goto(`/compose?copy=${result.post.id}`);
  await tabs.getByRole("tab", { name: "Instagram", exact: true }).click();
  await expect(page.getByLabel("Instagram caption", { exact: true })).toHaveValue("Instagram version #instagram");
});

test("settings live in a persistent keyboard-accessible dialog and blockers open the relevant tab", async ({ page }) => {
  await withVideo(page);
  await expect(page.getByLabel("TikTok privacy")).toHaveCount(0);
  const dialog = await settings(page);
  await expect(dialog.getByRole("tab", { name: "TikTok", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("combobox", { name: "TikTok privacy" })).toHaveText("Everyone");
  await dialog.getByRole("combobox", { name: "TikTok privacy" }).click();
  await dialog.getByRole("option", { name: "Everyone", exact: true }).click();
  await dialog.getByLabel("Allow comments", { exact: true }).check();
  await dialog.getByRole("tab", { name: "Instagram", exact: true }).click();
  await expect(dialog.getByText("Instagram Reel", { exact: true })).toBeVisible();
  await expect(dialog.locator("textarea")).toHaveCount(0);
  await dialog.getByRole("tab", { name: "Instagram", exact: true }).press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "TikTok", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publish now", exact: true })).toBeEnabled();
  await settings(page);
  await expect(dialog.getByLabel("Allow comments", { exact: true })).toBeChecked();
  await expect(dialog.getByRole("combobox", { name: "TikTok privacy" })).toHaveText("Everyone");
  await dialog.getByRole("combobox", { name: "TikTok privacy" }).click();
  await dialog.getByRole("combobox", { name: "TikTok privacy" }).press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("listbox")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done", exact: true }).press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
  await settings(page);
  await dialog.getByLabel("Disclose commercial content").check();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: /TikTok settings.*Indicate whether/ }).click();
  await expect(dialog.getByRole("tab", { name: "TikTok", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("invalid schedules, disconnected accounts and zero targets appear in checks and block submission", async ({ page }) => {
  await withVideo(page);
  const targets = page.getByRole("group", { name: "Target accounts" });
  await targets.getByRole("button", { name: "TikTok", exact: true }).click();
  await page.getByRole("radio", { name: "Schedule", exact: true }).click();
  await page.getByLabel("Launch time").fill("2020-01-01T10:00");
  await expect(page.getByRole("button", { name: "Schedule post", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: /Scheduled time.*Choose a time/ }).click();
  await expect(page.getByLabel("Launch time")).toBeFocused();
  await page.getByRole("radio", { name: "Post now", exact: true }).click();
  await page.evaluate(() => (window as any).__engine.getState().setPortalStatus("instagram", "disconnected"));
  await expect(page.getByRole("button", { name: "Publish now", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: /Instagram account.*Choose a connected/ }).click();
  await expect(page.getByRole("dialog", { name: "Accounts", exact: true }).getByRole("link", { name: "Connect Instagram account" })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await targets.getByRole("button", { name: "Instagram", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publish now", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Platforms targeted.*Pick at least/ })).toBeVisible();
});

test("failed profile images fall back without losing platform identity", async ({ page }) => {
  await page.route("**/missing-avatar.png", (route) => route.fulfill({ status: 404, body: "missing" }));
  await withVideo(page);
  await page.evaluate(() => {
    const engine = (window as any).__engine;
    engine.setState({ portals: engine.getState().portals.map((a: any) => ({ ...a, avatarUrl: "/missing-avatar.png" })) });
  });
  const instagram = page.getByRole("group", { name: "Target accounts" }).getByRole("button", { name: "Instagram", exact: true });
  await expect(instagram.locator(".web-compose-account-photo img")).toHaveCount(0);
  await expect(instagram.locator(".web-compose-account-photo > span")).toHaveText("PO");
  await expect(instagram.locator(".web-compose-account-badge")).toBeVisible();
});

test("desktop retains the original composer and hashtag input", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).desktop = { platform: "darwin", on: () => () => {}, request: async () => ({ status: "signed_out", secureStorageAvailable: false }) };
  });
  await page.goto("/compose");
  await expect(page.getByRole("heading", { name: "Caption", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "TikTok Settings", exact: true })).toBeVisible();
  await expect(page.getByLabel("Hashtags (0)", { exact: true })).toBeVisible();
  await expect(page.locator(".web-compose")).toHaveCount(0);
});

test("copying a legacy post preserves its separate hashtags exactly once", async ({ page }) => {
  const artifactId = await withVideo(page);
  const sourceId = await page.evaluate((artifactId) => {
    return (window as any).__engine.getState().createTransmission({
      title: "Legacy caption", baseCaption: "Legacy story", hashtags: ["legacy"], artifactId,
      platforms: ["instagram"], accountIds: ["portal_instagram"], perPlatformCaptions: { instagram: "Legacy story\n\n#legacy" },
      scheduleMode: "at", scheduledFor: Date.now() + 3600_000,
    }).id;
  }, artifactId);
  await page.goto(`/compose?copy=${sourceId}`);
  await expect(page.getByLabel("Base caption", { exact: true })).toHaveValue("Legacy story\n\n#legacy");
  await page.getByRole("tab", { name: "Instagram", exact: true }).click();
  await expect(page.getByLabel("Instagram caption", { exact: true })).toHaveValue("Legacy story\n\n#legacy");
  await page.getByRole("radio", { name: "Schedule", exact: true }).click();
  await page.getByRole("button", { name: "Schedule post", exact: true }).click();
  await expect(page).toHaveURL(/transmissions/);
  const copied = await page.evaluate((sourceId) => {
    const state = (window as any).__engine.getState();
    const post = state.transmissions.find((t: any) => t.id !== sourceId && t.baseCaption === "Legacy story\n\n#legacy");
    return { tags: post.hashtags, caption: state.projections.find((p: any) => p.transmissionId === post.id).caption };
  }, sourceId);
  expect(copied).toEqual({ tags: [], caption: "Legacy story\n\n#legacy" });
});

test("real video intake and replacement keep the caption intact", async ({ page }) => {
  await page.goto("/compose");
  await page.getByLabel("Base caption", { exact: true }).fill("Keep this caption #intact");
  await page.locator('.web-compose-media input[type="file"]').setInputFiles("tests/e2e/fixtures/import-video.mp4");
  await expect(page.locator(".web-compose-file")).toContainText("import-video.mp4");
  await expect(page.locator(".web-compose-video video")).toBeVisible();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add a video — drag and drop or browse" })).toBeVisible();
  await expect(page.getByLabel("Base caption", { exact: true })).toHaveValue("Keep this caption #intact");
});
