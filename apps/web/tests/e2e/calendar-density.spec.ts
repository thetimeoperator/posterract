import { expect, test } from "@playwright/test";

// Synthetic calendar data. No external accounts or publishing calls.
for (const width of [1440, 1024, 390]) {
  test(`four-platform cards have all logos below the title and more posts at the bottom at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.clock.setFixedTime(new Date("2026-09-16T12:00:00"));
    await page.goto("/continuum");
    await page.waitForFunction(() => Boolean(window.__engine));
    await page.evaluate(async () => {
      const engine = (window as any).__engine;
      engine.setState({ transmissions: [], projections: [], events: [] });
      const store = engine.getState();
      const artifact = await store.addArtifact(new File([new Uint8Array(128)], "launch.mp4", { type: "video/mp4" }), { durationMs: 12_000 });
      store.createTransmission({ title: "Seed", baseCaption: "Caption", hashtags: [], artifactId: artifact.id, platforms: ["tiktok"], perPlatformCaptions: {}, scheduleMode: "at", scheduledFor: new Date("2026-09-20T12:00:00").getTime() });
      const original = engine.getState().transmissions[0];
      const projection = engine.getState().projections[0];
      const titles = ["Studio tour", "Three editing tricks", "Inside the launch", "New feature walkthrough"];
      const posts = [2, 3, 3, 3, 3, 7, 9, 9, 14, 16, 16, 18, 18, 18, 21, 25, 29].map((day, i) => ({
        ...original, id: `density-${i}`, title: titles[i % titles.length], status: "live",
        scheduledFor: new Date(2026, 8, day, 9 + i % 10, i % 2 ? 30 : 0).getTime(),
      }));
      engine.setState({ transmissions: posts, projections: posts.flatMap((post, i) => (i % 3 ? ["tiktok"] : ["tiktok", "instagram", "facebook", "threads"]).map((provider) => ({ ...projection, id: `${post.id}-${provider}`, transmissionId: post.id, provider, status: "live" }))) });
    });
    const days = page.locator(".calendar-month-day");
    await expect(days).toHaveCount(35);
    const heights = await days.evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().height));
    expect(new Set(heights)).toEqual(new Set([160]));
    const cards = page.locator(".calendar-post-block--month");
    await expect(cards.first()).toBeVisible();
    const measurements = await cards.evaluateAll((buttons) => buttons.map((button) => {
      const title = button.querySelector("[data-calendar-post-title]")!;
      const logos = button.querySelector("[data-calendar-platforms]")!;
      const time = button.querySelector("[data-calendar-post-time]")!;
      const cardBox = button.getBoundingClientRect();
      const titleBox = title.getBoundingClientRect();
      const logosBox = logos.getBoundingClientRect();
      const timeBox = time.getBoundingClientRect();
      const images = [...logos.querySelectorAll("img")].map(image => image.getBoundingClientRect());
      return {
        height: cardBox.height, titleWidth: titleBox.width,
        logosBelowTitle: logosBox.top >= titleBox.bottom,
        timeAtTopRight: timeBox.left >= titleBox.right && timeBox.top < titleBox.bottom && cardBox.right - timeBox.right < 10,
        logosInOneRow: new Set(images.map(image => Math.round(image.top))).size === 1,
        timeSize: getComputedStyle(time).fontSize,
      };
    }));
    for (const card of measurements) {
      expect(card.height).toBe(54);
      expect(card.titleWidth).toBeGreaterThan(32);
      expect(card.logosBelowTitle).toBe(true);
      expect(card.timeAtTopRight).toBe(true);
      expect(card.logosInOneRow).toBe(true);
      expect(card.timeSize).toBe("9px");
    }
    const fourPlatformCard = page.locator('[data-transmission-id="density-0"]');
    await expect(fourPlatformCard.locator("[data-calendar-platforms] img")).toHaveCount(4);
    for (const platform of ["TikTok", "Instagram", "Facebook", "Threads"]) {
      await expect(fourPlatformCard.getByRole("img", { name: `${platform} logo`, exact: true })).toBeVisible();
    }
    const more = page.getByRole("button", { name: "View 2 more posts on Thu Sep 03 2026", exact: true });
    expect(await more.evaluate(button => {
      const day = button.closest(".calendar-month-day")!;
      const cards = [...day.querySelectorAll(".calendar-post-block--month")];
      const box = button.getBoundingClientRect();
      return box.top >= cards[cards.length - 1].getBoundingClientRect().bottom
        && day.getBoundingClientRect().bottom - box.bottom <= 8;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/posterract-calendar-stacked-logos-${width}.png`, fullPage: true });
    await more.click();
    await expect(page.getByRole("dialog").getByRole("button", { name: /View post:/ })).toHaveCount(4);
  });
}

test("month grid uses only the weeks needed, including four- and six-week months", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-16T12:00:00"));
  await page.goto("/continuum");
  await expect(page.locator(".calendar-month-day")).toHaveCount(35);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByText("August 2026", { exact: true })).toBeVisible();
  await expect(page.locator(".calendar-month-day")).toHaveCount(42);
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("February 2027", { exact: true })).toBeVisible();
  await expect(page.locator(".calendar-month-day")).toHaveCount(28);
});
