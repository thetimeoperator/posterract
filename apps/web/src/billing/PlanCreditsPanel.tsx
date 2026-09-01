import { useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowUpRight, Zap } from "lucide-react";
import type { BillingSubscriptionDTO } from "@posterract/contract";
import { Button, Panel, pushSignal } from "@posterract/hyperkit";
import { ENGINE_BACKEND, refreshCredits, useCredits } from "@/engine/useEngine";
import { fetchCreditsLedger } from "@/lib/ai";
import { openExternalUrl } from "@/lib/desktop";
import { formatWhen } from "@/lib/fmt";
import {
  createBillingCheckout,
  createBillingPortal,
  fetchBillingConfig,
  fetchBillingSubscription,
} from "./api";
import {
  CREDIT_RATES,
  PLAN_TIERS,
  PLAN_TIER_BY_ID,
  creditsResetInfo,
  formatCredits,
  formatUsd,
  readTierCatalog,
  tierMonthlyPrice,
  type BillingTierCatalog,
  type CreditLedgerEntry,
  type PlanTierId,
} from "./plans";

const CLOUD_BILLING = ENGINE_BACKEND === "postgres";

type LedgerStatus = "loading" | "ready" | "unavailable";

const LEDGER_KIND_LABEL: Record<CreditLedgerEntry["kind"], string> = {
  grant: "Grant",
  reserve: "Reserve",
  settle: "Settle",
  refund: "Refund",
  expire: "Expire",
};

/**
 * Plan + AI credits surface on Settings: current plan, credit meter against
 * the monthly allotment, the three-tier upgrade matrix, and the usage ledger.
 * Checkout and portal URLs always come from the billing API; tiers the API
 * does not advertise stay visible but cannot be purchased.
 */
