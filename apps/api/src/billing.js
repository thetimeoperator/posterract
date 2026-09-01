import { createHash } from "node:crypto";
import Stripe from "stripe";
import {
  clearWorkspacePlan,
  grantPlanCycle,
  setWorkspacePlan,
} from "./credits.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * AI credit subscription plans. Each plan maps one Stripe monthly price
 * (configured through STRIPE_PRICE_CREATOR / STRIPE_PRICE_STUDIO /
 * STRIPE_PRICE_AGENCY) to the credits granted every paid cycle. Balances
 * reset to the allotment on each cycle — no rollover at launch.
 */
export const CREDIT_PLANS = Object.freeze({
  creator: Object.freeze({ id: "creator", monthlyAmount: 2_000, credits: 150 }),
  studio: Object.freeze({ id: "studio", monthlyAmount: 5_000, credits: 2_250 }),
  agency: Object.freeze({ id: "agency", monthlyAmount: 10_000, credits: 5_250 }),
});
const ACTIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);
const HANDLED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

export class BillingError extends Error {
  constructor(statusCode, code, message = code) {
    super(message);
    this.name = "BillingError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Fail closed for every product route while leaving auth and billing reachable. */
export function createBillingEntitlementGuard(service) {
  if (!service?.loadSubscription) {
    throw new Error("A Stripe billing service is required for entitlement checks");
  }
  return async function requireBillingEntitlement(request, reply) {
    if (request.authContext?.kind === "internal") return;
    try {
      const subscription = await service.loadSubscription(
        request.authContext?.workspaceId,
      );
      if (!subscription.entitled) {
        return reply.code(402).send({
          error: "subscription_required",
          status: subscription.status,
          accessState: subscription.accessState,
        });
      }
    } catch (error) {
      request.log.error({ err: error }, "Subscription entitlement check failed");
      return reply.code(503).send({ error: "billing_status_unavailable" });
    }
  };
}

function configuredValue(environment, name) {
  const value = environment[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stripeId(value) {
  if (typeof value === "string") return value;
  return value && typeof value.id === "string" ? value.id : undefined;
}

function unixDate(value) {
  return Number.isFinite(Number(value)) ? new Date(Number(value) * 1_000) : null;
}

function dateMillis(value) {
  return value ? new Date(value).getTime() : undefined;
}

function firstSubscriptionItem(subscription) {
  return subscription?.items?.data?.[0];
}

function subscriptionPeriod(subscription) {
  const item = firstSubscriptionItem(subscription);
  return {
    start: subscription?.current_period_start ?? item?.current_period_start,
    end: subscription?.current_period_end ?? item?.current_period_end,
  };
}

function subscriptionIdFromInvoice(invoice) {
  return (
    stripeId(invoice?.subscription) ??
    stripeId(invoice?.parent?.subscription_details?.subscription)
  );
}

function requestHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stripeIdempotencyKey(operation, workspaceId, key) {
  const digest = createHash("sha256")
    .update(`${operation}:${workspaceId}:${key}`)
    .digest("hex");
  return `posterract:${operation}:${digest}`;
}

function requireIdempotencyKey(request) {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8 || value.length > 200) {
    throw new BillingError(400, "idempotency_key_required");
  }
  return value;
}

function safeSiteUrl(value) {
  try {
    const url = new URL(value || "https://posterract.app");
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new Error("The billing return URL must use HTTPS");
    }
    return url.origin;
  } catch {
    return "https://posterract.app";
  }
}

function publicSubscription(row) {
  if (!row) {
    return {
      status: "none",
      accessState: "inactive",
      entitled: false,
      plan: null,
      cancelAtPeriodEnd: false,
    };
  }
  const periodEnd = dateMillis(row.current_period_end);
  // Posterract is paid-only: trials and failed-payment grace periods do not
  // unlock product access. Stripe's active status is the entitlement source.
  const entitled =
    Boolean(row.recognized_plan) &&
    row.status === "active" &&
    row.last_payment_status !== "failed";
  return {
    status: row.status,
    accessState: entitled ? "active" : "inactive",
    entitled,
    plan: row.recognized_plan
      ? {
          interval: row.billing_interval,
          currency: row.currency,
          unitAmount: row.unit_amount,
        }
      : null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    currentPeriodStart: dateMillis(row.current_period_start),
    currentPeriodEnd: periodEnd,
    trialEnd: dateMillis(row.trial_end),
    cancelAt: dateMillis(row.cancel_at),
    canceledAt: dateMillis(row.canceled_at),
    lastPaymentStatus: row.last_payment_status ?? undefined,
    lastPaymentAt: dateMillis(row.last_payment_at),
    updatedAt: dateMillis(row.updated_at),
  };
}

function configuration(environment) {
  const config = {
    secretKey: configuredValue(environment, "STRIPE_SECRET_KEY"),
    webhookSecret: configuredValue(environment, "STRIPE_WEBHOOK_SECRET"),
    publishableKey: configuredValue(environment, "STRIPE_PUBLISHABLE_KEY"),
    productId: configuredValue(environment, "STRIPE_PRODUCT_ID"),
    monthlyPriceId: configuredValue(environment, "STRIPE_MONTHLY_PRICE_ID"),
    yearlyPriceId: configuredValue(environment, "STRIPE_YEARLY_PRICE_ID"),
    creditPrices: {
      creator: configuredValue(environment, "STRIPE_PRICE_CREATOR"),
      studio: configuredValue(environment, "STRIPE_PRICE_STUDIO"),
      agency: configuredValue(environment, "STRIPE_PRICE_AGENCY"),
    },
    siteUrl: safeSiteUrl(
      configuredValue(environment, "SITE_URL") ??
        configuredValue(environment, "PUBLIC_WEB_URL"),
    ),
  };
  const errors = [];
  if (!config.secretKey?.startsWith("sk_live_")) errors.push("STRIPE_SECRET_KEY");
  if (!config.publishableKey?.startsWith("pk_live_")) {
    errors.push("STRIPE_PUBLISHABLE_KEY");
  }
  if (!config.productId?.startsWith("prod_")) errors.push("STRIPE_PRODUCT_ID");
  if (!config.monthlyPriceId?.startsWith("price_")) {
    errors.push("STRIPE_MONTHLY_PRICE_ID");
  }
  if (!config.yearlyPriceId?.startsWith("price_")) {
    errors.push("STRIPE_YEARLY_PRICE_ID");
  }
  return { ...config, errors, configured: errors.length === 0 };
}

function creditPlanForPrice(config, priceId) {
  if (typeof priceId !== "string" || priceId.length === 0) return undefined;
  return Object.values(CREDIT_PLANS).find(
    (plan) => config.creditPrices[plan.id] === priceId,
  );
}

function cycleDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function invoiceCreditPlan(config, invoice) {
  for (const line of invoice?.lines?.data ?? []) {
    const priceId =
      stripeId(line?.price) ?? line?.pricing?.price_details?.price;
    const plan = creditPlanForPrice(config, priceId);
    if (plan) {
      return {
        plan,
        periodStart: unixDate(line?.period?.start),
        periodEnd: unixDate(line?.period?.end),
      };
    }
  }
  return undefined;
}

async function subscriptionCreditPlan(client, config, subscriptionId) {
  if (!subscriptionId) return undefined;
  const result = await client.query(
    `select stripe_price_id, current_period_start, current_period_end
     from billing_subscriptions
     where stripe_subscription_id = $1
     limit 1`,
    [subscriptionId],
  );
  const row = result.rows[0];
  const plan = creditPlanForPrice(config, row?.stripe_price_id);
  if (!plan) return undefined;
  return {
    plan,
    periodStart: row.current_period_start,
    periodEnd: row.current_period_end,
  };
}

async function workspaceExists(client, workspaceId) {
  if (!UUID_PATTERN.test(workspaceId ?? "")) return false;
  const result = await client.query(
    "select 1 from workspaces where id = $1 limit 1",
    [workspaceId],
  );
  return Boolean(result.rows[0]);
}

async function resolveWorkspaceId(client, object) {
  const metadataWorkspace =
    object?.metadata?.workspace_id ?? object?.client_reference_id;
  if (await workspaceExists(client, metadataWorkspace)) return metadataWorkspace;

  const customerId = stripeId(object?.customer);
  if (customerId) {
    const customer = await client.query(
      `select workspace_id from billing_customers
       where stripe_customer_id = $1 limit 1`,
      [customerId],
    );
    if (customer.rows[0]) return customer.rows[0].workspace_id;
  }

  const subscriptionId =
    object?.object === "subscription"
      ? object.id
      : subscriptionIdFromInvoice(object);
  if (subscriptionId) {
    const subscription = await client.query(
      `select workspace_id from billing_subscriptions
       where stripe_subscription_id = $1 limit 1`,
      [subscriptionId],
    );
    if (subscription.rows[0]) return subscription.rows[0].workspace_id;
  }
  return undefined;
}

async function upsertCustomer(client, workspaceId, customerId) {
  if (!workspaceId || !customerId) return;
  const conflict = await client.query(
    `select workspace_id from billing_customers
     where stripe_customer_id = $1 and workspace_id <> $2 limit 1`,
    [customerId, workspaceId],
  );
  if (conflict.rows[0]) {
    throw new BillingError(409, "stripe_customer_workspace_conflict");
  }
  await client.query(
    `insert into billing_customers
       (workspace_id, stripe_customer_id)
     values ($1, $2)
     on conflict (workspace_id) do update set
       stripe_customer_id = excluded.stripe_customer_id,
       updated_at = now()`,
    [workspaceId, customerId],
  );
}

async function upsertSubscription(client, workspaceId, subscription, config) {
  const customerId = stripeId(subscription.customer);
  if (!customerId) {
    throw new BillingError(422, "stripe_subscription_customer_missing");
  }
  const item = firstSubscriptionItem(subscription);
  const price = item?.price;
  const priceId = stripeId(price);
  const productId = stripeId(price?.product);
  const period = subscriptionPeriod(subscription);
  const interval = price?.recurring?.interval;
  const creditPlan = creditPlanForPrice(config, priceId);
  const recognizedPlan =
    (productId === config.productId &&
      (priceId === config.monthlyPriceId || priceId === config.yearlyPriceId)) ||
    Boolean(creditPlan);
  await upsertCustomer(client, workspaceId, customerId);
  await client.query(
    `insert into billing_subscriptions
       (stripe_subscription_id, workspace_id, stripe_customer_id,
        stripe_product_id, stripe_price_id, billing_interval, currency,
        unit_amount, status, recognized_plan, cancel_at_period_end,
        current_period_start, current_period_end, trial_end, cancel_at,
        canceled_at, ended_at, livemode)
     values
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18)
     on conflict (stripe_subscription_id) do update set
       workspace_id = excluded.workspace_id,
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_product_id = excluded.stripe_product_id,
       stripe_price_id = excluded.stripe_price_id,
       billing_interval = excluded.billing_interval,
       currency = excluded.currency,
       unit_amount = excluded.unit_amount,
       status = excluded.status,
       recognized_plan = excluded.recognized_plan,
       cancel_at_period_end = excluded.cancel_at_period_end,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       trial_end = excluded.trial_end,
       cancel_at = excluded.cancel_at,
       canceled_at = excluded.canceled_at,
       ended_at = excluded.ended_at,
       livemode = excluded.livemode,
       updated_at = now()`,
    [
      subscription.id,
      workspaceId,
      customerId,
      productId,
      priceId,
      interval === "month" || interval === "year" ? interval : null,
      price?.currency ?? null,
      Number.isInteger(price?.unit_amount) ? price.unit_amount : null,
      subscription.status,
      recognizedPlan,
      Boolean(subscription.cancel_at_period_end),
      unixDate(period.start),
      unixDate(period.end),
      unixDate(subscription.trial_end),
      unixDate(subscription.cancel_at),
      unixDate(subscription.canceled_at),
      unixDate(subscription.ended_at),
      Boolean(subscription.livemode),
    ],
  );
  if (creditPlan) {
    // Credit plans: keep the stored plan in sync with the subscription.
    // Downgrade/cancel clears the plan but leaves the balance untouched
    // until the cycle ends; grants happen only on paid invoices.
    if (ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
      await setWorkspacePlan(client, workspaceId, creditPlan.id);
    } else {
      await clearWorkspacePlan(client, workspaceId);
    }
  }
}

async function applyCheckoutEvent(client, workspaceId, session, config) {
  const customerId = stripeId(session.customer);
  const subscriptionId = stripeId(session.subscription);
  const interval = session.metadata?.billing_interval;
  const priceId = session.metadata?.price_id;
  // Tier checkouts carry a credit-plan price, legacy ones the monthly or
  // yearly price. Any other price belongs to a session this deployment never
  // created, so it stays ignored.
  const recognizedPrice =
    priceId === config.monthlyPriceId ||
    priceId === config.yearlyPriceId ||
    Boolean(creditPlanForPrice(config, priceId));
  if (
    session.mode !== "subscription" ||
    !recognizedPrice ||
    (interval !== "month" && interval !== "year")
  ) {
    return false;
  }
  await upsertCustomer(client, workspaceId, customerId);
  await client.query(
    `insert into billing_checkout_sessions
       (stripe_checkout_session_id, workspace_id, user_id,
        stripe_customer_id, stripe_subscription_id, stripe_product_id,
        stripe_price_id, billing_interval, status, payment_status,
        amount_total, currency, expires_at, completed_at)
     values ($1, $2, nullif($3, '')::uuid, $4, $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $14)
     on conflict (stripe_checkout_session_id) do update set
       stripe_customer_id = coalesce(excluded.stripe_customer_id,
                                     billing_checkout_sessions.stripe_customer_id),
       stripe_subscription_id = coalesce(excluded.stripe_subscription_id,
                                         billing_checkout_sessions.stripe_subscription_id),
       status = excluded.status,
       payment_status = excluded.payment_status,
       amount_total = excluded.amount_total,
       currency = excluded.currency,
       expires_at = excluded.expires_at,
       completed_at = excluded.completed_at,
       updated_at = now()`,
    [
      session.id,
      workspaceId,
      session.metadata?.user_id ?? "",
      customerId,
      subscriptionId,
      config.productId,
      priceId,
      interval,
      session.status ?? "complete",
      session.payment_status ?? null,
      Number.isInteger(session.amount_total) ? session.amount_total : null,
      session.currency ?? null,
      unixDate(session.expires_at),
      session.status === "complete" ? new Date() : null,
    ],
  );
  return true;
}

async function applyInvoiceEvent(client, workspaceId, invoice, paymentStatus, config) {
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  const customerId = stripeId(invoice.customer);
  await upsertCustomer(client, workspaceId, customerId);
  const paidAt =
    paymentStatus === "paid"
      ? unixDate(invoice.status_transitions?.paid_at) ?? new Date()
      : null;
  if (subscriptionId) {
    await client.query(
      `insert into billing_subscriptions
         (stripe_subscription_id, workspace_id, stripe_customer_id, status,
          recognized_plan, last_invoice_id, last_payment_status,
          last_payment_at, livemode)
       values ($1, $5, $6, 'unknown', false, $2, $3, $4, $7)
       on conflict (stripe_subscription_id) do update set
         last_invoice_id = excluded.last_invoice_id,
         last_payment_status = excluded.last_payment_status,
         last_payment_at = coalesce(excluded.last_payment_at,
                                    billing_subscriptions.last_payment_at),
         updated_at = now()
       where billing_subscriptions.workspace_id = excluded.workspace_id`,
      [
        subscriptionId,
        invoice.id,
        paymentStatus,
        paidAt,
        workspaceId,
        customerId,
        Boolean(invoice.livemode),
      ],
    );
  } else if (customerId) {
    await client.query(
      `update billing_subscriptions
       set last_invoice_id = $2,
           last_payment_status = $3,
           last_payment_at = coalesce($4, last_payment_at),
           updated_at = now()
       where stripe_subscription_id = (
         select stripe_subscription_id from billing_subscriptions
         where workspace_id = $1 and stripe_customer_id = $5
           and recognized_plan = true
         order by updated_at desc limit 1
       )`,
      [workspaceId, invoice.id, paymentStatus, paidAt, customerId],
    );
  }

  if (paymentStatus === "paid") {
    // A paid subscription invoice for a credit plan starts a fresh cycle:
    // the plan is set and the balance RESETS to the allotment (no rollover).
    const resolved =
      invoiceCreditPlan(config, invoice) ??
      (await subscriptionCreditPlan(client, config, subscriptionId));
    if (resolved) {
      const cycleStartedAt = resolved.periodStart ?? paidAt ?? new Date();
      const cycleResetsAt = resolved.periodEnd ?? null;
      await grantPlanCycle(client, {
        workspaceId,
        plan: resolved.plan.id,
        allotment: resolved.plan.credits,
        cycleStartedAt,
        cycleResetsAt,
        note: `Granted ${resolved.plan.credits} ${resolved.plan.id} credits for cycle ${cycleDate(cycleStartedAt)}${cycleResetsAt ? ` to ${cycleDate(cycleResetsAt)}` : ""}`,
      });
    }
  }
}

export function createStripeBillingService({
  postgres,
  environment = process.env,
  logger = console,
  stripeClient,
} = {}) {
  if (!postgres) throw new Error("A PostgreSQL client is required for billing");
  const config = configuration(environment);
  const stripe =
    stripeClient ??
    (config.secretKey?.startsWith("sk_live_")
      ? new Stripe(config.secretKey, {
          maxNetworkRetries: 2,
          timeout: 10_000,
          appInfo: { name: "Posterract", version: "1.0.0" },
        })
      : undefined);
  let catalogCache;

  function requireConfigured() {
    if (!config.configured || !stripe) {
      throw new BillingError(503, "billing_not_configured");
    }
  }

  async function verifyCatalog() {
    requireConfigured();
    if (catalogCache?.expiresAt > Date.now()) return catalogCache.value;
    const [product, monthly, yearly] = await Promise.all([
      stripe.products.retrieve(config.productId),
      stripe.prices.retrieve(config.monthlyPriceId),
      stripe.prices.retrieve(config.yearlyPriceId),
    ]);
    const expected = [
      [monthly, "month", 2_000],
      [yearly, "year", 20_000],
    ];
    const valid =
      product.active !== false &&
      expected.every(
        ([price, interval, amount]) =>
          price.active !== false &&
          stripeId(price.product) === config.productId &&
          price.type === "recurring" &&
          price.recurring?.interval === interval &&
          price.recurring?.interval_count === 1 &&
          price.currency === "usd" &&
          price.unit_amount === amount,
      );
    if (!valid) {
      throw new BillingError(503, "stripe_catalog_mismatch");
    }
    const value = {
      productId: config.productId,
      monthly: { priceId: config.monthlyPriceId, amount: 2_000, currency: "usd" },
      yearly: { priceId: config.yearlyPriceId, amount: 20_000, currency: "usd" },
    };
    catalogCache = { value, expiresAt: Date.now() + 10 * 60_000 };
    return value;
  }

  async function claimIdempotency(client, actorKey, key, payload) {
    const hash = requestHash(payload);
    const inserted = await client.query(
      `insert into api_idempotency_keys
         (actor_key, idempotency_key, request_hash)
       values ($1, $2, $3)
       on conflict do nothing
       returning actor_key`,
      [actorKey, key, hash],
    );
    if (inserted.rowCount > 0) return { hash };
    const existing = await client.query(
      `select request_hash, status_code, response_body, locked_until
       from api_idempotency_keys
       where actor_key = $1 and idempotency_key = $2`,
      [actorKey, key],
    );
    const record = existing.rows[0];
    if (!record || record.request_hash !== hash) {
      throw new BillingError(409, "idempotency_key_reused");
    }
    if (record.response_body && record.status_code) {
      return { replay: record.response_body, statusCode: record.status_code };
    }
    if (new Date(record.locked_until).getTime() > Date.now()) {
      throw new BillingError(409, "request_in_progress");
    }
    await client.query(
      `update api_idempotency_keys
       set locked_until = now() + interval '2 minutes'
       where actor_key = $1 and idempotency_key = $2`,
      [actorKey, key],
    );
    return { hash };
  }

  async function completeIdempotency(
    client,
    actorKey,
    key,
    statusCode,
    response,
  ) {
    await client.query(
      `update api_idempotency_keys
       set status_code = $3, response_body = $4,
           resource_type = 'stripe_checkout', resource_id = null,
           completed_at = now()
      where actor_key = $1 and idempotency_key = $2`,
      [actorKey, key, statusCode, JSON.stringify(response)],
    );
  }

  async function ensureCustomer(workspaceId, userId) {
    const existing = await postgres.query(
      `select stripe_customer_id from billing_customers
       where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    if (existing.rows[0]) return existing.rows[0].stripe_customer_id;
    const user = await postgres.query(
      "select email, display_name from app_users where id = $1 limit 1",
      [userId],
    );
    const customer = await stripe.customers.create(
      {
        email: user.rows[0]?.email ?? undefined,
        name: user.rows[0]?.display_name ?? undefined,
        metadata: { workspace_id: workspaceId, user_id: userId },
      },
      { idempotencyKey: stripeIdempotencyKey("customer", workspaceId, workspaceId) },
    );
    await upsertCustomer(postgres, workspaceId, customer.id);
    return customer.id;
  }

  async function createCheckout({
    workspaceId,
    userId,
    role,
    interval,
    plan,
    key,
  }) {
    requireConfigured();
    if (role !== "owner" && role !== "admin") {
      throw new BillingError(403, "billing_admin_required");
    }
    if (interval !== "monthly" && interval !== "yearly") {
      throw new BillingError(400, "invalid_billing_interval");
    }
    const tier =
      typeof plan === "string" && Object.hasOwn(CREDIT_PLANS, plan)
        ? CREDIT_PLANS[plan]
        : undefined;
    if (plan !== undefined && plan !== null) {
      if (!tier) throw new BillingError(400, "invalid_plan");
      if (!config.creditPrices[tier.id]) {
        throw new BillingError(400, "billing_plan_not_configured");
      }
      // Tier prices are monthly-only — there is no yearly tier price to sell.
      if (interval === "yearly") {
        throw new BillingError(400, "invalid_billing_interval");
      }
    }
    await verifyCatalog();
    const active = await postgres.query(
      `select status from billing_subscriptions
       where workspace_id = $1 and recognized_plan = true
         and status = any($2::text[])
       order by updated_at desc limit 1`,
      [workspaceId, [...ACTIVE_SUBSCRIPTION_STATUSES]],
    );
    if (active.rows[0]) {
      throw new BillingError(409, "subscription_already_exists");
    }

    const actorKey = `billing:user:${userId}`;
    // The tier is part of the request identity: picking a different plan with
    // a reused key is a conflict, never a replay of the previous choice.
    const payload = {
      operation: "checkout",
      workspaceId,
      interval,
      plan: plan ?? null,
    };
    const claim = await claimIdempotency(postgres, actorKey, key, payload);
    if (claim.replay) return { ...claim.replay, replayed: true };

    const customerId = await ensureCustomer(workspaceId, userId);
    const priceId = tier
      ? config.creditPrices[tier.id]
      : interval === "yearly"
        ? config.yearlyPriceId
        : config.monthlyPriceId;
    const billingInterval = interval === "yearly" ? "year" : "month";
    const metadata = {
      workspace_id: workspaceId,
      user_id: userId,
      billing_interval: billingInterval,
      price_id: priceId,
      plan_tier: tier ? tier.id : null,
    };
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        client_reference_id: workspaceId,
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        payment_method_collection: "always",
        success_url: `${config.siteUrl}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.siteUrl}/settings?billing=cancelled`,
        metadata,
        subscription_data: { metadata },
      },
      { idempotencyKey: stripeIdempotencyKey("checkout", workspaceId, key) },
    );
    const response = {
      sessionId: session.id,
      url: session.url,
      status: session.status,
      expiresAt: session.expires_at ? session.expires_at * 1_000 : undefined,
    };
    await postgres.query(
      `insert into billing_checkout_sessions
         (stripe_checkout_session_id, workspace_id, user_id,
          stripe_customer_id, stripe_product_id, stripe_price_id,
          billing_interval, status, payment_status, amount_total, currency,
          expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (stripe_checkout_session_id) do update set
         status = excluded.status, payment_status = excluded.payment_status,
         amount_total = excluded.amount_total, currency = excluded.currency,
         expires_at = excluded.expires_at, updated_at = now()`,
      [
        session.id,
        workspaceId,
        userId,
        customerId,
        config.productId,
        priceId,
        billingInterval,
        session.status ?? "open",
        session.payment_status ?? null,
        Number.isInteger(session.amount_total) ? session.amount_total : null,
        session.currency ?? "usd",
        unixDate(session.expires_at),
      ],
    );
    await completeIdempotency(postgres, actorKey, key, 201, response);
    return response;
  }

  async function createPortal({ workspaceId, role, key }) {
    requireConfigured();
    if (role !== "owner" && role !== "admin") {
      throw new BillingError(403, "billing_admin_required");
    }
    const customer = await postgres.query(
      `select stripe_customer_id from billing_customers
       where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    if (!customer.rows[0]) throw new BillingError(404, "billing_customer_not_found");
    const session = await stripe.billingPortal.sessions.create(
      {
        customer: customer.rows[0].stripe_customer_id,
        return_url: `${config.siteUrl}/settings`,
      },
      { idempotencyKey: stripeIdempotencyKey("portal", workspaceId, key) },
    );
    return { url: session.url };
  }

  async function loadSubscription(workspaceId) {
    const result = await postgres.query(
      `select * from billing_subscriptions
       where workspace_id = $1
       order by
         recognized_plan desc,
         case status
           when 'active' then 0 when 'trialing' then 1 when 'past_due' then 2
           when 'unpaid' then 3 when 'paused' then 4 else 5
         end,
         updated_at desc
       limit 1`,
      [workspaceId],
    );
    return publicSubscription(result.rows[0]);
  }

  function publicConfig() {
    const creditPlanEntries = Object.values(CREDIT_PLANS)
      .filter((plan) => config.creditPrices[plan.id])
      .map((plan) => [
        plan.id,
        {
          priceId: config.creditPrices[plan.id],
          amount: plan.monthlyAmount,
          currency: "usd",
          interval: "month",
          credits: plan.credits,
        },
      ]);
    return {
      configured: config.configured,
      publishableKey: config.configured ? config.publishableKey : undefined,
      productId: config.configured ? config.productId : undefined,
      plans: config.configured
        ? {
            monthly: {
              priceId: config.monthlyPriceId,
              amount: 2_000,
              currency: "usd",
              interval: "month",
            },
            yearly: {
              priceId: config.yearlyPriceId,
              amount: 20_000,
              currency: "usd",
              interval: "year",
            },
          }
        : undefined,
      creditPlans:
        creditPlanEntries.length > 0
          ? Object.fromEntries(creditPlanEntries)
          : undefined,
      // Tier catalog for the three-tier checkout interface. Same prices as
      // creditPlans, nested per interval because tier prices are monthly-only.
      tiers:
        creditPlanEntries.length > 0
          ? Object.fromEntries(
              creditPlanEntries.map(([id, plan]) => [id, { monthly: plan }]),
            )
          : undefined,
    };
  }

  function webhookStatus() {
    return {
      ok: true,
      service: "posterract-stripe-webhook",
      configured: config.configured && config.webhookSecret?.startsWith("whsec_"),
    };
  }

  function verifyWebhook(rawBody, signature) {
    requireConfigured();
    if (!config.webhookSecret?.startsWith("whsec_")) {
      throw new BillingError(503, "stripe_webhook_not_configured");
    }
    if (!Buffer.isBuffer(rawBody) || typeof signature !== "string") {
      throw new BillingError(400, "invalid_stripe_signature");
    }
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
    } catch {
      throw new BillingError(400, "invalid_stripe_signature");
    }
  }

  async function processWebhook(event, payloadSha256) {
    const client = await postgres.connect();
    try {
      await client.query("begin");
      const inserted = await client.query(
        `insert into stripe_webhook_events
           (stripe_event_id, event_type, api_version, livemode,
            stripe_created_at, payload_sha256, stripe_object_id,
            processing_status)
         values ($1, $2, $3, $4, $5, $6, $7, 'ignored')
         on conflict do nothing
         returning stripe_event_id`,
        [
          event.id,
          event.type,
          event.api_version ?? null,
          Boolean(event.livemode),
          unixDate(event.created),
          payloadSha256,
          stripeId(event.data?.object),
        ],
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query(
          `select payload_sha256 from stripe_webhook_events
           where stripe_event_id = $1`,
          [event.id],
        );
        if (existing.rows[0]?.payload_sha256 !== payloadSha256) {
          throw new BillingError(409, "stripe_event_payload_mismatch");
        }
        await client.query("commit");
        return { received: true, duplicate: true };
      }

      const object = event.data?.object;
      const handled = event.livemode === true && HANDLED_EVENT_TYPES.has(event.type);
      const workspaceId = handled
        ? await resolveWorkspaceId(client, object)
        : undefined;
      let applied = false;
      if (handled && workspaceId) {
        if (
          event.type === "customer.subscription.created" ||
          event.type === "customer.subscription.updated" ||
          event.type === "customer.subscription.deleted"
        ) {
          await upsertSubscription(client, workspaceId, object, config);
          applied = true;
        } else if (
          event.type === "checkout.session.completed" ||
          event.type === "checkout.session.expired"
        ) {
          applied = await applyCheckoutEvent(client, workspaceId, object, config);
        } else if (event.type === "invoice.paid") {
          await applyInvoiceEvent(client, workspaceId, object, "paid", config);
          applied = true;
        } else if (event.type === "invoice.payment_failed") {
          await applyInvoiceEvent(client, workspaceId, object, "failed", config);
          applied = true;
        }
      }

      const processingStatus = applied ? "processed" : "ignored";
      await client.query(
        `update stripe_webhook_events
         set workspace_id = $2, processing_status = $3, processed_at = now()
         where stripe_event_id = $1`,
        [event.id, workspaceId ?? null, processingStatus],
      );
      await client.query("commit");
      return { received: true, processed: processingStatus === "processed" };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    config,
    createCheckout,
    createPortal,
    loadSubscription,
    processWebhook,
    publicConfig,
    verifyCatalog,
    verifyWebhook,
    webhookStatus,
    logger,
  };
}

function billingRouteError(request, reply, error) {
  if (error instanceof BillingError) {
    return reply.code(error.statusCode).send({ error: error.code });
  }
  request.log.error({ err: error }, "Stripe billing request failed");
  return reply.code(502).send({ error: "stripe_request_failed" });
}

export function registerBillingRoutes(app, { service, requireSession }) {
  app.get("/v1/billing/config", async () => service.publicConfig());
  app.get(
    "/v1/billing/subscription",
    { preHandler: requireSession },
    async (request, reply) => {
      try {
        return await service.loadSubscription(request.authContext.workspaceId);
      } catch (error) {
        return billingRouteError(request, reply, error);
      }
    },
  );
  app.post(
    "/v1/billing/checkout",
    { preHandler: requireSession },
    async (request, reply) => {
      try {
        const result = await service.createCheckout({
          workspaceId: request.authContext.workspaceId,
          userId: request.authContext.userId,
          role: request.authContext.role,
          interval: request.body?.interval,
          plan: request.body?.plan,
          key: requireIdempotencyKey(request),
        });
        return reply.code(result.replayed ? 200 : 201).send(result);
      } catch (error) {
        return billingRouteError(request, reply, error);
      }
    },
  );
  app.post(
    "/v1/billing/portal",
    { preHandler: requireSession },
    async (request, reply) => {
      try {
        return await service.createPortal({
          workspaceId: request.authContext.workspaceId,
          role: request.authContext.role,
          key: requireIdempotencyKey(request),
        });
      } catch (error) {
        return billingRouteError(request, reply, error);
      }
    },
  );
}

export async function registerStripeWebhookRoutes(app, { service }) {
  await app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );
    scope.get("/v1/webhooks/stripe", async () => service.webhookStatus());
    scope.post("/v1/webhooks/stripe", async (request, reply) => {
      try {
        const signatureHeader = request.headers["stripe-signature"];
        const signature = Array.isArray(signatureHeader)
          ? signatureHeader[0]
          : signatureHeader;
        const event = service.verifyWebhook(request.body, signature);
        const payloadSha256 = createHash("sha256")
          .update(request.body)
          .digest("hex");
        return await service.processWebhook(event, payloadSha256);
      } catch (error) {
        if (error instanceof BillingError) {
          return reply.code(error.statusCode).send({ error: error.code });
        }
        request.log.error({ err: error }, "Stripe webhook processing failed");
        return reply.code(500).send({ error: "stripe_webhook_processing_failed" });
      }
    });
  });
}
