import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { PNG } from "pngjs";

const draftCapsuleTitle = "Launch Console Product Tease";
const seededReadyCapsuleTitle = "AI Tools Are Rewiring Creator Workflows";

async function expectNoPanelOverlap(page: Page, selectors: string[]) {
  const overlaps = await page.evaluate((targetSelectors) => {
    const boxes = targetSelectors.flatMap((selector) =>
      [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        }),
    );

    const collisions: string[] = [];
    for (let index = 0; index < boxes.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < boxes.length; nextIndex += 1) {
        const first = boxes[index];
        const second = boxes[nextIndex];
        const xOverlap = Math.min(first.right, second.right) - Math.max(first.left, second.left);
        const yOverlap = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
        if (xOverlap > 4 && yOverlap > 4) {
          collisions.push(`${first.selector} overlaps ${second.selector}`);
        }
      }
    }
    return collisions;
  }, selectors);

  expect(overlaps).toEqual([]);
}

async function runFastGeneration(page: Page, prompt = "Make a sharp video about AI video tools changing creator workflows.") {
  await page.goto("/?testSpeed=fast");

  await page.getByTestId("open-create").click();
  await page.getByTestId("prompt-input").fill(prompt);
  await expect(page.getByTestId("generate-button")).toBeEnabled();
  await page.getByTestId("generate-button").click();

  await expect(page.getByTestId("run-timeline").getByText("Writing angle")).toBeVisible();
  await expect(page.getByText("Final master")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("run-timeline").getByText("Export ready")).toBeVisible();
}

function platformButton(page: Page, platformName: string) {
  return page.getByTestId("platform-panel").getByRole("button", { name: new RegExp(platformName, "i") });
}

async function expectSampleVideoMetadata(outputVideo: Locator) {
  await expect(outputVideo).toBeVisible();
  await outputVideo.evaluate((element: HTMLVideoElement) => {
    element.preload = "metadata";
    element.load();
  });
  await expect.poll(() => outputVideo.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(1);

  const media = await outputVideo.evaluate((element: HTMLVideoElement) => ({
    currentSrc: element.currentSrc,
    duration: element.duration,
    networkState: element.networkState,
  }));
  expect(media.currentSrc).toContain("fixtures/news-character/news-character-fake-preview.mp4");
  expect(media.duration).toBeGreaterThan(0);
  expect(media.networkState).not.toBe(3);
}

test("renders the Vidtryx home core with create and post powers", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("VIDTRYX CORE")).toBeVisible();
  await expect(page.getByTestId("open-create")).toBeVisible();
  await expect(page.getByTestId("open-post")).toBeVisible();
  await expect(page.getByTestId("capsule-dock")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByText("viral-script-skill")).toHaveCount(0);
  await expect(page.getByText("1080")).toHaveCount(0);
});

test("runs through the fake pipeline and moves the capsule to Post", async ({ page }) => {
  test.setTimeout(60_000);
  await runFastGeneration(page);

  const videoCount = await page.locator("video").count();
  expect(videoCount).toBeGreaterThanOrEqual(1);
  await expectSampleVideoMetadata(page.locator("video").first());

  await page.getByTestId("send-to-post").click();
  await expect(page.getByText("POST MODE")).toBeVisible();
  await expect(page.getByTestId("capsule-shelf")).toContainText("AI video tools");
  await expect(page.getByTestId("platform-panel")).toBeVisible();
});

