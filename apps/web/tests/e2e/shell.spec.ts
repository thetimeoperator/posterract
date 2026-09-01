import { expect, test } from "@playwright/test";

test.describe("Posterract shell", () => {
  test("Calendar is the signed-in home with the primary product dock", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await expect(page).toHaveURL(/\/continuum/);
    const dock = page.getByRole("toolbar", { name: "Posterract navigation" });
    await expect(dock).toBeVisible();
    await expect(page.locator(".liquid-surface__effect")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Posterract home" })).toBeVisible();
    const dockBox = await dock.boundingBox();
    const viewport = page.viewportSize();
    expect(dockBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(dockBox!.y).toBeGreaterThan(viewport!.height * 0.75);
    await expect(dock.getByText("POSTERRACT", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Plan and schedule every post." })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const typography = await page.evaluate(() => ({
      body: window.getComputedStyle(document.body).fontFamily,
      heading: window.getComputedStyle(document.querySelector("h1")!).fontFamily,
      switzerReady: document.fonts.check('600 16px "Switzer"'),
      geistReady: document.fonts.check('400 16px "Geist Variable"'),
    }));
    expect(typography.body).toContain("Geist Variable");
    expect(typography.heading).toContain("Switzer");
    expect(typography.switzerReady).toBe(true);
    expect(typography.geistReady).toBe(true);
    await expect(page.getByRole("link", { name: "New post", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("radio", { name: "Month" })).toBeChecked();
    expect(await dock.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("aria-label")))).toEqual([
      "Create — Agent video editor",
      "Calendar — Publishing schedule",
      "API Keys — Agent access",
      "Analytics — Performance",
      "Social accounts — Connections",
      "Assets — Media library",
      "Settings — Workspace",
    ]);
    await expect(dock.getByRole("link", { name: /Skills|History/ })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("Navigator opens with Cmd+K and jumps to Social accounts", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("toolbar", { name: "Posterract navigation" })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByPlaceholder("Jump to… or type a command");
    await expect(input).toBeVisible();
    await input.fill("social accounts");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/portals/);
  });

  test("typing in Navigator never adds a neon focus box", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("toolbar", { name: "Posterract navigation" })).toBeVisible();

    const assertNeutralFocus = async (selector: string) => {
      const field = page.locator(selector);
      await field.focus();
      const style = await field.evaluate((element) => {
        const computed = window.getComputedStyle(element);
        return {
          outlineStyle: computed.outlineStyle,
          outlineWidth: computed.outlineWidth,
          borderColor: computed.borderColor,
          boxShadow: computed.boxShadow,
        };
      });
      expect(style.outlineStyle).toBe("none");
      expect(style.borderColor).not.toContain("101, 255, 154");
      expect(style.boxShadow).not.toContain("101, 255, 154");
    };

    await page.keyboard.press("ControlOrMeta+k");
    await assertNeutralFocus('input[aria-label="Search commands"]');
  });

  test("Calendar New post opens the manual composer", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "New post", exact: true }).first().click();
    await expect(page).toHaveURL(/\/compose/);
    await expect(page.getByRole("button", { name: "Back to calendar" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Initiate Transmission|Lock Trajectory/ })).toBeVisible();
    await page.getByRole("button", { name: "Back to calendar" }).click();
    await expect(page).toHaveURL(/\/continuum/);
  });

  test("Month and Week day clicks open the focused date popup without changing views", async ({ page }) => {
    const today = new Date();
    const dayLabel = today.toDateString();

    await page.goto("/");
    await expect(page.getByRole("radio", { name: "Month" })).toBeChecked();
    await expect(page.locator("[data-calendar-day]")).toHaveCount(42);
    await page.getByRole("button", { name: dayLabel, exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Day timeline");
    await expect(page.getByRole("radio", { name: "Month" })).toBeChecked();
    await page.getByRole("button", { name: "Close dialog" }).click();

    await page.getByRole("radio", { name: "Week" }).click();
    await expect(page.locator("[data-calendar-day]")).toHaveCount(7);
    await page.getByRole("button", { name: `Open ${dayLabel}`, exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Day timeline");
    await expect(page.getByRole("radio", { name: "Week" })).toBeChecked();
  });

  test("scheduled posts can be dragged to another calendar date", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as unknown as { __engine?: unknown }).__engine));

    const post = await page.evaluate(async () => {
      type TestStore = {
        addArtifact: (
          file: File,
          meta: { durationMs?: number; width?: number; height?: number },
        ) => Promise<{ id: string }>;
        createTransmission: (input: unknown) => { id: string };
      };
      const engine = (window as unknown as { __engine: { getState: () => TestStore } }).__engine;
      const store = engine.getState();
      const file = new File([new Uint8Array(256)], "calendar-drag.mp4", { type: "video/mp4" });
      const artifact = await store.addArtifact(file, { durationMs: 12_000, width: 1080, height: 1920 });
      const source = new Date();
      source.setDate(source.getDate() + 2);
      source.setHours(10, 15, 0, 0);
      const target = new Date(source);
      target.setDate(target.getDate() + 2);
      target.setHours(0, 0, 0, 0);
      const transmission = store.createTransmission({
        title: "Calendar drag test",
        baseCaption: "Move me",
        hashtags: [],
        artifactId: artifact.id,
        platforms: ["instagram"],
        perPlatformCaptions: {},
        scheduleMode: "at",
        scheduledFor: source.getTime(),
      });
      return { id: transmission.id, targetDay: target.getTime() };
    });

    const postCard = page.locator(`[data-transmission-id="${post.id}"]`).first();
    const targetDay = page.locator(`[data-calendar-day="${post.targetDay}"]`);
    await expect(postCard).toBeVisible();
    await postCard.dragTo(targetDay);

    await expect(targetDay.locator(`[data-transmission-id="${post.id}"]`)).toBeVisible();
    await expect(page.getByText("Post rescheduled", { exact: true })).toBeVisible();
  });

  test("Signals panel opens from the bell", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Open notifications/i }).click();
    await expect(page.getByRole("dialog", { name: /Signals/i })).toBeVisible();
  });

  test("bottom dock fits the mobile viewport without replacing the title", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const dock = page.getByRole("toolbar", { name: "Posterract navigation" });
    const box = await dock.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y).toBeGreaterThan(630);
    await expect(page.getByRole("link", { name: "Posterract home" })).toBeVisible();
    await expect(dock.getByRole("link", { name: /API Keys/i })).toBeVisible();
    await expect(dock.getByRole("link", { name: /Settings/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "More Posterract destinations" })).toHaveCount(0);
  });

  test("bottom dock keeps its glass frame stable and icons vertically centered while magnifying", async ({ page }) => {
    await page.goto("/");
    const shell = page.locator(".bottom-dock-shell");
    const analytics = page.getByRole("link", { name: /Analytics/i });
    const before = await shell.boundingBox();
    expect(before).not.toBeNull();

    await analytics.hover();
    await page.waitForTimeout(180);

    const after = await shell.boundingBox();
    const item = await analytics.boundingBox();
    expect(after).not.toBeNull();
    expect(item).not.toBeNull();
    expect(after!.width).toBeCloseTo(before!.width, 1);
    expect(item!.y + item!.height / 2).toBeCloseTo(after!.y + after!.height / 2, 0);
    expect(item!.height).toBeGreaterThan(60);
  });

  test("Hyperkit gallery renders every section", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/dev/hyperkit");
    for (const section of ["Buttons", "Status badges", "Platform chips & runes", "Fields", "Progress", "Panels"]) {
      await expect(page.getByRole("heading", { name: section })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("unknown route shows the Lost Dimension page", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page.getByText("Lost in a dimension")).toBeVisible();
  });

  test("Points is not an active product route", async ({ page }) => {
    await page.goto("/points");
    await expect(page.getByText("Lost in a dimension")).toBeVisible();
  });
});
