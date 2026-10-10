import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

/**
 * Buying AI FOR SAVAGES from Posterract's landing page with no account: the
 * email typed on Stripe's page becomes a person, a Posterract workspace and a
 * membership, exactly once, whoever asks first.
 *
 * In-memory Postgres (PGlite) with every migration and a fake Stripe: no
 * network, no real database, no money. Run it alone:
 *   cd apps/hub && node --test test/guest-checkout.test.js
 */

// billing.js reads these as it loads. db.js insists on a URL, but nothing here
// touches its pool: every function under test is handed the PGlite client.
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.AFS_STRIPE_PRICE_MONTHLY = "price_afs_monthly";
process.env.AFS_STRIPE_PRICE_YEARLY = "price_afs_yearly";
process.env.AFS_STRIPE_PRICE_LIFETIME = "price_afs_lifetime";
process.env.AFS_SITE_URL = "https://www.aiforsavages.fyi";
process.env.POSTERRACT_SITE_URL = "https://www.posterract.app";
delete process.env.STRIPE_SECRET_KEY;

const { GUEST_FLOW, createGuestCheckout, fulfillGuestCheckout, guestCheckoutStatus, publicPlans, siteUrl } =
  await import("../src/billing.js");

const here = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(here, "../../../deploy/posterract/postgres/init");
const NOW = Math.floor(Date.now() / 1000);

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  const files = (await readdir(migrations)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of files) await db.exec(await readFile(resolve(migrations, name), "utf8"));
  const query = async (sql, params = []) => {
    const result = await db.query(sql, params);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  };
  return { query };
}

function fakeStripe({ sessions = {}, subscriptions = {}, prices = {} } = {}) {
  const calls = { created: [], customers: [], subscriptions: [] };
  return {
    calls,
    checkout: {
      sessions: {
        create: async (params) => {
          calls.created.push(params);
          return { id: "cs_test_created0001", url: "https://checkout.stripe.com/c/pay/cs_test_created0001" };
        },
        retrieve: async (id) => {
          if (!sessions[id]) throw new Error("No such checkout.session");
          return sessions[id];
        },
      },
    },
    subscriptions: {
      retrieve: async (id) => subscriptions[id],
      update: async (id, params) => {
        calls.subscriptions.push({ id, ...params });
        return { ...subscriptions[id], ...params };
      },
    },
    customers: {
      update: async (id, params) => {
        calls.customers.push({ id, ...params });
        return { id, ...params };
      },
    },
    prices: {
      retrieve: async (id) => {
        if (!prices[id]) throw new Error("No such price");
        return prices[id];
      },
    },
  };
}

let sequence = 0;
/** A checkout from the landing page, as Stripe returns it with line_items expanded. */
function guestSession({ plan = "monthly", email = "Buyer@Example.test", paid = true } = {}) {
  sequence += 1;
  const id = `cs_test_guest${String(sequence).padStart(6, "0")}`;
  const mode = plan === "lifetime" ? "payment" : "subscription";
  return {
    id,
    object: "checkout.session",
    livemode: false,
    mode,
    status: paid ? "complete" : "open",
    payment_status: paid ? "paid" : "unpaid",
    metadata: { product: "aiforsavages", plan, flow: GUEST_FLOW },
    customer: `cus_${id}`,
    subscription: mode === "subscription" ? `sub_${id}` : null,
    customer_details: { email, name: "Buyer Test" },
    line_items: { data: [{ price: { id: `price_afs_${plan}` } }] },
  };
}

function subscriptionFor(session, status = "active") {
  return {
    id: session.subscription,
    object: "subscription",
    status,
    cancel_at_period_end: false,
    customer: session.customer,
    metadata: { ...session.metadata },
    items: {
      data: [{
        price: { id: session.line_items.data[0].price.id },
        current_period_start: NOW,
        current_period_end: NOW + 30 * 86_400,
      }],
    },
  };
}

/** Stripe holding this one session, and its subscription. */
function stripeWith(session, subscriptionStatus = "active") {
  return fakeStripe({
    sessions: { [session.id]: session },
    subscriptions: session.subscription
      ? { [session.subscription]: subscriptionFor(session, subscriptionStatus) }
      : {},
  });
}

