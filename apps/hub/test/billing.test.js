import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { postgres } from "../src/db.js";
import { PRICES, handleStripeEvent, isOurPrice, planForPrice, stripe } from "../src/billing.js";

/**
 * Phase D acceptance (§11): duplicate and out-of-order events are harmless,
 * a foreign price can never grant anything, and the 3-day grace is set once.
 *
 * These exercise the webhook handler directly with synthetic events, so no
 * Stripe network calls and no real money. The end-to-end test-clock script
 * still needs a test-mode key.
 */

const RUN = randomUUID().slice(0, 8);
const EMAIL = `billtest-${RUN}@example.com`;
const SUB = `sub_test_${RUN}`;
const CUS = `cus_test_${RUN}`;

const OURS_MONTHLY = process.env.AFS_STRIPE_PRICE_MONTHLY;
const POSTERRACT_PRICE = "price_1U7UwZCoOesYmdbAFycPOK9b"; // real Posterract $20/mo

let accountId;

// the happy path: people with no membership yet
const PAYER = `billtest-${RUN}-payer@example.com`; // monthly, then renews
const LIFER = `billtest-${RUN}-lifer@example.com`; // lifetime
const NOPE = `billtest-${RUN}-nope@example.com`; // every ignore case
const PAYER_SUB = `sub_test_${RUN}_payer`;
const PAYER_CUS = `cus_test_${RUN}_payer`;
let payerId;
let liferId;
let nopeId;
const happyEvents = [];

const evt = (type, object, id = `evt_${randomUUID().slice(0, 12)}`) => ({
  id,
  type,
  livemode: false,
  data: { object },
});

const subObject = (priceId, { cancel = false, periodDays = 30 } = {}) => ({
  id: SUB,
  customer: CUS,
  cancel_at_period_end: cancel,
  metadata: { account_id: accountId, product: "aiforsavages" },
  items: {
    data: [
      {
        price: { id: priceId },
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + periodDays * 86400,
      },
    ],
  },
});

async function hasMembership() {
  const row = await postgres.query(
    `select core.has_membership($1,'aiforsavages') as ok`,
    [accountId],
  );
  return row.rows[0].ok;
}

before(async () => {
  const person = await postgres.query(
    `insert into app_users (id, email, display_name)
     values (gen_random_uuid(), $1, 'Billing Test') returning id`,
    [EMAIL],
  );
  accountId = person.rows[0].id;

  // a live subscription membership to act on
  await postgres.query(
    `insert into core.memberships
       (account_id, product_id, plan, status, source,
        stripe_customer_id, stripe_subscription_id, stripe_price_id,
        current_period_start, current_period_end, member_since)
     values ($1,'aiforsavages','monthly','active','stripe_subscription',
             $2,$3,$4, now(), now() + interval '30 days', now())`,
    [accountId, CUS, SUB, OURS_MONTHLY],
  );

  const newPerson = async (email) =>
    (
      await postgres.query(
        `insert into app_users (id, email, display_name)
         values (gen_random_uuid(), $1, 'Billing Test') returning id`,
        [email],
      )
    ).rows[0].id;
  payerId = await newPerson(PAYER);
  liferId = await newPerson(LIFER);
  nopeId = await newPerson(NOPE);
});

after(async () => {
  const people = [accountId, payerId, liferId, nopeId].filter(Boolean);
  await postgres.query(`delete from core.review_queue where account_id = any($1)`, [people]);
  await postgres.query(`delete from core.memberships where account_id = any($1)`, [people]);
  await postgres.query(`delete from core.billing_events where stripe_event_id = any($1)`, [happyEvents]);
  await postgres.query(`delete from core.billing_events where stripe_event_id like 'evt_%' and account_id is null and type like '%' and received_at > now() - interval '1 hour'`);
  await postgres.query(`delete from app_users where id = any($1)`, [people]);
  await postgres.end();
});

test("our three price ids are recognised, everyone else's are not", () => {
  assert.equal(isOurPrice(OURS_MONTHLY), true);
  assert.equal(planForPrice(OURS_MONTHLY), "monthly");

  // the legacy one-time price shares the same Stripe PRODUCT — must not match
  assert.equal(isOurPrice("price_1RbNWSCoOesYmdbA8d1QvblR"), false);
  // Posterract, same Stripe account
  assert.equal(isOurPrice(POSTERRACT_PRICE), false);
});

