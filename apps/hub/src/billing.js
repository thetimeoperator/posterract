import Stripe from "stripe";

import { postgres, withTransaction, normalizeEmail } from "./db.js";
import { queueReview, findOrCreatePerson } from "./provisioning.js";

/**
 * AI FOR SAVAGES billing (§8).
 *
 * This Stripe account also carries Posterract, makeaiugcvids and others, so
 * the separation rules are load-bearing:
 *
 *   - the Hub creates its OWN customer per person, tagged
 *     metadata.product = 'aiforsavages'. It never reuses the customer
 *     Posterract made for that person's workspace.
 *   - it never writes workspace_id into metadata or client_reference_id,
 *     because that is exactly what Posterract's webhook looks for.
 *   - it acts ONLY on the three AFS price IDs. Note the legacy one-time price
 *     shares the same Stripe *product*, so matching is by PRICE ID.
 */

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-05-28.basil",
    })
  : null;

const PRODUCT_ID = "aiforsavages";
const GRACE_DAYS = 3;

/** plan -> price id. Server-side only; the client never sends a price. */
export const PRICES = {
  monthly: process.env.AFS_STRIPE_PRICE_MONTHLY ?? "",
  yearly: process.env.AFS_STRIPE_PRICE_YEARLY ?? "",
  lifetime: process.env.AFS_STRIPE_PRICE_LIFETIME ?? "",
};

export function planForPrice(priceId) {
  for (const [plan, id] of Object.entries(PRICES)) {
    if (id && id === priceId) return plan;
  }
  return null;
}

/** True only for prices this product owns. Everything else is ignored. */
export function isOurPrice(priceId) {
  return planForPrice(priceId) !== null;
}

/* ------------------------------------------------------------------ */
/* customers                                                           */
/* ------------------------------------------------------------------ */

/** Our own customer for this person, created once and remembered. */
export async function customerFor(accountId) {
  const existing = await postgres.query(
    `select stripe_customer_id
       from core.memberships
      where account_id = $1 and stripe_customer_id is not null
      order by created_at desc limit 1`,
    [accountId],
  );
  if (existing.rows[0]?.stripe_customer_id) {
    return existing.rows[0].stripe_customer_id;
  }

  const person = await postgres.query(
    `select email, display_name from app_users where id = $1`,
    [accountId],
  );
  if (!person.rows[0]) throw new Error("account_not_found");

  const customer = await stripe.customers.create({
    email: person.rows[0].email,
    name: person.rows[0].display_name ?? undefined,
    // deliberately NO workspace_id — Posterract's webhook keys off that
    metadata: { account_id: accountId, product: PRODUCT_ID },
  });
  return customer.id;
}

/* ------------------------------------------------------------------ */
/* checkout                                                            */
/* ------------------------------------------------------------------ */

/**
 * Redirect targets must point at our own site. The website passes these
 * through from its own config, but the Hub does not take that on trust: a
 * caller who could steer the post-payment redirect could land a paying member
 * on a phishing page. Anything else falls back to the default.
 */
