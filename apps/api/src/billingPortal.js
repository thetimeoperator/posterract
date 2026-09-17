import { createHash } from "node:crypto";

/** Separate Posterract portal configurations; never edit the shared default. */
export function createPortalConfigurationResolver(stripe, config) {
  const cache = new Map();
  return async function ensurePortalConfiguration(plan) {
    if (plan !== undefined && plan !== "pro") throw new Error("Only the Pro plan is available");
    const prices = plan ? Object.values(config.creditPrices[plan]).filter(Boolean) : [];
    const settings = {
      business_profile: {
        headline: "Manage your Posterract subscription",
        privacy_policy_url: `${config.siteUrl}/privacy`,
        terms_of_service_url: `${config.siteUrl}/terms`,
      },
      default_return_url: `${config.siteUrl}/settings`,
      features: {
        customer_update: { enabled: true, allowed_updates: ["name", "email", "address"] },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
        // Stripe permits only one price per product/currency/interval in a
        // portal catalog. Each confirmed target tier gets its own catalog.
        subscription_update: plan ? {
          enabled: true,
          default_allowed_updates: ["price"],
          products: [{ product: config.productId, prices }],
          billing_cycle_anchor: "unchanged",
          proration_behavior: "always_invoice",
          schedule_at_period_end: { conditions: [{ type: "decreasing_item_amount" }, { type: "shortening_interval" }] },
        } : { enabled: false },
      },
    };
    const fingerprint = createHash("sha256").update(JSON.stringify(settings)).digest("hex");
    if (cache.has(fingerprint)) return cache.get(fingerprint);
    const pending = (async () => {
      const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
      const match = existing.data.find((entry) => !entry.is_default && entry.metadata?.posterract_config === fingerprint);
      if (match) return match.id;
      const created = await stripe.billingPortal.configurations.create({
        ...settings,
        metadata: { app: "posterract", product_id: config.productId, target_plan: plan ?? "management", posterract_config: fingerprint },
      }, { idempotencyKey: `posterract:portal-config:${fingerprint}` });
      return created.id;
    })();
    cache.set(fingerprint, pending);
    try { return await pending; } catch (error) { cache.delete(fingerprint); throw error; }
  };
}
