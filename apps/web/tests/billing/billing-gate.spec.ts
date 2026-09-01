import { expect, test, type Page } from "@playwright/test";

const session = {
  session: {
    id: "session_test",
    token: "token_test",
    userId: "user_test",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  user: {
    id: "user_test",
    email: "paid@example.test",
    emailVerified: true,
    name: "Paid Test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
};

const config = {
  configured: true,
  publishableKey: "pk_live_test",
  productId: "prod_test",
  plans: {
    monthly: { priceId: "price_monthly", amount: 2_000, currency: "usd", interval: "month" },
    yearly: { priceId: "price_yearly", amount: 20_000, currency: "usd", interval: "year" },
  },
};

async function mockAuthenticatedUser(page: Page) {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }),
  );
  await page.route("**/v1/billing/config", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config) }),
  );
}

test("an authenticated unpaid user sees the locked payment popup before app data loads", async ({ page }) => {
  await mockAuthenticatedUser(page);
  let bootstrapRequests = 0;
  await page.route("**/v1/billing/subscription", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "none",
        accessState: "inactive",
        entitled: false,
        plan: null,
        cancelAtPeriodEnd: false,
      }),
    }),
  );
  await page.route("**/v1/bootstrap", (route) => {
    bootstrapRequests += 1;
    return route.fulfill({ status: 402, contentType: "application/json", body: '{"error":"subscription_required"}' });
  });

  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "Everything currently shipping, in one plan." })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Monthly $20 per month" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Yearly $200 per year" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plan and schedule every post." })).toHaveCount(0);
  expect(bootstrapRequests).toBe(0);

  let checkoutInterval: string | undefined;
  let idempotencyKey: string | undefined;
  await page.route("**/v1/billing/checkout", async (route) => {
    checkoutInterval = (await route.request().postDataJSON()).interval;
    idempotencyKey = route.request().headers()["idempotency-key"];
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "cs_live_test",
        url: "http://127.0.0.1:5175/stripe-checkout-test",
        status: "open",
      }),
    });
  });
  await page.getByRole("radio", { name: "Yearly $200 per year" }).click();
  await page.getByRole("button", { name: "Continue to Stripe" }).click();
  await expect(page).toHaveURL(/stripe-checkout-test/);
  expect(checkoutInterval).toBe("yearly");
  expect(idempotencyKey).toMatch(/^checkout-/);
});

test("an active paid subscription unlocks and mounts the application", async ({ page }) => {
  await mockAuthenticatedUser(page);
  await page.route("**/v1/billing/subscription", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "active",
        accessState: "active",
        entitled: true,
        plan: { interval: "month", currency: "usd", unitAmount: 2_000 },
        cancelAtPeriodEnd: false,
      }),
    }),
  );
  await page.route("**/v1/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspaceId: "workspace_test",
        artifacts: [],
        transmissions: [],
        projections: [],
        events: [],
        portals: [],
        points: { lifetimeRP: 0, weekRP: 0, streakDays: 0, badges: [], recent: [] },
      }),
    }),
  );

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Plan and schedule every post." })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Everything currently shipping, in one plan." })).toHaveCount(0);
});
