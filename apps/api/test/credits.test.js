import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import Fastify from "fastify";
import Stripe from "stripe";
import { rollCycleIfDue } from "../src/credits.js";
import {
  CREDIT_PLANS,
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
  "006-stripe-billing.sql",
  "011-ai-credits.sql",
  "013-plan-rename.sql",
  "014-transcribe-minutes.sql",
  "015-plan-names.sql",
];
const workspaceId = "00000000-0000-4000-8000-000000000301";
const userId = "00000000-0000-4000-8000-000000000302";
const webhookSecret = "whsec_posterract_credit_test";
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
     values ($1, 'credits@example.test', 'Credits Test')`,
    [userId],
  );
  await postgres.query(
    `insert into workspaces (id, owner_id, name)
     values ($1, $2, 'Credits Test Workspace')`,
    [workspaceId, userId],
  );
  return { postgres, pool: pgPool(postgres) };
}

async function testApp(pool) {
  const app = Fastify({ logger: false });
  const service = createStripeBillingService({
    postgres: pool,
    environment,
    stripeClient: { webhooks: new Stripe("sk_live_signature_unit_test").webhooks },
  });
  const requireSession = async (request) => {
    request.authContext = { kind: "session", userId, workspaceId, role: "owner" };
  };
  registerBillingRoutes(app, { service, requireSession });
  await registerStripeWebhookRoutes(app, { service });
  const signatures = new Stripe("sk_live_signature_unit_test").webhooks;
  async function send(event) {
    const payload = JSON.stringify({
      api_version: "2026-07-29.basil",
      created: 1_800_000_000,
      livemode: true,
      ...event,
    });
    return app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signatures.generateTestHeaderString({
          payload,
          secret: webhookSecret,
        }),
      },
      payload,
    });
  }
  return { app, send };
}

function creditSubscription(overrides = {}) {
  return {
    id: "sub_credit",
    object: "subscription",
    customer: "cus_credit",
    status: "active",
    livemode: true,
    cancel_at_period_end: false,
    metadata: { workspace_id: workspaceId, user_id: userId },
    items: {
      data: [
        {
          current_period_start: 1_799_000_000,
          current_period_end: 1_801_678_400,
          price: {
            id: environment.STRIPE_PRO_MONTHLY_PRICE_ID,
            product: "prod_ai_plans",
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

function paidInvoice({ id, priceId, periodStart, periodEnd }) {
  return {
    id,
    object: "invoice",
    customer: "cus_credit",
    subscription: "sub_credit",
    status_transitions: { paid_at: 1_800_000_010 },
    lines: {
      data: [
        {
          price: { id: priceId },
          period: { start: periodStart, end: periodEnd },
        },
      ],
    },
  };
}

test("credit plan definitions expose the launch catalog", async () => {
  // A credit is a cent of provider spend, so an allotment is the most a
  // subscriber can cost us: $0.00, $12.00, $30.00 against $20/$49/$99.
  assert.equal(CREDIT_PLANS.pro.credits, 0);
  assert.equal(CREDIT_PLANS.allstar.credits, 1_200);
  assert.equal(CREDIT_PLANS.superstar.credits, 3_000);
  assert.equal(CREDIT_PLANS.pro.monthlyAmount, 2_000);
  assert.equal(CREDIT_PLANS.allstar.monthlyAmount, 4_900);
  assert.equal(CREDIT_PLANS.superstar.monthlyAmount, 9_900);
  // Ten months' money for twelve months of service, and the figure the plan card
  // shows on the yearly cycle — it used to show the monthly one relabelled.
  assert.equal(CREDIT_PLANS.pro.yearlyAmount, 20_000);
  assert.equal(CREDIT_PLANS.allstar.yearlyAmount, 49_000);
  assert.equal(CREDIT_PLANS.superstar.yearlyAmount, 99_000);

  const { postgres, pool } = await database();
  const { app } = await testApp(pool);
  try {
    const config = await app.inject({ method: "GET", url: "/v1/billing/config" });
    assert.equal(config.statusCode, 200);
    assert.deepEqual(config.json().creditPlans.pro, {
      priceId: "price_pro",
      yearlyPriceId: "price_pro_yearly",
      amount: 2_000,
      yearlyAmount: 20_000,
      currency: "usd",
      interval: "month",
      credits: 0,
    });
    assert.equal(config.json().creditPlans.allstar.yearlyAmount, 49_000);
    assert.equal(config.json().creditPlans.superstar.yearlyAmount, 99_000);
    assert.equal(config.json().creditPlans.superstar.credits, 3_000);
  } finally {
    await app.close();
    await postgres.close();
  }
});

test("paid credit-plan invoices set the plan and reset the balance each cycle", async () => {
  const { postgres, pool } = await database();
  const { app, send } = await testApp(pool);
  try {
    const created = await send({
      id: "evt_credit_subscription",
      type: "customer.subscription.created",
      data: { object: creditSubscription() },
    });
    assert.equal(created.statusCode, 200);
    assert.deepEqual(created.json(), { received: true, processed: true });

    const subscription = await pool.query(
      "select recognized_plan, status from billing_subscriptions where workspace_id = $1",
      [workspaceId],
    );
    assert.equal(subscription.rows[0].recognized_plan, true);
    let credits = await pool.query(
      "select plan, balance from workspace_credits where workspace_id = $1",
      [workspaceId],
    );
    assert.equal(credits.rows[0].plan, "pro");
    assert.equal(Number(credits.rows[0].balance), 0);

    const firstInvoice = await send({
      id: "evt_credit_invoice_1",
      type: "invoice.paid",
      data: {
        object: paidInvoice({
          id: "in_credit_1",
          priceId: environment.STRIPE_ALLSTAR_MONTHLY_PRICE_ID,
          periodStart: 1_799_000_000,
          periodEnd: 1_801_678_400,
        }),
      },
    });
    assert.equal(firstInvoice.statusCode, 200);
    credits = await pool.query(
      `select plan, balance, allotment, cycle_started_at, cycle_resets_at
       from workspace_credits where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(credits.rows[0].plan, "allstar");
    assert.equal(Number(credits.rows[0].balance), 1_200);
    assert.equal(Number(credits.rows[0].allotment), 1_200);
    assert.equal(
      new Date(credits.rows[0].cycle_resets_at).getTime(),
      1_801_678_400_000,
    );
    const grants = await pool.query(
      `select delta, note from credit_ledger
       where workspace_id = $1 and kind = 'grant'`,
      [workspaceId],
    );
    assert.equal(grants.rows.length, 1);
    assert.equal(Number(grants.rows[0].delta), 1_200);
    assert.match(
      grants.rows[0].note,
      /Granted 1200 allstar credits for cycle \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/,
    );

    // Spend most of the cycle, then renew: the balance RESETS to the
    // allotment (no rollover) and the remainder is expired in the ledger.
    await pool.query(
      "update workspace_credits set balance = 40 where workspace_id = $1",
      [workspaceId],
    );
    const renewal = await send({
      id: "evt_credit_invoice_2",
      type: "invoice.paid",
      data: {
        object: paidInvoice({
          id: "in_credit_2",
          priceId: environment.STRIPE_ALLSTAR_MONTHLY_PRICE_ID,
          periodStart: 1_801_678_400,
          periodEnd: 1_804_356_800,
        }),
      },
    });
    assert.equal(renewal.statusCode, 200);
    credits = await pool.query(
      "select balance from workspace_credits where workspace_id = $1",
      [workspaceId],
    );
    assert.equal(Number(credits.rows[0].balance), 1_200);
    const expired = await pool.query(
      `select delta from credit_ledger
       where workspace_id = $1 and kind = 'expire'`,
      [workspaceId],
    );
    assert.equal(expired.rows.length, 1);
    assert.equal(Number(expired.rows[0].delta), -40);
    const allGrants = await pool.query(
      `select count(*)::int as count from credit_ledger
       where workspace_id = $1 and kind = 'grant'`,
      [workspaceId],
    );
    assert.equal(allGrants.rows[0].count, 2);
  } finally {
    await app.close();
    await postgres.close();
  }
});

