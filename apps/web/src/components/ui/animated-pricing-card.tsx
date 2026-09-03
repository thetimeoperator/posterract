import { useState } from "react";
import { ArrowUpRight, Check } from "lucide-react";

type BillingInterval = "monthly" | "yearly";

type AnimatedPricingCardProps = {
  onLaunch: () => void;
};

const FEATURES = [
  "Cross-platform scheduling",
  "The full desktop video editor",
  "AI generation with your own API keys",
  "Instagram, Facebook, Threads + TikTok draft delivery",
  "Unified history and authorized analytics",
  "Agent-ready API keys + media storage",
];

function SignalCross() {
  return (
    <svg viewBox="0 0 130 130" fill="none" aria-hidden="true">
      <path d="m11 11 107.899 108M11.101 119 119 11" stroke="currentColor" strokeWidth="24" />
    </svg>
  );
}

export function AnimatedPricingCard({ onLaunch }: AnimatedPricingCardProps) {
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");
  const yearly = billingInterval === "yearly";

  return (
    <article className="site-pricing-card">
      <div className="site-pricing-cross site-pricing-cross-top" aria-hidden="true"><SignalCross /></div>
      <div className="site-pricing-cross site-pricing-cross-bottom" aria-hidden="true"><SignalCross /></div>

      <div className="site-pricing-card-content">
        <header className="site-pricing-card-header">
          <h3>Creator</h3>
          <span className="site-pricing-plan-status"><i /> FULL ACCESS</span>
        </header>

        <div className="site-pricing-toggle" aria-label="Billing interval">
          <button
            type="button"
            className={!yearly ? "is-active" : undefined}
            aria-pressed={!yearly}
            onClick={() => setBillingInterval("monthly")}
          >
            Monthly
          </button>
          <button
            type="button"
            className={yearly ? "is-active" : undefined}
            aria-pressed={yearly}
            onClick={() => setBillingInterval("yearly")}
          >
            Yearly <span>Save $40</span>
          </button>
        </div>

        <div className="site-pricing-price" aria-live="polite">
          <span className="site-pricing-currency">$</span>
          <strong key={billingInterval}>{yearly ? "200" : "20"}</strong>
          <div>
            <span>/ {yearly ? "year" : "month"}</span>
            <small>{yearly ? "$16.67 per month" : "Billed monthly"}</small>
          </div>
        </div>

        <p className="site-pricing-summary">
          One plan for creators and agents: the scheduler, the editor, and the AI tools inside it. Bring your own AI keys—pay the providers directly, we never mark up generation.
        </p>

        <ul className="site-pricing-features">
          {FEATURES.map((feature) => (
            <li key={feature}><span><Check size={13} strokeWidth={2.4} /></span>{feature}</li>
          ))}
        </ul>

        <button className="site-pricing-cta" type="button" onClick={onLaunch}>
          <span>Start with Creator</span>
          <ArrowUpRight size={19} strokeWidth={2} />
        </button>

        <div className="site-pricing-card-footer">
          <span>MONTHLY OR ANNUAL</span>
          <span>SECURE CHECKOUT</span>
          <strong>READY TO LAUNCH</strong>
        </div>
      </div>
    </article>
  );
}
