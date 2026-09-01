import { expect, test } from "@playwright/test";

test.describe("Echoes analytics", () => {
  test("filters real platform-shaped signals by network and date range", async ({ page }) => {
    await page.goto("/echoes");

    await expect(page.getByTestId("analytics-dashboard")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: "All" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Total" })).toBeChecked();
    await expect(page.locator("[data-signal-metric]")).toHaveCount(6);
    await expect(page.getByTestId("signal-sparkline")).toHaveCount(6);
    await expect(page.locator('[data-signal-metric][aria-label*="All available history"]')).toHaveCount(6);

    await page.getByRole("radio", { name: "Instagram" }).click();
    await page.getByRole("radio", { name: "7D" }).click();

    await expect(page.getByRole("radio", { name: "Instagram" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "7D" })).toBeChecked();
    await expect(page.getByRole("heading", { name: "Views · last 7 days" })).toBeVisible();
    await expect(page.getByText("Followers", { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-signal-metric="reach"]')).toBeVisible();
    await expect(page.locator('[data-signal-metric="saves"]')).toBeVisible();
    await expect(page.getByRole("radio", { name: "YouTube" })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "TikTok" })).toHaveCount(1);

    await page.getByRole("radio", { name: "TikTok" }).click();
    await expect(page.locator('[data-signal-metric="reach"]')).toHaveCount(0);
    await expect(page.locator('[data-signal-metric="comments"]')).toBeVisible();
    await expect(page.locator('[data-signal-metric="shares"]')).toBeVisible();
  });

  test("keeps trend graphs visible across every fixed analytics range", async ({ page }) => {
    await page.goto("/echoes");

    for (const range of ["7D", "30D", "90D"]) {
      await page.getByRole("radio", { name: range, exact: true }).click();
      await expect(page.getByRole("radio", { name: range, exact: true })).toBeChecked();
      await expect(page.getByTestId("signal-sparkline")).toHaveCount(6);
      await expect(page.getByRole("img", { name: /Daily views by platform/i })).toBeVisible();
    }
  });

  test("keeps all six signal chambers compact and visually consistent", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/echoes");
    const cards = page.locator("[data-signal-metric]");
    await expect(cards).toHaveCount(6);
    const boxes = await cards.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return {
          top: Math.round(box.top),
          width: box.width,
          height: box.height,
          borderRadius: getComputedStyle(element).borderRadius,
        };
      }),
    );
    expect(new Set(boxes.map((box) => box.top)).size).toBe(2);
    expect(boxes.every((box) => box.width >= 350)).toBe(true);
    expect(boxes.every((box) => box.height >= 205 && box.height <= 220)).toBe(true);
    expect(boxes.every((box) => box.borderRadius === "17px")).toBe(true);

    const graphs = page.getByTestId("signal-sparkline");
    await expect(graphs).toHaveCount(6);
    const graphGeometry = await graphs.evaluateAll((elements) =>
      elements.map((element) => {
        const graphBox = element.getBoundingClientRect();
        const cardBox = element.closest("[data-signal-metric]")!.getBoundingClientRect();
        return {
          overflow: getComputedStyle(element).overflow,
          observedPoints: Number(element.getAttribute("data-observed-points")),
          hasDashAnimation: element.querySelector("[data-signal-line]")?.hasAttribute("stroke-dasharray") ?? false,
          mainStroke: Number(element.querySelector("[data-signal-line]")?.getAttribute("stroke-width")),
          glowStroke: Number(element.querySelector(".analytics-signal-line-glow")?.getAttribute("stroke-width")),
          pointCount: element.querySelectorAll("circle, rect").length,
          widthShare: graphBox.width / cardBox.width,
          heightShare: graphBox.height / cardBox.height,
        };
      }),
    );
    expect(graphGeometry.every((graph) => graph.overflow === "hidden")).toBe(true);
    expect(graphGeometry.every((graph) => graph.observedPoints >= 2)).toBe(true);
    expect(graphGeometry.some((graph) => graph.hasDashAnimation)).toBe(false);
    expect(graphGeometry.every((graph) => graph.mainStroke <= .8 && graph.glowStroke <= 2.2)).toBe(true);
    expect(graphGeometry.every((graph) => graph.pointCount === 0)).toBe(true);
    expect(graphGeometry.every((graph) => graph.widthShare >= .9 && graph.heightShare >= .44 && graph.heightShare <= .5)).toBe(true);
  });

  test("keeps the analytics surface inside the tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/echoes");
    await expect(page.getByTestId("analytics-dashboard")).toBeVisible();
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);
  });
});
