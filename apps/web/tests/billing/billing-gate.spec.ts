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

export const config = {
  configured: true,
  publishableKey: "pk_live_test",
  productId: "prod_test",
  creditPlans: {
    pro: { priceId: "price_pro", yearlyPriceId: "price_pro_yearly", amount: 2_000, yearlyAmount: 20_000, currency: "usd", interval: "month", credits: 0 },
    allstar: { priceId: "price_allstar", yearlyPriceId: "price_allstar_yearly", amount: 4_900, yearlyAmount: 49_000, currency: "usd", interval: "month", credits: 1_200 },
    superstar: { priceId: "price_superstar", yearlyPriceId: "price_superstar_yearly", amount: 9_900, yearlyAmount: 99_000, currency: "usd", interval: "month", credits: 3_000 },
  },
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
  await expect(page.getByRole("dialog", { name: "Your workspace. Your AI keys." })).toBeVisible();
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
  await expect(page.getByRole("dialog", { name: "Your workspace. Your AI keys." })).toHaveCount(0);
});

test("failed payments on an active subscription open recovery and refresh access after payment", async ({ page }) => {
  await mockAuthenticatedUser(page);
  let recovered = false;
  await page.route("**/v1/billing/subscription", route => route.fulfill({ json: {
    status: "active", entitled: recovered, accessState: recovered ? "active" : "inactive", canManageBilling: true,
    lastPaymentStatus: recovered ? "paid" : "failed", cancelAtPeriodEnd: false,
    plan: { id: "pro", interval: "month", currency: "usd", unitAmount: 2000 },
  } }));
  await page.route("**/v1/bootstrap", route => route.fulfill({ json: {
    workspaceId: "workspace_test", artifacts: [], transmissions: [], projections: [], events: [], portals: [],
    points: { lifetimeRP: 0, weekRP: 0, streakDays: 0, badges: [], recent: [] },
  } }));
  let portalRequests = 0;
  let checkoutRequests = 0;
  await page.route("**/v1/billing/checkout", route => { checkoutRequests++; return route.fulfill({ status: 409, json: { error: "subscription_already_exists" } }); });
  await page.route("**/v1/billing/portal", route => { portalRequests++; return route.fulfill({ json: { url: "http://127.0.0.1:5175/stripe-portal-test" } }); });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Continue to Stripe" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open Stripe billing" }).click();
  await expect(page).toHaveURL(/stripe-portal-test/);
  expect(portalRequests).toBe(1);
  expect(checkoutRequests).toBe(0);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Check payment status" })).toBeVisible();
  recovered = true;
  await page.getByRole("button", { name: "Check payment status" }).click();
  await expect(page.getByRole("heading", { name: "Plan and schedule every post." })).toBeVisible();
});

test("closing annual checkout keeps the annual selection", async ({ page }) => {
  await mockAuthenticatedUser(page);
  await page.route("**/v1/billing/subscription", route => route.fulfill({ json: { status: "none", entitled: false, accessState: "inactive", plan: null, cancelAtPeriodEnd: false } }));
  await page.goto("/settings?billing=cancelled&plan=pro&interval=yearly");
  await expect(page.getByRole("radio", { name: "Yearly $200 per year" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Checkout was closed before payment.", { exact: true })).toBeVisible();
});


for (const [plan, name] of [["pro", "Pro"]] as const) {
  for (const interval of ["monthly", "yearly"] as const) {
    test(`${name} ${interval} survives signup navigation and reaches the correct checkout`, async ({ page }) => {
      let authenticated = false;
      await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: authenticated ? session : null }));
      await page.route("**/v1/billing/config", (route) => route.fulfill({ json: config }));
      await page.route("**/v1/auth/config", (route) => route.fulfill({ json: { providers: { google: true, emailVerification: true } } }));
      await page.route("**/v1/billing/subscription", (route) => route.fulfill({ json: { status: "none", entitled: false, plan: null, cancelAtPeriodEnd: false } }));
      let checkout: unknown;
      await page.route("**/v1/billing/checkout", async (route) => {
        checkout = route.request().postDataJSON();
        await route.fulfill({ status: 201, json: { sessionId: "cs_test", url: "http://127.0.0.1:5175/stripe-checkout-test" } });
      });
      await page.goto("/#pricing");
      if (interval === "yearly") await page.getByRole("switch", { name: "Yearly billing" }).check();
      const amount = interval === "yearly" ? config.creditPlans[plan].yearlyAmount : config.creditPlans[plan].amount;
      await expect(page.getByLabel(`${name} $${amount / 100} per ${interval === "yearly" ? "year" : "month"}`, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: `Get ${name}`, exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Welcome to Posterract" })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`plan=${plan}&interval=${interval}`));
      // Verification and OAuth can return in a new document without any React state.
      authenticated = true;
      await page.reload();
      await expect(page.getByRole("radiogroup", { name: "Plan", exact: true })).toHaveCount(0);
      await expect(page.getByRole("radio", { name: `${interval === "yearly" ? "Yearly" : "Monthly"} $${amount / 100} per ${interval === "yearly" ? "year" : "month"}` })).toHaveAttribute("aria-checked", "true");
      await page.getByRole("button", { name: "Continue to Stripe" }).click();
      await expect(page).toHaveURL(/stripe-checkout-test/);
      expect(checkout).toEqual({ plan, interval });
    });
  }
}

test("email signup and Google sign-in receive the selected annual-plan return URL", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: null }));
  await page.route("**/v1/billing/config", (route) => route.fulfill({ json: config }));
  await page.route("**/v1/auth/config", (route) => route.fulfill({ json: { providers: { google: true, emailVerification: true } } }));
  let emailCallback = "";
  let googleCallback = "";
  await page.route("**/api/auth/sign-up/email", (route) => {
    emailCallback = route.request().postDataJSON().callbackURL;
    return route.fulfill({ json: { user: session.user, token: null } });
  });
  await page.route("**/api/auth/sign-in/social", (route) => {
    googleCallback = route.request().postDataJSON().callbackURL;
    return route.fulfill({ json: { redirect: false } });
  });
  await page.goto("/#pricing");
  await page.getByRole("switch", { name: "Yearly billing" }).press("Space");
  await expect(page.getByRole("switch", { name: "Yearly billing" })).toBeChecked();
  await page.getByRole("button", { name: "Get Pro", exact: true }).click();
  await page.getByPlaceholder("What should we call you?").fill("Pricing Test");
  await page.getByPlaceholder("you@example.com").fill("pricing@example.test");
  await page.getByPlaceholder("At least 8 characters").fill("test password only 123");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verify your signal." })).toBeVisible();
  expect(emailCallback).toBe("http://127.0.0.1:5175/?plan=pro&interval=yearly");
  await page.getByRole("button", { name: "Close welcome screen" }).click();
  await page.getByRole("button", { name: "Get Pro", exact: true }).click();
  await page.getByRole("button", { name: "Sign up with Google" }).click();
  await expect.poll(() => googleCallback).toBe(emailCallback);
});