test("handles platform toggles, blocked drafts, scheduled jobs, and Post Now completion", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("open-post").click();
  await expect(page.getByTestId("platform-panel")).toBeVisible();
  await expect(page.getByText("3 selected connected platforms")).toBeVisible();

  const tiktok = platformButton(page, "TikTok");
  await expect(tiktok).toHaveClass(/is-selected/);
  await tiktok.click();
  await expect(tiktok).not.toHaveClass(/is-selected/);
  await expect(page.getByText("2 selected connected platforms")).toBeVisible();

  await tiktok.click();
  await expect(tiktok).toHaveClass(/is-selected/);
  await expect(page.getByText("3 selected connected platforms")).toBeVisible();

  const threads = platformButton(page, "Threads");
  await expect(threads).toBeDisabled();
  await expect(threads).toHaveClass(/is-disabled/);
  await expect(threads).not.toHaveClass(/is-selected/);

  const publishJobsBefore = await page.getByTestId("publish-job").count();

  await page.getByTestId("post-caption").fill("Launch this across the connected short-form channels.");
  await page.getByTestId("schedule-publish").click();

  await expect(page.getByTestId("publish-job")).toHaveCount(publishJobsBefore + 3);
  await expect(page.getByTestId("publish-queue").getByText("scheduled").first()).toBeVisible();

  await page.getByTestId("capsule-shelf").getByRole("button", { name: new RegExp(seededReadyCapsuleTitle, "i") }).click();
  await page.getByTestId("post-caption").fill("Post now smoke test across connected channels.");
  await page.getByRole("button", { name: /^Now$/ }).click();
  const publishJobsBeforeNow = await page.getByTestId("publish-job").count();

  await page.getByTestId("schedule-publish").click();

  await expect(page.getByTestId("publish-job")).toHaveCount(publishJobsBeforeNow + 3);
  await expect(page.getByTestId("publish-job").nth(0)).toContainText("posted", { timeout: 5_000 });
  await expect(page.getByTestId("publish-job").nth(1)).toContainText("posted");
  await expect(page.getByTestId("publish-job").nth(2)).toContainText("posted");
  await expect(page.getByTestId("capsule-shelf").getByRole("button", { name: new RegExp(seededReadyCapsuleTitle, "i") })).toContainText(
    "posted / 9:16",
  );

  await page.getByTestId("capsule-shelf").getByRole("button", { name: new RegExp(draftCapsuleTitle, "i") }).click();
  await expect(page.getByTestId("capsule-shelf").getByRole("button", { name: new RegExp(draftCapsuleTitle, "i") })).toContainText(
    "draft / 9:16",
  );
  await expect(page.getByTestId("schedule-publish")).toBeDisabled();
  await expect(page.getByText("Draft capsule cannot be scheduled")).toBeVisible();
});

test("switches the bottom-left creator vault between profile and past generations", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("creator-vault-button").click();
  await expect(page.getByTestId("creator-vault-panel")).toBeVisible();
  await expect(page.getByText("Creator profile")).toBeVisible();
  await expect(page.getByTestId("vault-profile-panel")).toBeVisible();

  await page.getByTestId("vault-generations-page").click();
  await expect(page.getByTestId("vault-generations-panel")).toBeVisible();
  await expect(page.getByText("Past Generated Parts")).toBeVisible();
  await expect(page.getByTestId("vault-generations")).toContainText("AI Tools");

  await page.getByTestId("vault-profile-page").click();
  await expect(page.getByTestId("vault-profile-panel")).toBeVisible();
  await expect(page.getByText("Creator profile")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("creator-vault-panel")).toHaveCount(0);
  await expect(page.getByTestId("creator-vault-button")).toBeFocused();

  await page.getByTestId("creator-vault-button").click();
  await page.getByTestId("vault-generations-page").click();
  await expect(page.getByTestId("vault-generations-panel")).toBeVisible();

  await page.getByTestId("vault-generations").getByRole("button").first().click();
  await expect(page.getByText("POST MODE")).toBeVisible();
});

test("displays attached file metadata before generation", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("open-create").click();
  await page.getByTestId("file-input").setInputFiles({
    name: "launch-brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(1536, "x"),
  });

  await expect(page.getByText("launch-brief.txt")).toBeVisible();
  await expect(page.getByText("1.5 KB")).toBeVisible();
  await expect(page.getByTestId("generate-button")).toBeEnabled();
});

test("canvas screenshot is not blank", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();

  const screenshot = await page.locator("canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  let litPixels = 0;
  const stride = 4 * 24;

  for (let index = 0; index < image.data.length; index += stride) {
    const red = image.data[index];
    const green = image.data[index + 1];
    const blue = image.data[index + 2];
    if (red + green + blue > 42) {
      litPixels += 1;
    }
  }

  expect(image.width).toBeGreaterThan(200);
  expect(image.height).toBeGreaterThan(200);
  expect(litPixels).toBeGreaterThan(900);
});

test("keeps primary HUD panels separated across target desktop sizes", async ({ page }) => {
  test.setTimeout(90_000);

  const sizes = [
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
    { width: 1728, height: 1117 },
  ];

  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto("/");
    await expectNoPanelOverlap(page, [".home-action--create", ".home-action--post", ".capsule-dock"]);

    await page.getByTestId("open-create").click();
    await expectNoPanelOverlap(page, [".mode-panel", ".telemetry-panel", ".output-bay", ".timeline-panel", ".prompt-bay"]);

    await page.getByTestId("surface-post").click({ force: true });
    await expectNoPanelOverlap(page, [".capsule-shelf", ".platform-panel", ".publish-queue", ".post-composer"]);
  }
});