test("cancellation clears the plan but leaves the balance until cycle end", async () => {
  const { postgres, pool } = await database();
  const { app, send } = await testApp(pool);
  try {
    await send({
      id: "evt_cancel_subscription",
      type: "customer.subscription.created",
      data: { object: creditSubscription() },
    });
    await send({
      id: "evt_cancel_invoice",
      type: "invoice.paid",
      data: {
        object: paidInvoice({
          id: "in_cancel_1",
          priceId: environment.STRIPE_ALLSTAR_MONTHLY_PRICE_ID,
          periodStart: 1_799_000_000,
          periodEnd: 1_801_678_400,
        }),
      },
    });

    const deleted = await send({
      id: "evt_cancel_deleted",
      type: "customer.subscription.deleted",
      data: {
        object: creditSubscription({
          status: "canceled",
          canceled_at: 1_800_500_000,
          ended_at: 1_800_500_000,
        }),
      },
    });
    assert.equal(deleted.statusCode, 200);
    const credits = await pool.query(
      "select plan, balance from workspace_credits where workspace_id = $1",
      [workspaceId],
    );
    assert.equal(credits.rows[0].plan, null);
    assert.equal(Number(credits.rows[0].balance), 1_200);

    // An upgrade later in a new cycle re-grants at the new plan's allotment.
    const upgrade = await send({
      id: "evt_studio_invoice",
      type: "invoice.paid",
      data: {
        object: paidInvoice({
          id: "in_studio_1",
          priceId: environment.STRIPE_SUPERSTAR_MONTHLY_PRICE_ID,
          periodStart: 1_801_678_400,
          periodEnd: 1_804_356_800,
        }),
      },
    });
    assert.equal(upgrade.statusCode, 200);
    const upgraded = await pool.query(
      "select plan, balance, allotment from workspace_credits where workspace_id = $1",
      [workspaceId],
    );
    assert.equal(upgraded.rows[0].plan, "superstar");
    assert.equal(Number(upgraded.rows[0].balance), 3_000);
    assert.equal(Number(upgraded.rows[0].allotment), 3_000);
  } finally {
    await app.close();
    await postgres.close();
  }
});