const personByEmail = async (db, email) =>
  (await db.query("select id, email, email_verified, auth_user_id from app_users where lower(email) = $1", [email])).rows[0];
const isMember = async (db, accountId) =>
  (await db.query("select core.has_membership($1, 'aiforsavages') as ok", [accountId])).rows[0].ok;
const count = async (db, sql, params = []) => (await db.query(sql, params)).rows[0].n;

test("a paid checkout makes the person, their Posterract workspace and a live membership", async () => {
  const db = await database();
  const session = guestSession({ email: "  New.Buyer@Example.TEST " });
  const stripe = stripeWith(session);

  const result = await fulfillGuestCheckout(db, session.id, { stripeClient: stripe });
  assert.equal(result.ok, true);
  assert.equal(result.status, "granted");
  assert.equal(result.created, true);

  const person = await personByEmail(db, "new.buyer@example.test");
  assert.ok(person, "stored trimmed and lower-cased");
  assert.notEqual(person.email_verified, true, "only Posterract's own login may verify the email");
  assert.equal(person.auth_user_id, null, "no Posterract login until they make one");

  const workspace = (await db.query("select id from workspaces where owner_id = $1", [person.id])).rows[0];
  assert.ok(workspace, "a Posterract workspace, exactly as sign-up makes one");
  assert.equal(
    (await db.query("select role from workspace_memberships where workspace_id = $1 and user_id = $2", [workspace.id, person.id])).rows[0].role,
    "owner",
  );
  assert.equal(await count(db, "select count(*)::int as n from social_accounts where workspace_id = $1 and status = 'disconnected'", [workspace.id]), 6);

  const membership = (await db.query("select * from core.memberships where account_id = $1", [person.id])).rows[0];
  assert.equal(membership.plan, "monthly");
  assert.equal(membership.status, "active");
  assert.equal(membership.source, "stripe_subscription");
  assert.equal(membership.stripe_subscription_id, session.subscription);
  assert.equal(membership.stripe_customer_id, session.customer);
  assert.ok(membership.current_period_end);
  assert.equal(await isMember(db, person.id), true);

  assert.deepEqual(stripe.calls.customers, [
    { id: session.customer, metadata: { account_id: person.id, product: "aiforsavages" } },
  ]);
  assert.equal(stripe.calls.subscriptions[0].metadata.account_id, person.id);
});

test("asked twice (the webhook, then the welcome page) it is recorded once", async () => {
  const db = await database();
  const session = guestSession();
  const stripe = stripeWith(session);
  assert.equal((await fulfillGuestCheckout(db, session.id, { stripeClient: stripe })).status, "granted");
  const again = await fulfillGuestCheckout(db, session.id, { stripeClient: stripe });
  assert.equal(again.ok, true);
  assert.equal(again.status, "duplicate");
  assert.equal(await count(db, "select count(*)::int as n from core.memberships"), 1);
  assert.equal(stripe.calls.customers.length, 1);
});

test("an unpaid checkout records nothing yet, and is recorded once paid", async () => {
  const db = await database();
  const session = guestSession({ paid: false });
  const stripe = stripeWith(session);
  assert.deepEqual(await fulfillGuestCheckout(db, session.id, { stripeClient: stripe }), { ok: false, reason: "not_paid" });
  assert.equal(await count(db, "select count(*)::int as n from core.billing_events where stripe_event_id = $1", [`guest:${session.id}`]), 0);
  session.status = "complete";
  session.payment_status = "paid";
  assert.equal((await fulfillGuestCheckout(db, session.id, { stripeClient: stripe })).status, "granted");
});

test("a subscription whose first payment is still settling waits for it", async () => {
  const db = await database();
  const session = guestSession();
  const stripe = stripeWith(session, "incomplete");
  assert.deepEqual(await fulfillGuestCheckout(db, session.id, { stripeClient: stripe }), { ok: false, reason: "subscription_incomplete" });
  assert.equal(await count(db, "select count(*)::int as n from core.billing_events"), 0);
});