test("a Posterract event is ignored and writes no AFS membership", async () => {
  const before_ = await postgres.query(
    `select status from core.memberships where account_id = $1`,
    [accountId],
  );

  const result = await handleStripeEvent(
    evt("customer.subscription.updated", subObject(POSTERRACT_PRICE, { cancel: true })),
  );

  assert.equal(result.status, "ignored");
  assert.equal(result.why, "not_our_price");

  const after_ = await postgres.query(
    `select status, cancel_at_period_end from core.memberships where account_id = $1`,
    [accountId],
  );
  assert.equal(after_.rows[0].status, before_.rows[0].status, "untouched");
  assert.equal(after_.rows[0].cancel_at_period_end, false, "not cancelled by a foreign event");
});

test("a duplicate event id is a no-op", async () => {
  const event = evt("customer.subscription.updated", subObject(OURS_MONTHLY, { cancel: true }));

  const first = await handleStripeEvent(event);
  assert.equal(first.status, "processed");

  const second = await handleStripeEvent(event);
  assert.equal(second.status, "duplicate", "same event id does nothing the second time");

  const ledger = await postgres.query(
    `select count(*)::int as n from core.billing_events where stripe_event_id = $1`,
    [event.id],
  );
  assert.equal(ledger.rows[0].n, 1, "recorded once");
});

test("a failed card sets a 3-day grace ONCE and later retries never extend it", async () => {
  // reset to a clean active state
  await postgres.query(
    `update core.memberships set status='active', grace_until=null, cancel_at_period_end=false
      where account_id = $1`,
    [accountId],
  );

  const failure = { id: `in_${RUN}_1`, subscription: SUB, customer: CUS };
  await handleStripeEvent(evt("invoice.payment_failed", failure));

  const first = await postgres.query(
    `select status, grace_until from core.memberships where account_id = $1`,
    [accountId],
  );
  assert.equal(first.rows[0].status, "past_due");
  assert.ok(first.rows[0].grace_until, "grace window opened");
  assert.equal(await hasMembership(), true, "access continues during grace");

  const firstGrace = new Date(first.rows[0].grace_until).getTime();

  // Stripe retries and fails again — must NOT push the window out
  await handleStripeEvent(evt("invoice.payment_failed", { ...failure, id: `in_${RUN}_2` }));

  const second = await postgres.query(
    `select grace_until from core.memberships where account_id = $1`,
    [accountId],
  );
  assert.equal(
    new Date(second.rows[0].grace_until).getTime(),
    firstGrace,
    "grace_until unchanged by the second failure",
  );
});

test("access switches off once the grace window passes", async () => {
  await postgres.query(
    `update core.memberships set status='past_due', grace_until = now() - interval '1 minute'
      where account_id = $1`,
    [accountId],
  );
  assert.equal(await hasMembership(), false, "off, without any job having run");
});

test("cancelling stops the next charge but keeps access to period end", async () => {
  await postgres.query(
    `update core.memberships
        set status='active', grace_until=null,
            current_period_end = now() + interval '10 days'
      where account_id = $1`,
    [accountId],
  );

  await handleStripeEvent(
    evt("customer.subscription.updated", subObject(OURS_MONTHLY, { cancel: true })),
  );

  const row = await postgres.query(
    `select cancel_at_period_end, status from core.memberships where account_id = $1`,
    [accountId],
  );
  assert.equal(row.rows[0].cancel_at_period_end, true);
  assert.equal(row.rows[0].status, "active");
  assert.equal(await hasMembership(), true, "still a member until the period ends");
});

test("subscription deleted turns access off", async () => {
  await handleStripeEvent(
    evt("customer.subscription.deleted", subObject(OURS_MONTHLY)),
  );

  const row = await postgres.query(
    `select status, ended_at from core.memberships where account_id = $1`,
    [accountId],
  );
  assert.equal(row.rows[0].status, "canceled");
  assert.ok(row.rows[0].ended_at);
  assert.equal(await hasMembership(), false);
});

test("a forced refund kills access immediately and parks a review row", async () => {
  await postgres.query(
    `update core.memberships
        set status='active', ended_at=null, current_period_end = now() + interval '20 days'
      where account_id = $1`,
    [accountId],
  );

  const result = await handleStripeEvent(
    evt("charge.refunded", {
      id: `ch_${RUN}`,
      customer: CUS,
      metadata: { account_id: accountId, product: "aiforsavages" },
    }),
  );
  assert.equal(result.status, "processed");

  const row = await postgres.query(
    `select status from core.memberships where account_id = $1`,
    [accountId],
  );
  assert.equal(row.rows[0].status, "refunded");
  assert.equal(await hasMembership(), false, "access off immediately");

  const review = await postgres.query(
    `select kind from core.review_queue where account_id = $1 and kind = 'charge.refunded'`,
    [accountId],
  );
  assert.equal(review.rowCount, 1, "a human is told");
});

/* ------------------------------------------------------------------ */
/* the happy path — a purchase actually granting a membership          */
/* ------------------------------------------------------------------ */

