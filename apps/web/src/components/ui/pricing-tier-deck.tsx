import { ArrowUpRight, Check, Zap } from "lucide-react";
import { PLAN_TIERS } from "@/billing/plans";

type PricingTierDeckProps = {
  onLaunch: () => void;
};

const SIDE_TIER_TAGS: Record<string, string> = {
  creator: "TASTER",
  agency: "VOLUME",
};

/**
 * The three-tier pricing deck on the marketing site. Studio is the visually
 * highlighted default; catalog data comes from the same plan module the
 * signed-in billing surface uses.
 */
export function PricingTierDeck({ onLaunch }: PricingTierDeckProps) {
  return (
    <div className="site-pricing-tiers">
      {PLAN_TIERS.map((tier, index) => (
        <article
          key={tier.id}
          className={tier.highlight ? "site-tier is-featured" : "site-tier"}
          data-tier={tier.id}
          aria-label={`${tier.name} plan`}
        >
          <header className="site-tier-head">
            <div>
              <span className="site-tier-index">{String(index + 1).padStart(2, "0")}</span>
              <h3>{tier.name}</h3>
            </div>
            {tier.highlight ? (
              <span className="site-pricing-plan-status">
                <i /> DEFAULT PICK
              </span>
            ) : (
              <span className="site-tier-tag">{SIDE_TIER_TAGS[tier.id]}</span>
            )}
          </header>

          <div className="site-tier-price">
            <span className="site-tier-currency">$</span>
            <strong>{tier.monthlyUsd}</strong>
            <div>
              <span>/ month</span>
              <small>BILLED MONTHLY</small>
            </div>
          </div>

          <p className="site-tier-credits">
            <Zap size={12} strokeWidth={2.6} aria-hidden />
            {tier.creditNote}
          </p>

          <p className="site-tier-summary">{tier.tagline}</p>

          <ul className="site-tier-features">
            {tier.features.map((feature) => (
              <li key={feature}>
                <span>
                  <Check size={12} strokeWidth={2.6} />
                </span>
                {feature}
              </li>
            ))}
          </ul>

          <button
            className={tier.highlight ? "site-pricing-cta" : "site-tier-cta"}
            type="button"
            onClick={onLaunch}
          >
            <span>Start with {tier.name}</span>
            <ArrowUpRight size={17} strokeWidth={2} />
          </button>
        </article>
      ))}
    </div>
  );
}
