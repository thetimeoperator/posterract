import assert from "node:assert/strict";
import Stripe from "stripe";
import pg from "pg";
import { createStripeBillingService, CREDIT_PLANS } from "../src/billing.js";

const apply = process.argv.includes("--apply");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const postgres = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const service = createStripeBillingService({ postgres, stripeClient: stripe });
  await service.verifyCatalog();
  const retired = [];
  const keep = new Set(Object.values(service.config.creditPrices.pro));
  for (const plan of ["allstar", "superstar"]) {
    for (const interval of ["monthly", "yearly"]) {
      const id = service.config.creditPrices[plan][interval];
      if (!id) continue;
      assert.ok(!keep.has(id), "A retired price must not be a Pro price");
      const price = await stripe.prices.retrieve(id);
      assert.equal(price.product, service.config.productId);
      assert.equal(price.livemode, true);
      assert.equal(price.currency, "usd");
      assert.equal(price.unit_amount, CREDIT_PLANS[plan][interval === "monthly" ? "monthlyAmount" : "yearlyAmount"]);
      retired.push(price);
    }
  }
  const retiredIds = new Set(retired.map(price => price.id));
  const sessions = [];
  for await (const session of stripe.checkout.sessions.list({ status: "open", limit: 100 })) {
    if (session.livemode && session.mode === "subscription" && retiredIds.has(session.metadata?.price_id)) sessions.push(session);
  }
  const configurations = [];
  for await (const config of stripe.billingPortal.configurations.list({ active: true, limit: 100 })) {
    if (!config.is_default && config.metadata?.app === "posterract" && config.metadata?.product_id === service.config.productId && ["allstar", "superstar"].includes(config.metadata?.target_plan)) configurations.push(config);
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", pricesToArchive: retired.filter(price => price.active).map(price => ({ id: price.id, amount: price.unit_amount })), openRetiredCheckouts: sessions.length, retiredPortalConfigurations: configurations.length }));
  if (apply) {
    for (const session of sessions) await stripe.checkout.sessions.expire(session.id);
    for (const price of retired) if (price.active) await stripe.prices.update(price.id, { active: false });
    for (const config of configurations) await stripe.billingPortal.configurations.update(config.id, { active: false });
    await service.ensurePortalConfiguration();
    await service.ensurePortalConfiguration("pro");
    console.log(JSON.stringify({ retiredPricesArchived: true, onlyProOffered: true }));
  }
} finally { await postgres.end(); }
