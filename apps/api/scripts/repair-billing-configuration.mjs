import Stripe from "stripe";
import pg from "pg";
import { createStripeBillingService } from "../src/billing.js";

const apply = process.argv.includes("--apply");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const postgres = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const service = createStripeBillingService({ postgres, stripeClient: stripe });
  await service.verifyCatalog();
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const endpoint = endpoints.data.find((item) => item.url === "https://api.posterract.app/v1/webhooks/stripe");
  if (!endpoint || endpoint.status !== "enabled") throw new Error("Expected Posterract webhook is not enabled");
  const needsExpirationEvent = !endpoint.enabled_events.includes("*") && !endpoint.enabled_events.includes("checkout.session.expired");
  const rows = await postgres.query(
    `select stripe_checkout_session_id, workspace_id, stripe_customer_id
     from billing_checkout_sessions
     where stripe_product_id = $1 and status = 'open' and expires_at < now()`, [service.config.productId],
  );
  const expired = [];
  for (const row of rows.rows) {
    const session = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id);
    if (session.livemode && session.mode === "subscription" && session.status === "expired" && session.customer === row.stripe_customer_id) expired.push({ row, session });
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", needsExpirationEvent, confirmedExpired: expired.length }));
  if (apply) {
    for (const plan of [undefined, "pro"]) await service.ensurePortalConfiguration(plan);
    if (needsExpirationEvent) await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: [...endpoint.enabled_events, "checkout.session.expired"] });
    let repaired = 0;
    for (const { row, session } of expired) {
      const result = await postgres.query(
        `update billing_checkout_sessions set status = 'expired', payment_status = $3, updated_at = now()
         where stripe_checkout_session_id = $1 and workspace_id = $2 and status = 'open'`,
        [row.stripe_checkout_session_id, row.workspace_id, session.payment_status],
      );
      repaired += result.rowCount;
    }
    console.log(JSON.stringify({ portalConfigurationsReady: true, expirationEventEnabled: true, repairedCheckoutStatuses: repaired }));
  }
} finally { await postgres.end(); }