test("legacy subscriptions without credit prices never touch credit accounts", async () => {
  const { postgres, pool } = await database();
  const { app, send } = await testApp(pool);
  try {
    const legacy = await send({
      id: "evt_legacy_subscription",
      type: "customer.subscription.created",
      data: {
        object: creditSubscription({
          id: "sub_legacy",
          items: {
            data: [
              {
                current_period_start: 1_799_000_000,
                current_period_end: 1_801_678_400,
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
        }),
      },
    });
    assert.equal(legacy.statusCode, 200);
    const invoice = await send({
      id: "evt_legacy_invoice",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_legacy_1",
          object: "invoice",
          customer: "cus_credit",
          subscription: "sub_legacy",
          status_transitions: { paid_at: 1_800_000_010 },
        },
      },
    });
    assert.equal(invoice.statusCode, 200);
    const credits = await pool.query(
      "select count(*)::int as count from workspace_credits where workspace_id = $1",
      [workspaceId],
    );
    assert.equal(credits.rows[0].count, 0);
  } finally {
    await app.close();
    await postgres.close();
  }
});

/**
 * Credits refill monthly from the payment date, whatever cadence Stripe
 * invoices on. A yearly subscriber is invoiced once; without this they would
 * be granted a single month's allowance for a year's money.
 */
test("credits refill a month from the payment date, even on a yearly invoice", async () => {
  const { postgres, pool } = await database();
  const { app, send } = await testApp(pool);
  try {
    await send({
      id: "evt_yearly_subscription",
      type: "customer.subscription.created",
      data: { object: creditSubscription() },
    });
    // A yearly invoice: one payment, a period a year long.
    await send({
      id: "evt_yearly_invoice",
      type: "invoice.paid",
      data: {
        object: paidInvoice({
          id: "in_yearly_1",
          priceId: environment.STRIPE_ALLSTAR_MONTHLY_PRICE_ID,
          periodStart: 1_799_000_000,
          periodEnd: 1_799_000_000 + 365 * 24 * 3600,
        }),
      },
    });

    // The cycle resets a month after payment, not a year.
    let credits = await pool.query(
      "select balance, cycle_started_at, cycle_resets_at from workspace_credits where workspace_id = $1",
      [workspaceId],
    );
    assert.equal(Number(credits.rows[0].balance), 1_200);
    const started = new Date(credits.rows[0].cycle_started_at).getTime();
    const resets = new Date(credits.rows[0].cycle_resets_at).getTime();
    const days = (resets - started) / (24 * 3600 * 1000);
    assert.ok(days >= 28 && days <= 31, `expected a one-month cycle, got ${days} days`);

    // Spend most of it, then move the clock past the reset: the next read
    // refills to the allowance rather than waiting for another invoice.
    await pool.query(
      `update workspace_credits
          set balance = 40,
              transcribe_seconds_used = 3600,
              cycle_resets_at = now() - interval '1 day'
        where workspace_id = $1`,
      [workspaceId],
    );
    // The refill is lazy — it happens on the next read of the account, which
    // is what makes it work without a scheduler.
    const rolled = await rollCycleIfDue(pool, workspaceId, (plan) => CREDIT_PLANS[plan].credits);
    assert.equal(rolled, true, "a due cycle rolls");
    credits = await pool.query(
      "select balance from workspace_credits where workspace_id = $1",
      [workspaceId],
    );
    assert.equal(Number(credits.rows[0].balance), 1_200, "a due cycle refills to the allowance");

    // Transcription minutes reset with it.
    credits = await pool.query(
      "select transcribe_seconds_used from workspace_credits where workspace_id = $1",
      [workspaceId],
    );
    assert.equal(Number(credits.rows[0].transcribe_seconds_used), 0);

    // The allowance is a ceiling, not something that accumulates: a long
    // absence grants once, not once per month missed.
    const grants = await pool.query(
      `select count(*)::int as count from credit_ledger
        where workspace_id = $1 and kind = 'grant'`,
      [workspaceId],
    );
    assert.equal(grants.rows[0].count, 2);
  } finally {
    await app.close();
    await postgres.close();
  }
});
