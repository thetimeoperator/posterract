import { expect, test } from "@playwright/test";
import { emptyBootstrap, useApiEngine } from "./fixtures/api-engine";

test("account-set names keep focus while typing, creating and editing", async ({ page }) => {
  await useApiEngine(page);
  const state = emptyBootstrap();
  state.portals.push({ id: "00000000-0000-4000-8000-000000000002", workspaceId: state.workspaceId,
    provider: "instagram", providerAccountId: "test-creator", handle: "@creator", status: "connected", scopes: [] });
  const writes: string[] = [];
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/bootstrap")) return route.fulfill({ json: state });
    if (path.endsWith("/refresh-profiles")) return route.fulfill({ json: { ok: true } });
    if (/\/account-sets(?:\/[^/]+)?$/.test(path)) {
      const input = route.request().postDataJSON();
      writes.push(input.name);
      state.accountSets = [{ id: "00000000-0000-4000-8000-000000000003", name: input.name, workspaceId: state.workspaceId,
        accounts: state.portals.filter((a) => input.accountIds.includes(a.id)), createdAt: Date.now(), updatedAt: Date.now() }];
      return route.fulfill({ json: state.accountSets[0] });
    }
    return route.fulfill({ status: 404, json: { error: "unexpected_test_request" } });
  });
  await page.goto("/portals");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Build one reusable publishing target" });
  const name = dialog.getByRole("textbox", { name: "Set name" });
  await name.click();
  // Keyboard events across separate renders reproduce the original one-letter bug.
  await page.keyboard.type("Creator team", { delay: 60 });
  await expect(name).toHaveValue("Creator team");
  await expect(name).toBeFocused();
  await dialog.locator("select").first().selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Create account set", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Edit Creator team", exact: true }).click();
  await name.click();
  await name.press("End");
  await page.keyboard.type(" west", { delay: 60 });
  await expect(name).toHaveValue("Creator team west");
  await expect(name).toBeFocused();
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Creator team west", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Edit Creator team west", exact: true }).click();
  await expect(name).toHaveValue("Creator team west");
  await name.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Creator team west", exact: true })).toBeFocused();
  expect(writes).toEqual(["Creator team", "Creator team west"]);
});
