import { expect, test, type Page } from "@playwright/test";
import { emptyBootstrap, useApiEngine } from "./fixtures/api-engine";

// A 1×1 PNG, standing in for a business logo.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("a business gets a name, a logo and two Instagram accounts; renaming keeps focus; deleting asks first", async ({ page }) => {
  await useApiEngine(page);
  const state = emptyBootstrap();
  const account = (id: string, provider: string, handle: string) => ({
    id, workspaceId: state.workspaceId, provider, providerAccountId: handle, handle, status: "connected", scopes: [],
  });
  state.portals.push(
    account("00000000-0000-4000-8000-000000000002", "instagram", "@sofia"),
    account("00000000-0000-4000-8000-000000000003", "instagram", "@sofia.clips"),
    account("00000000-0000-4000-8000-000000000004", "threads", "@sofia"),
  );
  const writes: Array<{ method: string; body?: any }> = [];
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith("/bootstrap")) return route.fulfill({ json: state });
    if (path.endsWith("/refresh-profiles")) return route.fulfill({ json: { ok: true } });
    if (/\/businesses(?:\/[^/]+)?$/.test(path)) {
      const body = method === "DELETE" ? undefined : route.request().postDataJSON();
      writes.push({ method, body });
      if (method === "DELETE") { state.businesses = []; return route.fulfill({ status: 204 }); }
      const existing = state.businesses[0];
      state.businesses = [{
        id: "00000000-0000-4000-8000-000000000009", workspaceId: state.workspaceId, name: body.name,
        logoUrl: body.logo === undefined ? existing?.logoUrl : body.logo ?? undefined,
        accountIds: body.accountIds, accounts: state.portals.filter((a) => body.accountIds.includes(a.id)),
        createdAt: Date.now(), updatedAt: Date.now(),
      }];
      return route.fulfill({ status: method === "POST" ? 201 : 200, json: state.businesses[0] });
    }
    return route.fulfill({ status: 404, json: { error: "unexpected_test_request" } });
  });

  await page.goto("/portals");
  await page.getByRole("button", { name: "New business", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "A group of your accounts" });
  const name = dialog.getByRole("textbox", { name: "Business name" });
  await name.click();
  await page.keyboard.type("Pissed Off Sofia", { delay: 40 });
  await expect(name).toHaveValue("Pissed Off Sofia");
  await expect(name).toBeFocused();
  await dialog.getByLabel("Business logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(dialog.getByRole("button", { name: "Change logo" })).toBeVisible();
  for (const handle of ["@sofia.clips", "@sofia"]) {
    for (const box of await dialog.getByRole("checkbox", { name: new RegExp(`^${handle.replace(".", "\\.")}$`) }).all()) await box.check();
  }
  await dialog.getByRole("button", { name: "Create business", exact: true }).click();
  await expect(dialog).not.toBeVisible();

  const created = writes[0]!;
  expect(created.method).toBe("POST");
  expect(created.body.name).toBe("Pissed Off Sofia");
  expect([...created.body.accountIds].sort()).toEqual(state.portals.map((a) => a.id).sort());
  expect(created.body.logo).toMatch(/^data:image\/(webp|png);base64,/);
  await expect(page.getByText("3 ACCOUNTS")).toBeVisible();

  await page.getByRole("button", { name: "Edit Pissed Off Sofia", exact: true }).click();
  await name.click();
  await name.press("End");
  await page.keyboard.type(" HQ", { delay: 40 });
  await expect(name).toHaveValue("Pissed Off Sofia HQ");
  await expect(name).toBeFocused();
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  expect(writes[1]!.method).toBe("PUT");
  expect("logo" in writes[1]!.body).toBe(false);

  await page.getByRole("button", { name: "Delete Pissed Off Sofia HQ", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete Pissed Off Sofia HQ?" });
  await expect(confirm).toBeVisible();
  expect(writes.filter((write) => write.method === "DELETE")).toHaveLength(0);
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  expect(writes.at(-1)!.method).toBe("DELETE");
  await expect(page.getByText("Create your first business")).toBeVisible();
});

/** Demo engine: a second Instagram account and a business that holds both. */
async function seedBusiness(page: Page) {
  await page.goto("/compose");
  await page.waitForFunction(() => !!(window as any).__engine);
  return page.evaluate(async () => {
    const engine = (window as any).__engine;
    const store = engine.getState();
    const first = store.portals.find((a: any) => a.provider === "instagram");
    const second = { ...first, id: "instagram_second", handle: "@second.ig", displayName: "Second IG" };
    engine.setState({
      portals: [...store.portals, second],
      businesses: [{ id: "biz_sofia", name: "Sofia", workspaceId: "ws_local", accountIds: [first.id, second.id], accounts: [first, second], createdAt: Date.now(), updatedAt: Date.now() }],
    });
    const artifact = await store.addArtifact(new File([new Uint8Array(128)], "sofia.mp4", { type: "video/mp4" }), { durationMs: 12_000, width: 1080, height: 1920 });
    return artifact.id as string;
  });
}

test("posting to a business reaches both of its Instagram accounts, and the calendar shows the business", async ({ page }) => {
  const artifactId = await seedBusiness(page);
  await page.goto(`/compose?artifact=${artifactId}`);
  await page.getByLabel("Business", { exact: true }).selectOption("biz_sofia");
  const names = page.getByRole("list", { name: "Selected posting accounts" });
  await expect(names.getByRole("listitem")).toHaveText(["Instagram: Posterract, Second IG"]);
  await page.getByRole("radio", { name: "Schedule", exact: true }).click();
  await page.getByRole("button", { name: "Schedule post", exact: true }).click();

  const posted = await page.evaluate(() => {
    const state = (window as any).__engine.getState();
    const post = state.transmissions[0];
    return { businessId: post.businessId, targets: state.projections.filter((p: any) => p.transmissionId === post.id).map((p: any) => `${p.provider}:${p.portalId}`).sort() };
  });
  expect(posted.businessId).toBe("biz_sofia");
  expect(posted.targets).toEqual(["instagram:instagram_second", "instagram:portal_instagram"]);

  // Published posts show their points in the tile's corner, next to the business logo.
  await page.evaluate(() => {
    const engine = (window as any).__engine;
    const state = engine.getState();
    engine.setState({ transmissions: state.transmissions.map((t: any, index: number) => index === 0 ? { ...t, status: "live", scheduledFor: Date.now() } : t) });
  });
  await page.goto("/continuum");
  const tile = page.locator("[data-transmission-id]").filter({ hasText: "sofia" }).first();
  await expect(tile.getByRole("img", { name: "Sofia" })).toBeVisible();
  await expect(tile.getByLabel("0 points earned")).toBeVisible();
});

test("analytics can show one business or picked accounts", async ({ page }) => {
  await seedBusiness(page);
  await page.goto("/echoes");
  const business = page.getByLabel("Business", { exact: true });
  await expect(business).toBeVisible();
  await business.selectOption("biz_sofia");
  const accounts = page.getByRole("button", { name: /Accounts/ });
  await expect(accounts).toContainText("All its accounts");
  await accounts.click();
  const menu = page.getByRole("group", { name: "Accounts to show" });
  await menu.getByRole("button", { name: "Only" }).last().click();
  await expect(accounts).toContainText("@second.ig");
});

test("the header's business switcher narrows the calendar, and the calendar's numbers sit right of the title", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-16T12:00:00"));
  await page.goto("/continuum");
  await page.waitForFunction(() => !!(window as any).__engine);
  await page.evaluate(async () => {
    const engine = (window as any).__engine;
    const store = engine.getState();
    const first = store.portals.find((a: any) => a.provider === "instagram");
    const threads = store.portals.find((a: any) => a.provider === "threads");
    engine.setState({
      transmissions: [], projections: [], events: [],
      businesses: [{ id: "biz_sofia", name: "Sofia", workspaceId: "ws_local", accountIds: [threads.id], accounts: [threads], createdAt: Date.now(), updatedAt: Date.now() }],
    });
    const artifact = await store.addArtifact(new File([new Uint8Array(128)], "clip.mp4", { type: "video/mp4" }), { durationMs: 12_000 });
    const make = (title: string, platforms: string[], accountIds: string[], businessId?: string) => engine.getState().createTransmission({
      title, baseCaption: "", hashtags: [], artifactId: artifact.id, platforms, perPlatformCaptions: {}, scheduleMode: "at",
      scheduledFor: new Date(2026, 8, 18, 10).getTime(), businessId, accountIds });
    make("Sofia rant", ["threads"], [threads.id], "biz_sofia");
    make("Studio tour", ["instagram"], [first.id]);
  });
  await page.reload();

  const stats = page.getByRole("region", { name: "This month at a glance" });
  await expect(stats).toBeVisible();
  for (const label of ["Points", "Views", "Streak", "Posts"]) await expect(stats.getByText(label, { exact: true })).toBeVisible();
  await expect(stats).toContainText("2 scheduled");
  // Right of the title, not on top of the calendar.
  const title = await page.getByRole("heading", { name: "Plan and schedule every post." }).boundingBox();
  const box = await stats.boundingBox();
  expect(box!.x).toBeGreaterThan(title!.x + 200);

  await page.getByRole("button", { name: /^Business: / }).click();
  await page.getByRole("menuitemradio", { name: /Sofia/ }).click();
  await expect(page.getByText("Sofia rant")).toBeVisible();
  await expect(page.getByText("Studio tour")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "This month · Sofia at a glance" })).toContainText("1 scheduled");

  // New post starts on the same business.
  await page.goto("/compose");
  await expect(page.getByLabel("Business", { exact: true })).toHaveValue("biz_sofia");

  await page.getByRole("button", { name: /^Business: / }).click();
  await page.getByRole("menuitemradio", { name: /All businesses/ }).click();
  await page.goto("/continuum");
  await expect(page.getByText("Studio tour")).toBeVisible();
});

