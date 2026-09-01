/**
 * Billing API client shared by the paywall gate and the settings billing
 * panel. Stripe URLs and price ids always come from these endpoints — the
 * interface never hardcodes a checkout target.
 */
import type { BillingCheckoutDTO, BillingSubscriptionDTO } from "@posterract/contract";
import { posterractApiUrl } from "@/lib/authClient";
import { cloudJson } from "@/lib/cloudRequest";
import type { ExtendedBillingConfig, PlanTierId } from "./plans";

export async function billingRequest<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  if (!posterractApiUrl) throw new Error("Billing is unavailable in this environment.");
  return cloudJson<T>(posterractApiUrl, path, {
    ...init,
    signal,
    cache: "no-store",
  });
}

export function fetchBillingConfig(signal?: AbortSignal): Promise<ExtendedBillingConfig> {
  return billingRequest<ExtendedBillingConfig>("/v1/billing/config", {}, signal);
}

export function fetchBillingSubscription(signal?: AbortSignal): Promise<BillingSubscriptionDTO> {
  return billingRequest<BillingSubscriptionDTO>("/v1/billing/subscription", {}, signal);
}

/**
 * Start Stripe Checkout. `plan` names one of the three tiers; it is omitted
 * from the type only, never the wire — an API that still knows a single plan
 * ignores the extra field, and the tiered API resolves it to the right price.
 */
export function createBillingCheckout(input: {
  interval: "monthly" | "yearly";
  plan?: PlanTierId;
}): Promise<BillingCheckoutDTO> {
  return billingRequest<BillingCheckoutDTO>("/v1/billing/checkout", {
    method: "POST",
    headers: { "Idempotency-Key": `checkout-${crypto.randomUUID()}` },
    body: JSON.stringify(input),
  });
}

export function createBillingPortal(): Promise<{ url: string }> {
  return billingRequest<{ url: string }>("/v1/billing/portal", {
    method: "POST",
    headers: { "Idempotency-Key": `portal-${crypto.randomUUID()}` },
    body: JSON.stringify({}),
  });
}