export function siteUrl(candidate, fallbackPath) {
  const base = String(process.env.AFS_SITE_URL ?? "").replace(/\/+$/, "");
  const fallback = `${base}${fallbackPath}`;
  if (typeof candidate !== "string" || !candidate) return fallback;
  try {
    const url = new URL(candidate);
    // our own two sites: AI FOR SAVAGES, and Posterract (its upgrade button)
    const ours = sameSite(url, base) || sameSite(url, posterractUrl(""));
    return ours ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function sameSite(url, base) {
  try {
    const home = new URL(base);
    return (
      url.protocol === home.protocol &&
      (url.hostname === home.hostname ||
        url.hostname === home.hostname.replace(/^www\./, "") ||
        `www.${url.hostname}` === home.hostname)
    );
  } catch {
    return false;
  }
}

export async function createCheckout({ accountId, plan, successUrl, cancelUrl }) {
  const price = PRICES[plan];
  if (!price) return { ok: false, reason: "unknown_plan" };

  // refuse to sell a second membership to someone who already has one
  const live = await postgres.query(
    `select core.has_membership($1, $2) as ok`,
    [accountId, PRODUCT_ID],
  );
  if (live.rows[0]?.ok === true) {
    return { ok: false, reason: "already_a_member" };
  }

  const customer = await customerFor(accountId);
  const mode = plan === "lifetime" ? "payment" : "subscription";

  const session = await stripe.checkout.sessions.create({
    mode,
    customer,
    // Cards only. Delayed methods (bank debits) complete the session before
    // the money arrives, and access must never be granted on a promise.
    payment_method_types: ["card"],
    line_items: [{ price, quantity: 1 }],
    client_reference_id: accountId,
    metadata: { account_id: accountId, product: PRODUCT_ID, plan },
    ...(mode === "subscription"
      ? {
          subscription_data: {
            metadata: { account_id: accountId, product: PRODUCT_ID, plan },
          },
        }
      : {
          payment_intent_data: {
            metadata: { account_id: accountId, product: PRODUCT_ID, plan },
          },
        }),
    success_url: siteUrl(successUrl, "/?success=true"),
    cancel_url: siteUrl(cancelUrl, "/?canceled=true"),
  });

  return { ok: true, url: session.url, id: session.id };
}

export async function createPortal({ accountId, returnUrl }) {
  const customer = await customerFor(accountId);
  const session = await stripe.billingPortal.sessions.create({
    customer,
    return_url: siteUrl(returnUrl, "/profile"),
    // own configuration, scoped to this product, so a member can never see or
    // cancel a Posterract subscription from the AFS account page
    ...(process.env.AFS_STRIPE_PORTAL_CONFIGURATION
      ? { configuration: process.env.AFS_STRIPE_PORTAL_CONFIGURATION }
      : {}),
  });
  return { url: session.url };
}

/** Cancel only ever stops the NEXT charge. Never refunds. */
export async function cancelMembership(accountId) {
  const row = await postgres.query(
    `select stripe_subscription_id from core.memberships
      where account_id = $1 and product_id = $2
        and status in ('active','past_due')
      order by created_at desc limit 1`,
    [accountId, PRODUCT_ID],
  );
  const subscriptionId = row.rows[0]?.stripe_subscription_id;
  if (!subscriptionId) return { ok: false, reason: "no_active_subscription" };

  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
  await postgres.query(
    `update core.memberships set cancel_at_period_end = true, updated_at = now()
      where stripe_subscription_id = $1`,
    [subscriptionId],
  );
  return { ok: true };
}

export async function resumeMembership(accountId) {
  const row = await postgres.query(
    `select stripe_subscription_id from core.memberships
      where account_id = $1 and product_id = $2
        and status in ('active','past_due')
      order by created_at desc limit 1`,
    [accountId, PRODUCT_ID],
  );
  const subscriptionId = row.rows[0]?.stripe_subscription_id;
  if (!subscriptionId) return { ok: false, reason: "no_active_subscription" };

  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });
  await postgres.query(
    `update core.memberships set cancel_at_period_end = false, updated_at = now()
      where stripe_subscription_id = $1`,
    [subscriptionId],
  );
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* webhook                                                             */
/* ------------------------------------------------------------------ */

/** The billing period lives on the subscription ITEM in this API version. */
function periodFromSubscription(subscription) {
  const item = subscription?.items?.data?.[0];
  const start = item?.current_period_start ?? subscription?.current_period_start;
  const end = item?.current_period_end ?? subscription?.current_period_end;
  return {
    start: start ? new Date(start * 1000) : null,
    end: end ? new Date(end * 1000) : null,
  };
}

async function accountIdFrom(object) {
  const direct =
    object?.metadata?.account_id ?? object?.client_reference_id ?? null;
  if (direct) return direct;

  const customerId =
    typeof object?.customer === "string" ? object.customer : object?.customer?.id;
  if (!customerId) return null;

  const known = await postgres.query(
    `select account_id from core.memberships
      where stripe_customer_id = $1 order by created_at desc limit 1`,
    [customerId],
  );
  if (known.rows[0]) return known.rows[0].account_id;

  // fall back to the customer's own metadata, but only if it is ours
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer?.metadata?.product === PRODUCT_ID) {
      return customer.metadata.account_id ?? null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Handle one Stripe event. The event id is recorded in the SAME transaction as
 * the change, so a duplicate delivery does nothing.
 */
export async function handleStripeEvent(event) {
  return withTransaction(async (client) => {
    const seen = await client.query(
      `insert into core.billing_events (stripe_event_id, type, livemode, status)
       values ($1, $2, $3, 'processed')
       on conflict (stripe_event_id) do nothing
       returning stripe_event_id`,
      [event.id, event.type, event.livemode === true],
    );
    if (seen.rowCount === 0) return { status: "duplicate" };

    const object = event.data?.object ?? {};

    const markIgnored = async (why) => {
      await client.query(
        `update core.billing_events set status = 'ignored' where stripe_event_id = $1`,
        [event.id],
      );
      return { status: "ignored", why };
    };

    switch (event.type) {
      /* ---------------------------------------------------------- */
      case "checkout.session.completed": {
        // A guest checkout from Posterract's landing page: the person comes
        // from the email typed on Stripe's page (fulfillGuestCheckout).
        if (object.metadata?.flow === GUEST_FLOW) {
          const result = await fulfillGuestCheckout(client, object.id);
          if (!result.ok) return markIgnored(result.reason);
          return { status: "processed", kind: `guest_${result.status}` };
        }

        const accountId = await accountIdFrom(object);
        if (!accountId) return markIgnored("no_account");

        // The session completing is not the same as the money arriving. With a
        // delayed payment method this fires with payment_status 'unpaid' and
        // the real outcome comes later as checkout.session.async_payment_*.
        // Cards (all we accept) are always 'paid' here; anything else waits.
        if (object.payment_status !== "paid") {
          return markIgnored(`payment_status_${object.payment_status ?? "unknown"}`);
        }

        if (object.mode === "payment") {
          // lifetime: never expires. Match on the price actually charged (read
          // back from Stripe), never on what the session's metadata claims.
          let chargedPrice = null;
          try {
            const items = await stripe.checkout.sessions.listLineItems(object.id, { limit: 1 });
            chargedPrice = items?.data?.[0]?.price?.id ?? null;
          } catch {
            chargedPrice = null;
          }
          const priceId = chargedPrice === PRICES.lifetime ? PRICES.lifetime : null;
          if (!priceId) return markIgnored("not_our_price");

          await upsertMembership(client, {
            accountId,
            plan: "lifetime",
            status: "active",
            source: "stripe_one_time",
            customerId: typeof object.customer === "string" ? object.customer : null,
            subscriptionId: null,
            priceId,
            start: new Date(),
            end: null,
          });
          return { status: "processed", kind: "lifetime" };
        }

        // subscription: refresh from the subscription object itself
        const subscriptionId =
          typeof object.subscription === "string" ? object.subscription : null;
        if (!subscriptionId) return markIgnored("no_subscription");

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription?.items?.data?.[0]?.price?.id;
        if (!isOurPrice(priceId)) return markIgnored("not_our_price");
        if (!["active", "trialing"].includes(subscription.status)) {
          // first payment still pending (e.g. 3DS) — invoice.paid will activate
          return markIgnored(`subscription_${subscription.status}`);
        }

        const { start, end } = periodFromSubscription(subscription);
        await upsertMembership(client, {
          accountId,
          plan: planForPrice(priceId),
          status: "active",
          source: "stripe_subscription",
          customerId:
            typeof subscription.customer === "string" ? subscription.customer : null,
          subscriptionId,
          priceId,
          start,
          end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
        });
        return { status: "processed", kind: "subscription" };
      }

      /* ---------------------------------------------------------- */
      case "invoice.paid": {
        const linePrice =
          object?.lines?.data?.[0]?.pricing?.price_details?.price ??
          object?.lines?.data?.[0]?.price?.id;
        const subscriptionId =
          typeof object.subscription === "string"
            ? object.subscription
            : object?.parent?.subscription_details?.subscription ?? null;
        if (!subscriptionId) return markIgnored("not_a_subscription_invoice");

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription?.items?.data?.[0]?.price?.id ?? linePrice;
        if (!isOurPrice(priceId)) return markIgnored("not_our_price");

        const accountId =
          (await accountIdFrom(subscription)) ?? (await accountIdFrom(object));
        if (!accountId) {
          // A guest checkout whose first payment cleared after its session's
          // own event (which found it unpaid and was ignored): record it now.
          if (subscription?.metadata?.flow === GUEST_FLOW) {
            const sessions = await stripe.checkout.sessions.list({ subscription: subscriptionId, limit: 1 });
            const sessionId = sessions?.data?.[0]?.id;
            if (sessionId) {
              const result = await fulfillGuestCheckout(client, sessionId);
              if (result.ok) return { status: "processed", kind: `guest_${result.status}` };
              return markIgnored(result.reason);
            }
          }
          return markIgnored("no_account");
        }

        const { start, end } = periodFromSubscription(subscription);
        await upsertMembership(client, {
          accountId,
          plan: planForPrice(priceId),
          status: "active",
          source: "stripe_subscription",
          customerId:
            typeof subscription.customer === "string" ? subscription.customer : null,
          subscriptionId,
          priceId,
          start,
          end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
          clearGrace: true, // a successful payment always clears the grace window
        });
        return { status: "processed", kind: "renewed" };
      }

      /* ---------------------------------------------------------- */
      case "invoice.payment_failed": {
        const subscriptionId =
          typeof object.subscription === "string"
            ? object.subscription
            : object?.parent?.subscription_details?.subscription ?? null;
        if (!subscriptionId) return markIgnored("not_a_subscription_invoice");

        // grace is set ONCE, on the first failure — later retries must not
        // push it further out
        const updated = await client.query(
          `update core.memberships
              set status = 'past_due',
                  grace_until = coalesce(grace_until, now() + ($2 || ' days')::interval),
                  updated_at = now()
            where stripe_subscription_id = $1
            returning account_id, grace_until`,
          [subscriptionId, String(GRACE_DAYS)],
        );
        if (updated.rowCount === 0) return markIgnored("unknown_subscription");
        return { status: "processed", kind: "past_due" };
      }

      /* ---------------------------------------------------------- */
      case "customer.subscription.updated": {
        const priceId = object?.items?.data?.[0]?.price?.id;
        if (!isOurPrice(priceId)) return markIgnored("not_our_price");

        const { start, end } = periodFromSubscription(object);
        const updated = await client.query(
          `update core.memberships
              set cancel_at_period_end = $2,
                  stripe_price_id = $3,
                  plan = $4,
                  current_period_start = coalesce($5, current_period_start),
                  current_period_end = coalesce($6, current_period_end),
                  updated_at = now()
            where stripe_subscription_id = $1
            returning account_id`,
          [
            object.id,
            object.cancel_at_period_end === true,
            priceId,
            planForPrice(priceId),
            start,
            end,
          ],
        );
        if (updated.rowCount === 0) return markIgnored("unknown_subscription");
        return { status: "processed", kind: "updated" };
      }

      /* ---------------------------------------------------------- */
      case "customer.subscription.deleted": {
        const priceId = object?.items?.data?.[0]?.price?.id;
        if (priceId && !isOurPrice(priceId)) return markIgnored("not_our_price");

        const updated = await client.query(
          `update core.memberships
              set status = 'canceled', ended_at = now(), updated_at = now()
            where stripe_subscription_id = $1
            returning account_id`,
          [object.id],
        );
        if (updated.rowCount === 0) return markIgnored("unknown_subscription");
        return { status: "processed", kind: "canceled", accountId: updated.rows[0].account_id };
      }

      /* ---------------------------------------------------------- */
      case "charge.dispute.created":
      case "charge.refunded": {
        // There is no refund policy (decision 14); these only happen when a
        // bank forces it or Sina refunds by hand. Access off immediately.
        const accountId = await accountIdFrom(object);
        if (!accountId) return markIgnored("no_account");

        const updated = await client.query(
          `update core.memberships
              set status = 'refunded', ended_at = now(), updated_at = now()
            where account_id = $1 and product_id = $2
              and status in ('active','past_due')
            returning id`,
          [accountId, PRODUCT_ID],
        );
        if (updated.rowCount > 0) {
          await queueReview(client, event.type, accountId, {
            stripeEventId: event.id,
          });
        }
        return { status: "processed", kind: "refunded", accountId };
      }

      default:
        return markIgnored("unhandled_type");
    }
  });
}

/** Create or refresh the single live membership for a person. */
async function upsertMembership(
  client,
  {
    accountId,
    plan,
    status,
    source,
    customerId,
    subscriptionId,
    priceId,
    start,
    end,
    cancelAtPeriodEnd = false,
    clearGrace = false,
  },
) {
  const live = await client.query(
    `select id, member_since, current_period_end from core.memberships
      where account_id = $1 and product_id = $2
        and status in ('active','past_due')
      order by created_at desc limit 1`,
    [accountId, PRODUCT_ID],
  );

  if (live.rows[0]) {
    // A founding / lifetime / comp membership never expires and must never be
    // downgraded by a subscription event (e.g. one Sina created by hand in the
    // Stripe dashboard). Leave it alone and let the subscription ride.
    if (live.rows[0].current_period_end === null && end !== null) {
      await queueReview(client, "subscription_on_forever_membership", accountId, {
        subscriptionId,
        plan,
      });
      return live.rows[0].id;
    }
    await client.query(
      `update core.memberships
          set plan = $2, status = $3, source = $4,
              stripe_customer_id = coalesce($5, stripe_customer_id),
              stripe_subscription_id = coalesce($6, stripe_subscription_id),
              stripe_price_id = coalesce($7, stripe_price_id),
              current_period_start = coalesce($8, current_period_start),
              current_period_end = $9,
              cancel_at_period_end = $10,
              grace_until = case when $11 then null else grace_until end,
              updated_at = now()
        where id = $1`,
      [
        live.rows[0].id,
        plan,
        status,
        source,
        customerId,
        subscriptionId,
        priceId,
        start,
        end,
        cancelAtPeriodEnd,
        clearGrace,
      ],
    );
    return live.rows[0].id;
  }

  // returning after a lapse starts a NEW membership and resets member_since
  const created = await client.query(
    `insert into core.memberships
       (account_id, product_id, plan, status, source,
        stripe_customer_id, stripe_subscription_id, stripe_price_id,
        current_period_start, current_period_end, cancel_at_period_end, member_since)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
     returning id`,
    [
      accountId,
      PRODUCT_ID,
      plan,
      status,
      source,
      customerId,
      subscriptionId,
      priceId,
      start,
      end,
      cancelAtPeriodEnd,
    ],
  );
  return created.rows[0].id;
}

/* ------------------------------------------------------------------ */
/* legacy checkout bridge — TEMPORARY                                  */
/* ------------------------------------------------------------------ */

/**
 * The old AI FOR SAVAGES one-time price is still on sale, and its checkout is
 * still created and its webhook still received by the website (Vercel), not by
 * the Hub. Until that flow is retired, a person who pays through it would be a
 * paying customer that the Hub has never heard of — and since the site now asks
 * the Hub whether you are a member, they would be locked out of what they just
 * bought.
 *
 * This closes that window. The website calls it after Stripe's signature has
 * already been verified, passing ONLY the checkout session id.
 *
 * Everything else is re-derived here from Stripe and Clerk directly:
 *
 *   - that the session was really paid                  (Stripe)
 *   - which price was actually paid                     (Stripe line items)
 *   - who the person is, and that their email is real   (Clerk)
 *
 * That matters: the old checkout route takes its price id AND its tier from
 * the browser, so a caller can ask for any price and claim any tier. Reading
 * the real price back from Stripe means a cheap or foreign price cannot buy an
 * AI FOR SAVAGES membership, whatever the client claimed.
 *
 * Delete this, and LEGACY_PRICES, once the old checkout is gone.
 */
const LEGACY_PRICES = (process.env.AFS_STRIPE_PRICE_LEGACY ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export async function grantFromLegacySession(sessionId, resolveIdentity) {
  if (!stripe) return { ok: false, reason: "stripe_not_configured" };
  if (typeof resolveIdentity !== "function") {
    return { ok: false, reason: "no_identity_resolver" };
  }
  if (typeof sessionId !== "string" || !sessionId.startsWith("cs_")) {
    return { ok: false, reason: "invalid_session_id" };
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["line_items"],
    });
  } catch {
    return { ok: false, reason: "session_not_found" };
  }

  if (session.payment_status !== "paid") {
    return { ok: false, reason: "not_paid" };
  }

  // The price that was actually charged, not the one anybody claimed.
  const priceId = session.line_items?.data?.[0]?.price?.id ?? null;
  const knownPlan = planForPrice(priceId);
  const isLegacy = priceId !== null && LEGACY_PRICES.includes(priceId);
  if (!knownPlan && !isLegacy) {
    return { ok: false, reason: "not_our_price", priceId };
  }

  const clerkUserId = session.metadata?.userId ?? null;
  if (!clerkUserId) return { ok: false, reason: "no_clerk_user_in_session" };

  // §3: a membership may only ever attach to a verified email address. The
  // lookup is injected so this module stays free of Clerk — the trust boundary
  // is unchanged, because the id being looked up came out of the Stripe
  // session, never out of the request body.
  const identity = await resolveIdentity(clerkUserId);
  if (!identity.verified || !identity.email) {
    return { ok: false, reason: identity.reason ?? "email_not_verified" };
  }

  // The legacy purchase is a one-time payment that never expires — the same
  // deal the imported founders got.
  const plan = knownPlan ?? "founding";
  const source = knownPlan ? "stripe_one_time" : "legacy_one_time";

  return withTransaction(async (client) => {
    // Idempotent on the session, so a Stripe retry or a double delivery
    // cannot produce a second membership.
    const first = await client.query(
      `insert into core.billing_events (stripe_event_id, type, livemode, status)
       values ($1, 'legacy_checkout_bridge', $2, 'processed')
       on conflict (stripe_event_id) do nothing
       returning stripe_event_id`,
      [`legacy:${sessionId}`, session.livemode === true],
    );
    if (first.rowCount === 0) return { ok: true, status: "duplicate" };

    const { accountId } = await findOrCreatePerson(client, {
      email: normalizeEmail(identity.email),
      displayName: identity.displayName ?? null,
      imageUrl: identity.imageUrl ?? null,
    });

    // The other direction of the same rule: if THIS Clerk login is already
    // attached to a different person, the payment must not land on a person
    // the buyer cannot sign in as. Park it for a human instead.
    const linkedElsewhere = await client.query(
      `select account_id from core.identities
        where provider = 'clerk' and provider_user_id = $1`,
      [clerkUserId],
    );
    if (linkedElsewhere.rows[0] && linkedElsewhere.rows[0].account_id !== accountId) {
      await queueReview(client, "legacy_purchase_collision", accountId, {
        session_id: sessionId,
        paying_clerk_user: clerkUserId,
        clerk_user_already_linked_to: linkedElsewhere.rows[0].account_id,
      });
      return { ok: false, reason: "collision", accountId };
    }

    // Link this Clerk login to that person. If the person is already held by a
    // DIFFERENT Clerk login, stop and have a human look — never merge, never
    // silently move a membership between logins.
    const held = await client.query(
      `select provider_user_id from core.identities
        where provider = 'clerk' and account_id = $1`,
      [accountId],
    );
    if (held.rows[0] && held.rows[0].provider_user_id !== clerkUserId) {
      await queueReview(client, "legacy_purchase_collision", accountId, {
        session_id: sessionId,
        existing_clerk_user: held.rows[0].provider_user_id,
        paying_clerk_user: clerkUserId,
      });
      return { ok: false, reason: "collision", accountId };
    }

    await client.query(
      `insert into core.identities (account_id, provider, provider_user_id, email, verified_at)
       values ($1, 'clerk', $2, $3, now())
       on conflict (provider, provider_user_id) do update
         set email = excluded.email, updated_at = now()`,
      [accountId, clerkUserId, normalizeEmail(identity.email)],
    );

    await upsertMembership(client, {
      accountId,
      plan,
      status: "active",
      source,
      customerId: typeof session.customer === "string" ? session.customer : null,
      subscriptionId: null,
      priceId,
      start: new Date(),
      end: null,
      clearGrace: true,
    });

    return { ok: true, status: "granted", accountId, plan };
  });
}

/* ------------------------------------------------------------------ */
/* Posterract: AI FOR SAVAGES for a buyer with no account yet          */
/* ------------------------------------------------------------------ */

/**
 * A checkout opened from Posterract's landing page by someone with no
 * account. Its session carries metadata.flow = GUEST_FLOW and no account_id:
 * the email typed on Stripe's page decides who the buyer is, once Stripe says
 * the money arrived (fulfillGuestCheckout).
 *
 * Its metadata must never carry `userId` or `tier` (the old website's
 * webhook, www.aiforsavages.fyi/api/webhooks/stripe, acts on exactly those
 * keys) or `workspace_id` (Posterract's webhook acts on that).
 */
export const GUEST_FLOW = "posterract_guest";

const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What each plan's Stripe price must be, so a misconfigured price is never shown. */
const PLAN_INTERVAL = { monthly: "month", yearly: "year", lifetime: null };
let plansCache;

/** A page on Posterract's site, for the addresses Stripe sends a buyer back to. */
export function posterractUrl(path) {
  const base = String(process.env.POSTERRACT_SITE_URL ?? "https://www.posterract.app").replace(/\/+$/, "");
  return `${base}${path}`;
}

/**
 * The three plans' live prices from Stripe, for Posterract's landing card.
 * A plan whose price is missing, inactive, or not what its name says is left
 * out. Cached ten minutes; half a minute when something was missing.
 */
export async function publicPlans({ stripeClient = stripe } = {}) {
  if (plansCache && plansCache.expiresAt > Date.now()) return plansCache.value;
  const plans = [];
  for (const [id, priceId] of Object.entries(PRICES)) {
    if (!priceId) continue;
    try {
      const price = await stripeClient.prices.retrieve(priceId);
      const interval = price.recurring?.interval ?? null;
      if (price.active === false || price.currency !== "usd") continue;
      if (!Number.isInteger(price.unit_amount) || interval !== PLAN_INTERVAL[id]) continue;
      plans.push({ id, amount: price.unit_amount, currency: "usd", interval });
    } catch {
      // left out; the card shows what it has
    }
  }
  plansCache = { value: plans, expiresAt: Date.now() + (plans.length === 3 ? 10 * 60_000 : 30_000) };
  return plans;
}

/**
 * Stripe Checkout for someone on Posterract's landing page with no account.
 * The buyer types their email on Stripe's page; fulfillGuestCheckout turns it
 * into a person and a membership once the money has arrived.
 */
export async function createGuestCheckout({ plan, stripeClient = stripe }) {
  const price = PRICES[plan];
  if (!price) return { ok: false, reason: "unknown_plan" };
  const mode = plan === "lifetime" ? "payment" : "subscription";
  // product, plan and flow, and nothing else (see GUEST_FLOW)
  const metadata = { product: PRODUCT_ID, plan, flow: GUEST_FLOW };

  const session = await stripeClient.checkout.sessions.create({
    mode,
    // Cards only, as in createCheckout: access is never granted on a promise.
    payment_method_types: ["card"],
    line_items: [{ price, quantity: 1 }],
    metadata,
    ...(mode === "subscription"
      ? { subscription_data: { metadata } }
      : {
          // a one-time payment makes no Customer unless asked, and refunds
          // find the person through it
          customer_creation: "always",
          payment_intent_data: { metadata },
        }),
    custom_text: {
      submit: {
        message:
          mode === "subscription"
            ? "Use the email you’ll sign in to Posterract with. No refunds, but you can cancel anytime · All sales are final."
            : "Use the email you’ll sign in to Posterract with. One payment, yours for good · All sales are final.",
      },
    },
    success_url: posterractUrl("/savages?session_id={CHECKOUT_SESSION_ID}"),
    cancel_url: posterractUrl("/#enter"),
  });
  return { ok: true, url: session.url, id: session.id };
}

/**
 * Turn a paid guest checkout into a person and a membership, in the caller's
 * transaction. Safe to call any number of times, even at the same moment, for
 * one session: the webhook calls it, and so does Posterract's welcome page in
 * case the webhook is late (Stripe recommends both).
 *
 * The person is whoever owns the email typed on Stripe's page. That needs no
 * verification step here, because a membership only ever reaches someone who
 * proves the email: Posterract counts it only once its own login has verified
 * the address (app_users.email_verified), and the AI FOR SAVAGES site only once
 * Clerk has (resolveAccount). Paying with someone else's address only gives
 * them a membership.
 */
export async function fulfillGuestCheckout(client, sessionId, { session: given, stripeClient = stripe } = {}) {
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) {
    return { ok: false, reason: "invalid_session_id" };
  }

  // 1. Everything is read back from Stripe; nothing is taken from the caller.
  let session = given;
  if (!session) {
    try {
      session = await stripeClient.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] });
    } catch {
      return { ok: false, reason: "session_not_found" };
    }
  }
  if (session?.id !== sessionId) return { ok: false, reason: "session_not_found" };
  if (session.metadata?.flow !== GUEST_FLOW || session.metadata?.product !== PRODUCT_ID) {
    return { ok: false, reason: "not_a_guest_checkout" };
  }
  if (session.status !== "complete" || session.payment_status !== "paid") {
    return { ok: false, reason: "not_paid" };
  }

  // the price actually charged, never the one the metadata names
  const priceId = session.line_items?.data?.[0]?.price?.id ?? null;
  const plan = planForPrice(priceId);
  if (!plan || (plan === "lifetime") !== (session.mode === "payment")) {
    return { ok: false, reason: "not_our_price" };
  }

  const email = normalizeEmail(session.customer_details?.email ?? session.customer_email ?? "");
  if (!EMAIL.test(email)) {
    const parked = await client.query(
      `select 1 from core.review_queue
        where kind = 'guest_checkout_no_email' and details->>'session_id' = $1
        limit 1`,
      [sessionId],
    );
    if (!parked.rows[0]) {
      await queueReview(client, "guest_checkout_no_email", null, { session_id: sessionId });
    }
    return { ok: false, reason: "no_email" };
  }

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;

  let subscription = null;
  if (session.mode === "subscription") {
    if (!subscriptionId) return { ok: false, reason: "no_subscription" };
    subscription = await stripeClient.subscriptions.retrieve(subscriptionId);
    if (subscription?.items?.data?.[0]?.price?.id !== priceId) {
      return { ok: false, reason: "not_our_price" };
    }
    if (!["active", "trialing"].includes(subscription.status)) {
      // the first payment is still settling; invoice.paid finishes this later
      return { ok: false, reason: `subscription_${subscription.status}` };
    }
  }

  // 2. Once per session, however many callers arrive and in whatever order.
  const first = await client.query(
    `insert into core.billing_events (stripe_event_id, type, livemode, status)
     values ($1, 'posterract_guest_checkout', $2, 'processed')
     on conflict (stripe_event_id) do nothing
     returning stripe_event_id`,
    [`guest:${sessionId}`, session.livemode === true],
  );
  if (first.rowCount === 0) return { ok: true, status: "duplicate", email, plan };

  // 3. The person who owns that email, or a new one with a Posterract workspace.
  const { accountId, created } = await findOrCreatePerson(client, {
    email,
    displayName: session.customer_details?.name ?? null,
    imageUrl: null,
  });
  await client.query(
    `update core.billing_events set account_id = $2 where stripe_event_id = $1`,
    [`guest:${sessionId}`, accountId],
  );

  // 4. Already a member: a second payment. Change nothing and park it for
  //    Sina. The new Stripe objects stay untagged, so their later events find
  //    no person and change nothing either.
  const live = await client.query(
    `select id from core.memberships
      where account_id = $1 and product_id = $2 and status in ('active','past_due')
      limit 1`,
    [accountId, PRODUCT_ID],
  );
  if (live.rows[0]) {
    await queueReview(client, "guest_checkout_already_member", accountId, {
      session_id: sessionId,
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: priceId,
    });
    return { ok: true, status: "already_member", accountId, email, plan, created };
  }

  // 5. Tag Stripe's objects with the person, so renewals, failed cards,
  //    cancels and refunds find them the usual way (accountIdFrom).
  if (customerId) {
    await stripeClient.customers.update(customerId, {
      metadata: { account_id: accountId, product: PRODUCT_ID },
    });
  }
  if (subscription) {
    await stripeClient.subscriptions.update(subscription.id, {
      metadata: {
        ...(subscription.metadata ?? {}),
        account_id: accountId,
        product: PRODUCT_ID,
        plan,
        flow: GUEST_FLOW,
      },
    });
  }

  // 6. The membership.
  if (subscription) {
    const { start, end } = periodFromSubscription(subscription);
    await upsertMembership(client, {
      accountId,
      plan,
      status: "active",
      source: "stripe_subscription",
      customerId,
      subscriptionId,
      priceId,
      start,
      end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    });
  } else {
    await upsertMembership(client, {
      accountId,
      plan: "lifetime",
      status: "active",
      source: "stripe_one_time",
      customerId,
      subscriptionId: null,
      priceId,
      start: new Date(),
      end: null,
    });
  }
  return { ok: true, status: "granted", accountId, email, plan, created };
}