test("unavailable public prices can be retried and cannot start an unpriced checkout", async ({ page }) => {
  let available = false;
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: null }));
  await page.route("**/v1/billing/config", (route) => route.fulfill({ status: available ? 200 : 503, json: available ? config : { error: "unavailable" } }));
  await page.goto("/#pricing");
  await expect(page.getByRole("status")).toContainText("Pricing is temporarily unavailable");
  await expect(page.getByRole("button", { name: "Get Pro", exact: true })).toBeDisabled();
  available = true;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Get Pro", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Pro $20 per month", { exact: true })).toBeVisible();
});

test("paid subscribers can manage billing and review a selected plan change", async ({ page }) => {
  await mockAuthenticatedUser(page);
  await page.route("**/v1/billing/subscription", route => route.fulfill({ json: {
    status: "active", entitled: true, accessState: "active", canManageBilling: true,
    plan: { id: "pro", interval: "month", currency: "usd", unitAmount: 2000 }, cancelAtPeriodEnd: false,
  } }));
  await page.route("**/v1/bootstrap", route => route.fulfill({ json: {
    workspaceId: "workspace_test", artifacts: [], transmissions: [], projections: [], events: [], portals: [],
    points: { lifetimeRP: 0, weekRP: 0, streakDays: 0, badges: [], recent: [] },
  } }));
  const requests: unknown[] = [];
  await page.route("**/v1/billing/portal", route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { url: "http://127.0.0.1:5175/stripe-portal-test" } });
  });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review billing change" })).toBeDisabled();
  await page.getByRole("button", { name: "Manage billing", exact: true }).click();
  await expect(page).toHaveURL(/stripe-portal-test/);
  expect(requests[0]).toEqual({});
  await page.goto("/settings");
  await expect(page.getByRole("combobox", { name: "New plan" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "New billing cycle" }).selectOption("yearly");
  await expect(page.getByText("Pro — $200 / year", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review billing change" }).click();
  await expect(page).toHaveURL(/stripe-portal-test/);
  expect(requests[1]).toEqual({ plan: "pro", interval: "yearly" });
});


test("retired plan links lead to the single Pro checkout while preserving yearly billing", async ({ page }) => {
  await mockAuthenticatedUser(page);
  await page.route("**/v1/billing/subscription", route => route.fulfill({ json: { status: "none", entitled: false, plan: null, cancelAtPeriodEnd: false } }));
  let payload: unknown;
  await page.route("**/v1/billing/checkout", route => {
    payload = route.request().postDataJSON();
    return route.fulfill({ json: { sessionId: "cs_test", url: "http://127.0.0.1:5175/stripe-checkout-test" } });
  });
  await page.goto("/?plan=superstar&interval=yearly");
  await expect(page.getByRole("radio", { name: "Yearly $200 per year" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Allstar", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Superstar", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to Stripe" }).click();
  await expect(page).toHaveURL(/stripe-checkout-test/);
  expect(payload).toEqual({ plan: "pro", interval: "yearly" });
});

test("public pricing shows one plan even against a cached three-plan catalog", async ({ page }) => {
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: null }));
  await page.route("**/v1/billing/config", route => route.fulfill({ json: config }));
  await page.goto("/#pricing");
  await expect(page.locator("#pricing article")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Posterract Pro" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Get Allstar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Get Superstar" })).toHaveCount(0);
  await expect(page.getByText("Your AI. Your API keys.")).toBeVisible();
});
