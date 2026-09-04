import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import Fastify from "fastify";
import Stripe from "stripe";
import {
  createBillingEntitlementGuard,
  createStripeBillingService,
  registerBillingRoutes,
  registerStripeWebhookRoutes,
} from "../src/billing.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = resolve(
  here,
  "../../../deploy/posterract/postgres/init",
);
const migrationNames = [
  "001-posterract.sql",
  "002-postgres-cutover.sql",
  "003-agent-harness.sql",
  "004-agent-chats.sql",
  "005-tiktok-draft-status.sql",
  "006-stripe-billing.sql",
];
const workspaceId = "00000000-0000-4000-8000-000000000101";
const userId = "00000000-0000-4000-8000-000000000102";
const webhookSecret = "whsec_posterract_unit_test";
const environment = {
  STRIPE_SECRET_KEY: "sk_live_posterract_unit_test",
  STRIPE_WEBHOOK_SECRET: webhookSecret,
  STRIPE_PUBLISHABLE_KEY: "pk_live_posterract_unit_test",
  STRIPE_PRODUCT_ID: "prod_posterract",
  STRIPE_MONTHLY_PRICE_ID: "price_monthly",
  STRIPE_YEARLY_PRICE_ID: "price_yearly",
  STRIPE_PRO_MONTHLY_PRICE_ID: "price_pro",
  STRIPE_PRO_YEARLY_PRICE_ID: "price_pro_yearly",
  STRIPE_ALLSTAR_MONTHLY_PRICE_ID: "price_allstar",
  STRIPE_ALLSTAR_YEARLY_PRICE_ID: "price_allstar_yearly",
  STRIPE_SUPERSTAR_MONTHLY_PRICE_ID: "price_superstar",
  STRIPE_SUPERSTAR_YEARLY_PRICE_ID: "price_superstar_yearly",
  SITE_URL: "https://posterract.app",
};

function pgPool(postgres) {
  const query = async (text, parameters = []) => {
    const result = await postgres.query(
      typeof text === "object" ? text.text : text,
      typeof text === "object" ? text.values ?? [] : parameters,
    );
    return {
      ...result,
      rowCount: result.affectedRows ?? result.rows.length,
    };
  };
  return {
    query,
    connect: async () => ({ query, release() {} }),
  };
}

async function database() {
  const postgres = new PGlite({ extensions: { pgcrypto } });
  for (const name of migrationNames) {
    await postgres.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
  }
  await postgres.query(
    `insert into app_users (id, email, display_name)
     values ($1, 'billing@example.test', 'Billing Test')`,
    [userId],
  );
  await postgres.query(
    `insert into workspaces (id, owner_id, name)
     values ($1, $2, 'Billing Test Workspace')`,
    [workspaceId, userId],
  );
  return { postgres, pool: pgPool(postgres) };
}

function stripeMock() {
  const signatures = new Stripe("sk_live_signature_unit_test").webhooks;
  const calls = {
    customers: [],
    checkouts: [],
    portals: [],
  };
  const client = {
    products: {
      retrieve: async (id) => ({ id, active: true }),
    },
    prices: {
      // The whole catalogue, because checkout verifies every price a customer
      // can be sent to — not just the base pair.
      retrieve: async (id) => {
        const catalogue = {
          [environment.STRIPE_MONTHLY_PRICE_ID]: ["month", 2_000],
          [environment.STRIPE_YEARLY_PRICE_ID]: ["year", 20_000],
          [environment.STRIPE_PRO_MONTHLY_PRICE_ID]: ["month", 2_000],
          [environment.STRIPE_PRO_YEARLY_PRICE_ID]: ["year", 20_000],
          [environment.STRIPE_ALLSTAR_MONTHLY_PRICE_ID]: ["month", 4_900],
          [environment.STRIPE_ALLSTAR_YEARLY_PRICE_ID]: ["year", 49_000],
          [environment.STRIPE_SUPERSTAR_MONTHLY_PRICE_ID]: ["month", 9_900],
          [environment.STRIPE_SUPERSTAR_YEARLY_PRICE_ID]: ["year", 99_000],
        };
        const [interval, unitAmount] = catalogue[id] ?? ["month", 2_000];
        return {
          id,
          active: true,
          type: "recurring",
          product: environment.STRIPE_PRODUCT_ID,
          currency: "usd",
          unit_amount: unitAmount,
          recurring: { interval, interval_count: 1 },
        };
      },
    },
    customers: {
      create: async (...args) => {
        calls.customers.push(args);
        return { id: "cus_posterract" };
      },
    },
    checkout: {
      sessions: {
        create: async (...args) => {
          calls.checkouts.push(args);
          return {
            id: "cs_live_posterract",
            url: "https://checkout.stripe.com/c/pay/posterract",
            status: "open",
            payment_status: "unpaid",
            amount_total: null,
            currency: "usd",
            expires_at: 2_000_000_000,
          };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (...args) => {
          calls.portals.push(args);
          return { url: "https://billing.stripe.com/p/session/posterract" };
        },
      },
    },
    webhooks: signatures,
  };
  return { client, calls, signatures };
}

async function testApp(pool, stripe) {
  const app = Fastify({ logger: false });
  const service = createStripeBillingService({
    postgres: pool,
    environment,
    stripeClient: stripe,
  });
  const requireSession = async (request) => {
    request.authContext = {
      kind: "session",
      userId,
      workspaceId,
      role: "owner",
    };
  };
  registerBillingRoutes(app, { service, requireSession });
  await registerStripeWebhookRoutes(app, { service });
  return { app, service };
}

function eventPayload(event) {
  return JSON.stringify({
    api_version: "2026-07-29.basil",
    created: 1_800_000_000,
    livemode: true,
    ...event,
  });
}

function signedHeaders(signatures, payload) {
  return {
    "content-type": "application/json",
    "stripe-signature": signatures.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    }),
  };
}

