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

const plans = [
  { id: "monthly", amount: 5999, currency: "usd", interval: "month" },
  { id: "yearly", amount: 59999, currency: "usd", interval: "year" },
  { id: "lifetime", amount: 200000, currency: "usd", interval: null },
];

const PROVIDERS = ["instagram", "tiktok", "facebook", "threads"] as const;
const tenAccounts = Array.from({ length: 10 }, (_, index) => ({
  id: `acct_${index}`,
  workspaceId: "workspace_test",
  provider: PROVIDERS[index % PROVIDERS.length],
  providerAccountId: `pid_${index}`,
  handle: `@player${index}`,
  scopes: [],
  status: "connected",
}));

async function signedOut(page: Page) {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: null }));
  await page.route("**/v1/auth/config", (route) =>
    route.fulfill({ json: { providers: { google: true, emailVerification: true, magicLink: false } } }),
  );
}

const billingConfig = {
  configured: true,
  publishableKey: "pk_live_test",
  productId: "prod_test",
  plans: {
    monthly: { priceId: "price_monthly", amount: 2_000, currency: "usd", interval: "month" },
    yearly: { priceId: "price_yearly", amount: 20_000, currency: "usd", interval: "year" },
  },
};

async function signedInAtTheLimit(page: Page) {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: session }));
  // Without this the billing gate stops at "Billing check unavailable".
  await page.route("**/v1/billing/config", (route) => route.fulfill({ json: billingConfig }));
  await page.route("**/v1/billing/subscription", (route) =>
    route.fulfill({
      json: { status: "active", accessState: "active", entitled: true, entitledVia: "subscription", plan: { id: "pro", interval: "month", currency: "usd", unitAmount: 2_000 }, cancelAtPeriodEnd: false },
    }),
  );
  await page.route("**/v1/bootstrap", (route) =>
    route.fulfill({
      json: {
        workspaceId: "workspace_test",
        artifacts: [],
        transmissions: [],
        projections: [],
        events: [],
        portals: tenAccounts,
        businesses: [],
        accountSets: [],
        points: { lifetimeRP: 0, weekRP: 0, streakDays: 0, badges: [], recent: [] },
        accountLimit: { plan: "pro", max: 10, used: 10 },
      },
    }),
  );
  await page.route("**/v1/accounts/refresh-profiles", (route) => route.fulfill({ json: { checked: 10, refreshed: 10, failures: [] } }));
  await page.route("**/v1/savages/plans", (route) => route.fulfill({ json: { plans } }));
}

test("after paying, the welcome page confirms the membership and offers the login on that email", async ({ page }) => {
  await signedOut(page);
  let asked = 0;
  await page.route("**/v1/savages/checkout/cs_live_*", (route) => {
    asked += 1;
    return route.fulfill({
      json:
        asked === 1
          ? { state: "pending", email: "buyer@example.test", plan: "monthly" }
          : { state: "active", email: "buyer@example.test", plan: "monthly", hasPosterractLogin: false },
    });
  });
  await page.goto("/savages?session_id=cs_live_a1b2c3d4e5f6g7h8");
  await expect(page.getByRole("heading", { name: "You’re in." })).toBeVisible();
  await expect(page.getByText("Your monthly membership is active for")).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com").first()).toHaveValue("buyer@example.test");
  await expect(page.getByRole("link", { name: /Open AI FOR SAVAGES/ })).toHaveAttribute("href", /aiforsavages\.fyi\/sign-up/);
});

test("a buyer whose email already has a login is asked to sign in", async ({ page }) => {
  await signedOut(page);
  await page.route("**/v1/savages/checkout/cs_live_*", (route) =>
    route.fulfill({ json: { state: "active", email: "back@example.test", plan: "yearly", hasPosterractLogin: true } }),
  );
  await page.goto("/savages?session_id=cs_live_a1b2c3d4e5f6g7h8");
  await expect(page.locator(".sv-step").first()).toContainText("Sign in with back@example.test");
});

test("without a checkout the welcome page says so and offers sign-in", async ({ page }) => {
  await signedOut(page);
  await page.goto("/savages");
  await expect(page.getByRole("heading", { name: "We couldn’t find that checkout." })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sign in to Posterract/ })).toHaveAttribute("href", "/gate?mode=signin");
});

test("at Pro's ten accounts, connecting is off and AI FOR SAVAGES is one click to Stripe", async ({ page }) => {
  await signedInAtTheLimit(page);
  let body: unknown;
  await page.route("**/v1/savages/checkout/member", async (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ json: { url: "http://127.0.0.1:5175/stripe-checkout-test" } });
  });
  await page.goto("/portals");
  await expect(page.getByRole("heading", { name: "10 of 10 accounts" })).toBeVisible();
  await expect(page.getByText("All 10 of your Pro account slots are in use.")).toBeVisible();
  for (const button of await page.getByRole("button", { name: "Limit reached" }).all()) {
    await expect(button).toBeDisabled();
  }
  await page.getByRole("button", { name: "$59.99/mo" }).click();
  await expect(page).toHaveURL(/stripe-checkout-test/);
  expect(body).toEqual({ plan: "monthly" });
});
