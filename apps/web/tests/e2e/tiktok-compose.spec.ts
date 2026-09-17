import { expect, test, type Page } from "@playwright/test";

async function openSettings(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Platform settings" });
  if (!await dialog.isVisible()) await page.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog.getByRole("tab", { name: "TikTok", exact: true }).click();
}
async function closeSettings(page: Page) {
  await page.getByRole("dialog", { name: "Platform settings" }).getByRole("button", { name: "Done", exact: true }).click();
}
async function choosePrivacy(page: Page, label: "Only me" | "Everyone") {
  await page.getByRole("combobox", { name: "TikTok privacy" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

// Isolated demo engine only. These tests never authenticate or post to TikTok.
async function seed(page: Page, multiple = false) {
  await page.goto("/compose");
  await page.waitForFunction(() => !!window.__engine);
  const id = await page.evaluate(async ({ multiple }) => {
    const engine = (window as unknown as { __engine: { getState(): any; setState(value: any): void } }).__engine;
    const store = engine.getState();
    if (multiple) {
      const first = store.portals.find((a: any) => a.provider === "tiktok");
      const second = { ...first, id: "tiktok_second", handle: "@second.creator", displayName: "Second Creator" };
      engine.setState({ portals: [...store.portals, second], accountSets: [{ id: "chosen-set", name: "Creator set", accounts: [second], workspaceId: "ws_local", createdAt: Date.now(), updatedAt: Date.now() }] });
    }
    const artifact = await store.addArtifact(new File([new Uint8Array(128)], "review-clip.mp4", { type: "video/mp4" }), { durationMs: 18_000, width: 1080, height: 1920 });
    return artifact.id;
  }, { multiple });
  await page.goto(`/compose?artifact=${id}`);
  await page.getByRole("group", { name: "Target accounts" }).getByRole("button", { name: /Instagram/ }).click();
}

test("Everyone is submitted by default without opening TikTok settings", async ({ page }) => {
  await seed(page);
  await page.getByRole("radio", { name: "Schedule", exact: true }).click();
  await expect(page.getByRole("button", { name: "Schedule post", exact: true })).toBeEnabled();
  await expect(page.getByRole("dialog", { name: "Platform settings" })).not.toBeVisible();
  await page.getByRole("button", { name: "Schedule post", exact: true }).click();
  await expect(page).toHaveURL(/transmissions/);
  const options = await page.evaluate(() => {
    const state = (window as any).__engine.getState();
    const post = state.transmissions.find((t: any) => t.title === "review-clip");
    return state.projections.find((p: any) => p.transmissionId === post.id && p.provider === "tiktok").platformOptions;
  });
  expect(options.privacyLevel).toBe("PUBLIC_TO_EVERYONE");
});

test("an account without public posting uses its available audiences instead", async ({ page }) => {
  // Override only the isolated demo creator-info fixture, never the live API.
  await page.route("**/src/engine/local.ts", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const restricted = source.replace(/(privacy_level_options:\s*\[)\s*"PUBLIC_TO_EVERYONE",?\s*/, "$1");
    expect(restricted).not.toBe(source);
    await route.fulfill({ response, body: restricted });
  });
  await seed(page);
  await expect(page.getByRole("button", { name: "Publish now", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: /TikTok settings.*Choose who/ }).click();
  await expect(page.getByLabel("TikTok privacy")).toHaveText("Choose privacy…");
  await page.getByLabel("TikTok privacy").click();
  await expect(page.getByRole("option", { name: "Everyone", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "Only me", exact: true }).click();
  await closeSettings(page);
  await expect(page.getByRole("button", { name: "Publish now", exact: true })).toBeEnabled();
});

test("Direct Post defaults to Everyone with unchecked interactions, disclosure validation and correct declarations", async ({ page }) => {
  await seed(page);
  await openSettings(page);
  await expect(page.getByLabel("TikTok privacy")).toHaveText("Everyone");
  await expect(page.getByLabel("Allow comments")).not.toBeChecked();
  await expect(page.getByLabel("Allow Duet", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Allow Stitch", { exact: true })).not.toBeChecked();
  const publish = page.locator(".web-compose-publish button");
  await expect(publish).toBeEnabled();
  await choosePrivacy(page, "Only me");
  await expect(publish).toBeEnabled();
  await page.getByLabel("Disclose commercial content").check();
  await expect(publish).toBeDisabled();
  await expect(page.getByLabel(/Branded content —/)).toBeDisabled();
  await page.getByLabel(/Your brand —/).check();
  await expect(page.getByText(/labeled as “Promotional content”/)).toBeVisible();
  await expect(publish).toBeEnabled();
  await choosePrivacy(page, "Everyone");
  await page.getByLabel(/Branded content —/).check();
  await expect(page.getByText(/labeled as “Paid partnership”/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Branded Content Policy" })).toHaveAttribute("href", /bc-policy/);
  await page.getByLabel("TikTok privacy").click();
  await expect(page.getByRole("option", { name: "Only me", exact: true })).toHaveAttribute("aria-disabled", "true");
  await page.getByLabel("TikTok privacy").press("Escape");
  await page.screenshot({ path: "/tmp/posterract-tiktok-web-settings.png", fullPage: true });
});

test("explicit accounts and Account Sets survive scheduling; switching accounts resets privacy", async ({ page }) => {
  await seed(page, true);
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Accounts", exact: true });
  const account = picker.getByLabel("TikTok account", { exact: true });
  await expect(account).toHaveValue("");
  await account.selectOption("portal_tiktok");
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await openSettings(page);
  await choosePrivacy(page, "Only me");
  await page.getByLabel("Allow comments").check();
  await page.getByRole("button", { name: "Refresh TikTok settings" }).click();
  await expect(page.getByLabel("TikTok privacy")).toBeEnabled();
  await expect(page.getByLabel("TikTok privacy")).toHaveText("Only me");
  await expect(page.getByLabel("Allow comments")).not.toBeChecked();
  await closeSettings(page);
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await account.selectOption("tiktok_second");
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await openSettings(page);
  await expect(page.getByLabel("TikTok privacy")).toHaveText("Everyone");
  await expect(page.getByLabel("Allow comments")).not.toBeChecked();
  await closeSettings(page);
  await page.getByLabel("Account set", { exact: true }).selectOption("chosen-set");
  await expect(page.getByLabel("Account set", { exact: true })).toHaveValue("chosen-set");
  await expect(page.getByRole("group", { name: "Target accounts" }).getByRole("button", { name: "Instagram", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("group", { name: "Target accounts" }).getByRole("button", { name: "TikTok", exact: true })).toHaveAttribute("title", /Second Creator/);
  await expect(page.getByRole("tablist", { name: "Caption variants" }).getByRole("tab")).toHaveCount(2);
  await page.screenshot({ path: "/tmp/posterract-composer-account-set.png", fullPage: true });
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(picker.getByRole("link", { name: "Manage account sets (opens in a new tab)" })).toHaveAttribute("target", "_blank");
  await expect(account).toHaveValue("tiktok_second");
  await account.selectOption("portal_tiktok");
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByLabel("Account set", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await account.selectOption("tiktok_second");
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await openSettings(page);
  await choosePrivacy(page, "Only me");
  await page.getByLabel("AI-generated content", { exact: true }).check();
  await closeSettings(page);
  await page.getByRole("radio", { name: "Schedule", exact: true }).click();
  await page.getByRole("button", { name: "Schedule post", exact: true }).click();
  await expect(page).toHaveURL(/transmissions/);
  const projection = await page.evaluate(() => (window as any).__engine.getState().projections.find((p: any) => p.caption === "" && p.platformOptions.mode === "direct"));
  expect(projection.portalId).toBe("tiktok_second");
  expect(projection.platformOptions.privacyLevel).toBe("SELF_ONLY");
  expect(projection.platformOptions.isAigc).toBe(true);
  expect(projection.platformOptions.consentAccepted).toBe(true);
  const row = page.locator("li", { hasText: "review-clip" }).first();
  await row.getByRole("button", { name: "Duplicate transmission" }).click();
  await expect(page).toHaveURL(/compose.*copy=/);
  await expect(page.getByRole("button", { name: "Publish now", exact: true })).toBeEnabled();
  await openSettings(page);
  await expect(page.getByLabel("TikTok privacy")).toHaveText("Everyone");
});

test("inbox stays available without Direct Post privacy and disconnected targets block submission", async ({ page }) => {
  await seed(page);
  await openSettings(page);
  await page.getByRole("radio", { name: "Send to TikTok inbox", exact: true }).click();
  await expect(page.getByText(/Inbox delivery is not a published post/)).toBeVisible();
  await expect(page.getByLabel("TikTok privacy")).toHaveCount(0);
  await closeSettings(page);
  await expect(page.getByRole("button", { name: "Send to TikTok inbox", exact: true }).last()).toBeEnabled();
  await page.evaluate(() => (window as any).__engine.getState().setPortalStatus("tiktok", "disconnected"));
  await expect(page.getByRole("button", { name: "Send to TikTok inbox", exact: true }).last()).toBeDisabled();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(page.getByRole("link", { name: "Connect TikTok account" })).toBeVisible();
});

test("missing disclosure explains disabled publish and schedule actions on hover and keyboard focus", async ({ page }) => {
  await seed(page);
  await openSettings(page);
  await choosePrivacy(page, "Everyone");
  await page.getByLabel("Disclose commercial content").check();
  const hint = page.getByRole("tooltip", { name: "You need to indicate if your content promotes yourself, a third party, or both." });
  await closeSettings(page);
  const wrapper = page.getByLabel("Why posting is unavailable", { exact: true });
  await expect(page.getByRole("button", { name: "Publish now", exact: true })).toBeDisabled();
  await wrapper.hover();
  await expect(hint).toBeVisible();
  await page.screenshot({ path: "/tmp/posterract-tiktok-disclosure-hint.png", fullPage: true });
  await page.getByRole("button", { name: "Back to calendar", exact: true }).hover();
  await wrapper.focus();
  await expect(hint).toBeVisible();
  await wrapper.press("Escape");
  await expect(hint).not.toBeVisible();
  await page.getByRole("radio", { name: "Schedule", exact: true }).click();
  await expect(page.getByRole("button", { name: "Schedule post", exact: true })).toBeDisabled();
  await wrapper.hover();
  await expect(hint).toBeVisible();
  await openSettings(page);
  await page.getByLabel(/Your brand —/).check();
  await closeSettings(page);
  await expect(page.getByRole("button", { name: "Schedule post", exact: true })).toBeEnabled();
  await expect(hint).toHaveCount(0);
});

test("private branded-content restrictions explain themselves on hover and cannot be bypassed with the keyboard", async ({ page }) => {
  await seed(page);
  await openSettings(page);
  await choosePrivacy(page, "Only me");
  await page.getByLabel("Disclose commercial content").check();
  const hint = page.getByRole("tooltip", { name: "Branded content visibility cannot be set to private." });
  await page.getByLabel("Why branded content is unavailable", { exact: true }).hover();
  await expect(hint).toBeVisible();
  await choosePrivacy(page, "Everyone");
  await page.getByLabel(/Branded content —/).check();
  const privacy = page.getByRole("combobox", { name: "TikTok privacy" });
  await privacy.click();
  const privateOption = page.getByRole("option", { name: "Only me", exact: true });
  await privateOption.hover();
  await expect(hint).toBeVisible();
  await page.screenshot({ path: "/tmp/posterract-tiktok-privacy-hint.png", fullPage: true });
  await privateOption.click({ force: true });
  await expect(privacy).toHaveText("Everyone");
  await privacy.press("End");
  await expect(hint).toBeVisible();
  await privacy.press("Enter");
  await expect(privacy).toHaveText("Everyone");
  await privacy.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.getByLabel("Disclose commercial content").uncheck();
  await privacy.press("ArrowDown");
  await privacy.press("End");
  await privacy.press("Enter");
  await expect(privacy).toHaveText("Only me");
});
