import { Link } from "@tanstack/react-router";
import clsx from "clsx";
import { Zap } from "lucide-react";
import { useCredits } from "@/engine/useEngine";
import { PLAN_TIER_BY_ID, creditsResetInfo, formatCredits } from "@/billing/plans";

/**
 * Compact AI-credit balance in the app header. Renders nothing until the
 * workspace actually reports credits (demo mode and a not-yet-live endpoint
 * both stay silent); hovering expands plan + reset details, clicking opens
 * the billing surface.
 */
export function CreditsPill() {
  const credits = useCredits();
  if (!credits.available) return null;

  const tier = credits.plan ? PLAN_TIER_BY_ID[credits.plan] : undefined;
  const reset = creditsResetInfo(credits.cycleResetsAt);
  const low = credits.allotment > 0 && credits.balance / credits.allotment <= 0.1;

  return (
    <Link
      to="/settings"
      data-testid="credits-pill"
      className={clsx("app-credits-pill", low && "is-low")}
      aria-label={`${formatCredits(credits.balance)} AI credits — open plan & billing`}
    >
      <Zap size={11} strokeWidth={2.4} aria-hidden />
      <span>{formatCredits(credits.balance)} cr</span>
      <span className="app-credits-pill-card" role="tooltip">
        <strong>{tier ? `${tier.name} plan` : "AI credits"}</strong>
        <small>
          {formatCredits(credits.balance)} of {formatCredits(credits.allotment)} credits
          {reset ? ` · ${reset.label}` : ""}
        </small>
        <em>Open plan & billing</em>
      </span>
    </Link>
  );
}