/**
 * For Posterract's welcome page: where a guest checkout stands. A paid one is
 * recorded first if Stripe's webhook has not done it yet.
 */
export async function guestCheckoutStatus(
  sessionId,
  { stripeClient = stripe, db = postgres, transaction = withTransaction } = {},
) {
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return { state: "invalid" };
  let session;
  try {
    session = await stripeClient.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] });
  } catch {
    return { state: "invalid" };
  }
  if (session.metadata?.flow !== GUEST_FLOW || session.metadata?.product !== PRODUCT_ID) {
    return { state: "invalid" };
  }
  const plan = planForPrice(session.line_items?.data?.[0]?.price?.id ?? null);
  const typed = normalizeEmail(session.customer_details?.email ?? "") || null;
  if (session.status === "expired") return { state: "invalid" };
  if (session.status !== "complete" || session.payment_status !== "paid") {
    return { state: "pending", email: typed, plan };
  }

  const result = await transaction((client) =>
    fulfillGuestCheckout(client, sessionId, { session, stripeClient }),
  );
  if (!result.ok) {
    if (result.reason === "no_email") return { state: "needs_help", plan };
    if (result.reason === "no_subscription" || result.reason.startsWith("subscription_")) {
      return { state: "pending", email: typed, plan };
    }
    return { state: "invalid" };
  }

  const parked = await db.query(
    `select 1 from core.review_queue
      where kind = 'guest_checkout_already_member' and details->>'session_id' = $1
      limit 1`,
    [sessionId],
  );
  if (parked.rows[0]) return { state: "already_member", email: result.email, plan };

  const person = await db.query(
    `select id, (auth_user_id is not null) as has_login
       from app_users where lower(email) = $1 limit 1`,
    [result.email],
  );
  const accountId = person.rows[0]?.id ?? null;
  const member = accountId
    ? (await db.query(`select core.has_membership($1, $2) as ok`, [accountId, PRODUCT_ID])).rows[0]?.ok === true
    : false;
  return {
    state: member ? "active" : "pending",
    email: result.email,
    plan,
    hasPosterractLogin: person.rows[0]?.has_login === true,
  };
}