function subscriptionObject(overrides = {}) {
  return {
    id: "sub_posterract",
    object: "subscription",
    customer: "cus_posterract",
    status: "active",
    livemode: true,
    cancel_at_period_end: false,
    metadata: { workspace_id: workspaceId, user_id: userId },
    items: {
      data: [
        {
          current_period_start: 1_799_000_000,
          current_period_end: 1_801_000_000,
          price: {
            id: environment.STRIPE_MONTHLY_PRICE_ID,
            product: environment.STRIPE_PRODUCT_ID,
            currency: "usd",
            unit_amount: 2_000,
            recurring: { interval: "month", interval_count: 1 },
          },
        },
      ],
    },
    ...overrides,
  };
}

test("Stripe webhook rejects bad signatures and atomically deduplicates events", async () => {
  const { postgres, pool } = await database();
  const { client, signatures } = stripeMock();
  const { app } = await testApp(pool, client);
  try {
    const payload = eventPayload({
      id: "evt_subscription_created",
      type: "customer.subscription.created",
      data: { object: subscriptionObject() },
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "invalid",
      },
      payload,
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, "invalid_stripe_signature");

    const accepted = await app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      headers: signedHeaders(signatures, payload),
      payload,
    });
    assert.equal(accepted.statusCode, 200);
    assert.deepEqual(accepted.json(), { received: true, processed: true });

    const replay = await app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      headers: signedHeaders(signatures, payload),
      payload,
    });
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), { received: true, duplicate: true });

    const subscriptions = await pool.query(
      "select * from billing_subscriptions where workspace_id = $1",
      [workspaceId],
    );
    assert.equal(subscriptions.rows.length, 1);
    assert.equal(subscriptions.rows[0].recognized_plan, true);
    assert.equal(subscriptions.rows[0].status, "active");
    assert.equal(subscriptions.rows[0].billing_interval, "month");

    const events = await pool.query("select * from stripe_webhook_events");
    assert.equal(events.rows.length, 1);
    assert.equal(events.rows[0].processing_status, "processed");
    assert.equal(events.rows[0].payload_sha256.length, 64);
  } finally {
    await app.close();
    await postgres.close();
  }
});