/**
 * The webhook handler reads a few things back from Stripe (the subscription,
 * a lifetime session's line items). Here those reads are stood in for, for
 * the length of one call: no network, no money, and the events themselves are
 * shaped like the production endpoint's payload version (2026-08-26.dahlia) —
 * an invoice names its subscription only under parent.subscription_details,
 * and the billing period lives on the subscription item.
 */
async function withStripeRead(resource, method, fake, run) {
  const own = Object.prototype.hasOwnProperty.call(resource, method);
  const original = resource[method];
  resource[method] = fake;
  try {
    return await run();
  } finally {
    if (own) resource[method] = original;
    else delete resource[method];
  }
}

const happyEvt = (type, object) => {
  const event = evt(type, object);
  happyEvents.push(event.id);
  return event;
};

const neverCalled = async () => {
  throw new Error("Stripe must not be asked about an event that is already refused");
};

const payerSubscription = ({ status = "active", days = 30 } = {}) => ({
  id: PAYER_SUB,
  object: "subscription",
  status,
  customer: PAYER_CUS,
  cancel_at_period_end: false,
  metadata: { account_id: payerId, product: "aiforsavages", plan: "monthly" },
  items: {
    data: [
      {
        price: { id: OURS_MONTHLY },
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + days * 86400,
      },
    ],
  },
});

const liveRows = async (id) =>
  (
    await postgres.query(
      `select plan, status, source, stripe_subscription_id, current_period_end,
              grace_until, member_since
         from core.memberships
        where account_id = $1 and status in ('active','past_due')`,
      [id],
    )
  ).rows;

const hasMembershipFor = async (id) =>
  (await postgres.query(`select core.has_membership($1,'aiforsavages') as ok`, [id])).rows[0].ok;

test("a paid monthly checkout creates an active membership with a period end", async () => {
  let asked = null;
  const result = await withStripeRead(
    stripe.subscriptions,
    "retrieve",
    async (id) => {
      asked = id;
      return payerSubscription();
    },
    () =>
      handleStripeEvent(
        happyEvt("checkout.session.completed", {
          id: `cs_test_${RUN}_monthly`,
          object: "checkout.session",
          mode: "subscription",
          status: "complete",
          payment_status: "paid",
          customer: PAYER_CUS,
          subscription: PAYER_SUB,
          client_reference_id: payerId,
          metadata: { account_id: payerId, product: "aiforsavages", plan: "monthly" },
        }),
      ),
  );

  assert.equal(result.status, "processed");
  assert.equal(result.kind, "subscription");
  assert.equal(asked, PAYER_SUB, "status and period come from the subscription itself");

  const rows = await liveRows(payerId);
  assert.equal(rows.length, 1, "exactly one live membership");
  assert.equal(rows[0].plan, "monthly");
  assert.equal(rows[0].status, "active");
  assert.equal(rows[0].source, "stripe_subscription");
  assert.equal(rows[0].stripe_subscription_id, PAYER_SUB);
  assert.ok(rows[0].member_since, "member_since is set");
  const daysLeft = (new Date(rows[0].current_period_end).getTime() - Date.now()) / 86400000;
  assert.ok(daysLeft > 29 && daysLeft <= 30, `period ends in ~30 days (got ${daysLeft.toFixed(2)})`);
  assert.equal(await hasMembershipFor(payerId), true, "unlocked");
});

test("invoice.paid renews: the period moves out and a grace window closes", async () => {
  // the card failed once: past_due, inside grace
  await postgres.query(
    `update core.memberships
        set status = 'past_due', grace_until = now() + interval '2 days'
      where account_id = $1 and stripe_subscription_id = $2`,
    [payerId, PAYER_SUB],
  );

  const result = await withStripeRead(
    stripe.subscriptions,
    "retrieve",
    async () => payerSubscription({ days: 60 }),
    () =>
      handleStripeEvent(
        // dahlia: no top-level `subscription` on an invoice
        happyEvt("invoice.paid", {
          id: `in_test_${RUN}_renewal`,
          object: "invoice",
          status: "paid",
          billing_reason: "subscription_cycle",
          customer: PAYER_CUS,
          parent: {
            type: "subscription_details",
            subscription_details: {
              subscription: PAYER_SUB,
              metadata: { account_id: payerId, product: "aiforsavages", plan: "monthly" },
            },
          },
          lines: {
            data: [
              {
                pricing: { type: "price_details", price_details: { price: OURS_MONTHLY } },
              },
            ],
          },
        }),
      ),
  );

  assert.equal(result.status, "processed");
  assert.equal(result.kind, "renewed");

  const rows = await liveRows(payerId);
  assert.equal(rows.length, 1, "renewed in place, not a second membership");
  assert.equal(rows[0].status, "active");
  assert.equal(rows[0].grace_until, null, "a successful payment closes the grace window");
  const daysLeft = (new Date(rows[0].current_period_end).getTime() - Date.now()) / 86400000;
  assert.ok(daysLeft > 59, `period extended (got ${daysLeft.toFixed(2)} days)`);
});