test("lifetime: a one-time payment grants a membership that never ends", async () => {
  const db = await database();
  const session = guestSession({ plan: "lifetime" });
  const stripe = stripeWith(session);
  const result = await fulfillGuestCheckout(db, session.id, { stripeClient: stripe });
  assert.equal(result.status, "granted");
  const membership = (await db.query("select * from core.memberships where account_id = $1", [result.accountId])).rows[0];
  assert.equal(membership.plan, "lifetime");
  assert.equal(membership.source, "stripe_one_time");
  assert.equal(membership.current_period_end, null);
  assert.equal(membership.stripe_subscription_id, null);
  assert.equal(stripe.calls.customers.length, 1);
  assert.equal(stripe.calls.subscriptions.length, 0);
});

test("someone who already uses Posterract gets the membership on their own account", async () => {
  const db = await database();
  const existing = (await db.query(
    "insert into app_users (email, display_name, email_verified) values ('existing@example.test', 'Existing', true) returning id",
  )).rows[0];
  await db.query("insert into workspaces (owner_id, name) values ($1, 'Mine')", [existing.id]);
  const session = guestSession({ email: "Existing@Example.test" });
  const result = await fulfillGuestCheckout(db, session.id, { stripeClient: stripeWith(session) });
  assert.equal(result.accountId, existing.id);
  assert.equal(result.created, false);
  assert.equal(await count(db, "select count(*)::int as n from workspaces where owner_id = $1", [existing.id]), 1);
  assert.equal(await isMember(db, existing.id), true);
});

test("a member who pays again changes nothing and is parked for Sina", async () => {
  const db = await database();
  const member = (await db.query("insert into app_users (email) values ('member@example.test') returning id")).rows[0];
  await db.query(
    `insert into core.memberships (account_id, product_id, plan, status, source, current_period_end)
     values ($1, 'aiforsavages', 'monthly', 'active', 'manual', now() + interval '30 days')`,
    [member.id],
  );
  const session = guestSession({ email: "member@example.test" });
  const stripe = stripeWith(session);
  const result = await fulfillGuestCheckout(db, session.id, { stripeClient: stripe });
  assert.equal(result.status, "already_member");
  assert.equal(await count(db, "select count(*)::int as n from core.memberships where account_id = $1", [member.id]), 1);
  assert.equal(await count(db, "select count(*)::int as n from core.review_queue where kind = 'guest_checkout_already_member' and details->>'session_id' = $1", [session.id]), 1);
  assert.equal(stripe.calls.customers.length, 0, "the second payment's customer stays untagged");
  assert.equal(stripe.calls.subscriptions.length, 0);

  const status = await guestCheckoutStatus(session.id, { stripeClient: stripe, db, transaction: (run) => run(db) });
  assert.equal(status.state, "already_member");
});

test("no email from Stripe: nothing is granted and one review is parked", async () => {
  const db = await database();
  const session = guestSession({ email: null });
  const stripe = stripeWith(session);
  assert.deepEqual(await fulfillGuestCheckout(db, session.id, { stripeClient: stripe }), { ok: false, reason: "no_email" });
  await fulfillGuestCheckout(db, session.id, { stripeClient: stripe });
  assert.equal(await count(db, "select count(*)::int as n from core.review_queue where kind = 'guest_checkout_no_email'"), 1);
  assert.equal(await count(db, "select count(*)::int as n from core.memberships"), 0);
});

test("anything that is not a guest checkout, or not our price, is refused", async () => {
  const db = await database();
  const notGuest = guestSession();
  notGuest.metadata = { product: "aiforsavages", plan: "monthly" };
  assert.equal((await fulfillGuestCheckout(db, notGuest.id, { stripeClient: stripeWith(notGuest) })).reason, "not_a_guest_checkout");

  const foreign = guestSession();
  foreign.line_items.data[0].price.id = "price_1U7UwZCoOesYmdbAFycPOK9b"; // Posterract Pro
  assert.equal((await fulfillGuestCheckout(db, foreign.id, { stripeClient: stripeWith(foreign) })).reason, "not_our_price");

  const mismatched = guestSession();
  mismatched.line_items.data[0].price.id = "price_afs_lifetime"; // a lifetime price in a subscription
  assert.equal((await fulfillGuestCheckout(db, mismatched.id, { stripeClient: stripeWith(mismatched) })).reason, "not_our_price");

  assert.equal((await fulfillGuestCheckout(db, "garbage")).reason, "invalid_session_id");
  assert.equal(await count(db, "select count(*)::int as n from core.memberships"), 0);
});