test("subscription and invoice events produce a safe current billing state", async () => {
  const { postgres, pool } = await database();
  const { client, signatures } = stripeMock();
  const { app } = await testApp(pool, client);
  async function send(event) {
    const payload = eventPayload(event);
    return app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      headers: signedHeaders(signatures, payload),
      payload,
    });
  }
  try {
    assert.equal(
      (
        await send({
          id: "evt_subscription_updated",
          type: "customer.subscription.updated",
          data: { object: subscriptionObject() },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await send({
          id: "evt_invoice_failed",
          type: "invoice.payment_failed",
          data: {
            object: {
              id: "in_failed",
              object: "invoice",
              customer: "cus_posterract",
              parent: {
                subscription_details: { subscription: "sub_posterract" },
              },
            },
          },
        })
      ).statusCode,
      200,
    );
    let state = await app.inject({
      method: "GET",
      url: "/v1/billing/subscription",
    });
    assert.equal(state.statusCode, 200);
    assert.equal(state.json().status, "active");
    assert.equal(state.json().entitled, false);
    assert.equal(state.json().accessState, "inactive");
    assert.equal(state.json().lastPaymentStatus, "failed");

    assert.equal(
      (
        await send({
          id: "evt_invoice_paid",
          type: "invoice.paid",
          data: {
            object: {
              id: "in_paid",
              object: "invoice",
              customer: "cus_posterract",
              subscription: "sub_posterract",
              status_transitions: { paid_at: 1_800_000_010 },
            },
          },
        })
      ).statusCode,
      200,
    );
    state = await app.inject({ method: "GET", url: "/v1/billing/subscription" });
    assert.equal(state.json().lastPaymentStatus, "paid");
    assert.equal(state.json().entitled, true);
    assert.equal(state.json().accessState, "active");
    assert.equal(typeof state.json().lastPaymentAt, "number");

    const deleted = subscriptionObject({
      status: "canceled",
      canceled_at: 1_800_000_020,
      ended_at: 1_800_000_020,
    });
    assert.equal(
      (
        await send({
          id: "evt_subscription_deleted",
          type: "customer.subscription.deleted",
          data: { object: deleted },
        })
      ).statusCode,
      200,
    );
    state = await app.inject({ method: "GET", url: "/v1/billing/subscription" });
    assert.equal(state.json().status, "canceled");
    assert.equal(state.json().entitled, false);
    assert.equal(state.json().accessState, "inactive");
  } finally {
    await app.close();
    await postgres.close();
  }
});

test("product entitlement requires an active subscription without a failed payment", async () => {
  const { postgres, pool } = await database();
  const { client } = stripeMock();
  const { app, service } = await testApp(pool, client);
  const authenticateWorkspace = async (request) => {
    request.authContext = { kind: "session", userId, workspaceId, role: "owner" };
  };
  app.get(
    "/v1/protected-test",
    {
      preHandler: [
        authenticateWorkspace,
        createBillingEntitlementGuard(service),
      ],
    },
    async () => ({ ok: true }),
  );
  try {
    let response = await app.inject({ method: "GET", url: "/v1/protected-test" });
    assert.equal(response.statusCode, 402);
    assert.equal(response.json().error, "subscription_required");

    await pool.query(
      `insert into billing_subscriptions
         (stripe_subscription_id, workspace_id, stripe_customer_id,
          stripe_product_id, stripe_price_id, billing_interval, currency,
          unit_amount, status, recognized_plan, last_payment_status)
       values ('sub_gate', $1, 'cus_gate', $2, $3, 'month', 'usd', 2000,
               'trialing', true, 'paid')`,
      [workspaceId, environment.STRIPE_PRODUCT_ID, environment.STRIPE_MONTHLY_PRICE_ID],
    );
    response = await app.inject({ method: "GET", url: "/v1/protected-test" });
    assert.equal(response.statusCode, 402);

    await pool.query(
      `update billing_subscriptions
       set status = 'active', last_payment_status = 'failed'
       where stripe_subscription_id = 'sub_gate'`,
    );
    response = await app.inject({ method: "GET", url: "/v1/protected-test" });
    assert.equal(response.statusCode, 402);

    await pool.query(
      `update billing_subscriptions
       set last_payment_status = 'paid'
       where stripe_subscription_id = 'sub_gate'`,
    );
    response = await app.inject({ method: "GET", url: "/v1/protected-test" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });
  } finally {
    await app.close();
    await postgres.close();
  }
});

test("Checkout refuses a tier whose Stripe price does not match the catalogue", async () => {
  const { postgres, pool } = await database();
  const { client } = stripeMock();
  // A tier price mistyped in the Stripe dashboard — $4.90 where $49.00 was meant.
  // Verifying only the base pair let exactly this reach a live checkout page.
  const inner = client.prices.retrieve;
  const stripe = {
    ...client,
    prices: {
      retrieve: async (id) => {
        const price = await inner(id);
        return id === environment.STRIPE_ALLSTAR_MONTHLY_PRICE_ID
          ? { ...price, unit_amount: 490 }
          : price;
      },
    },
  };
  const { app } = await testApp(pool, stripe);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { "idempotency-key": "checkout-mistyped-0001" },
      payload: { plan: "allstar", interval: "monthly" },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, "stripe_catalog_mismatch");
  } finally {
    await app.close();
    await postgres.end?.();
  }
});