test("a paid lifetime checkout grants a membership that never ends", async () => {
  let asked = null;
  const result = await withStripeRead(
    stripe.checkout.sessions,
    "listLineItems",
    async (id) => {
      asked = id;
      return { data: [{ price: { id: PRICES.lifetime } }] };
    },
    () =>
      handleStripeEvent(
        happyEvt("checkout.session.completed", {
          id: `cs_test_${RUN}_lifetime`,
          object: "checkout.session",
          mode: "payment",
          status: "complete",
          payment_status: "paid",
          customer: `cus_test_${RUN}_lifer`,
          subscription: null,
          client_reference_id: liferId,
          metadata: { account_id: liferId, product: "aiforsavages", plan: "lifetime" },
        }),
      ),
  );

  assert.equal(result.status, "processed");
  assert.equal(result.kind, "lifetime");
  assert.equal(asked, `cs_test_${RUN}_lifetime`, "the charged price is read back from Stripe");

  const rows = await liveRows(liferId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].plan, "lifetime");
  assert.equal(rows[0].status, "active");
  assert.equal(rows[0].source, "stripe_one_time");
  assert.equal(rows[0].current_period_end, null, "no end date");
  assert.equal(await hasMembershipFor(liferId), true);
});

test("a checkout whose money has not arrived grants nothing", async () => {
  for (const paymentStatus of ["unpaid", "no_payment_required"]) {
    const result = await withStripeRead(stripe.subscriptions, "retrieve", neverCalled, () =>
      handleStripeEvent(
        happyEvt("checkout.session.completed", {
          id: `cs_test_${RUN}_${paymentStatus}`,
          object: "checkout.session",
          mode: "subscription",
          status: "complete",
          payment_status: paymentStatus,
          customer: `cus_test_${RUN}_nope`,
          subscription: `sub_test_${RUN}_nope`,
          client_reference_id: nopeId,
          metadata: { account_id: nopeId, product: "aiforsavages", plan: "monthly" },
        }),
      ),
    );
    assert.equal(result.status, "ignored");
    assert.equal(result.why, `payment_status_${paymentStatus}`);
  }
  assert.equal((await liveRows(nopeId)).length, 0, "no membership written");
  assert.equal(await hasMembershipFor(nopeId), false);
});

test("a subscription still waiting on 3-D Secure is not activated by checkout", async () => {
  const result = await withStripeRead(
    stripe.subscriptions,
    "retrieve",
    async () => ({
      ...payerSubscription({ status: "incomplete" }),
      id: `sub_test_${RUN}_nope`,
      metadata: { account_id: nopeId, product: "aiforsavages", plan: "monthly" },
    }),
    () =>
      handleStripeEvent(
        happyEvt("checkout.session.completed", {
          id: `cs_test_${RUN}_incomplete`,
          object: "checkout.session",
          mode: "subscription",
          status: "complete",
          payment_status: "paid",
          customer: `cus_test_${RUN}_nope`,
          subscription: `sub_test_${RUN}_nope`,
          client_reference_id: nopeId,
          metadata: { account_id: nopeId, product: "aiforsavages", plan: "monthly" },
        }),
      ),
  );
  assert.equal(result.status, "ignored");
  assert.equal(result.why, "subscription_incomplete", "invoice.paid activates it later");
  assert.equal((await liveRows(nopeId)).length, 0);
});

test("a one-time checkout for any other price grants nothing, whatever its metadata claims", async () => {
  const result = await withStripeRead(
    stripe.checkout.sessions,
    "listLineItems",
    // the old $59.99 one-time price — same Stripe product, not ours to grant on
    async () => ({ data: [{ price: { id: "price_1RbNWSCoOesYmdbA8d1QvblR" } }] }),
    () =>
      handleStripeEvent(
        happyEvt("checkout.session.completed", {
          id: `cs_test_${RUN}_foreign`,
          object: "checkout.session",
          mode: "payment",
          status: "complete",
          payment_status: "paid",
          customer: `cus_test_${RUN}_nope`,
          client_reference_id: nopeId,
          metadata: { account_id: nopeId, product: "aiforsavages", plan: "lifetime" },
        }),
      ),
  );
  assert.equal(result.status, "ignored");
  assert.equal(result.why, "not_our_price");
  assert.equal((await liveRows(nopeId)).length, 0);
});
