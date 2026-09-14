import { useEffect, useState } from "react";
import { Button, Panel } from "@posterract/hyperkit";
import type { BillingConfigDTO, BillingSubscriptionDTO } from "@posterract/contract";
import { posterractApiUrl } from "@/lib/authClient";
import { cloudJson } from "@/lib/cloudRequest";
import { openExternalUrl } from "@/lib/desktop";
import type { BillingCycle, PlanId } from "./selection";

const apiBase = posterractApiUrl ?? "";
const names = { pro: "Pro", allstar: "Allstar", superstar: "Superstar" };
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const messages: Record<string, string> = {
  billing_admin_required: "Only a workspace owner or admin can manage billing.",
  billing_customer_not_found: "This workspace has no Stripe billing account.",
  subscription_change_pending: "A change or cancellation is already scheduled. Manage it in Stripe before choosing another plan.",
  plan_already_selected: "You already have this plan and billing cycle.",
  active_subscription_required: "Resolve the current payment in Manage billing before changing plans.",
  subscription_not_updatable: "This subscription cannot be changed here. Open Manage billing to review it.",
};

export function BillingSettings() {
  const [subscription, setSubscription] = useState<BillingSubscriptionDTO | null>(null);
  const [config, setConfig] = useState<BillingConfigDTO | null>(null);
  const [plan, setPlan] = useState<PlanId>("pro");
  const [interval, setInterval] = useState<BillingCycle>("monthly");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!apiBase) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      cloudJson<BillingSubscriptionDTO>(apiBase, "/v1/billing/subscription", { signal: controller.signal, cache: "no-store" }),
      cloudJson<BillingConfigDTO>(apiBase, "/v1/billing/config", { signal: controller.signal, cache: "no-store" }),
    ]).then(([next, catalog]) => {
      if (controller.signal.aborted) return;
      setSubscription(next);
      setConfig(catalog);
      setPlan("pro");
      setInterval(next.plan?.interval === "year" ? "yearly" : "monthly");
    }).catch(() => { if (!controller.signal.aborted) setError("Billing details could not be loaded. Try again."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    const refresh = () => setRetry((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); };
  }, [retry]);

  const openPortal = async (changePlan = false) => {
    setBusy(true);
    setError(null);
    try {
      const result = await cloudJson<{ url: string }>(apiBase, "/v1/billing/portal", {
        method: "POST", headers: { "Idempotency-Key": `portal-${crypto.randomUUID()}` },
        body: JSON.stringify(changePlan ? { plan, interval } : {}),
      });
      await openExternalUrl(result.url);
    } catch (cause) {
      setError(cause instanceof Error && messages[cause.message] || "Stripe billing could not be opened. Please try again.");
    } finally { setBusy(false); }
  };
  const selected = config?.creditPlans?.[plan];
  const amount = interval === "yearly" ? selected?.yearlyAmount : selected?.amount;
  const unchanged = subscription?.plan?.id === plan && subscription.plan.interval === (interval === "yearly" ? "year" : "month");
  const canChange = subscription?.canManageBilling && subscription.status === "active" && !subscription.cancelAtPeriodEnd && amount !== undefined && Boolean(interval === "yearly" ? selected?.yearlyPriceId : selected?.priceId);

  if (!apiBase) return null;
  return <Panel kicker="Subscription" title="Billing" brackets>
    {loading ? <p role="status" className="text-sm text-starlight-dim">Loading billing details…</p> : subscription ? <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-display text-lg font-semibold">{subscription.plan?.id ? names[subscription.plan.id] : "Workspace subscription"}</p>
          <p className="mt-1 text-sm text-starlight-dim">{subscription.plan ? `${money(subscription.plan.unitAmount)} / ${subscription.plan.interval}` : "No paid plan"} · {subscription.status.replaceAll("_", " ")}</p>
          {subscription.currentPeriodEnd && <p className="mt-1 text-xs text-starlight-faint">{subscription.cancelAtPeriodEnd ? "Access ends" : "Current period ends"} {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</p>}
        </div>
        {subscription.canManageBilling && <Button onClick={() => void openPortal()} disabled={busy}>{busy ? "Opening Stripe…" : "Manage billing"}</Button>}
      </div>
      <p className="mt-3 text-xs text-starlight-dim">{subscription.canManageBilling ? "Update your payment method, download invoices, or cancel future renewals in Stripe." : "Billing management is available to the owner or an admin of a workspace with a Stripe subscription."}</p>
      {subscription.canManageBilling && subscription.status === "active" && <div className="mt-6 border-t border-white/10 pt-5">
        <h3 className="font-display text-sm font-semibold">Billing cycle</h3>
        <div className="mt-3 grid gap-3">
          <label className="text-xs text-starlight-dim">Billing cycle<select aria-label="New billing cycle" className="mt-1 block w-full rounded-lg border border-white/15 bg-void-2 p-3 text-sm text-starlight" value={interval} onChange={(event) => setInterval(event.target.value as BillingCycle)} disabled={busy}>
            <option value="monthly">Monthly</option><option value="yearly">Yearly</option>
          </select></label>
        </div>
        <p className="mt-3 text-sm text-starlight">{amount !== undefined ? `${names[plan]} — ${money(amount)} / ${interval === "yearly" ? "year" : "month"}` : "This option is currently unavailable."}</p>
        <p className="mb-4 mt-2 text-xs leading-relaxed text-starlight-dim">Pro is $20 per month or $200 per year with your own AI keys. Stripe shows the charge and effective date before you confirm a billing change.</p>
        <Button variant="secondary" disabled={busy || !canChange || unchanged} onClick={() => void openPortal(true)}>Review billing change</Button>
        {subscription.cancelAtPeriodEnd && <p className="mt-2 text-xs text-starlight-dim">Your cancellation is scheduled. Open Manage billing to renew before changing plans.</p>}
      </div>}
    </> : <Button onClick={() => setRetry((value) => value + 1)}>Retry billing</Button>}
    {error && <p role="alert" className="mt-3 text-sm text-redshift">{error}</p>}
  </Panel>;
}