test("Checkout validates the live catalog and prevents duplicate subscriptions", async () => {
  const { postgres, pool } = await database();
  const { client, calls } = stripeMock();
  const { app } = await testApp(pool, client);
  try {
    const config = await app.inject({ method: "GET", url: "/v1/billing/config" });
    assert.equal(config.statusCode, 200);
    assert.equal(config.json().configured, true);
    assert.equal(config.json().plans.yearly.amount, 20_000);
    // The yearly amount must be the one Stripe holds. Deriving it from the
    // monthly figure advertised $49/year for a plan billed $490.
    assert.equal(config.json().creditPlans.allstar.amount, 4_900);
    assert.equal(config.json().creditPlans.allstar.yearlyAmount, 49_000);
    assert.equal(config.json().creditPlans.superstar.yearlyAmount, 99_000);

    const missingKey = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      payload: { interval: "yearly" },
    });
    assert.equal(missingKey.statusCode, 400);
    assert.equal(missingKey.json().error, "idempotency_key_required");

    const first = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { "idempotency-key": "checkout-yearly-0001" },
      payload: { interval: "yearly" },
    });
    assert.equal(first.statusCode, 201);
    assert.equal(first.json().sessionId, "cs_live_posterract");
    assert.equal(calls.customers.length, 1);
    assert.equal(calls.checkouts.length, 1);
    assert.equal(
      calls.checkouts[0][0].line_items[0].price,
      environment.STRIPE_YEARLY_PRICE_ID,
    );
    assert.equal(calls.checkouts[0][0].metadata.workspace_id, workspaceId);
    assert.equal(
      calls.checkouts[0][0].subscription_data.metadata.billing_interval,
      "year",
    );
    assert.equal(
      calls.checkouts[0][0].success_url,
      "https://posterract.app/settings?billing=success&session_id={CHECKOUT_SESSION_ID}",
    );

    const replay = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { "idempotency-key": "checkout-yearly-0001" },
      payload: { interval: "yearly" },
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().replayed, true);
    assert.equal(calls.checkouts.length, 1);

    const reused = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { "idempotency-key": "checkout-yearly-0001" },
      payload: { interval: "monthly" },
    });
    assert.equal(reused.statusCode, 409);
    assert.equal(reused.json().error, "idempotency_key_reused");

    await pool.query(
      `insert into billing_subscriptions
         (stripe_subscription_id, workspace_id, stripe_customer_id,
          stripe_product_id, stripe_price_id, billing_interval, currency,
          unit_amount, status, recognized_plan)
       values ('sub_existing', $1, 'cus_posterract', $2, $3, 'year', 'usd',
               20000, 'active', true)`,
      [
        workspaceId,
        environment.STRIPE_PRODUCT_ID,
        environment.STRIPE_YEARLY_PRICE_ID,
      ],
    );
    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { "idempotency-key": "checkout-monthly-0002" },
      payload: { interval: "monthly" },
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().error, "subscription_already_exists");
  } finally {
    await app.close();
    await postgres.close();
  }
});

test("billing stays bootable when secrets are absent and webhook reports readiness", async () => {
  const { postgres, pool } = await database();
  const app = Fastify({ logger: false });
  const service = createStripeBillingService({ postgres: pool, environment: {} });
  await registerStripeWebhookRoutes(app, { service });
  try {
    const status = await app.inject({
      method: "GET",
      url: "/v1/webhooks/stripe",
    });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().configured, false);

    const post = await app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "not-configured",
      },
      payload: "{}",
    });
    assert.equal(post.statusCode, 503);
    assert.equal(post.json().error, "billing_not_configured");
  } finally {
    await app.close();
    await postgres.close();
  }
});

test("signed non-live events are recorded but cannot change entitlements", async () => {
  const { postgres, pool } = await database();
  const { client, signatures } = stripeMock();
  const { app } = await testApp(pool, client);
  try {
    const payload = JSON.stringify({
      id: "evt_testmode_subscription",
      type: "customer.subscription.created",
      api_version: "2026-07-29.basil",
      created: 1_800_000_000,
      livemode: false,
      data: { object: subscriptionObject({ livemode: false }) },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      headers: signedHeaders(signatures, payload),
      payload,
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { received: true, processed: false });
    const subscriptions = await pool.query("select * from billing_subscriptions");
    assert.equal(subscriptions.rows.length, 0);
    const event = await pool.query(
      `select processing_status, livemode from stripe_webhook_events
       where stripe_event_id = 'evt_testmode_subscription'`,
    );
    assert.equal(event.rows[0].processing_status, "ignored");
    assert.equal(event.rows[0].livemode, false);
  } finally {
    await app.close();
    await postgres.close();
  }
});
