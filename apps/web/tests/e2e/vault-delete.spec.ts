import { expect, test } from "@playwright/test";
import { emptyBootstrap, useApiEngine } from "./fixtures/api-engine";

test("Vault clears missing-media placeholders through the HTTP engine and keeps them gone on reload", async ({ page }) => {
  await useApiEngine(page);
  const state = emptyBootstrap();
  state.artifacts = ["stale-record.mp4", "missing-object.mp4"].map((fileName, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 2}`, workspaceId: state.workspaceId, fileName,
    r2Key: `test/${fileName}`, mimeType: "video/mp4", sizeBytes: 100, status: "failed", createdAt: Date.now(),
    publicUrl: index === 1 ? "/missing-video.mp4" : undefined,
  }));
  await page.route("**/missing-video.mp4*", (route) => route.fulfill({ status: 404, body: "Not found" }));
  const removed: string[] = [];
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/bootstrap")) return route.fulfill({ json: state });
    if (route.request().method() === "DELETE" && path.includes("/media/")) {
      const id = path.split("/").at(-1)!;
      removed.push(id);
      state.artifacts = state.artifacts.filter((a) => a.id !== id);
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/vault");
  for (const name of ["stale-record.mp4", "missing-object.mp4"]) {
    await page.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Delete ${name}`, exact: true })).toHaveCount(0);
  }
  expect(removed).toHaveLength(2);
  await expect(page.getByText("Can’t delete", { exact: true })).toHaveCount(0);
  await expect(page.getByText("The Vault is empty.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("The Vault is empty.", { exact: true })).toBeVisible();
});

test("Vault retains media when the API rejects deletion", async ({ page }) => {
  await useApiEngine(page);
  const state = emptyBootstrap();
  state.artifacts = [{ id: "00000000-0000-4000-8000-000000000002", workspaceId: state.workspaceId,
    fileName: "scheduled.mp4", r2Key: "test/scheduled.mp4", mimeType: "video/mp4", sizeBytes: 100, status: "ready", createdAt: Date.now() }];
  await page.route("**/v1/**", (route) => route.request().method() === "DELETE"
    ? route.fulfill({ status: 409, json: { error: "media_in_use" } })
    : route.fulfill({ json: state }));
  await page.goto("/vault");
  await page.getByRole("button", { name: "Delete scheduled.mp4", exact: true }).click();
  await expect(page.getByText("Can’t delete", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete scheduled.mp4", exact: true })).toBeVisible();
});