test("the welcome page's status: pending, then active with the email", async () => {
  const db = await database();
  const session = guestSession({ paid: false, email: "Pay.Later@Example.test" });
  const stripe = stripeWith(session);
  const ask = () => guestCheckoutStatus(session.id, { stripeClient: stripe, db, transaction: (run) => run(db) });
  assert.deepEqual(await ask(), { state: "pending", email: "pay.later@example.test", plan: "monthly" });
  session.status = "complete";
  session.payment_status = "paid";
  assert.deepEqual(await ask(), { state: "active", email: "pay.later@example.test", plan: "monthly", hasPosterractLogin: false });
  assert.deepEqual(await guestCheckoutStatus("nope", { stripeClient: stripe, db }), { state: "invalid" });
});

test("a guest checkout carries only product, plan and flow, and comes back to Posterract", async () => {
  const stripe = fakeStripe();
  assert.deepEqual(await createGuestCheckout({ plan: "weekly", stripeClient: stripe }), { ok: false, reason: "unknown_plan" });

  const monthly = await createGuestCheckout({ plan: "monthly", stripeClient: stripe });
  assert.equal(monthly.ok, true);
  const params = stripe.calls.created[0];
  assert.equal(params.mode, "subscription");
  assert.deepEqual(params.payment_method_types, ["card"]);
  assert.deepEqual(params.metadata, { product: "aiforsavages", plan: "monthly", flow: GUEST_FLOW });
  assert.deepEqual(params.subscription_data.metadata, params.metadata);
  for (const key of ["userId", "tier", "workspace_id", "account_id"]) {
    assert.equal(key in params.metadata, false, `${key} would make another webhook act on it`);
  }
  assert.equal(params.client_reference_id, undefined);
  assert.equal(params.customer, undefined);
  assert.equal(params.success_url, "https://www.posterract.app/savages?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(params.cancel_url, "https://www.posterract.app/#enter");

  await createGuestCheckout({ plan: "lifetime", stripeClient: stripe });
  const lifetime = stripe.calls.created[1];
  assert.equal(lifetime.mode, "payment");
  assert.equal(lifetime.customer_creation, "always");
  assert.deepEqual(lifetime.payment_intent_data.metadata, { product: "aiforsavages", plan: "lifetime", flow: GUEST_FLOW });
});

test("plans: only prices that are what their name says", async () => {
  const stripe = fakeStripe({
    prices: {
      price_afs_monthly: { active: true, currency: "usd", unit_amount: 5999, recurring: { interval: "month" } },
      price_afs_yearly: { active: true, currency: "usd", unit_amount: 59999, recurring: { interval: "month" } }, // wrong
      price_afs_lifetime: { active: true, currency: "usd", unit_amount: 200000, recurring: null },
    },
  });
  assert.deepEqual(await publicPlans({ stripeClient: stripe }), [
    { id: "monthly", amount: 5999, currency: "usd", interval: "month" },
    { id: "lifetime", amount: 200000, currency: "usd", interval: null },
  ]);
});

test("redirects may point at either of our two sites, nowhere else", () => {
  assert.equal(siteUrl("https://www.posterract.app/portals?savages=joined", "/x"), "https://www.posterract.app/portals?savages=joined");
  assert.equal(siteUrl("https://posterract.app/portals", "/x"), "https://posterract.app/portals");
  assert.equal(siteUrl("https://www.aiforsavages.fyi/?join=monthly", "/x"), "https://www.aiforsavages.fyi/?join=monthly");
  assert.equal(siteUrl("https://evil.example/", "/?success=true"), "https://www.aiforsavages.fyi/?success=true");
});