test("Analytics has an Overview tab and a Businesses tab comparing every business and its creators", async ({ page }) => {
  await seedBusiness(page);
  await page.evaluate(() => {
    const engine = (window as any).__engine;
    const state = engine.getState();
    const tiktok = state.portals.find((a: any) => a.provider === "tiktok");
    engine.setState({ businesses: [...state.businesses, { id: "biz_main", name: "Posterract Main", workspaceId: "ws_local", accountIds: [tiktok.id], accounts: [tiktok], createdAt: Date.now(), updatedAt: Date.now() }] });
  });
  await page.goto("/echoes");
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Businesses" }).click();
  await expect(page).toHaveURL(/tab=businesses/);
  const view = page.getByTestId("businesses-analytics");
  await expect(view.getByRole("region", { name: "All businesses" })).toContainText("3 creator accounts");
  const board = view.getByRole("region", { name: "Businesses" });
  await expect(board.getByRole("article")).toHaveCount(2);
  await board.getByRole("button", { name: /Sofia/ }).click();
  const table = board.getByRole("table").first();
  await expect(table.getByRole("row")).toHaveCount(3);
  await view.getByRole("radio", { name: "Points" }).click();
  await table.getByRole("row").nth(1).click();
  await expect(page).toHaveURL(/account=/);
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: /Accounts/ })).not.toContainText("All");
});