export function PlanCreditsPanel() {
  const credits = useCredits();
  const [subscription, setSubscription] = useState<BillingSubscriptionDTO | null>(null);
  const [tierCatalog, setTierCatalog] = useState<BillingTierCatalog>({});
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
  const [ledgerStatus, setLedgerStatus] = useState<LedgerStatus>(
    CLOUD_BILLING ? "loading" : "unavailable",
  );
  const [busyTier, setBusyTier] = useState<PlanTierId | "portal" | null>(null);

  useEffect(() => {
    if (!CLOUD_BILLING) return;
    const controller = new AbortController();
    let active = true;

    const load = () => {
      void fetchBillingConfig(controller.signal)
        .then((config) => {
          if (active) setTierCatalog(readTierCatalog(config));
        })
        .catch(() => undefined);
      void fetchBillingSubscription(controller.signal)
        .then((next) => {
          if (active) setSubscription(next);
        })
        .catch(() => undefined);
      void fetchCreditsLedger(50)
        .then((result) => {
          if (!active) return;
          setLedger(Array.isArray(result.entries) ? result.entries : []);
          setLedgerStatus("ready");
        })
        .catch(() => {
          if (active) setLedgerStatus("unavailable");
        });
      void refreshCredits().catch(() => undefined);
    };

    load();
    // Returning from Stripe Checkout/portal lands back on this tab — refresh.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const currentTier: PlanTierId | null = credits.available ? credits.plan : null;
  const currentTierInfo = currentTier ? PLAN_TIER_BY_ID[currentTier] : undefined;
  const entitled = Boolean(subscription?.entitled);
  const reset = creditsResetInfo(credits.cycleResetsAt);
  const used = Math.max(0, credits.allotment - credits.balance);
  const ratio = credits.allotment > 0 ? Math.min(1, Math.max(0, credits.balance / credits.allotment)) : 0;

  const openPortal = async () => {
    setBusyTier("portal");
    try {
      const portal = await createBillingPortal();
      await openExternalUrl(portal.url);
    } catch (error) {
      pushSignal({
        tone: "danger",
        title: "Stripe billing could not be opened",
        detail: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusyTier(null);
    }
  };

  const chooseTier = async (tierId: PlanTierId) => {
    // An entitled workspace changes plans inside the Stripe portal (proration
    // handled there); a workspace without a subscription starts checkout.
    if (entitled) {
      await openPortal();
      return;
    }
    setBusyTier(tierId);
    try {
      const checkout = await createBillingCheckout({ interval: "monthly", plan: tierId });
      await openExternalUrl(checkout.url);
    } catch (error) {
      pushSignal({
        tone: "danger",
        title: "Stripe Checkout could not be opened",
        detail: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusyTier(null);
    }
  };

  return (
    <>
      <Panel kicker="Billing" title="Plan & AI credits" brackets>
        <div className="grid gap-3 lg:grid-cols-[0.92fr_1.08fr]">
          {/* Current plan */}
          <div className="rounded-[16px] border border-[var(--glass-border)] bg-black/10 p-4">
            <p className="kicker !text-[8px]">Current plan</p>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <p className="font-display text-[22px] font-semibold text-starlight">
                {currentTierInfo
                  ? currentTierInfo.name
                  : entitled
                    ? "Posterract Pro"
                    : CLOUD_BILLING
                      ? "No active plan"
                      : "Demo workspace"}
              </p>
              {subscription?.plan && (
                <p className="font-display text-[15px] font-semibold text-starlight-dim">
                  {formatUsd(subscription.plan.unitAmount)}
                  <small className="ml-0.5 text-[9px] font-normal text-starlight-faint">
                    /{subscription.plan.interval}
                  </small>
                </p>
              )}
            </div>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-starlight-dim">
              {currentTierInfo
                ? currentTierInfo.tagline
                : CLOUD_BILLING
                  ? "Manage the subscription attached to this workspace."
                  : "Billing and AI credits go live on the Posterract cloud workspace."}
            </p>
            {subscription?.currentPeriodEnd && (
              <p className="mt-3 text-[9.5px] text-starlight-faint">
                {subscription.cancelAtPeriodEnd ? "Ends" : "Renews"}{" "}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
            {CLOUD_BILLING && (
              <Button
                className="mt-4"
                size="sm"
                variant="secondary"
                disabled={busyTier !== null}
                onClick={() => void openPortal()}
              >
                {busyTier === "portal" ? "Opening Stripe…" : "Manage in Stripe"}
              </Button>
            )}
          </div>

          {/* Credits meter */}
          <div className="rounded-[16px] border border-[var(--glass-border)] bg-black/10 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="kicker !text-[8px]">AI credits</p>
              {reset && (
                <p className="text-[9px] text-starlight-faint">
                  Resets {reset.date} · {reset.label.replace("resets ", "")}
                </p>
              )}
            </div>
            {credits.available ? (
              <>
                <p className="mt-2 font-display text-[26px] font-semibold leading-none text-starlight">
                  {formatCredits(credits.balance)}
                  <small className="ml-1.5 text-[10px] font-normal tracking-normal text-starlight-faint">
                    of {formatCredits(credits.allotment)} cr this cycle
                  </small>
                </p>
                <div
                  className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
                  role="progressbar"
                  aria-label="Credits remaining"
                  aria-valuemin={0}
                  aria-valuemax={credits.allotment}
                  aria-valuenow={credits.balance}
                >
                  <div
                    className={clsx(
                      "h-full rounded-full transition-[width]",
                      ratio <= 0.1 ? "bg-solar" : "bg-neon shadow-glow-neon-sm",
                    )}
                    style={{ width: `${Math.max(ratio * 100, credits.balance > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <p className="mt-2 text-[9.5px] text-starlight-faint">
                  {formatCredits(used)} cr used · generation stops at zero — no surprise charges.
                </p>
              </>
            ) : (
              <p className="mt-3 text-[10.5px] leading-relaxed text-starlight-dim">
                {credits.loading
                  ? "Checking the credit balance…"
                  : CLOUD_BILLING
                    ? "AI credits are not live for this workspace yet. They appear here the moment the credit engine ships."
                    : "AI credits require the cloud workspace — the demo runs without a billing account."}
              </p>
            )}
            <div className="mt-4 grid gap-1 border-t border-white/[0.07] pt-3 sm:grid-cols-2">
              {CREDIT_RATES.map((rate) => (
                <p key={rate.kind} className="text-[8.5px] leading-relaxed text-starlight-faint">
                  <span className="text-starlight-dim">{rate.kind}</span> · {rate.rate}
                </p>
              ))}
            </div>
          </div>
        </div>

        {/* Tier matrix */}
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {PLAN_TIERS.map((tier) => {
            const advertised = tierCatalog[tier.id];
            const isCurrent = currentTier === tier.id;
            const purchasable = CLOUD_BILLING && (entitled || Boolean(advertised));
            const busy = busyTier === tier.id || (busyTier === "portal" && entitled && !isCurrent);
            return (
              <div
                key={tier.id}
                data-testid={`plan-tier-${tier.id}`}
                className={clsx(
                  "flex flex-col rounded-[16px] border p-4 transition-colors",
                  isCurrent
                    ? "border-neon/45 bg-neon/[0.06]"
                    : tier.highlight
                      ? "border-neon/25 bg-black/15"
                      : "border-[var(--glass-border)] bg-black/10",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-display text-[14px] font-semibold text-starlight">{tier.name}</p>
                  {isCurrent ? (
                    <span className="rounded-full border border-neon/40 bg-neon/[0.1] px-2 py-0.5 text-[7.5px] font-semibold tracking-[0.1em] text-neon">
                      CURRENT
                    </span>
                  ) : tier.highlight ? (
                    <span className="rounded-full border border-neon/25 bg-neon/[0.06] px-2 py-0.5 text-[7.5px] font-semibold tracking-[0.1em] text-neon">
                      POPULAR
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 font-display text-[24px] font-semibold leading-none text-starlight">
                  {tierMonthlyPrice(tier, tierCatalog)}
                  <small className="ml-1 text-[10px] font-normal tracking-normal text-starlight-faint">/mo</small>
                </p>
                <p className="mt-1.5 flex items-center gap-1.5 text-[10px] font-medium text-neon">
                  <Zap size={11} strokeWidth={2.4} aria-hidden />
                  {tier.creditNote}
                </p>
                <p className="mt-2 text-[9.5px] leading-relaxed text-starlight-faint">{tier.tagline}</p>
                <div className="mt-auto pt-4">
                  <Button
                    size="sm"
                    variant={isCurrent ? "tertiary" : tier.highlight ? "primary" : "secondary"}
                    className="w-full"
                    disabled={isCurrent || !purchasable || busyTier !== null}
                    onClick={() => void chooseTier(tier.id)}
                  >
                    {isCurrent
                      ? "Current plan"
                      : busy
                        ? "Opening Stripe…"
                        : !CLOUD_BILLING
                          ? "Cloud workspace required"
                          : entitled
                            ? `Switch to ${tier.name}`
                            : advertised
                              ? `Choose ${tier.name}`
                              : "Available soon"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[9px] leading-relaxed text-starlight-faint">
          Plan changes are confirmed on Stripe before anything is charged. Your exports stay on your
          computer — the cloud is only for scheduling.
        </p>
      </Panel>

      <Panel kicker="AI usage" title="Credit ledger" brackets className="min-w-0">
        {ledgerStatus === "unavailable" ? (
          <p className="text-[10.5px] leading-relaxed text-starlight-dim">
            {CLOUD_BILLING
              ? "The usage ledger is not live for this workspace yet."
              : "AI usage appears here on the cloud workspace."}
          </p>
        ) : ledgerStatus === "loading" ? (
          <p className="text-[10.5px] text-starlight-faint">Loading usage…</p>
        ) : ledger.length === 0 ? (
          <div className="flex min-h-28 flex-col items-center justify-center text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-[13px] border border-neon/20 bg-neon/[0.05] text-neon">
              <Zap size={16} />
            </span>
            <p className="mt-3 font-display text-[12.5px] font-semibold text-starlight">No AI usage yet</p>
            <p className="mt-1 max-w-sm text-[10px] text-starlight-faint">
              Generate an image, clip, or voiceover in Create and every credit movement lands here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  {["Kind", "Note", "Credits", "When"].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className={clsx(
                        "pb-2 text-[8px] font-semibold uppercase tracking-[0.1em] text-starlight-faint",
                        heading === "Credits" && "text-right",
                      )}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.id} className="border-b border-white/[0.05] last:border-0">
                    <td className="py-2.5 pr-3">
                      <span
                        className={clsx(
                          "rounded-full border px-2 py-0.5 text-[8px] font-medium",
                          entry.kind === "grant" || entry.kind === "refund"
                            ? "border-neon/25 bg-neon/[0.06] text-neon"
                            : entry.kind === "expire"
                              ? "border-solar/25 bg-solar/[0.06] text-solar"
                              : "border-[var(--glass-border)] text-starlight-dim",
                        )}
                      >
                        {LEDGER_KIND_LABEL[entry.kind] ?? entry.kind}
                      </span>
                    </td>
                    <td className="max-w-[260px] truncate py-2.5 pr-3 text-[10px] text-starlight-dim">
                      {entry.note || (entry.generationId ? `Generation ${entry.generationId.slice(0, 8)}` : "—")}
                    </td>
                    <td
                      className={clsx(
                        "py-2.5 pr-3 text-right font-mono text-[10px] font-semibold",
                        entry.delta > 0 ? "text-auroral" : entry.delta < 0 ? "text-redshift" : "text-starlight-faint",
                      )}
                    >
                      {entry.delta > 0 ? "+" : ""}
                      {formatCredits(entry.delta)}
                    </td>
                    <td className="whitespace-nowrap py-2.5 text-[9.5px] text-starlight-faint">
                      {formatWhen(new Date(entry.createdAt).getTime() || undefined)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

export function BillingReturnBanner() {
  const returnState = new URLSearchParams(window.location.search).get("billing");
  if (returnState !== "success" && returnState !== "cancelled") return null;
  return (
    <div
      role="status"
      className={clsx(
        "flex items-center gap-2 rounded-[14px] border px-4 py-3 text-[10.5px]",
        returnState === "success"
          ? "border-neon/30 bg-neon/[0.06] text-starlight"
          : "border-solar/25 bg-solar/[0.05] text-starlight-dim",
      )}
    >
      <ArrowUpRight size={13} className={returnState === "success" ? "text-neon" : "text-solar"} aria-hidden />
      {returnState === "success"
        ? "Payment confirmed — your plan and credits update within a few seconds."
        : "Checkout was closed before payment. Nothing was charged."}
    </div>
  );
}
