import { expect, test, type Page } from "@playwright/test";

const title = "Launch day: behind the scenes";
const platforms = ["Instagram", "TikTok", "YouTube", "Facebook", "Threads", "X"];

// Synthetic local-engine data only: no OAuth credentials or real publications.
async function seedPost(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-16T12:00:00"));
  await page.goto("/continuum");
  await page.waitForFunction(() => Boolean(window.__engine));
  return page.evaluate(async (postTitle) => {
    const engine = (window as unknown as { __engine: { getState(): any; setState(value: any): void } }).__engine;
    engine.setState({ transmissions: [], projections: [], events: [] });
    const store = engine.getState();
    const artifact = await store.addArtifact(new File([new Uint8Array(256)], "logo-check.mp4", { type: "video/mp4" }), { durationMs: 12_000 });
    const scheduledFor = new Date();
    scheduledFor.setHours(18, 30, 0, 0);
    const post = store.createTransmission({
      title: postTitle, baseCaption: "The caption stays in post details.", hashtags: [],
      artifactId: artifact.id, platforms: ["instagram", "tiktok", "youtube", "facebook", "threads", "x"],
      perPlatformCaptions: {}, scheduleMode: "at", scheduledFor: scheduledFor.getTime(),
    });
    // Duplicate destinations must not produce duplicate platform logos.
    const projections = engine.getState().projections;
    engine.setState({ projections: [...projections, { ...projections[0], id: "second-account-same-platform" }] });
    return post.id;
  }, title);
}

for (const width of [1440, 390]) {
  test(`calendar shows every logo below the title and time in the top corner at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const id = await seedPost(page);
    const postButton = page.getByRole("button", { name: `View post: ${title}`, exact: true });
    const checkCard = async () => {
      await postButton.scrollIntoViewIfNeeded();
      await expect(postButton).toBeVisible();
      await expect(postButton).toContainText(title);
      await expect(postButton.locator("[data-calendar-platforms] img")).toHaveCount(6);
      await expect(postButton.locator(".calendar-post-platform-count")).toHaveCount(0);
      for (const platform of platforms) {
        await expect(postButton.getByRole("img", { name: `${platform} logo`, exact: true })).toBeVisible();
      }
      const fits = await postButton.evaluate((button) => {
        const card = button.getBoundingClientRect();
        return [...button.querySelectorAll("[data-calendar-platforms] img")].every((image) => {
          const box = image.getBoundingClientRect();
          return box.left >= card.left && box.right <= card.right + 1 && box.bottom <= card.bottom + 1;
        });
      });
      expect(fits).toBe(true);
      const sizes = await postButton.evaluate((button) => ({
        title: parseFloat(getComputedStyle(button.querySelector("[data-calendar-post-title]")!).fontSize),
        time: parseFloat(getComputedStyle(button.querySelector("[data-calendar-post-time]")!).fontSize),
        height: button.getBoundingClientRect().height,
      }));
      expect(sizes.time).toBe(9);
      expect(sizes.time).toBeLessThan(sizes.title);
      expect(sizes.height).toBeGreaterThanOrEqual(54);
      expect(sizes.height).toBeLessThanOrEqual(80);
    };

    await checkCard();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/posterract-calendar-logos-month-${width}.png`, fullPage: true });
    await postButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("The caption stays in post details.");
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await page.getByRole("radio", { name: "Week", exact: true }).click();
    await checkCard();
    await page.screenshot({ path: `/tmp/posterract-calendar-logos-week-${width}.png`, fullPage: true });

    await page.getByRole("button", { name: "Open Wed Sep 16 2026", exact: true }).click();
    const dayPost = page.getByRole("dialog").getByRole("button", { name: `View post: ${title}`, exact: true });
    await expect(dayPost).toContainText(title);
    await expect(dayPost.locator("[data-calendar-platforms] img")).toHaveCount(6);
    await dayPost.click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: title, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.locator(`[data-transmission-id="${id}"]`)).toHaveAttribute("draggable", "true");
  });
}

test("logo calendar cards retain drag-to-reschedule behavior", async ({ page }) => {
  const id = await seedPost(page);
  const target = page.getByRole("group", { name: "Fri Sep 18 2026", exact: true });
  await page.locator(`[data-transmission-id="${id}"]`).dragTo(target);
  const moved = target.locator(`[data-transmission-id="${id}"]`);
  await expect(moved).toBeVisible();
  await expect(moved.locator("[data-calendar-platforms] img")).toHaveCount(6);
  await expect(moved.locator("[data-calendar-post-title]")).toHaveText(title);
  await expect(page.getByText("Post rescheduled", { exact: true })).toBeVisible();
});

for (const provider of ["youtube", "tiktok", "facebook"]) {
  test(`${provider} connection return screen shows its logo without changing completion`, async ({ page }) => {
    // Hold only the demo OAuth promise so the brief completion screen can be inspected.
    await page.route("**/src/engine/local.ts", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const delayed = body.replace(/complete:\s*async\s*\(\)\s*=>\s*\(\{[\s\S]*?\}\)/,
        "complete: () => new Promise((resolve) => { window.__finishDemoOAuth = resolve; })");
      expect(delayed).not.toBe(body);
      await route.fulfill({ response, body: delayed });
    });
    await page.goto(`/oauth/callback/${provider}?code=demo-code&state=demo-state`);
    const label = { youtube: "YouTube", tiktok: "TikTok", facebook: "Facebook" }[provider];
    const accountLink = page.getByRole("link", { name: `Return to ${label} accounts`, exact: true });
    await expect(accountLink).toHaveAttribute("href", "/portals");
    await expect(accountLink.getByRole("img", { name: `${label} logo`, exact: true })).toBeVisible();
    await expect(page.getByText("Completing connection…", { exact: true })).toBeVisible();
    if (provider === "youtube") await page.screenshot({ path: "/tmp/posterract-youtube-connection-logo.png" });
    await page.evaluate(() => (window as unknown as { __finishDemoOAuth: (value: unknown) => void }).__finishDemoOAuth({ ok: true, handle: "Demo account" }));
    await expect(page).toHaveURL(/\/portals$/);
  });
}
